import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import {
  Api,
  Event,
  Fingerprint,
  Issue,
  Warning,
} from "@timmo001/effect-triage";
import {
  Clock,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Schema,
} from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";
import {
  isKind,
  type Redaction,
  RedactionVault,
  redactDashedIps,
  redactGeneric,
} from "../redact.js";

export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  cause: Schema.Defect(),
}) {}

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()(
  "IssueNotFound",
  { issueId: Schema.String },
) {
  override get message() {
    return `There's no issue ${this.issueId}`;
  }
}

export class NothingToMerge extends Schema.TaggedError<NothingToMerge>()(
  "NothingToMerge",
  { issueIds: Schema.Array(Schema.String) },
) {
  override get message() {
    return "Pick at least two different issues to merge";
  }
}

export class FingerprintNotFound extends Schema.TaggedError<FingerprintNotFound>()(
  "FingerprintNotFound",
  { issueId: Schema.String, fingerprint: Schema.String },
) {
  override get message() {
    return `Issue ${this.issueId} has no fingerprint ${this.fingerprint}`;
  }
}

export class NothingToUnmerge extends Schema.TaggedError<NothingToUnmerge>()(
  "NothingToUnmerge",
  { issueId: Schema.String },
) {
  override get message() {
    return `Issue ${this.issueId} has only one fingerprint, so there's nothing to unmerge`;
  }
}

/** The issue that issues were merged into, and the IDs that now redirect to it. */
export type Merged = Api.Merged;

/** Which issue's kind and title a merged issue takes: crashes first, as the cause. */
const causeOrder: ReadonlyArray<Issue.Kind> = [
  "Crash",
  "OutOfMemory",
  "UnitFailure",
  "LogError",
];

export interface ListOptions extends Api.IssueFilters {
  /** The most issues to return. */
  readonly limit: number;
  /** How many issues to skip first. */
  readonly offset?: number | undefined;
  readonly state?: ReadonlyArray<Issue.State> | undefined;
  /** What to sort by, the latest seen first by default. */
  readonly sort?: Api.IssueSort | undefined;
  readonly order?: Api.SortOrder | undefined;
  /** Keep issues with the same value together, before sorting. */
  readonly group?: Api.IssueGrouping | undefined;
}

export interface Pending {
  /** Events not yet uploaded, oldest first. */
  readonly events: ReadonlyArray<Event.Event>;
  /** The position to mark as uploaded once they're sent. */
  readonly last: number;
}

export interface PendingWarnings {
  readonly warnings: ReadonlyArray<Warning.Warning>;
  /** Each count's ID and version, to mark as uploaded once they're sent. */
  readonly versions: ReadonlyArray<{
    readonly id: number;
    readonly version: number;
  }>;
}

export const TokenScope = Api.TokenScope;

export type TokenScope = Api.TokenScope;

export const Token = Api.Token;

export type Token = Api.Token;

/** What a decision model made of an issue, for comparing models and labels. */
export type StoredDecision = Api.Decision;

/** A language model's suggestion for fixing an issue. */
export type StoredSuggestion = Api.Suggestion;

/** A model's decision on an issue next to the hand label for it. */
export const LabelledDecision = Schema.Struct({
  model: Schema.String,
  /** The probability the model gave that the issue is worth fixing. */
  worth: Schema.Finite,
  /** Whether the issue was labelled worth fixing. */
  label: Schema.BooleanFromBit,
});

export interface LabelledDecision extends Schema.Schema.Type<
  typeof LabelledDecision
> {}

const EventJson = Schema.fromJsonString(Event.Event);

const encodeEvent = Schema.encodeEffect(EventJson);

const IssueRow = Schema.Struct({
  id: Schema.String,
  fingerprint: Schema.String,
  kind: Issue.Kind,
  title: Schema.String,
  first_seen: Schema.Finite,
  last_seen: Schema.Finite,
  count: Schema.Int,
  status: Issue.Status,
  regressed_at: Schema.NullOr(Schema.Finite),
});

/** How long issues stay new, and how long without events before they're quiet. */
interface Windows {
  readonly newMillis: number;
  readonly quietMillis: number;
}

const hours = (name: string, fallback: number) =>
  Config.schema(Schema.Int.check(Schema.isGreaterThan(0)), name).pipe(
    Config.withDefault(fallback / (60 * 60 * 1000)),
    Config.map((value) => value * 60 * 60 * 1000),
  );

/**
 * The state windows from `$TRIAGE_NEW_HOURS` and `$TRIAGE_QUIET_HOURS`, which
 * is also how long an issue stays regressed.
 */
const stateWindows = Config.all({
  newMillis: hours("TRIAGE_NEW_HOURS", Issue.newMillis),
  quietMillis: hours("TRIAGE_QUIET_HOURS", Issue.recentMillis),
});

const state = (
  row: typeof IssueRow.Type,
  now: number,
  windows: Windows,
): Issue.State => {
  if (row.status !== "open") {
    return row.status;
  }

  if (
    row.regressed_at !== null &&
    now - row.regressed_at < windows.quietMillis
  ) {
    return "regressed";
  }

  if (now - row.first_seen < windows.newMillis) {
    return "new";
  }

  return now - row.last_seen < windows.quietMillis ? "ongoing" : "quiet";
};

const toIssue = (
  row: typeof IssueRow.Type,
  now: number,
  windows: Windows,
): Issue.Issue => ({
  id: row.id,
  fingerprint: row.fingerprint,
  kind: row.kind,
  title: row.title,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  count: row.count,
  state: state(row, now, windows),
});

const SummaryRow = Schema.Struct({
  ...IssueRow.fields,
  worth: Schema.NullOr(Schema.Finite),
  label: Schema.NullOr(Schema.BooleanFromBit),
  hosts: Schema.fromJsonString(Schema.Array(Schema.String)),
});

const toSummary = (
  row: typeof SummaryRow.Type,
  now: number,
  windows: Windows,
): Api.IssueSummary =>
  Object.assign(
    toIssue(row, now, windows),
    { hosts: row.hosts },
    row.worth === null ? {} : { worth: row.worth },
    row.label === null
      ? {}
      : { label: row.label ? ("worth" as const) : ("noise" as const) },
  );

const HostCountRow = Schema.Struct({
  host: Schema.String,
  count: Schema.Int,
  first_seen: Schema.Finite,
  last_seen: Schema.Finite,
});

const HostRow = Schema.Struct({
  host: Schema.String,
  events: Schema.Int,
  issues: Schema.Int,
  last_seen: Schema.Finite,
});

const DecisionRow = Schema.Struct({
  model: Schema.String,
  decided_at: Schema.Finite,
  decided_by: Schema.NullOr(Schema.String),
  issue_count: Schema.Int,
  worth: Schema.Finite,
  severity: Schema.Finite,
  cause: Schema.String,
});

const SuggestionRow = Schema.Struct({
  model: Schema.String,
  suggested_at: Schema.Finite,
  suggested_by: Schema.NullOr(Schema.String),
  issue_count: Schema.Int,
  text: Schema.String,
});

const toSuggestion = (row: typeof SuggestionRow.Type): Api.IssueSuggestion => ({
  model: row.model,
  suggestedAt: row.suggested_at,
  by: row.suggested_by,
  issueCount: row.issue_count,
  text: row.text,
});

const NoteRow = Schema.Struct({
  id: Schema.Int,
  created_at: Schema.Finite,
  created_by: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Api.NoteStatus),
  text: Schema.String,
});

const toNote = (row: typeof NoteRow.Type): Api.IssueNote => ({
  id: row.id,
  createdAt: row.created_at,
  by: row.created_by,
  status: row.status,
  text: row.text,
});

/** Who changed an issue's status, and why. */
export interface StatusChange {
  /** The admin, or `cli` or `mcp` on the server's own machine. */
  readonly by: string;
  /** Why, such as what fixed it. */
  readonly note?: string | undefined;
}

/** How merged issues end up: the status, and when each change happened. */
const mergedStatus = (
  rows: ReadonlyArray<{
    readonly status: string;
    readonly resolved_at: number | null;
    readonly regressed_at: number | null;
  }>,
) => {
  const latest = (values: ReadonlyArray<number | null>) =>
    values.reduce<number | null>(
      (max, value) =>
        value !== null && (max === null || value > max) ? value : max,
      null,
    );

  return {
    status:
      ["muted", "open"].find((s) => rows.some((row) => row.status === s)) ??
      "resolved",
    resolvedAt: latest(rows.map((row) => row.resolved_at)),
    regressedAt: latest(rows.map((row) => row.regressed_at)),
  };
};

/**
 * Move an issue's events, decisions, label and suggestions to another issue,
 * keeping the latest decision and suggestion from each model and the latest
 * label, then delete it.
 */
