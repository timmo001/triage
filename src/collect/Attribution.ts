import { Event } from "@timmo001/effect-triage";
import { Context, Effect, FileSystem, Layer, Option } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type Entry, text } from "../journal/Entry.js";
import { rawUnit } from "../journal/toEvent.js";
import { Redactor } from "../redact.js";

/** Changes whenever pacman installs, upgrades or removes a package. */
const pacmanDatabase = "/var/lib/pacman/local";

const owner = / is owned by (?<name>\S+) (?<version>\S+)\s*$/;

/** The name and version in the lines of `/etc/os-release`. */
export const parseOsRelease = (osRelease: string): string | undefined => {
  const values = new Map(
    osRelease.split("\n").flatMap((line) => {
      const match = /^(?<key>[A-Z_]+)=(?<value>.*)$/.exec(line.trim());

      return match?.groups === undefined
        ? []
        : [
            [
              match.groups.key ?? "",
              (match.groups.value ?? "").replace(/^(["'])(.*)\1$/, "$2"),
            ] as const,
          ];
    }),
  );

  const name = values.get("NAME") ?? values.get("ID");
  const version = values.get("VERSION_ID") ?? values.get("BUILD_ID");

  return name === undefined
    ? undefined
    : [name, version].filter((part) => part !== undefined).join(" ");
};

/**
 * Adds the package that owns an event's program or unit, and the OS and
 * kernel the host was running. Only events from the current boot get them,
 * since anything older could have run different versions. Package lookups go
 * through pacman and are cached until its database changes; on hosts without
 * pacman, events get the OS and kernel only.
 */
export class Attribution extends Context.Service<
  Attribution,
  {
    attribute(entry: Entry, event: Event.Event): Effect.Effect<Event.Event>;
  }
>()("triage/collect/Attribution") {
  static readonly layer = Layer.effect(
    Attribution,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const { redact } = yield* Redactor;

      const read = (file: string) =>
        fs.readFileString(file).pipe(
          Effect.map((content) => content.trim()),
          Effect.orElseSucceed(() => ""),
        );

      const bootId = (yield* read("/proc/sys/kernel/random/boot_id")).replace(
        /-/g,
        "",
      );

      const kernel = yield* read("/proc/sys/kernel/osrelease");

      const run = (command: string, args: ReadonlyArray<string>) =>
        spawner
          .string(
            ChildProcess.make(command, args, {
              env: { LC_ALL: "C" },
              extendEnv: true,
            }),
          )
          .pipe(Effect.orElseSucceed(() => ""));

      let stamp: number | undefined;
      let os: string | undefined;
      const packages = new Map<string, Option.Option<Event.Package>>();
      const fragments = new Map<string, string>();

      // Forget cached answers once packages have changed.
      const refresh = Effect.gen(function* () {
        const mtime = yield* fs.stat(pacmanDatabase).pipe(
          Effect.map((info) =>
            Option.match(info.mtime, {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            }),
          ),
          Effect.orElseSucceed(() => 0),
        );

        if (mtime === stamp) {
          return;
        }

        stamp = mtime;
        packages.clear();
        fragments.clear();

        const osRelease = parseOsRelease(yield* read("/etc/os-release"));

        os = osRelease === undefined ? undefined : redact(osRelease);
      });

      const ownerOf = Effect.fnUntraced(function* (path: string) {
        const cached = packages.get(path);

        if (cached !== undefined) {
          return cached;
        }

        const [first = ""] = (yield* run("pacman", ["-Qo", path])).split("\n");
        const groups = owner.exec(first)?.groups;

        const found =
          groups?.name === undefined || groups.version === undefined
            ? Option.none<Event.Package>()
            : Option.some({
                name: redact(groups.name),
                version: redact(groups.version),
              });

        packages.set(path, found);

        return found;
      });

      const fragmentOf = Effect.fnUntraced(function* (
        unit: string,
        scope: "system" | "user",
      ) {
        const key = `${scope}:${unit}`;
        const cached = fragments.get(key);

        if (cached !== undefined) {
          return cached;
        }

        const path = (yield* run("systemctl", [
          ...(scope === "user" ? ["--user"] : []),
          "show",
          "--property=FragmentPath",
          "--value",
          unit,
        ])).trim();

        fragments.set(key, path);

        return path;
      });

      // The file whose package is to blame: the crashed executable, the unit
      // file for units and OOM kills, the running kernel's modules for kernel
      // messages, or the program that logged an error.
      const pathOf = (entry: Entry, event: Event.Event) => {
        const unit = rawUnit(entry);

        const fromUnit =
          unit === undefined
            ? Effect.succeed("")
            : fragmentOf(unit.unit, unit.scope);

        return Event.Event.match(event, {
          Crash: () => Effect.succeed(text(entry, "COREDUMP_EXE") ?? ""),
          UnitFailure: () => fromUnit,
          OutOfMemory: () => fromUnit,
          LogError: () =>
            Effect.succeed(
              text(entry, "_TRANSPORT") === "kernel" && kernel !== ""
                ? `/usr/lib/modules/${kernel}`
                : (text(entry, "_EXE") ?? ""),
            ),
        });
      };

      const attribute = Effect.fnUntraced(function* (
        entry: Entry,
        event: Event.Event,
      ) {
        if (bootId === "" || text(entry, "_BOOT_ID") !== bootId) {
          return event;
        }

        yield* refresh;

        const path = yield* pathOf(entry, event);

        const found = path.startsWith("/")
          ? yield* ownerOf(path)
          : Option.none<Event.Package>();

        const system: Event.System = {
          ...(os !== undefined && { os }),
          ...(kernel !== "" && { kernel: redact(kernel) }),
        };

        return {
          ...event,
          ...Option.match(found, {
            onNone: () => ({}),
            onSome: (pkg) => ({ package: pkg }),
          }),
          ...(Object.keys(system).length > 0 && { system }),
        };
      });

      return Attribution.of({ attribute });
    }),
  );
}
