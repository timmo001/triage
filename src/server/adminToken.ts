import { Config, Effect } from "effect";
import { CliError } from "effect/cli";

/** The admin token in `$TRIAGE_ADMIN_TOKEN`, for managing a server with `--server` or `$TRIAGE_SERVER`. */
export const adminToken = Config.Redacted("TRIAGE_ADMIN_TOKEN").pipe(
  Effect.mapError(
    (cause) =>
      new CliError.UserError({
        cause,
        userMessage:
          "Set TRIAGE_ADMIN_TOKEN to an admin token to manage a server with --server or TRIAGE_SERVER. Add one with triage admins add <name>.",
      }),
  ),
);