const moveIssue = Effect.fnUntraced(function* (from: string, to: string) {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    INSERT INTO decisions (issue_id, model, decided_at, decided_by,
      issue_count, worth, severity, cause, answers)
    SELECT ${to}, model, decided_at, decided_by, issue_count, worth,
      severity, cause, answers
    FROM decisions WHERE issue_id = ${from}
    ON CONFLICT (issue_id, model) DO UPDATE SET
      decided_at = excluded.decided_at, decided_by = excluded.decided_by,
      issue_count = excluded.issue_count, worth = excluded.worth,
      severity = excluded.severity, cause = excluded.cause,
      answers = excluded.answers
    WHERE excluded.decided_at > decisions.decided_at
  `;
  yield* sql`
    INSERT INTO labels (issue_id, worth, labelled_at)
    SELECT ${to}, worth, labelled_at FROM labels WHERE issue_id = ${from}
    ON CONFLICT (issue_id) DO UPDATE SET
      worth = excluded.worth, labelled_at = excluded.labelled_at
    WHERE excluded.labelled_at > labels.labelled_at
  `;
  yield* sql`
    INSERT INTO suggestions (issue_id, model, suggested_at, suggested_by,
      issue_count, text, evidence)
    SELECT ${to}, model, suggested_at, suggested_by, issue_count, text,
      evidence
    FROM suggestions WHERE issue_id = ${from}
    ON CONFLICT (issue_id, model) DO UPDATE SET
      suggested_at = excluded.suggested_at,
      suggested_by = excluded.suggested_by,
      issue_count = excluded.issue_count, text = excluded.text,
      evidence = excluded.evidence
    WHERE excluded.suggested_at > suggestions.suggested_at
  `;
  yield* sql`UPDATE events SET issue_id = ${to} WHERE issue_id = ${from}`;
  yield* sql`DELETE FROM decisions WHERE issue_id = ${from}`;
  yield* sql`DELETE FROM labels WHERE issue_id = ${from}`;
  yield* sql`DELETE FROM suggestions WHERE issue_id = ${from}`;
  yield* sql`DELETE FROM issues WHERE id = ${from}`;
});

/**
 * Merge issues into the issue for a fingerprint, creating it when it doesn't
 * exist. The merged issue is muted if any of them was, open if any was and
 * resolved otherwise, and keeps the latest decision and suggestion from each
 * model and the latest label.
 */
const mergeIssues = Effect.fnUntraced(function* (
  key: string,
  ids: ReadonlyArray<string>,
) {
  const sql = yield* SqlClient.SqlClient;
  const next = Fingerprint.issueId(key);
  const sources = ids.filter((id) => id !== next);

  if (sources.length === 0) {
    return;
  }

  const merged = mergedStatus(
    yield* sql<{
      status: string;
      resolved_at: number | null;
      regressed_at: number | null;
    }>`
      SELECT status, resolved_at, regressed_at FROM issues
      WHERE id IN ${sql.in([next, ...sources])}
    `,
  );

  yield* sql`
    INSERT OR IGNORE INTO issues (id, fingerprint, kind, title, first_seen,
      last_seen, count)
    SELECT ${next}, ${key}, kind, title, first_seen, last_seen, count
    FROM issues WHERE id = ${sources[0]}
  `;

  for (const id of sources) {
    yield* moveIssue(id, next);
  }

  yield* sql`
    UPDATE issues SET
      first_seen = (SELECT MIN(timestamp) FROM events WHERE issue_id = ${next}),
      last_seen = (SELECT MAX(timestamp) FROM events WHERE issue_id = ${next}),
      count = (SELECT COUNT(*) FROM events WHERE issue_id = ${next}),
      status = ${merged.status},
      resolved_at = ${merged.resolvedAt},
      regressed_at = ${merged.regressedAt}
    WHERE id = ${next}
  `;
});

/** Merge issues whose fingerprints now map to the same one. */
const mergeGroups = Effect.fnUntraced(function* (
  issues: ReadonlyArray<{ id: string; fingerprint: string }>,
  rekey: (fingerprint: string) => string,
) {
  const groups = Map.groupBy(issues, (issue) => rekey(issue.fingerprint));

  for (const [key, group] of groups) {
    yield* mergeIssues(
      key,
      group.map((issue) => issue.id),
    );
  }
});

const migrations = SqliteMigrator.fromRecord({
  "0001_events_and_issues": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE issues (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        count INTEGER NOT NULL
      )
    `;

    yield* sql`
      CREATE TABLE events (
        host TEXT NOT NULL,
        id TEXT NOT NULL,
        issue_id TEXT NOT NULL REFERENCES issues (id),
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (host, id)
      )
    `;

    yield* sql`CREATE INDEX events_issue ON events (issue_id, timestamp)`;

    yield* sql`
      CREATE TABLE cursors (
        source TEXT PRIMARY KEY,
        cursor TEXT NOT NULL
      )
    `;
  }),
  "0002_hosts_and_uploads": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE hosts (
        name TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      )
    `;

    yield* sql`
      CREATE TABLE uploads (
        target TEXT PRIMARY KEY,
        last_event INTEGER NOT NULL
      )
    `;
  }),
  "0003_scoped_tokens": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE tokens (
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (scope, name)
      )
    `;

    yield* sql`
      INSERT INTO tokens (scope, name, token_hash, created_at)
      SELECT 'host', name, token_hash, created_at FROM hosts
    `;

    yield* sql`DROP TABLE hosts`;
  }),
  "0004_decisions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE decisions (
        issue_id TEXT NOT NULL REFERENCES issues (id),
        model TEXT NOT NULL,
        decided_at INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        worth REAL NOT NULL,
        severity REAL NOT NULL,
        cause TEXT NOT NULL,
        answers TEXT NOT NULL,
        PRIMARY KEY (issue_id, model)
      )
    `;
  }),
  "0005_labels": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE labels (
        issue_id TEXT PRIMARY KEY REFERENCES issues (id),
        worth INTEGER NOT NULL,
        labelled_at INTEGER NOT NULL
      )
    `;
  }),
  "0006_suggestions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE suggestions (
        issue_id TEXT NOT NULL REFERENCES issues (id),
        model TEXT NOT NULL,
        suggested_at INTEGER NOT NULL,
        issue_count INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY (issue_id, model)
      )
    `;
  }),
  "0007_suggestion_evidence": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      ALTER TABLE suggestions ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]'
    `;
  }),
  "0008_issue_states": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`ALTER TABLE issues ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`;
    yield* sql`ALTER TABLE issues ADD COLUMN resolved_at INTEGER`;
    yield* sql`ALTER TABLE issues ADD COLUMN regressed_at INTEGER`;
  }),
  "0009_decided_by": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`ALTER TABLE decisions ADD COLUMN decided_by TEXT`;
    yield* sql`ALTER TABLE suggestions ADD COLUMN suggested_by TEXT`;
  }),
  // Errors and OOM kills now group per host. Each one's events move to an issue
  // for their host, which keeps the old issue's state, decisions, label and
  // suggestions.
  "0010_per_host_issues": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const pairs = yield* sql<{ id: string; fingerprint: string; host: string }>`
      SELECT DISTINCT issues.id, issues.fingerprint, events.host
      FROM issues JOIN events ON events.issue_id = issues.id
      WHERE issues.kind IN ('LogError', 'OutOfMemory')
    `;

    for (const { id, fingerprint, host } of pairs) {
      const key = `${fingerprint}|${host}`;
      const next = Fingerprint.issueId(key);

      yield* sql`
        INSERT INTO issues (id, fingerprint, kind, title, first_seen, last_seen,
          count, status, resolved_at, regressed_at)
        SELECT ${next}, ${key}, kind, title,
          (SELECT MIN(timestamp) FROM events WHERE issue_id = ${id} AND host = ${host}),
          (SELECT MAX(timestamp) FROM events WHERE issue_id = ${id} AND host = ${host}),
          (SELECT COUNT(*) FROM events WHERE issue_id = ${id} AND host = ${host}),
          status, resolved_at, regressed_at
        FROM issues WHERE id = ${id}
      `;
      yield* sql`
        INSERT INTO decisions (issue_id, model, decided_at, decided_by,
          issue_count, worth, severity, cause, answers)
        SELECT ${next}, model, decided_at, decided_by, issue_count, worth,
          severity, cause, answers
        FROM decisions WHERE issue_id = ${id}
      `;
      yield* sql`
        INSERT INTO labels (issue_id, worth, labelled_at)
        SELECT ${next}, worth, labelled_at FROM labels WHERE issue_id = ${id}
      `;
      yield* sql`
        INSERT INTO suggestions (issue_id, model, suggested_at, suggested_by,
          issue_count, text, evidence)
        SELECT ${next}, model, suggested_at, suggested_by, issue_count, text,
          evidence
        FROM suggestions WHERE issue_id = ${id}
      `;
      yield* sql`
        UPDATE events SET issue_id = ${next}
        WHERE issue_id = ${id} AND host = ${host}
      `;
    }

    for (const id of new Set(pairs.map((pair) => pair.id))) {
      yield* sql`DELETE FROM decisions WHERE issue_id = ${id}`;
      yield* sql`DELETE FROM labels WHERE issue_id = ${id}`;
      yield* sql`DELETE FROM suggestions WHERE issue_id = ${id}`;
      yield* sql`DELETE FROM issues WHERE id = ${id}`;
    }
  }),
  // Crash frames now name their module by its file name, so a crash reported
  // with the module's full path joins the issue for the same crash without it.
  "0011_crash_module_names": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const crashes = yield* sql<{ id: string; fingerprint: string }>`
      SELECT id, fingerprint FROM issues
      WHERE kind = 'Crash' AND fingerprint LIKE '%|/%'
    `;

    yield* mergeGroups(crashes, (fingerprint) =>
      fingerprint
        .split("|")
        .map((part) =>
          part.startsWith("/") ? part.slice(part.lastIndexOf("/") + 1) : part,
        )
        .join("|"),
    );
  }),
  // Errors and OOM kills group across hosts again, like crashes and unit
  // failures, so each one's issues on different hosts merge into one.
  "0012_cross_host_issues": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const issues = yield* sql<{ id: string; fingerprint: string }>`
      SELECT id, fingerprint FROM issues
      WHERE kind IN ('LogError', 'OutOfMemory')
    `;

    yield* mergeGroups(issues, (fingerprint) =>
      fingerprint.slice(0, fingerprint.lastIndexOf("|")),
    );
  }),
  // Issues keep notes and the history of their status. Resolutions and
  // regressions from before then start it, without a note or who did them.
  "0013_notes": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues (id),
        created_at INTEGER NOT NULL,
        created_by TEXT,
        status TEXT,
        text TEXT NOT NULL
      )
    `;

    yield* sql`CREATE INDEX notes_issue ON notes (issue_id, created_at)`;

    yield* sql`
      INSERT INTO notes (issue_id, created_at, status, text)
      SELECT id, resolved_at, 'resolved', '' FROM issues
      WHERE resolved_at IS NOT NULL
    `;

    yield* sql`
      INSERT INTO notes (issue_id, created_at, status, text)
      SELECT id, regressed_at, 'regressed', '' FROM issues
      WHERE regressed_at IS NOT NULL
    `;
  }),
  // An issue can own several fingerprints, so merged issues keep getting their
  // events, and each event keeps its own fingerprint to unmerge by. A merged
  // issue's ID redirects to the one it joined.
  "0014_issue_fingerprints": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decodeEvent = Schema.decodeUnknownEffect(EventJson);

    yield* sql`
      CREATE TABLE issue_fingerprints (
        fingerprint TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues (id)
      )
    `;

    yield* sql`CREATE INDEX issue_fingerprints_issue ON issue_fingerprints (issue_id)`;

    yield* sql`
      CREATE TABLE issue_redirects (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues (id)
      )
    `;

    yield* sql`ALTER TABLE events ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''`;

    yield* sql`
      UPDATE events SET fingerprint = (
        SELECT fingerprint FROM issues WHERE issues.id = events.issue_id
      )
    `;

    // Events merged in by 0011 or 0012 have a fingerprint of their own.
    let last = 0;

    while (true) {
      const rows = yield* sql<{ rowid: number; data: string }>`
        SELECT rowid, data FROM events WHERE rowid > ${last}
        ORDER BY rowid LIMIT 1000
      `;

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const event = yield* Effect.option(decodeEvent(row.data));

        if (Option.isSome(event)) {
          yield* sql`
            UPDATE events SET fingerprint = ${Fingerprint.fingerprint(event.value)}
            WHERE rowid = ${row.rowid}
          `;
        }
      }

      last = rows.at(-1)?.rowid ?? last;
    }

    // An issue's own fingerprint wins, since that's where ingest sends it now.
    yield* sql`
      INSERT INTO issue_fingerprints (fingerprint, issue_id)
      SELECT fingerprint, id FROM issues
    `;

    yield* sql`
      INSERT OR IGNORE INTO issue_fingerprints (fingerprint, issue_id)
      SELECT DISTINCT fingerprint, issue_id FROM events
    `;

    const owned = yield* sql<{ fingerprint: string; issue_id: string }>`
      SELECT fingerprint, issue_id FROM issue_fingerprints
    `;

    for (const { fingerprint, issue_id } of owned) {
      const id = Fingerprint.issueId(fingerprint);

      if (id !== issue_id) {
        yield* sql`
          INSERT OR IGNORE INTO issue_redirects (id, issue_id)
          SELECT ${id}, ${issue_id}
          WHERE NOT EXISTS (SELECT 1 FROM issues WHERE id = ${id})
        `;
      }
    }
  }),
  // Warning counts for each host, boot, program and template. A host keeps
  // every program's for a while and sends those for programs with an issue;
  // `version` changes with each count, so it knows which to send again.
  "0015_warnings": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE warnings (
        id INTEGER PRIMARY KEY,
        host TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        unit TEXT NOT NULL,
        template TEXT NOT NULL,
        example TEXT NOT NULL,
        count INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        version INTEGER NOT NULL,
        UNIQUE (host, boot_id, identifier, unit, template)
      )
    `;

    yield* sql`CREATE INDEX warnings_identifier ON warnings (identifier)`;
    yield* sql`CREATE INDEX warnings_unit ON warnings (unit)`;
    yield* sql`CREATE INDEX warnings_last_seen ON warnings (last_seen)`;

    yield* sql`
      CREATE TABLE warning_uploads (
        target TEXT NOT NULL,
        warning_id INTEGER NOT NULL REFERENCES warnings (id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        PRIMARY KEY (target, warning_id)
      )
    `;
  }),
  // For the issues that happened on a host around the same time as another.
  "0016_events_by_host_time": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`CREATE INDEX events_host_time ON events (host, timestamp)`;
  }),
  // Crash frames no longer keep systemd-coredump's n/a as their module, which
  // fingerprinted as `a` once modules were cut to their file name, so such a
  // frame counts as `?`. Each event's new fingerprint goes to the issue that
  // already has it, so its next events still join it, and an issue's own
  // fingerprint changes to match.
  "0017_crash_frames_without_modules": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decodeEvent = Schema.decodeUnknownEffect(EventJson);
    let last = 0;

    while (true) {
      const rows = yield* sql<{
        rowid: number;
        issue_id: string;
        data: string;
      }>`
        SELECT rowid, issue_id, data FROM events
        WHERE rowid > ${last} AND data LIKE '%"module":"n/a"%'
        ORDER BY rowid LIMIT 1000
      `;

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const crash = Option.filter(
          yield* Effect.option(decodeEvent(row.data)),
          Event.Event.guards.Crash,
        );

        if (Option.isNone(crash)) {
          continue;
        }

        const event = Event.Event.cases.Crash.make({
          ...crash.value,
          frames: crash.value.frames.map((frame) =>
            frame.module === "n/a"
              ? frame.function === undefined
                ? {}
                : { function: frame.function }
              : frame,
          ),
        });

        const fingerprint = Fingerprint.fingerprint(event);

        yield* sql`
          UPDATE events SET data = ${yield* encodeEvent(event)},
            fingerprint = ${fingerprint}
          WHERE rowid = ${row.rowid}
        `;

        yield* sql`
          INSERT OR IGNORE INTO issue_fingerprints (fingerprint, issue_id)
          VALUES (${fingerprint}, ${row.issue_id})
        `;
      }

      last = rows.at(-1)?.rowid ?? last;
    }

    const issues = yield* sql<{ id: string; fingerprint: string }>`
      SELECT id, fingerprint FROM issues
      WHERE kind = 'Crash' AND '|' || fingerprint || '|' LIKE '%|n/a|%'
    `;

    for (const issue of issues) {
      const [kind, executable, signal, ...frames] =
        issue.fingerprint.split("|");

      const fingerprint = [
        kind,
        executable,
        signal,
        ...frames.map((frame) => (frame === "n/a" ? "?" : frame)),
      ].join("|");

      yield* sql`UPDATE issues SET fingerprint = ${fingerprint} WHERE id = ${issue.id}`;

      yield* sql`
        INSERT OR IGNORE INTO issue_fingerprints (fingerprint, issue_id)
        VALUES (${fingerprint}, ${issue.id})
      `;
    }
  }),
  // Redacted values become tokens, such as <ip:71d0a3c2e94b>, from a key that
  // never leaves this store, and the values behind them are kept here so this
  // machine can show them. Neither is ever uploaded.
  "0018_redactions": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE redaction_key (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        key BLOB NOT NULL
      )
    `;

    yield* sql`
      CREATE TABLE redactions (
        token TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        first_seen INTEGER NOT NULL
      )
    `;
  }),
  // Which values behind tokens a host has sent to each server, which it only
  // does for a server on its own network when told to.
  "0019_redaction_uploads": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
      CREATE TABLE redaction_uploads (
        target TEXT NOT NULL,
        token TEXT NOT NULL REFERENCES redactions (token) ON DELETE CASCADE,
        PRIMARY KEY (target, token)
      )
    `;
  }),
  // An entity ID's token only stands for its object ID, since its domain stays
  // in the text, so a value kept as the whole entity ID showed the domain
  // twice. Names, which have spaces or capitals, are left alone.
  "0020_entity_object_ids": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const rows = yield* sql<{ token: string; value: string }>`
      SELECT token, value FROM redactions WHERE kind = 'entity'
    `;

    for (const { token, value } of rows) {
      if (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(value)) {
        yield* sql`
          UPDATE redactions SET value = ${value.slice(value.indexOf(".") + 1)}
          WHERE token = ${token}
        `;
      }
    }
  }),
  // IPv4 addresses written with dashes in a host name, as in Plex's
  // a-b-c-d.<id>.plex.direct, weren't redacted. Stored ones become a plain
  // <ip>, since there's no token to give them now, and each event's new
  // fingerprint goes to the issue that already has it, so its next events,
  // redacted when they're captured, still join it.
  "0021_dashed_ips": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const decodeEvent = Schema.decodeUnknownEffect(EventJson);
    let last = 0;

    while (true) {
      const rows = yield* sql<{
        rowid: number;
        issue_id: string;
        data: string;
      }>`
        SELECT rowid, issue_id, data FROM events
        WHERE rowid > ${last} AND data GLOB '*[0-9]-[0-9]*-[0-9]*-[0-9]*.*'
        ORDER BY rowid LIMIT 1000
      `;

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const data = redactDashedIps(row.data);

        if (data === row.data) {
          continue;
        }

        const event = yield* Effect.option(decodeEvent(data));

        if (Option.isNone(event)) {
          continue;
        }

        const fingerprint = Fingerprint.fingerprint(event.value);

        yield* sql`
          UPDATE events SET data = ${data}, fingerprint = ${fingerprint}
          WHERE rowid = ${row.rowid}
        `;

        yield* sql`
          INSERT OR IGNORE INTO issue_fingerprints (fingerprint, issue_id)
          VALUES (${fingerprint}, ${row.issue_id})
        `;
      }

      last = rows.at(-1)?.rowid ?? last;
    }

    const warnings = yield* sql<{ id: number; example: string }>`
      SELECT id, example FROM warnings
      WHERE example GLOB '*[0-9]-[0-9]*-[0-9]*-[0-9]*.*'
    `;

    for (const warning of warnings) {
      const example = redactDashedIps(warning.example);

      if (example !== warning.example) {
        yield* sql`UPDATE warnings SET example = ${example} WHERE id = ${warning.id}`;
      }
    }
  }),
});

