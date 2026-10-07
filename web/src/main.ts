import { Effect } from "effect";
import { load } from "./i18n.js";

// Every component reads its text as it's imported, so the translations load
// first.
await Effect.runPromise(load).then(
  () => import("./triage-app.js"),
  () => {
    document.body.textContent = "Couldn't reach the triage server.";
  },
);
