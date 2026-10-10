import type { Api } from "@timmo001/effect-triage";
import { Context, Effect, Layer, Option, Ref } from "effect";

/**
 * How the server's collection of Home Assistant's errors is going, for the
 * web UI. Nothing until the collector starts, and nothing at all when the
 * server doesn't collect them.
 */
export class CollectionStatus extends Context.Service<
  CollectionStatus,
  {
    readonly get: Effect.Effect<Option.Option<Api.HomeAssistantCollection>>;
    readonly set: (status: Api.HomeAssistantCollection) => Effect.Effect<void>;
  }
>()("triage/homeassistant/CollectionStatus") {
  static readonly layer = Layer.effect(
    CollectionStatus,
    Effect.gen(function* () {
      const ref = yield* Ref.make(Option.none<Api.HomeAssistantCollection>());

      return CollectionStatus.of({
        get: Ref.get(ref),
        set: (status) => Ref.set(ref, Option.some(status)),
      });
    }),
  );
}