/** How long a host keeps warning counts, sent or not. */
const warningRetention = 7 * 24 * 60 * 60 * 1000;

/** Redaction tokens, such as `<ip:71d0a3c2e94b>`, as stored text holds them. */
const storedTokens = /<[a-z]+:[0-9a-f]{12}>/g;

/**
 * How long a redaction value is kept before it can be forgotten, since it's
 * written a moment before the event that holds its token.
 */
const pruneGrace = 60 * 60 * 1000;

/** When an open store first forgets unused redaction values, then how often. */
const firstPrune = "10 minutes";

const pruneEvery = "1 day";

const warningKey = (warning: Warning.Warning) =>
  JSON.stringify([
    warning.host,
    warning.bootId,
    warning.identifier ?? "",
    warning.unit ?? "",
    warning.template,
  ]);

/** Add up occurrences of the same warning, keeping the latest example. */
const sumWarnings = (warnings: ReadonlyArray<Warning.Warning>) => {
  const sums = new Map<string, Warning.Warning>();

  for (const warning of warnings) {
    const key = warningKey(warning);
    const sum = sums.get(key);

    sums.set(
      key,
      sum === undefined
        ? warning
        : Object.assign({}, sum, {
            example:
              warning.lastSeen >= sum.lastSeen ? warning.example : sum.example,
            count: sum.count + warning.count,
            firstSeen: Math.min(sum.firstSeen, warning.firstSeen),
            lastSeen: Math.max(sum.lastSeen, warning.lastSeen),
          }),
    );
  }

  return [...sums.values()];
};

const WarningRow = Schema.Struct({
  id: Schema.Int,
  host: Schema.String,
  boot_id: Schema.String,
  identifier: Schema.String,
  unit: Schema.String,
  template: Schema.String,
  example: Schema.String,
  count: Schema.Int,
  first_seen: Schema.Finite,
  last_seen: Schema.Finite,
  version: Schema.Int,
});

const toWarning = (row: typeof WarningRow.Type): Warning.Warning => ({
  host: row.host,
  bootId: row.boot_id,
  ...(row.identifier !== "" && { identifier: row.identifier }),
  ...(row.unit !== "" && { unit: row.unit }),
  template: row.template,
  example: row.example,
  count: row.count,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
});

/** Each host's counts of a warning, added up across boots, most first. */
const issueWarnings = (
  rows: ReadonlyArray<typeof WarningRow.Type>,
): ReadonlyArray<Api.IssueWarning> =>
  sumWarnings(
    rows.map((row) => ({
      host: row.host,
      bootId: "",
      template: row.template,
      example: row.example,
      count: row.count,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
    })),
  )
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, Api.maxIssueWarnings)
    .map(({ host, template, example, count, firstSeen, lastSeen }) => ({
      host,
      template,
      example,
      count,
      firstSeen,
      lastSeen,
    }));

/** The programs the given fingerprints belong to. */
const programsOf = (fingerprints: ReadonlyArray<string>) => [
  ...new Set(
    fingerprints.flatMap((key) => {
      const name = Fingerprint.program(key);

      return name === undefined ? [] : [name];
    }),
  ),
];

/**
 * Where triage keeps events and the issues they group into. Events are stored
 * once, so reading the same journal entries again changes nothing.
 */
