# @timmo001/effect-triage

Effect schemas and protocol for [triage](https://github.com/timmo001/triage), which captures crashes and errors from your machines, decides which are worth fixing, and suggests fixes.

The server, host agents and clients share it. To talk to a running server, use [`@timmo001/effect-triage-client`](https://github.com/timmo001/triage/tree/main/packages/client) instead. Early development: the API will change before 1.0.

## Install

```bash
bun add @timmo001/effect-triage effect
npm install @timmo001/effect-triage effect
npx jsr add @timmo001/effect-triage
```

`effect` is a peer dependency, so install the same Effect v4 version your app uses.

## Licence

Apache 2.0. See [LICENSE](https://github.com/timmo001/triage/blob/main/LICENSE).
