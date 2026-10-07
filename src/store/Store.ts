import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Api, Event, Fingerprint, Issue } from "@timmo001/effect-triage";
import {
  Clock,
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
} from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

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

const state = (row: typeof IssueRow.Type, now: number): Issue.State => {
  if (row.status !== "open") {
    return row.status;
  }

  if (
    row.regressed_at !== null &&
    now - row.regressed_at < Issue.recentMillis
  ) {
    return "regressed";
  }

  if (now - row.first_seen < Issue.newMillis) {
    return "new";
  }

  return now - row.last_seen < Issue.recentMillis ? "ongoing" : "quiet";
};

const toIssue = (row: typeof IssueRow.Type, now: number): Issue.Issue => ({
  id: row.id,
  fingerprint: row.fingerprint,
  kind: row.kind,
  title: row.title,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  count: row.count,
  state: state(row, now),
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
): Api.IssueSummary =>
  Object.assign(
    toIssue(row, now),
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

  const rows = yield* sql<{
    status: string;
    resolved_at: number | null;
    regressed_at: number | null;
  }>`
    SELECT status, resolved_at, regressed_at FROM issues
    WHERE id IN ${sql.in([next, ...sources])}
  `;

  const status =
    ["muted", "open"].find((s) => rows.some((row) => row.status === s)) ??
    "resolved";

  const latest = (values: ReadonlyArray<number | null>) =>
    values.reduce<number | null>(
      (max, value) =>
        value !== null && (max === null || value > max) ? value : max,
      null,
    );

  yield* sql`
    INSERT OR IGNORE INTO issues (id, fingerprint, kind, title, first_seen,
      last_seen, count)
    SELECT ${next}, ${key}, kind, title, first_seen, last_seen, count
    FROM issues WHERE id = ${sources[0]}
  `;

  for (const id of sources) {
    yield* sql`
      INSERT INTO decisions (issue_id, model, decided_at, decided_by,
        issue_count, worth, severity, cause, answers)
      SELECT ${next}, model, decided_at, decided_by, issue_count, worth,
        severity, cause, answers
      FROM decisions WHERE issue_id = ${id}
      ON CONFLICT (issue_id, model) DO UPDATE SET
        decided_at = excluded.decided_at, decided_by = excluded.decided_by,
        issue_count = excluded.issue_count, worth = excluded.worth,
        severity = excluded.severity, cause = excluded.cause,
        answers = excluded.answers
      WHERE excluded.decided_at > decisions.decided_at
    `;
    yield* sql`
      INSERT INTO labels (issue_id, worth, labelled_at)
      SELECT ${next}, worth, labelled_at FROM labels WHERE issue_id = ${id}
      ON CONFLICT (issue_id) DO UPDATE SET
        worth = excluded.worth, labelled_at = excluded.labelled_at
      WHERE excluded.labelled_at > labels.labelled_at
    `;
    yield* sql`
      INSERT INTO suggestions (issue_id, model, suggested_at, suggested_by,
        issue_count, text, evidence)
      SELECT ${next}, model, suggested_at, suggested_by, issue_count, text,
        evidence
      FROM suggestions WHERE issue_id = ${id}
      ON CONFLICT (issue_id, model) DO UPDATE SET
        suggested_at = excluded.suggested_at,
        suggested_by = excluded.suggested_by,
        issue_count = excluded.issue_count, text = excluded.text,
        evidence = excluded.evidence
      WHERE excluded.suggested_at > suggestions.suggested_at
    `;
    yield* sql`UPDATE events SET issue_id = ${next} WHERE issue_id = ${id}`;
    yield* sql`DELETE FROM decisions WHERE issue_id = ${id}`;
    yield* sql`DELETE FROM labels WHERE issue_id = ${id}`;
    yield* sql`DELETE FROM suggestions WHERE issue_id = ${id}`;
    yield* sql`DELETE FROM issues WHERE id = ${id}`;
  }

  yield* sql`
    UPDATE issues SET
      first_seen = (SELECT MIN(timestamp) FROM events WHERE issue_id = ${next}),
      last_seen = (SELECT MAX(timestamp) FROM events WHERE issue_id = ${next}),
      count = (SELECT COUNT(*) FROM events WHERE issue_id = ${next}),
      status = ${status},
      resolved_at = ${latest(rows.map((row) => row.resolved_at))},
      regressed_at = ${latest(rows.map((row) => row.regressed_at))}
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
      const key = Fingerprint.onHost(fingerprint, host);
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
});

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
     * Store events and the cursor after them together, so a source never
     * skips or double counts events. Returns how many events were new.
     */
    record(
      source: string,
      events: ReadonlyArray<Event.Event>,
      cursor: string,
    ): Effect.Effect<number, StoreError>;
    /** Store events sent by a host. Returns how many events were new. */
    add(events: ReadonlyArray<Event.Event>): Effect.Effect<number, StoreError>;
    issues(
      options: ListOptions,
    ): Effect.Effect<ReadonlyArray<Api.IssueSummary>, StoreError>;
    /** How many issues match the filters, in all and in each state. */
    issueCounts(
      filters: Api.IssueFilters,
    ): Effect.Effect<Api.IssueCounts, StoreError>;
    /** Every host that has sent events, most recently seen first. */
    readonly hosts: Effect.Effect<ReadonlyArray<Api.HostSummary>, StoreError>;
    /** An issue with its latest events, newest first. */
    issue(
      id: string,
      events: number,
    ): Effect.Effect<
      Option.Option<{
        readonly issue: Issue.Issue;
        readonly events: ReadonlyArray<Event.Event>;
      }>,
      StoreError
    >;
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
    /** Resolve, mute or reopen an issue. */
    setStatus(
      issueId: string,
      status: Issue.Status,
    ): Effect.Effect<void, IssueNotFound | StoreError>;
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

    const cursor = Effect.fn("Store.cursor")(
      function* (source: string) {
        const rows = yield* sql<{
          cursor: string;
        }>`SELECT cursor FROM cursors WHERE source = ${source}`;

        return Option.fromNullishOr(rows[0]?.cursor);
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    const insert = Effect.fnUntraced(function* (event: Event.Event) {
      const issue = Issue.fromEvent(event);

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

      const inserted = yield* sql`
        INSERT INTO events ${sql.insert({
          host: event.host,
          id: event.id,
          issue_id: issue.id,
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
        WHERE id = ${issue.id}
      `;

      // Events from before an issue was resolved, sent late, don't reopen it.
      yield* sql`
        UPDATE issues SET
          status = 'open',
          resolved_at = NULL,
          regressed_at = ${yield* Clock.currentTimeMillis}
        WHERE id = ${issue.id}
          AND status = 'resolved'
          AND resolved_at < ${event.timestamp}
      `;

      return 1;
    });

    const record = Effect.fn("Store.record")(
      function* (
        source: string,
        events: ReadonlyArray<Event.Event>,
        next: string,
      ) {
        const added = yield* Effect.forEach(events, insert);

        yield* sql`
          INSERT INTO cursors ${sql.insert({ source, cursor: next })}
          ON CONFLICT (source) DO UPDATE SET cursor = excluded.cursor
        `;

        return added.reduce<number>((total, count) => total + count, 0);
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
            AND ${now} - regressed_at < ${Issue.recentMillis} THEN 'regressed'
          WHEN ${now} - first_seen < ${Issue.newMillis} THEN 'new'
          WHEN ${now} - last_seen < ${Issue.recentMillis} THEN 'ongoing'
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

        return rows.map((row) => toSummary(row, now));
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

    const findIssue = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: IssueRow,
      execute: (id) => sql`SELECT * FROM issues WHERE id = ${id} AND count > 0`,
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

    const issue = Effect.fn("Store.issue")(
      function* (id: string, limit: number) {
        const row = yield* findIssue(id);

        if (Option.isNone(row)) {
          return Option.none();
        }

        const rows = yield* issueEvents({ id, limit, offset: 0 });

        return Option.some({
          issue: toIssue(row.value, yield* Clock.currentTimeMillis),
          events: rows.map((event) => event.data),
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

        const rows = yield* issueEvents({ id, ...page });

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

    const review = Effect.fn("Store.review")(
      function* (id: string, limit: number) {
        const detail = yield* issue(id, limit);

        if (Option.isNone(detail)) {
          return Option.none();
        }

        const decisions = yield* issueDecisions(id);
        const suggestions = yield* issueSuggestions(id);
        const label = yield* issueLabel(id);
        const hostCounts = yield* issueHosts(id);

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
            WHERE id != ${id}
              AND instr(fingerprint, ${Fingerprint.family(row.value.fingerprint)}) = 1
            ORDER BY state = 'resolved' DESC, last_seen DESC, id
            LIMIT ${limit}
          `,
        );

        return Option.some(
          yield* Effect.forEach(rows, (similarRow) =>
            issueSuggestions(similarRow.id).pipe(
              Effect.map((suggestions): Api.SimilarIssue =>
                Object.assign(toSummary(similarRow, now), {
                  suggestions: suggestions.map(toSuggestion),
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

        return rows.map((row) => toIssue(row, now));
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
          FROM issues WHERE id = ${issueId} AND count > 0
          ON CONFLICT (issue_id) DO UPDATE SET
            worth = excluded.worth,
            labelled_at = excluded.labelled_at
          RETURNING issue_id
        `.pipe(Effect.mapError((cause) => new StoreError({ cause })));

      if (rows.length === 0) {
        return yield* new IssueNotFound({ issueId });
      }
    });

    const setStatus = Effect.fn("Store.setStatus")(function* (
      issueId: string,
      status: Issue.Status,
    ) {
      const rows = yield* sql`
          UPDATE issues SET
            status = ${status},
            resolved_at = ${status === "resolved" ? yield* Clock.currentTimeMillis : null},
            regressed_at = NULL
          WHERE id = ${issueId} AND count > 0
          RETURNING id
        `.pipe(Effect.mapError((cause) => new StoreError({ cause })));

      if (rows.length === 0) {
        return yield* new IssueNotFound({ issueId });
      }
    });

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

        return rows.map((row) => toIssue(row, now));
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
      record,
      add,
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
      undecided,
      decidedSince,
      saveDecision,
      label,
      setStatus,
      labelledDecisions,
      unsuggested,
      suggestedSince,
      saveSuggestion,
    });
  });

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
