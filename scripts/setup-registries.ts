// Creates each package under packages/ on npm and JSR and links it to
// .github/workflows/release.yml, so releases can publish with OIDC. Run it
// once by hand: npm needs a logged-in user, and JSR needs a personal access
// token in JSR_TOKEN. Steps that are already done are skipped.
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Effect, FileSystem, Path, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const repository = { owner: "timmo001", name: "triage" };

const workflow = "release.yml";

const placeholderVersion = "0.0.0";

const Manifest = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  license: Schema.String,
  repository: Schema.Struct({
    type: Schema.String,
    url: Schema.String,
    directory: Schema.String,
  }),
});

const JsrPackage = Schema.Struct({
  githubRepository: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ owner: Schema.String, name: Schema.String })),
  ),
});

class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  message: Schema.String,
}) {}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* HttpClient.HttpClient;
  const jsrToken = yield* Config.Redacted("JSR_TOKEN");

  // Interactive, so npm can prompt for a login or one-time password.
  const run = Effect.fn("run")(function* (
    command: string,
    args: ReadonlyArray<string>,
    cwd?: string,
  ) {
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make(command, args, {
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }),
    );

    if (exitCode !== 0) {
      return yield* new SetupError({
        message: `${command} ${args.join(" ")} exited with ${exitCode}`,
      });
    }
  });

  const jsr = http.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl("https://api.jsr.io"),
        HttpClientRequest.bearerToken(Redacted.value(jsrToken)),
        HttpClientRequest.acceptJson,
      ),
    ),
  );

  const setUpNpm = Effect.fn("setUpNpm")(function* (
    manifest: typeof Manifest.Type,
  ) {
    const registry = yield* http.get(
      `https://registry.npmjs.org/${manifest.name.replace("/", "%2f")}`,
    );

    if (registry.status === 404) {
      yield* Effect.log(
        `npm: publishing ${manifest.name}@${placeholderVersion} as a placeholder`,
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const directory = yield* fs.makeTempDirectoryScoped();
          yield* fs.writeFileString(
            path.join(directory, "package.json"),
            `${JSON.stringify(
              {
                ...manifest,
                version: placeholderVersion,
                description: `${manifest.description}. Placeholder release, use a later version.`,
              },
              null,
              2,
            )}\n`,
          );
          yield* run("npm", ["publish", "--access", "public"], directory);
        }),
      );
    } else {
      yield* HttpClientResponse.filterStatusOk(registry);
      yield* Effect.log(`npm: ${manifest.name} already exists`);
    }

    const trust = yield* spawner.string(
      ChildProcess.make("npm", ["trust", "list", manifest.name, "--json"]),
    );

    if (trust.includes(`${repository.owner}/${repository.name}`)) {
      yield* Effect.log(`npm: ${manifest.name} already trusts ${workflow}`);

      return;
    }

    yield* Effect.log(`npm: trusting ${workflow} for ${manifest.name}`);
    yield* run("npm", [
      "trust",
      "github",
      manifest.name,
      "--file",
      workflow,
      "--repo",
      `${repository.owner}/${repository.name}`,
      "--allow-publish",
      "--yes",
    ]);
  });

  const setUpJsr = Effect.fn("setUpJsr")(function* (
    manifest: typeof Manifest.Type,
  ) {
    const [scope, name] = manifest.name.slice(1).split("/");
    const packageUrl = `/scopes/${scope}/packages/${name}`;
    const existing = yield* jsr.get(packageUrl);

    if (existing.status === 404) {
      yield* Effect.log(`JSR: creating ${manifest.name}`);
      yield* HttpClientRequest.post(`/scopes/${scope}/packages`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ package: name }),
        jsr.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
      );
    } else {
      const current = yield* HttpClientResponse.filterStatusOk(existing).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(JsrPackage)),
      );

      if (
        current.githubRepository?.owner === repository.owner &&
        current.githubRepository.name === repository.name
      ) {
        yield* Effect.log(`JSR: ${manifest.name} is already linked`);

        return;
      }
    }

    yield* Effect.log(
      `JSR: linking ${manifest.name} to ${repository.owner}/${repository.name}`,
    );
    yield* HttpClientRequest.patch(packageUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({ githubRepository: repository }),
      jsr.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
    yield* HttpClientRequest.patch(packageUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({ description: manifest.description }),
      jsr.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
  });

  yield* run("npm", ["whoami"]);

  const directories = yield* fs.readDirectory("packages");
  yield* Effect.forEach(
    directories.toSorted(),
    (directory) =>
      Effect.gen(function* () {
        const manifest = yield* fs
          .readFileString(path.join("packages", directory, "package.json"))
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest)),
            ),
          );

        yield* setUpNpm(manifest);
        yield* setUpJsr(manifest);
      }),
    { discard: true },
  );

  yield* Effect.log(
    "Done. Releases can now publish every package to npm and JSR.",
  );
});

program.pipe(
  Effect.provide([BunServices.layer, FetchHttpClient.layer]),
  BunRuntime.runMain,
);
