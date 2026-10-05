import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Event, Issue } from "@timmo001/effect-triage";
import {
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

export interface ListOptions {
  /** The most issues to return, most recently seen first. */
  readonly limit: number;
}

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
});

const toIssue = (row: typeof IssueRow.Type): Issue.Issue => ({
  id: row.id,
  fingerprint: row.fingerprint,
  kind: row.kind,
  title: row.title,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  count: row.count,
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
    issues(
      options: ListOptions,
    ): Effect.Effect<ReadonlyArray<Issue.Issue>, StoreError>;
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

    const listIssues = SqlSchema.findAll({
      Request: Schema.Int,
      Result: IssueRow,
      execute: (limit) =>
        sql`SELECT * FROM issues WHERE count > 0 ORDER BY last_seen DESC LIMIT ${limit}`,
    });

    const issues = Effect.fn("Store.issues")(
      function* (options: ListOptions) {
        const rows = yield* listIssues(options.limit);

        return rows.map(toIssue);
      },
      Effect.mapError((cause) => new StoreError({ cause })),
    );

    return Store.of({ cursor, record, issues });
  });

  /** A store in the given SQLite database file, migrated before use. */
  static readonly layerFile = (filename: string) =>
    Layer.effect(Store, Store.make).pipe(
      Layer.provide(SqliteMigrator.layer({ loader: migrations })),
      Layer.provide(SqliteClient.layer({ filename })),
    );

  /**
   * The store at `$TRIAGE_DB`, or `triage.db` in `$XDG_STATE_HOME/triage`,
   * creating its directory when needed.
   */
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* Config.String("HOME").pipe(Config.withDefault(""));

      const stateHome = yield* Config.String("XDG_STATE_HOME").pipe(
        Config.withDefault(path.join(home, ".local", "state")),
      );

      const filename = yield* Config.String("TRIAGE_DB").pipe(
        Config.withDefault(path.join(stateHome, "triage", "triage.db")),
      );

      yield* fs.makeDirectory(path.dirname(filename), { recursive: true });

      return Store.layerFile(filename);
    }),
  );
}
