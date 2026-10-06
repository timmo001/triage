---
title: Libraries
description: Talk to a triage server from your own Effect app.
---

Triage is built from Effect v4 libraries, published to npm and JSR. They work under Bun and Node. Early development: the API will change before 1.0.

| Package | Use it to |
| --- | --- |
| [`@timmo001/effect-triage-client`](https://github.com/timmo001/triage/tree/main/packages/client) | Talk to a triage server over its HTTP API |
| [`@timmo001/effect-triage`](https://github.com/timmo001/triage/tree/main/packages/effect-triage) | Use the event, issue and API schemas every part of triage shares |

The CLI uses the same API, so anything it does against a server, your app can do too.

## Client

```bash
bun add @timmo001/effect-triage-client effect
```

`effect` is a peer dependency, so install the Effect v4 version your app already uses.

`TriageClient` is an Effect service built on `effect/http-api`. `TriageClient.layer({ url, token })` makes a typed client for one server, authenticating with a host, worker or admin token. It retries transient failures a few times.

```ts
import { TriageClient } from "@timmo001/effect-triage-client";
import { Console, Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/http";

const program = Effect.gen(function* () {
  const client = yield* TriageClient;
  const issues = yield* client.issues.list({ query: { limit: 10 } });

  for (const issue of issues) {
    yield* Console.log(`${issue.state}  ${issue.count}  ${issue.title}`);
  }
});

const client = TriageClient.layer({
  url: "https://triage.example.com",
  token: Redacted.make(process.env.TRIAGE_ADMIN_TOKEN ?? ""),
}).pipe(Layer.provide(FetchHttpClient.layer));

program.pipe(Effect.provide(client), Effect.runPromise);
```

## API

| Group | Token | Endpoints |
| --- | --- | --- |
| `ingest` | Host | Send events |
| `issues` | Admin | List issues, get one with its events, and set its state |
| `work` | Worker | Fetch issues to decide on or suggest for, and send back answers |
| `tokens` | Admin | List, add and remove host, worker and admin tokens |
| `system` | None | Health |

The server serves its OpenAPI document at `/api/openapi.json`.
