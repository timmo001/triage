# @timmo001/effect-triage-client

Effect client for [triage](https://github.com/timmo001/triage), which captures crashes and errors from your machines, decides which are worth fixing, and suggests fixes.

Use it to talk to a triage server from your own Effect app, CLI or web UI. It re-exports the shared schemas from [`@timmo001/effect-triage`](https://github.com/timmo001/triage/tree/main/packages/effect-triage). Early development: the API will change before 1.0.

## Install

```bash
bun add @timmo001/effect-triage-client effect
npm install @timmo001/effect-triage-client effect
npx jsr add @timmo001/effect-triage-client
```

`effect` is a peer dependency, so install the same Effect v4 version your app uses.

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/triage/blob/main/LICENSE).
