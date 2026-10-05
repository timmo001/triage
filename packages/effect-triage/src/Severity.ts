import { Schema } from "effect";

/** Syslog severity names, most severe first, as journald's `PRIORITY` 0 to 7. */
export const Severity = Schema.Literals([
  "emerg",
  "alert",
  "crit",
  "err",
  "warning",
  "notice",
  "info",
  "debug",
]);

/** A syslog severity name. */
export type Severity = typeof Severity.Type;

/** Map a journald `PRIORITY` (0 to 7) to its severity name. */
export const fromPriority = (priority: number): Severity | undefined =>
  Severity.literals[priority];
