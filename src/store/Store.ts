import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Event, Issue } from "@timmo001/effect-triage";
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

export interface ListOptions {
  /** The most issues to return, most recently seen first. */
  readonly limit: number;
}

export interface Pending {
  /** Events not yet uploaded, oldest first. */
  readonly events: ReadonlyArray<Event.Event>;
  /** The position to mark as uploaded once they're sent. */
  readonly last: number;
}

/** What a token can do: a host uploads events, an admin reads issues. */
export const TokenScope = Schema.Literals(["host", "admin"]);

export type TokenScope = typeof TokenScope.Type;

export const Token = Schema.Struct({
  name: Schema.String,
  createdAt: Schema.Finite,
});

export interface Token extends Schema.Schema.Type<typeof Token> {}

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
    ): Effect.Effect<ReadonlyArray<Issue.Issue>, StoreError>;
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

    const add = Effect.fn("Store.add")(
      function* (events: ReadonlyArray<Event.Event>) {
        const added = yield* Effect.forEach(events, insert);

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

    const findIssue = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: IssueRow,
      execute: (id) => sql`SELECT * FROM issues WHERE id = ${id} AND count > 0`,
    });

    const issueEvents = SqlSchema.findAll({
      Request: Schema.Struct({ id: Schema.String, limit: Schema.Int }),
      Result: Schema.Struct({ data: EventJson }),
      execute: ({ id, limit }) =>
        sql`SELECT data FROM events WHERE issue_id = ${id} ORDER BY timestamp DESC LIMIT ${limit}`,
    });

    const issue = Effect.fn("Store.issue")(
      function* (id: string, limit: number) {
        const row = yield* findIssue(id);

        if (Option.isNone(row)) {
          return Option.none();
        }

        const rows = yield* issueEvents({ id, limit });

        return Option.some({
          issue: toIssue(row.value),
          events: rows.map((event) => event.data),
        });
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

    return Store.of({
      cursor,
      record,
      add,
      issues,
      issue,
      addToken,
      tokenName,
      tokens,
      removeToken,
      pending,
      uploaded,
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
