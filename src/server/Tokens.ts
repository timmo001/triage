import {
  Context,
  Crypto,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Base64Url, Hex } from "effect/encoding";
import { Store, StoreError } from "../store/Store.js";

/**
 * A host's enrolled name. It's what the server knows the host by, in place of
 * its real hostname, so choose something that doesn't identify the machine.
 */
export const HostName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,62}$/),
);

export class HostExists extends Schema.TaggedError<HostExists>()("HostExists", {
  name: Schema.String,
}) {}

/** Enrols hosts and checks the tokens they send. */
export class Hosts extends Context.Service<
  Hosts,
  {
    /** Enrol a host, returning the token it authenticates with. */
    enrol(
      name: string,
    ): Effect.Effect<Redacted.Redacted, HostExists | StoreError>;
    /** The host a token belongs to, if any. */
    authenticate(
      token: Redacted.Redacted,
    ): Effect.Effect<Option.Option<string>, StoreError>;
  }
>()("triage/server/Hosts") {
  static readonly layer = Layer.effect(
    Hosts,
    Effect.gen(function* () {
      const store = yield* Store;
      const crypto = yield* Crypto.Crypto;

      const hash = (token: Redacted.Redacted) =>
        crypto
          .digest("SHA-256", new TextEncoder().encode(Redacted.value(token)))
          .pipe(Effect.map(Hex.encode), Effect.orDie);

      const enrol = Effect.fn("Hosts.enrol")(function* (name: string) {
        const bytes = yield* crypto.randomBytes(32).pipe(Effect.orDie);
        const token = Redacted.make(Base64Url.encode(bytes));
        const added = yield* store.addHost(name, yield* hash(token));

        if (!added) {
          return yield* new HostExists({ name });
        }

        return token;
      });

      const authenticate = Effect.fn("Hosts.authenticate")(function* (
        token: Redacted.Redacted,
      ) {
        return yield* store.hostByToken(yield* hash(token));
      });

      return Hosts.of({ enrol, authenticate });
    }),
  );
}