export class Store extends Context.Service<
  Store,
  {
    /** Where reading a source should resume, if it has been read before. */
    cursor(source: string): Effect.Effect<Option.Option<string>, StoreError>;
    /**
     * The key redaction tokens are made with, made the first time it's asked
     * for. It never leaves this store.
     */
    readonly redactionKey: Effect.Effect<Uint8Array, StoreError>;
    /**
     * Keep the values behind redaction tokens, the first one seen for each,
     * so this machine can show them. Returns how many were new. A host only
     * sends its own to a server on its own network when told to.
     */
    remember(
      redactions: ReadonlyArray<Redaction>,
    ): Effect.Effect<number, StoreError>;
    /** The values behind these redaction tokens, leaving out any not kept here. */
    resolve(
      tokens: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyArray<Redaction>, StoreError>;
    /** Up to `limit` values behind tokens not yet sent to `target`. */
    pendingRedactions(
      target: string,
      limit: number,
    ): Effect.Effect<ReadonlyArray<Redaction>, StoreError>;
    /** Mark values behind these tokens as sent to `target`. */
    redactionsUploaded(
      target: string,
      tokens: ReadonlyArray<string>,
    ): Effect.Effect<void, StoreError>;
    /**
     * Forget values behind tokens no stored event or warning holds any more,
     * such as one from a warning's example that a newer one replaced, kept
     * since before `before`. Returns how many were forgotten. Runs by itself
     * every day while the store is open.
     */
    pruneRedactions(before: number): Effect.Effect<number, StoreError>;
    /**
     * Store events, warnings and the cursor after them together, so a source
     * never skips or double counts them. Warnings add to the counts so far,
     * and counts older than a week are dropped. Returns how many events were
     * new.
     */
    record(
      source: string,
      events: ReadonlyArray<Event.Event>,
      cursor: string,
      warnings?: ReadonlyArray<Warning.Warning>,
    ): Effect.Effect<number, StoreError>;
    /** Store events sent by a host. Returns how many events were new. */
    add(events: ReadonlyArray<Event.Event>): Effect.Effect<number, StoreError>;
    /**
     * Store warning counts sent by a host, each replacing the last one for
     * its boot, keeping only those for a program with an issue that isn't
     * muted. Returns how many were kept.
     */
    addWarnings(
      warnings: ReadonlyArray<Warning.Warning>,
    ): Effect.Effect<number, StoreError>;
    issues(
      options: ListOptions,
    ): Effect.Effect<ReadonlyArray<Api.IssueSummary>, StoreError>;
    /** How many issues match the filters, in all and in each state. */
    issueCounts(
      filters: Api.IssueFilters,
    ): Effect.Effect<Api.IssueCounts, StoreError>;
    /** Every host that has sent events, most recently seen first. */
    readonly hosts: Effect.Effect<ReadonlyArray<Api.HostSummary>, StoreError>;
    /**
     * An issue with its latest events, newest first, and the warnings its
     * program logged.
     */
    issue(
      id: string,
      events: number,
    ): Effect.Effect<Option.Option<Api.IssueDetail>, StoreError>;
    /** An issue with its latest events and each model's latest answers. */
    review(
      id: string,
      events: number,
    ): Effect.Effect<Option.Option<Api.IssueReview>, StoreError>;
    /** A page of an issue's events, newest first. */
    events(
      id: string,
      page: { readonly limit: number; readonly offset: number },
    ): Effect.Effect<Option.Option<Api.IssueEvents>, StoreError>;
    /**
     * Other issues in the same fingerprint family as an issue, with their
     * suggested fixes: resolved ones first, then the latest seen.
     */
    similar(
      id: string,
      limit: number,
    ): Effect.Effect<
      Option.Option<ReadonlyArray<Api.SimilarIssue>>,
      StoreError
    >;
    /** Add a token. Returns false when the name is already taken in its scope. */
    addToken(
      scope: TokenScope,
      name: string,
      tokenHash: string,
    ): Effect.Effect<boolean, StoreError>;
    /** The name a token belongs to in a scope, by the token's hash. */
    tokenName(
      scope: TokenScope,
      tokenHash: string,
    ): Effect.Effect<Option.Option<string>, StoreError>;
    /** The tokens in a scope, oldest first. */
    tokens(scope: TokenScope): Effect.Effect<ReadonlyArray<Token>, StoreError>;
    /** Remove a token. Returns false when there was none by that name. */
    removeToken(
      scope: TokenScope,
      name: string,
    ): Effect.Effect<boolean, StoreError>;
    /** Events not yet uploaded to a server. */
    pending(target: string, limit: number): Effect.Effect<Pending, StoreError>;
    /** Mark events up to `last` as uploaded to a server. */
    uploaded(target: string, last: number): Effect.Effect<void, StoreError>;
    /**
     * Warning counts for programs with an issue that isn't muted, which
     * changed since they were last uploaded to a server.
     */
    pendingWarnings(
      target: string,
      limit: number,
    ): Effect.Effect<PendingWarnings, StoreError>;
    /** Mark warning counts as uploaded to a server. */
    warningsUploaded(
      target: string,
      versions: PendingWarnings["versions"],
    ): Effect.Effect<void, StoreError>;
    /**
     * Open issues a model hasn't decided on since they were first seen or
     * last regressed, most recently seen first.
     */
    undecided(
      model: string,
      limit: number,
    ): Effect.Effect<ReadonlyArray<Issue.Issue>, StoreError>;
    /** How many decisions a model has made since `since`, in milliseconds. */
    decidedSince(
      model: string,
      since: number,
    ): Effect.Effect<number, StoreError>;
    /**
     * Store a model's decision, replacing any earlier one for the issue. `by`
     * is the worker that asked the model, or `server` or `cli`.
     */
    saveDecision(
      decision: StoredDecision,
      by: string,
    ): Effect.Effect<void, StoreError>;
    /** Label an issue by hand, replacing any earlier label. */
    label(
      issueId: string,
      worth: boolean,
    ): Effect.Effect<void, IssueNotFound | StoreError>;
    /**
     * Resolve, mute or reopen an issue, keeping who did it and why in its
     * notes.
     */
    setStatus(
      issueId: string,
      status: Issue.Status,
      change: StatusChange,
    ): Effect.Effect<void, IssueNotFound | StoreError>;
    /** Add a note to an issue. `by` is the admin, or `cli` or `mcp`. */
    addNote(
      issueId: string,
      text: string,
      by: string,
    ): Effect.Effect<void, IssueNotFound | StoreError>;
    /**
     * Merge issues into one: the issue seen first is kept, then the one with
     * more events, then the lower ID. It takes the kind and title
     * of the cause, a crash before an OOM kill, a unit failure or an error,
     * and is muted if any of them was, open if any was and resolved otherwise.
     * Each merged issue's ID redirects to it. `by` is the admin, or `cli` or
     * `mcp`.
     */
    merge(
      issueIds: ReadonlyArray<string>,
      by: string,
    ): Effect.Effect<Merged, IssueNotFound | NothingToMerge | StoreError>;
    /**
     * Move a fingerprint's events out of an issue into an issue of their own,
     * which keeps the issue's status but none of its decisions, label or
     * suggestions. Returns the new issue's ID: the fingerprint's own, unless
     * the issue already has it. `by` is the admin, or `cli` or `mcp`.
     */
    unmerge(
      issueId: string,
      fingerprint: string,
      by: string,
    ): Effect.Effect<
      string,
      IssueNotFound | FingerprintNotFound | NothingToUnmerge | StoreError
    >;
    /** Every decision on a labelled issue. */
    labelledDecisions: Effect.Effect<
      ReadonlyArray<LabelledDecision>,
      StoreError
    >;
    /**
     * Open issues `decisionModel` rated at least `worth` that `model` hasn't
     * suggested a fix for yet, most recently seen first.
     */
    unsuggested(options: {
      readonly model: string;
      readonly decisionModel: string;
      readonly worth: number;
      readonly limit: number;
    }): Effect.Effect<ReadonlyArray<Issue.Issue>, StoreError>;
    /** How many suggestions a model has made since `since`, in milliseconds. */
    suggestedSince(
      model: string,
      since: number,
    ): Effect.Effect<number, StoreError>;
    /**
     * Store a model's suggestion, replacing any earlier one for the issue.
     * `by` is the worker that asked the model, or `server` or `cli`.
     */
    saveSuggestion(
      suggestion: StoredSuggestion,
      by: string,
    ): Effect.Effect<void, StoreError>;
  }
>()("triage/store/Store") {
  static readonly make = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const windows = yield* stateWindows;

    const cursor = Effect.fn("Store.cursor")(
      function* (source: string) {
        const rows = yield* sql<{
          cursor: string;
        }>`SELECT cursor FROM cursors WHERE source = ${source}`;

        return Option.fromNullishOr(rows[0]?.cursor);
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const redactionKey = Effect.gen(function* () {
      const rows = yield* sql<{
        key: Uint8Array;
      }>`SELECT key FROM redaction_key WHERE id = 1`;

      const existing = rows[0]?.key;

      if (existing !== undefined) {
        return existing;
      }

      const key = crypto.getRandomValues(new Uint8Array(32));

      yield* sql`INSERT OR IGNORE INTO redaction_key (id, key) VALUES (1, ${key})`;

      // Another process may have made one first, so read back whichever won.
      const [kept] = yield* sql<{
        key: Uint8Array;
      }>`SELECT key FROM redaction_key WHERE id = 1`;

      return kept?.key ?? key;
    }).pipe(
      Effect.mapError((cause) => new StoreError({ cause })),
      Effect.withSpan("Store.redactionKey"),
    );

    const remember = Effect.fn("Store.remember")(
      function* (redactions: ReadonlyArray<Redaction>) {
        if (redactions.length === 0) {
          return 0;
        }

        const now = yield* Clock.currentTimeMillis;

        const added = yield* sql<{ token: string }>`
          INSERT OR IGNORE INTO redactions ${sql.insert(
            redactions.map(({ token, kind, value }) => ({
              token,
              kind,
              value,
              first_seen: now,
            })),
          )}
          RETURNING token
        `;

        return added.length;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const resolve = Effect.fn("Store.resolve")(
      function* (tokens: ReadonlyArray<string>) {
        if (tokens.length === 0) {
          return [];
        }

        const rows = yield* sql<{ token: string; kind: string; value: string }>`
          SELECT token, kind, value FROM redactions
          WHERE ${sql.in("token", tokens)}
        `;

        return rows.flatMap((row) =>
          isKind(row.kind) ? [{ ...row, kind: row.kind }] : [],
        );
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const pendingRedactions = Effect.fn("Store.pendingRedactions")(
      function* (target: string, limit: number) {
        const rows = yield* sql<{ token: string; kind: string; value: string }>`
          SELECT redactions.token, redactions.kind, redactions.value
          FROM redactions
          LEFT JOIN redaction_uploads
            ON redaction_uploads.token = redactions.token
            AND redaction_uploads.target = ${target}
          WHERE redaction_uploads.token IS NULL
          ORDER BY redactions.first_seen, redactions.token
          LIMIT ${limit}
        `;

        return rows.flatMap((row) =>
          isKind(row.kind) ? [{ ...row, kind: row.kind }] : [],
        );
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const redactionsUploaded = Effect.fn("Store.redactionsUploaded")(
      function* (target: string, tokens: ReadonlyArray<string>) {
        if (tokens.length === 0) {
          return;
        }

        yield* sql`
          INSERT OR IGNORE INTO redaction_uploads ${sql.insert(
            tokens.map((token) => ({ target, token })),
          )}
        `;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const pruneRedactions = Effect.fn("Store.pruneRedactions")(
      function* (before: number) {
        const candidates = yield* sql<{ token: string }>`
          SELECT token FROM redactions WHERE first_seen < ${before}
        `;

        if (candidates.length === 0) {
          return 0;
        }

        // Every token still held, from events a page at a time and warnings.
        const held = new Set<string>();

        const hold = (text: string) => {
          for (const token of text.match(storedTokens) ?? []) {
            held.add(token);
          }
        };

        let last = 0;

        while (true) {
          const rows = yield* sql<{ rowid: number; data: string }>`
            SELECT rowid, data FROM events WHERE rowid > ${last}
            ORDER BY rowid LIMIT 5000
          `;

          if (rows.length === 0) {
            break;
          }

          for (const row of rows) {
            hold(row.data);
          }

          last = rows.at(-1)?.rowid ?? last;
        }

        const warnings = yield* sql<{
          example: string;
          identifier: string;
          unit: string;
        }>`SELECT example, identifier, unit FROM warnings`;

        for (const warning of warnings) {
          hold(`${warning.example} ${warning.identifier} ${warning.unit}`);
        }

        const unheld = candidates
          .map(({ token }) => token)
          .filter((token) => !held.has(token));

        for (let start = 0; start < unheld.length; start += 500) {
          const chunk = unheld.slice(start, start + 500);

          yield* sql`DELETE FROM redaction_uploads WHERE ${sql.in("token", chunk)}`;
          yield* sql`DELETE FROM redactions WHERE ${sql.in("token", chunk)}`;
        }

        return unheld.length;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    // Daily, starting a while after the store opens, so a short command such
    // as listing issues never waits on it.
    yield* Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) => pruneRedactions(now - pruneGrace)),
      Effect.tap((pruned) =>
        pruned === 0
          ? Effect.void
          : Effect.logDebug(
              `Forgot the values behind ${pruned} redaction tokens nothing holds any more`,
            ),
      ),
      Effect.catch((error) =>
        Effect.logWarning(
          `Couldn't forget unused redaction values: ${error.message}`,
        ),
      ),
      Effect.delay(firstPrune),
      Effect.repeat(Schedule.spaced(pruneEvery)),
      Effect.forkScoped,
    );

    const insert = Effect.fnUntraced(function* (event: Event.Event) {
      const issue = Issue.fromEvent(event);

      const owner = yield* sql<{ issue_id: string }>`
        SELECT issue_id FROM issue_fingerprints
        WHERE fingerprint = ${issue.fingerprint}
      `;

      const issueId = owner[0]?.issue_id ?? issue.id;

      if (owner.length === 0) {
        yield* sql`
          INSERT INTO issues ${sql.insert({
            id: issue.id,
            fingerprint: issue.fingerprint,
            kind: issue.kind,
            title: issue.title,
            first_seen: issue.firstSeen,
            last_seen: issue.lastSeen,
            count: 0,
          })}
          ON CONFLICT (id) DO NOTHING
        `;

        yield* sql`
          INSERT INTO issue_fingerprints ${sql.insert({
            fingerprint: issue.fingerprint,
            issue_id: issue.id,
          })}
        `;
      }

      const inserted = yield* sql`
        INSERT INTO events ${sql.insert({
          host: event.host,
          id: event.id,
          issue_id: issueId,
          fingerprint: issue.fingerprint,
          timestamp: event.timestamp,
          data: yield* encodeEvent(event),
        })}
        ON CONFLICT (host, id) DO NOTHING
        RETURNING id
      `;

      if (inserted.length === 0) {
        return 0;
      }

      yield* sql`
        UPDATE issues SET
          count = count + 1,
          first_seen = min(first_seen, ${event.timestamp}),
          last_seen = max(last_seen, ${event.timestamp})
        WHERE id = ${issueId}
      `;

      // Events from before an issue was resolved, sent late, don't reopen it.
      const now = yield* Clock.currentTimeMillis;

      const regressed = yield* sql`
        UPDATE issues SET
          status = 'open',
          resolved_at = NULL,
          regressed_at = ${now}
        WHERE id = ${issueId}
          AND status = 'resolved'
          AND resolved_at < ${event.timestamp}
        RETURNING id
      `;

      if (regressed.length > 0) {
        yield* sql`
          INSERT INTO notes ${sql.insert({
            issue_id: issueId,
            created_at: now,
            created_by: event.host,
            status: "regressed",
            text: "",
          })}
        `;
      }

      return 1;
    });

    const countWarnings = Effect.fnUntraced(function* (
      warnings: ReadonlyArray<Warning.Warning>,
    ) {
      const cutoff = (yield* Clock.currentTimeMillis) - warningRetention;

      const recent = warnings.filter((warning) => warning.lastSeen >= cutoff);

      for (const warning of sumWarnings(recent)) {
        yield* sql`
          INSERT INTO warnings (host, boot_id, identifier, unit, template,
            example, count, first_seen, last_seen, version)
          SELECT ${warning.host}, ${warning.bootId}, ${warning.identifier ?? ""},
            ${warning.unit ?? ""}, ${warning.template}, ${warning.example},
            ${warning.count}, ${warning.firstSeen}, ${warning.lastSeen},
            coalesce(MAX(version), 0) + 1
          FROM warnings
          WHERE true
          ON CONFLICT (host, boot_id, identifier, unit, template) DO UPDATE SET
            example = CASE WHEN excluded.last_seen >= last_seen
              THEN excluded.example ELSE example END,
            count = count + excluded.count,
            first_seen = min(first_seen, excluded.first_seen),
            last_seen = max(last_seen, excluded.last_seen),
            version = excluded.version
        `;
      }

      yield* sql`
        DELETE FROM warning_uploads WHERE warning_id IN (
          SELECT id FROM warnings WHERE last_seen < ${cutoff}
        )
      `;
      yield* sql`DELETE FROM warnings WHERE last_seen < ${cutoff}`;
    });

    const record = Effect.fn("Store.record")(
      function* (
        source: string,
        events: ReadonlyArray<Event.Event>,
        next: string,
        warnings: ReadonlyArray<Warning.Warning> = [],
      ) {
        const added = yield* Effect.forEach(events, insert);

        yield* countWarnings(warnings);

        yield* sql`
          INSERT INTO cursors ${sql.insert({ source, cursor: next })}
          ON CONFLICT (source) DO UPDATE SET cursor = excluded.cursor
        `;

        return added.reduce<number>((total, count) => total + count, 0);
      },
      sql.withTransaction,
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    /** The programs that have an issue that isn't muted. */
    const activePrograms = Effect.map(
      sql<{ fingerprint: string }>`
        SELECT issue_fingerprints.fingerprint FROM issue_fingerprints
        JOIN issues ON issues.id = issue_fingerprints.issue_id
        WHERE issues.status != 'muted' AND issues.count > 0
      `,
      (rows) => programsOf(rows.map((row) => row.fingerprint)),
    );

    /** Warnings that belong to one of the given programs. */
    const ofPrograms = (programs: ReadonlyArray<string>) =>
      sql`(identifier IN ${sql.in(programs)} OR unit IN ${sql.in(programs)})`;

    const addWarnings = Effect.fn("Store.addWarnings")(
      function* (warnings: ReadonlyArray<Warning.Warning>) {
        const programs = new Set(yield* activePrograms);

        const kept = sumWarnings(warnings).filter((warning) =>
          Warning.programs(warning).some((name) => programs.has(name)),
        );

        for (const warning of kept) {
          yield* sql`
            INSERT INTO warnings ${sql.insert({
              host: warning.host,
              boot_id: warning.bootId,
              identifier: warning.identifier ?? "",
              unit: warning.unit ?? "",
              template: warning.template,
              example: warning.example,
              count: warning.count,
              first_seen: warning.firstSeen,
              last_seen: warning.lastSeen,
              version: 0,
            })}
            ON CONFLICT (host, boot_id, identifier, unit, template) DO UPDATE SET
              example = excluded.example,
              count = excluded.count,
              first_seen = excluded.first_seen,
              last_seen = excluded.last_seen
          `;
        }

        return kept.length;
      },
      sql.withTransaction,
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const add = Effect.fn("Store.add")(
      function* (events: ReadonlyArray<Event.Event>) {
        const added = yield* Effect.forEach(events, insert);

        return added.reduce<number>((total, count) => total + count, 0);
      },
      sql.withTransaction,
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    /** Issues as summaries, with each one's state worked out as of `now`. */
    const summaries = (filters: Api.IssueFilters, now: number) => {
      const where = [
        sql`count > 0`,
        ...(filters.host === undefined || filters.host.length === 0
          ? []
          : [
              sql`EXISTS (
                SELECT 1 FROM events
                WHERE events.issue_id = issues.id
                  AND events.host IN ${sql.in(filters.host)}
              )`,
            ]),
        ...(filters.kind === undefined || filters.kind.length === 0
          ? []
          : [sql`kind IN ${sql.in(filters.kind)}`]),
        ...(filters.search === undefined || filters.search === ""
          ? []
          : [sql`instr(lower(title), lower(${filters.search})) > 0`]),
      ];

      return sql`
        SELECT issues.*, (
          SELECT worth FROM decisions
          WHERE decisions.issue_id = issues.id
          ORDER BY decided_at DESC
          LIMIT 1
        ) AS worth, (
          SELECT worth FROM labels WHERE labels.issue_id = issues.id
        ) AS label, (
          SELECT json_group_array(DISTINCT host) FROM events
          WHERE events.issue_id = issues.id
        ) AS hosts, CASE
          WHEN status != 'open' THEN status
          WHEN regressed_at IS NOT NULL
            AND ${now} - regressed_at < ${windows.quietMillis} THEN 'regressed'
          WHEN ${now} - first_seen < ${windows.newMillis} THEN 'new'
          WHEN ${now} - last_seen < ${windows.quietMillis} THEN 'ongoing'
          ELSE 'quiet'
        END AS state
        FROM issues
        WHERE ${sql.and(where)}
      `;
    };

    const labelConditions: Record<Api.LabelFilter, string> = {
      none: "label IS NULL",
      worth: "label = 1",
      noise: "label = 0",
    };

    const labelled = (labels: ReadonlyArray<Api.LabelFilter> | undefined) =>
      labels === undefined || labels.length === 0
        ? sql`1`
        : sql.or(labels.map((label) => labelConditions[label]));

    const sortColumns: Record<Api.IssueSort, string> = {
      lastSeen: "last_seen",
      firstSeen: "first_seen",
      worth: "worth",
      count: "count",
      title: "title COLLATE NOCASE",
    };

    const groupColumns: Record<Api.IssueGrouping, string> = {
      state: `CASE state ${Issue.State.literals
        .map((state, index) => `WHEN '${state}' THEN ${index}`)
        .join(" ")} END`,
      kind: "kind",
      label: "CASE label WHEN 1 THEN 0 WHEN 0 THEN 1 ELSE 2 END",
    };

    const decodeSummaries = Schema.decodeUnknownEffect(
      Schema.Array(SummaryRow),
    );

    const decodeCounts = Schema.decodeUnknownEffect(
      Schema.Array(Schema.Struct({ state: Issue.State, count: Schema.Int })),
    );

    const issues = Effect.fn("Store.issues")(
      function* (options: ListOptions) {
        const now = yield* Clock.currentTimeMillis;
        const sort = options.sort ?? "lastSeen";

        const orderBy = [
          ...(options.group === undefined ? [] : [groupColumns[options.group]]),
          ...(sort === "worth" ? ["worth IS NULL"] : []),
          `${sortColumns[sort]} ${options.order === "asc" ? "ASC" : "DESC"}`,
          "id",
        ].join(", ");

        const rows = yield* decodeSummaries(
          yield* sql`
            SELECT * FROM (${summaries(options, now)})
            WHERE ${sql.and([
              labelled(options.label),
              ...(options.state === undefined || options.state.length === 0
                ? []
                : [sql`state IN ${sql.in(options.state)}`]),
            ])}
            ORDER BY ${sql.literal(orderBy)}
            LIMIT ${options.limit} OFFSET ${options.offset ?? 0}
          `,
        );

        return rows.map((row) => toSummary(row, now, windows));
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const issueCounts = Effect.fn("Store.issueCounts")(
      function* (filters: Api.IssueFilters) {
        const now = yield* Clock.currentTimeMillis;

        const rows = yield* decodeCounts(
          yield* sql`
            SELECT state, COUNT(*) AS count FROM (${summaries(filters, now)})
            WHERE ${labelled(filters.label)}
            GROUP BY state
          `,
        );

        const counts = new Map(rows.map((row) => [row.state, row.count]));

        return {
          total: rows.reduce((total, row) => total + row.count, 0),
          states: {
            new: counts.get("new") ?? 0,
            ongoing: counts.get("ongoing") ?? 0,
            quiet: counts.get("quiet") ?? 0,
            regressed: counts.get("regressed") ?? 0,
            resolved: counts.get("resolved") ?? 0,
            muted: counts.get("muted") ?? 0,
          },
        };
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const listHosts = SqlSchema.findAll({
      Request: Schema.Void,
      Result: HostRow,
      execute: () => sql`
        SELECT host, COUNT(*) AS events, COUNT(DISTINCT issue_id) AS issues,
          MAX(timestamp) AS last_seen
        FROM events GROUP BY host ORDER BY last_seen DESC
      `,
    });

    const hosts = listHosts(undefined).pipe(
      Effect.map((rows) =>
        rows.map((row): Api.HostSummary => ({
          host: row.host,
          events: row.events,
          issues: row.issues,
          lastSeen: row.last_seen,
        })),
      ),
      Effect.mapError((cause) => new StoreError({ cause })),
      Effect.withSpan("Store.hosts"),
    );

    const issueHosts = SqlSchema.findAll({
      Request: Schema.String,
      Result: HostCountRow,
      execute: (id) => sql`
        SELECT host, COUNT(*) AS count, MIN(timestamp) AS first_seen,
          MAX(timestamp) AS last_seen
        FROM events WHERE issue_id = ${id}
        GROUP BY host ORDER BY count DESC, host
      `,
    });

    /** An issue's ID, or the ID of the issue it was merged into. */
    const target = (id: string) =>
      sql`coalesce((SELECT issue_id FROM issue_redirects WHERE id = ${id}), ${id})`;

    const findIssue = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: IssueRow,
      execute: (id) =>
        sql`SELECT * FROM issues WHERE id = ${target(id)} AND count > 0`,
    });

    const issueEvents = SqlSchema.findAll({
      Request: Schema.Struct({
        id: Schema.String,
        limit: Schema.Int,
        offset: Schema.Int,
      }),
      Result: Schema.Struct({ data: EventJson }),
      execute: ({ id, limit, offset }) =>
        sql`SELECT data FROM events WHERE issue_id = ${id} ORDER BY timestamp DESC, host, id LIMIT ${limit} OFFSET ${offset}`,
    });

    const decodeWarnings = Schema.decodeUnknownEffect(Schema.Array(WarningRow));

    /** The warnings an issue's program logged on the hosts it happened on. */
    const warningsFor = Effect.fnUntraced(function* (id: string) {
      const owned = yield* sql<{ fingerprint: string }>`
        SELECT fingerprint FROM issue_fingerprints WHERE issue_id = ${id}
      `;

      const programs = programsOf(owned.map((row) => row.fingerprint));

      if (programs.length === 0) {
        return [];
      }

      return issueWarnings(
        yield* decodeWarnings(
          yield* sql`
            SELECT * FROM warnings
            WHERE ${ofPrograms(programs)}
              AND host IN (SELECT DISTINCT host FROM events WHERE issue_id = ${id})
            ORDER BY last_seen DESC
            LIMIT 1000
          `,
        ),
      );
    });

    const issue = Effect.fn("Store.issue")(
      function* (id: string, limit: number) {
        const row = yield* findIssue(id);

        if (Option.isNone(row)) {
          return Option.none();
        }

        const rows = yield* issueEvents({ id: row.value.id, limit, offset: 0 });

        return Option.some({
          issue: toIssue(row.value, yield* Clock.currentTimeMillis, windows),
          events: rows.map((event) => event.data),
          warnings: yield* warningsFor(row.value.id),
        });
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const events = Effect.fn("Store.events")(
      function* (id: string, page: { limit: number; offset: number }) {
        const row = yield* findIssue(id);

        if (Option.isNone(row)) {
          return Option.none();
        }

        const rows = yield* issueEvents({ ...page, id: row.value.id });

        return Option.some<Api.IssueEvents>({
          total: row.value.count,
          events: rows.map((event) => event.data),
        });
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const issueDecisions = SqlSchema.findAll({
      Request: Schema.String,
      Result: DecisionRow,
      execute: (id) => sql`
        SELECT model, decided_at, decided_by, issue_count, worth, severity, cause
        FROM decisions WHERE issue_id = ${id} ORDER BY decided_at DESC
      `,
    });

    const issueSuggestions = SqlSchema.findAll({
      Request: Schema.String,
      Result: SuggestionRow,
      execute: (id) => sql`
        SELECT model, suggested_at, suggested_by, issue_count, text
        FROM suggestions WHERE issue_id = ${id} ORDER BY suggested_at DESC
      `,
    });

    const issueLabel = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: Schema.Struct({ worth: Schema.BooleanFromBit }),
      execute: (id) => sql`SELECT worth FROM labels WHERE issue_id = ${id}`,
    });

    const issueNotes = SqlSchema.findAll({
      Request: Schema.String,
      Result: NoteRow,
      execute: (id) => sql`
        SELECT id, created_at, created_by, status, text
        FROM notes WHERE issue_id = ${id} ORDER BY created_at DESC, id DESC
      `,
    });

    const issueFingerprints = SqlSchema.findAll({
      Request: Schema.String,
      Result: Api.IssueFingerprint,
      execute: (id) => sql`
        SELECT fingerprint, (
          SELECT COUNT(*) FROM events
          WHERE events.issue_id = ${id}
            AND events.fingerprint = issue_fingerprints.fingerprint
        ) AS count
        FROM issue_fingerprints WHERE issue_id = ${id}
        ORDER BY count DESC, fingerprint
      `,
    });

    /**
     * Other issues with events on the same host within `Api.nearbyMillis` of
     * one of this issue's latest events, those near the most first.
     */
    const nearbyIssues = Effect.fnUntraced(function* (id: string) {
      const near = yield* sql<{ id: string; near: number }>`
        SELECT other.issue_id AS id, COUNT(DISTINCT mine.id) AS near
        FROM (
          SELECT host, id, timestamp FROM events
          WHERE issue_id = ${id}
          ORDER BY timestamp DESC
          LIMIT ${Api.latestEvents}
        ) AS mine
        JOIN events AS other ON other.host = mine.host
          AND other.timestamp BETWEEN mine.timestamp - ${Api.nearbyMillis}
            AND mine.timestamp + ${Api.nearbyMillis}
          AND other.issue_id != ${id}
        GROUP BY other.issue_id
        ORDER BY near DESC, MAX(other.timestamp) DESC
        LIMIT ${Api.maxNearby}
      `;

      if (near.length === 0) {
        return [];
      }

      const counts = new Map(near.map((row) => [row.id, row.near]));
      const now = yield* Clock.currentTimeMillis;

      const rows = yield* decodeSummaries(
        yield* sql`
          SELECT * FROM (${summaries({}, now)})
          WHERE id IN ${sql.in([...counts.keys()])}
        `,
      );

      return rows
        .map((row): Api.NearbyIssue =>
          Object.assign(toSummary(row, now, windows), {
            near: counts.get(row.id) ?? 0,
          }),
        )
        .toSorted((a, b) => b.near - a.near || b.lastSeen - a.lastSeen);
    });

    const review = Effect.fn("Store.review")(
      function* (requested: string, limit: number) {
        const detail = yield* issue(requested, limit);

        if (Option.isNone(detail)) {
          return Option.none();
        }

        const id = detail.value.issue.id;

        const decisions = yield* issueDecisions(id);
        const suggestions = yield* issueSuggestions(id);
        const notes = yield* issueNotes(id);
        const label = yield* issueLabel(id);
        const hostCounts = yield* issueHosts(id);
        const fingerprints = yield* issueFingerprints(id);
        const nearby = yield* nearbyIssues(id);

        return Option.some<Api.IssueReview>({
          ...detail.value,
          ...Option.match(label, {
            onNone: () => ({}),
            onSome: (row) => ({
              label: row.worth ? ("worth" as const) : ("noise" as const),
            }),
          }),
          hosts: hostCounts.map((row) => ({
            host: row.host,
            count: row.count,
            firstSeen: row.first_seen,
            lastSeen: row.last_seen,
          })),
          decisions: decisions.map((row) => ({
            model: row.model,
            decidedAt: row.decided_at,
            by: row.decided_by,
            issueCount: row.issue_count,
            worth: row.worth,
            severity: row.severity,
            cause: row.cause,
          })),
          suggestions: suggestions.map(toSuggestion),
          notes: notes.map(toNote),
          fingerprints,
          nearby,
        });
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const similar = Effect.fn("Store.similar")(
      function* (id: string, limit: number) {
        const row = yield* findIssue(id);

        if (Option.isNone(row)) {
          return Option.none();
        }

        const now = yield* Clock.currentTimeMillis;

        const rows = yield* decodeSummaries(
          yield* sql`
            SELECT * FROM (${summaries({}, now)})
            WHERE id != ${row.value.id}
              AND instr(fingerprint, ${Fingerprint.family(row.value.fingerprint)}) = 1
            ORDER BY state = 'resolved' DESC, last_seen DESC, id
            LIMIT ${limit}
          `,
        );

        return Option.some(
          yield* Effect.forEach(rows, (similarRow) =>
            Effect.all([
              issueSuggestions(similarRow.id),
              issueNotes(similarRow.id),
            ]).pipe(
              Effect.map(([suggestions, notes]): Api.SimilarIssue =>
                Object.assign(toSummary(similarRow, now, windows), {
                  suggestions: suggestions.map(toSuggestion),
                  notes: notes.map(toNote),
                }),
              ),
            ),
          ),
        );
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const addToken = Effect.fn("Store.addToken")(
      function* (scope: TokenScope, name: string, tokenHash: string) {
        const rows = yield* sql`
          INSERT INTO tokens ${sql.insert({
            scope,
            name,
            token_hash: tokenHash,
            created_at: yield* Clock.currentTimeMillis,
          })}
          ON CONFLICT DO NOTHING
          RETURNING name
        `;

        return rows.length > 0;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const tokenName = Effect.fn("Store.tokenName")(
      function* (scope: TokenScope, tokenHash: string) {
        const rows = yield* sql<{
          name: string;
        }>`SELECT name FROM tokens WHERE scope = ${scope} AND token_hash = ${tokenHash}`;

        return Option.fromNullishOr(rows[0]?.name);
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const listTokens = SqlSchema.findAll({
      Request: TokenScope,
      Result: Schema.Struct({ name: Schema.String, created_at: Schema.Finite }),
      execute: (scope) =>
        sql`SELECT name, created_at FROM tokens WHERE scope = ${scope} ORDER BY created_at`,
    });

    const tokens = Effect.fn("Store.tokens")(
      function* (scope: TokenScope) {
        const rows = yield* listTokens(scope);

        return rows.map((row) => ({
          name: row.name,
          createdAt: row.created_at,
        }));
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const removeToken = Effect.fn("Store.removeToken")(
      function* (scope: TokenScope, name: string) {
        const rows = yield* sql`
          DELETE FROM tokens WHERE scope = ${scope} AND name = ${name}
          RETURNING name
        `;

        return rows.length > 0;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const pendingEvents = SqlSchema.findAll({
      Request: Schema.Struct({ target: Schema.String, limit: Schema.Int }),
      Result: Schema.Struct({ rowid: Schema.Int, data: EventJson }),
      execute: ({ target, limit }) => sql`
        SELECT rowid, data FROM events
        WHERE rowid > coalesce(
          (SELECT last_event FROM uploads WHERE target = ${target}),
          0
        )
        ORDER BY rowid
        LIMIT ${limit}
      `,
    });

    const pending = Effect.fn("Store.pending")(
      function* (target: string, limit: number) {
        const rows = yield* pendingEvents({ target, limit });

        return {
          events: rows.map((row) => row.data),
          last: rows.at(-1)?.rowid ?? 0,
        };
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const uploaded = Effect.fn("Store.uploaded")(
      function* (target: string, last: number) {
        yield* sql`
          INSERT INTO uploads ${sql.insert({ target, last_event: last })}
          ON CONFLICT (target) DO UPDATE SET last_event = excluded.last_event
        `;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const pendingWarnings = Effect.fn("Store.pendingWarnings")(
      function* (target: string, limit: number) {
        const programs = yield* activePrograms;

        if (programs.length === 0) {
          return { warnings: [], versions: [] };
        }

        const rows = yield* decodeWarnings(
          yield* sql`
            SELECT warnings.* FROM warnings
            LEFT JOIN warning_uploads ON warning_uploads.warning_id = warnings.id
              AND warning_uploads.target = ${target}
            WHERE (warning_uploads.version IS NULL
                OR warning_uploads.version != warnings.version)
              AND ${ofPrograms(programs)}
            ORDER BY warnings.id
            LIMIT ${limit}
          `,
        );

        return {
          warnings: rows.map(toWarning),
          versions: rows.map(({ id, version }) => ({ id, version })),
        };
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const warningsUploaded = Effect.fn("Store.warningsUploaded")(
      function* (target: string, versions: PendingWarnings["versions"]) {
        for (const { id, version } of versions) {
          yield* sql`
            INSERT INTO warning_uploads ${sql.insert({
              target,
              warning_id: id,
              version,
            })}
            ON CONFLICT (target, warning_id) DO UPDATE SET
              version = excluded.version
          `;
        }
      },
      sql.withTransaction,
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const listUndecided = SqlSchema.findAll({
      Request: Schema.Struct({ model: Schema.String, limit: Schema.Int }),
      Result: IssueRow,
      execute: ({ model, limit }) => sql`
        SELECT * FROM issues
        WHERE count > 0 AND status = 'open' AND NOT EXISTS (
          SELECT 1 FROM decisions
          WHERE decisions.issue_id = issues.id
            AND decisions.model = ${model}
            AND decisions.decided_at > coalesce(issues.regressed_at, 0)
        )
        ORDER BY last_seen DESC
        LIMIT ${limit}
      `,
    });

    const undecided = Effect.fn("Store.undecided")(
      function* (model: string, limit: number) {
        const rows = yield* listUndecided({ model, limit });
        const now = yield* Clock.currentTimeMillis;

        return rows.map((row) => toIssue(row, now, windows));
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const saveDecision = Effect.fn("Store.saveDecision")(
      function* (decision: StoredDecision, by: string) {
        yield* sql`
          INSERT INTO decisions ${sql.insert({
            issue_id: decision.issueId,
            model: decision.model,
            decided_at: yield* Clock.currentTimeMillis,
            decided_by: by,
            issue_count: decision.issueCount,
            worth: decision.worth,
            severity: decision.severity,
            cause: decision.cause,
            answers: decision.answers,
          })}
          ON CONFLICT (issue_id, model) DO UPDATE SET
            decided_at = excluded.decided_at,
            decided_by = excluded.decided_by,
            issue_count = excluded.issue_count,
            worth = excluded.worth,
            severity = excluded.severity,
            cause = excluded.cause,
            answers = excluded.answers
        `;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const label = Effect.fn("Store.label")(function* (
      issueId: string,
      worth: boolean,
    ) {
      const rows = yield* sql`
          INSERT INTO labels (issue_id, worth, labelled_at)
          SELECT id, ${worth ? 1 : 0}, ${yield* Clock.currentTimeMillis}
          FROM issues WHERE id = ${target(issueId)} AND count > 0
          ON CONFLICT (issue_id) DO UPDATE SET
            worth = excluded.worth,
            labelled_at = excluded.labelled_at
          RETURNING issue_id
        `.pipe(Effect.mapError((cause) => new StoreError({ cause })));

      if (rows.length === 0) {
        return yield* new IssueNotFound({ issueId });
      }
    });

    const insertNote = (note: {
      readonly issueId: string;
      readonly createdAt: number;
      readonly by: string;
      readonly status: Api.NoteStatus | null;
      readonly text: string;
    }) => sql`
      INSERT INTO notes ${sql.insert({
        issue_id: note.issueId,
        created_at: note.createdAt,
        created_by: note.by,
        status: note.status,
        text: redactGeneric(note.text.trim()),
      })}
    `;

    const toStoreError = (cause: SqlError.SqlError) =>
      Effect.fail(new StoreError({ cause }));

    const setStatus = Effect.fn("Store.setStatus")(
      function* (issueId: string, status: Issue.Status, change: StatusChange) {
        const now = yield* Clock.currentTimeMillis;

        const rows = yield* sql<{ id: string }>`
          UPDATE issues SET
            status = ${status},
            resolved_at = ${status === "resolved" ? now : null},
            regressed_at = NULL
          WHERE id = ${target(issueId)} AND count > 0
          RETURNING id
        `;

        const [row] = rows;

        if (row === undefined) {
          return yield* new IssueNotFound({ issueId });
        }

        yield* insertNote({
          issueId: row.id,
          createdAt: now,
          by: change.by,
          status,
          text: change.note ?? "",
        });
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", toStoreError),
    );

    const addNote = Effect.fn("Store.addNote")(
      function* (issueId: string, text: string, by: string) {
        const rows = yield* sql<{ id: string }>`
          SELECT id FROM issues WHERE id = ${target(issueId)} AND count > 0
        `;

        const [row] = rows;

        if (row === undefined) {
          return yield* new IssueNotFound({ issueId });
        }

        yield* insertNote({
          issueId: row.id,
          createdAt: yield* Clock.currentTimeMillis,
          by,
          status: null,
          text,
        });
      },
      Effect.catchTag("SqlError", toStoreError),
    );

    const merge = Effect.fn("Store.merge")(
      function* (issueIds: ReadonlyArray<string>, by: string) {
        const found = new Map<string, typeof IssueRow.Type>();

        for (const issueId of issueIds) {
          const row = yield* findIssue(issueId);

          if (Option.isNone(row)) {
            return yield* new IssueNotFound({ issueId });
          }

          found.set(row.value.id, row.value);
        }

        const [kept, ...rest] = [...found.values()].sort(
          (a, b) =>
            a.first_seen - b.first_seen ||
            b.count - a.count ||
            (a.id < b.id ? -1 : 1),
        );

        if (kept === undefined || rest.length === 0) {
          return yield* new NothingToMerge({ issueIds });
        }

        const cause = [kept, ...rest].reduce((best, row) =>
          causeOrder.indexOf(row.kind) < causeOrder.indexOf(best.kind)
            ? row
            : best,
        );

        const merged = mergedStatus(
          yield* sql<{
            status: string;
            resolved_at: number | null;
            regressed_at: number | null;
          }>`
            SELECT status, resolved_at, regressed_at FROM issues
            WHERE id IN ${sql.in([...found.keys()])}
          `,
        );

        for (const { id } of rest) {
          yield* sql`
            UPDATE issue_fingerprints SET issue_id = ${kept.id}
            WHERE issue_id = ${id}
          `;
          yield* sql`UPDATE notes SET issue_id = ${kept.id} WHERE issue_id = ${id}`;
          yield* sql`
            UPDATE issue_redirects SET issue_id = ${kept.id}
            WHERE issue_id = ${id}
          `;
          yield* moveIssue(id, kept.id);
          yield* sql`
            INSERT INTO issue_redirects ${sql.insert({ id, issue_id: kept.id })}
          `;
        }

        yield* sql`
          UPDATE issues SET
            fingerprint = ${cause.fingerprint},
            kind = ${cause.kind},
            title = ${cause.title},
            first_seen = (SELECT MIN(timestamp) FROM events WHERE issue_id = ${kept.id}),
            last_seen = (SELECT MAX(timestamp) FROM events WHERE issue_id = ${kept.id}),
            count = (SELECT COUNT(*) FROM events WHERE issue_id = ${kept.id}),
            status = ${merged.status},
            resolved_at = ${merged.resolvedAt},
            regressed_at = ${merged.regressedAt}
          WHERE id = ${kept.id}
        `;

        const ids = rest.map((row) => row.id);

        yield* insertNote({
          issueId: kept.id,
          createdAt: yield* Clock.currentTimeMillis,
          by,
          status: null,
          text: `Merged ${ids.join(", ")}`,
        });

        return { id: kept.id, merged: ids };
      },
      Effect.provideService(SqlClient.SqlClient, sql),
      sql.withTransaction,
      Effect.catchTag("SqlError", toStoreError),
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(new StoreError({ cause })),
      ),
    );

    const latestEvent = SqlSchema.findOneOption({
      Request: Schema.Struct({ id: Schema.String, fingerprint: Schema.String }),
      Result: Schema.Struct({ data: EventJson }),
      execute: ({ id, fingerprint }) => sql`
        SELECT data FROM events WHERE issue_id = ${id} AND fingerprint = ${fingerprint}
        ORDER BY timestamp DESC LIMIT 1
      `,
    });

    /** Count an issue's events again, after some moved in or out. */
    const recount = (id: string) => sql`
      UPDATE issues SET
        first_seen = coalesce((SELECT MIN(timestamp) FROM events WHERE issue_id = ${id}), first_seen),
        last_seen = coalesce((SELECT MAX(timestamp) FROM events WHERE issue_id = ${id}), last_seen),
        count = (SELECT COUNT(*) FROM events WHERE issue_id = ${id})
      WHERE id = ${id}
    `;

    const unmerge = Effect.fn("Store.unmerge")(
      function* (issueId: string, fingerprint: string, by: string) {
        const row = yield* findIssue(issueId);

        if (Option.isNone(row)) {
          return yield* new IssueNotFound({ issueId });
        }

        const source = row.value;

        const owned = yield* sql<{ fingerprint: string; events: number }>`
          SELECT fingerprint, (
            SELECT COUNT(*) FROM events
            WHERE events.issue_id = ${source.id}
              AND events.fingerprint = issue_fingerprints.fingerprint
          ) AS events
          FROM issue_fingerprints WHERE issue_id = ${source.id}
        `;

        if (!owned.some((owner) => owner.fingerprint === fingerprint)) {
          return yield* new FingerprintNotFound({
            issueId: source.id,
            fingerprint,
          });
        }

        if (owned.length < 2) {
          return yield* new NothingToUnmerge({ issueId: source.id });
        }

        const now = yield* Clock.currentTimeMillis;
        const natural = Fingerprint.issueId(fingerprint);

        const taken = yield* sql`SELECT 1 FROM issues WHERE id = ${natural}`;

        const id =
          taken.length === 0
            ? natural
            : Fingerprint.issueId(`${fingerprint}|${now}`);

        const started = Option.map(
          yield* latestEvent({ id: source.id, fingerprint }),
          ({ data }) => Issue.fromEvent(data),
        );

        const status = yield* sql<{
          status: string;
          resolved_at: number | null;
          regressed_at: number | null;
        }>`SELECT status, resolved_at, regressed_at FROM issues WHERE id = ${source.id}`;

        yield* sql`
          INSERT INTO issues ${sql.insert({
            id,
            fingerprint,
            kind: Option.match(started, {
              onNone: () => source.kind,
              onSome: (issue) => issue.kind,
            }),
            title: Option.match(started, {
              onNone: () => source.title,
              onSome: (issue) => issue.title,
            }),
            first_seen: source.first_seen,
            last_seen: source.last_seen,
            count: 0,
            status: status[0]?.status ?? "open",
            resolved_at: status[0]?.resolved_at ?? null,
            regressed_at: status[0]?.regressed_at ?? null,
          })}
        `;
        yield* sql`
          UPDATE events SET issue_id = ${id}
          WHERE issue_id = ${source.id} AND fingerprint = ${fingerprint}
        `;
        yield* sql`
          UPDATE issue_fingerprints SET issue_id = ${id}
          WHERE fingerprint = ${fingerprint}
        `;
        yield* sql`DELETE FROM issue_redirects WHERE id = ${id}`;
        yield* recount(id);
        yield* recount(source.id);

        // The issue left behind takes the kind and title of its cause again.
        const remaining = yield* Effect.forEach(
          owned.filter((owner) => owner.fingerprint !== fingerprint),
          (owner) =>
            Effect.map(
              latestEvent({ id: source.id, fingerprint: owner.fingerprint }),
              Option.map(({ data }) => ({
                issue: Issue.fromEvent(data),
                events: owner.events,
              })),
            ),
        );

        const [cause] = remaining
          .flatMap((found) => (Option.isSome(found) ? [found.value] : []))
          .sort(
            (a, b) =>
              causeOrder.indexOf(a.issue.kind) -
                causeOrder.indexOf(b.issue.kind) || b.events - a.events,
          );

        if (cause !== undefined) {
          yield* sql`
            UPDATE issues SET
              fingerprint = ${cause.issue.fingerprint},
              kind = ${cause.issue.kind},
              title = ${cause.issue.title}
            WHERE id = ${source.id}
          `;
        }

        yield* insertNote({
          issueId: source.id,
          createdAt: now,
          by,
          status: null,
          text: `Unmerged ${id}`,
        });
        yield* insertNote({
          issueId: id,
          createdAt: now,
          by,
          status: null,
          text: `Unmerged from ${source.id}`,
        });

        return id;
      },
      sql.withTransaction,
      Effect.catchTag("SqlError", toStoreError),
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(new StoreError({ cause })),
      ),
    );

    const labelledDecisions = SqlSchema.findAll({
      Request: Schema.Void,
      Result: LabelledDecision,
      execute: () => sql`
        SELECT decisions.model, decisions.worth, labels.worth AS label
        FROM decisions JOIN labels USING (issue_id)
        ORDER BY decisions.model
      `,
    })(undefined).pipe(
      Effect.mapError((cause) => new StoreError({ cause })),
      Effect.withSpan("Store.labelledDecisions"),
    );

    const countSince = (table: "decisions" | "suggestions", column: string) =>
      Effect.fn(`Store.${table}Since`)(
        function* (model: string, since: number) {
          const rows = yield* sql<{ count: number }>`
            SELECT count(*) AS count FROM ${sql(table)}
            WHERE model = ${model} AND ${sql(column)} >= ${since}
          `;

          return rows[0]?.count ?? 0;
        },
        Effect.mapError((cause) => new StoreError({ cause })),
      );

    const decidedSince = countSince("decisions", "decided_at");
    const suggestedSince = countSince("suggestions", "suggested_at");

    const listUnsuggested = SqlSchema.findAll({
      Request: Schema.Struct({
        model: Schema.String,
        decisionModel: Schema.String,
        worth: Schema.Finite,
        limit: Schema.Int,
      }),
      Result: IssueRow,
      execute: ({ model, decisionModel, worth, limit }) => sql`
        SELECT issues.* FROM issues JOIN decisions ON decisions.issue_id = issues.id
        WHERE decisions.model = ${decisionModel}
          AND decisions.worth >= ${worth}
          AND issues.count > 0
          AND issues.status = 'open'
          AND issues.id NOT IN (
            SELECT issue_id FROM suggestions WHERE model = ${model}
          )
        ORDER BY issues.last_seen DESC
        LIMIT ${limit}
      `,
    });

    const unsuggested = Effect.fn("Store.unsuggested")(
      function* (options: {
        readonly model: string;
        readonly decisionModel: string;
        readonly worth: number;
        readonly limit: number;
      }) {
        const rows = yield* listUnsuggested(options);
        const now = yield* Clock.currentTimeMillis;

        return rows.map((row) => toIssue(row, now, windows));
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const saveSuggestion = Effect.fn("Store.saveSuggestion")(
      function* (suggestion: StoredSuggestion, by: string) {
        yield* sql`
          INSERT INTO suggestions ${sql.insert({
            issue_id: suggestion.issueId,
            model: suggestion.model,
            suggested_at: yield* Clock.currentTimeMillis,
            suggested_by: by,
            issue_count: suggestion.issueCount,
            text: suggestion.text,
            evidence: suggestion.evidence,
          })}
          ON CONFLICT (issue_id, model) DO UPDATE SET
            suggested_at = excluded.suggested_at,
            suggested_by = excluded.suggested_by,
            issue_count = excluded.issue_count,
            text = excluded.text,
            evidence = excluded.evidence
        `;
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    return Store.of({
      cursor,
      redactionKey,
      remember,
      resolve,
      pendingRedactions,
      redactionsUploaded,
      pruneRedactions,
      record,
      add,
      addWarnings,
      issues,
      issueCounts,
      hosts,
      issue,
      events,
      review,
      similar,
      addToken,
      tokenName,
      tokens,
      removeToken,
      pending,
      uploaded,
      pendingWarnings,
      warningsUploaded,
      undecided,
      decidedSince,
      saveDecision,
      label,
      setStatus,
      addNote,
      merge,
      unmerge,
      labelledDecisions,
      unsuggested,
      suggestedSince,
      saveSuggestion,
    });
  });

  /** This store as the vault for redaction tokens' key and values. */
  static readonly layerVault = Layer.effect(
    RedactionVault,
    Effect.gen(function* () {
      const store = yield* Store;

      return RedactionVault.of({
        key: store.redactionKey,
        remember: (redactions) =>
          store.remember(redactions).pipe(Effect.asVoid),
      });
    }),
  );

  /** A store in the given SQLite database file, migrated before use. */
  static readonly layerFile = (filename: string) =>
    Layer.effect(Store, Store.make).pipe(
      Layer.provide(SqliteMigrator.layer({ loader: migrations })),
      Layer.provide(SqliteClient.layer({ filename })),
    );

  /**
   * A store in `$XDG_STATE_HOME/triage`, unless the given environment
   * variable names another file, creating its directory when needed.
   */
  static readonly layerState = (file: string, variable: string) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* Config.String("HOME").pipe(Config.withDefault(""));

        const stateHome = yield* Config.String("XDG_STATE_HOME").pipe(
          Config.withDefault(path.join(home, ".local", "state")),
        );

        const filename = yield* Config.String(variable).pipe(
          Config.withDefault(path.join(stateHome, "triage", file)),
        );

        yield* fs.makeDirectory(path.dirname(filename), { recursive: true });

        return Store.layerFile(filename);
      }),
    );

  /** This machine's events, at `$TRIAGE_DB` or `triage.db`. */
  static readonly layer = Store.layerState("triage.db", "TRIAGE_DB");

  /** The server's events from every host, at `$TRIAGE_SERVER_DB` or `server.db`. */
  static readonly layerServer = Store.layerState(
    "server.db",
    "TRIAGE_SERVER_DB",
  );
}
