import type { Api } from "@timmo001/effect-triage";
import { Context, Effect, Layer, Option, Ref } from "effect";

/**
 * How the server's collection of Home Assistant Core's errors is going, for
 * the web UI. Nothing until the collector starts, and nothing at all when the
 * server doesn't collect them.
 */
export class CoreStatus extends Context.Service<
  CoreStatus,
  {
    readonly get: Effect.Effect<Option.Option<Api.CoreCollection>>;
    readonly set: (status: Api.CoreCollection) => Effect.Effect<void>;
  }
>()("triage/homeassistant/CoreStatus") {
  static readonly layer = Layer.effect(
    CoreStatus,
    Effect.gen(function* () {
      const ref = yield* Ref.make(Option.none<Api.CoreCollection>());

      return CoreStatus.of({
        get: Ref.get(ref),
        set: (status) => Ref.set(ref, Option.some(status)),
      });
    }),
  );
}
