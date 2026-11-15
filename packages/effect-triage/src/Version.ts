/**
 * The header the web UI sends its version in. The server refuses a call from
 * a page of another version, such as one the browser kept from before the
 * server was updated. A client that doesn't send it isn't held to a version.
 */
export const header = "x-triage-version";
