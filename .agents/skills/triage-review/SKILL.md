---
name: triage-review
description: Review, clean up and test a changeset in triage, whether a pull request, a branch, recent commits or uncommitted changes. Use when asked to review changes, clean up what goes against the repository's rules, check whether review comments are valid, judge whether tests are needed, or test changes for real against the journal.
license: Apache-2.0
compatibility: Requires mise and Bun from the triage repository root, and a systemd host whose journal the user can read. Pull request steps also need gh.
---

# triage review

Work through these steps in order, skipping those that don't apply, and report after each one the user asks about. Never merge, comment on, or resolve review threads without the user's say so for that change.

## 1. Find the changeset

The changeset is the scope: review and change only what it introduces or makes worse, and read other code only as context. Work out what it is from the request:

- A pull request or branch: `git fetch origin` and check it out. Find a PR's number with `gh pr list --head <branch>`. The changeset is `git diff origin/main...HEAD`, with commits from `git log origin/main..HEAD`.
- Recent commits: the range the user names, such as `git diff <base>..HEAD`.
- Uncommitted work: `git diff` and `git diff --staged`, plus new files from `git status`.

Once the changed files are known, load every other skill that matches them or the work, and apply it within the changeset. That includes this repository's skills, such as `triage-release`, and any available skills for the languages, frameworks, testing, writing or commits involved. This skill sets the review process; the others set the rules for what's being reviewed.

## 2. Check claims against systemd

Changes often describe journald, systemd-coredump or catalog behaviour in code comments, schemas and docs. Check each claim before trusting it.

- Read real entries with `journalctl -o json`, filtered by `MESSAGE_ID` or field, and limit what comes back with `--output-fields`. Catalog message IDs and their fields are in `/usr/lib/systemd/catalog/systemd.catalog`.
- Fields can be a string, `null` when too large, a byte array when not UTF-8, or an array when repeated. New schemas must accept all of them.
- Never paste raw entries into commits, tests or docs. Core dump fields such as `COREDUMP_CMDLINE`, `COREDUMP_ENVIRON` and `COREDUMP_CWD` hold secrets and home paths; build fixtures by hand from redacted values.

## 3. Clean up against the repository's rules

Fix only what the changeset introduces:

- Tests that don't catch a meaningful failure nothing else covers: schema-decoding checks, unit tests that repeat an end-to-end test, tests tied to logic the change removes.
- Unused fields, options or exports the change adds.
- Comments heavier than the surrounding code, and writing that doesn't match the repository's voice.
- Imperative loops where a short expression reads better, and anything that breaks `AGENTS.md`.

Run `mise run check`, `mise run test`, `mise run build` and `mise run build:packages`. Commit one coherent change at a time, and commit or push only when the user asked.

## 4. Validate review comments

Review feedback can come from a pull request, or be pasted by the user. On a pull request, read every source, from people and bots alike: review bodies with `gh api repos/timmo001/triage/pulls/<n>/reviews`, inline comments with `.../pulls/<n>/comments`, and PR comments with `.../issues/<n>/comments`. Skip deploy and status bots. Some bot bodies hold HTML comments; cut at the first `<!--`.

Don't take any review at face value. For each finding, trace the path in the current code and compare with `main`. Say whether it is valid, why, and the smallest fix. Fix only when asked, then rerun the checks above.

## 5. Judge the tests

For every test the changeset adds or keeps, state the failure it catches and whether anything else covers it. To prove a test catches the bug, run it against `main`'s code in a throwaway worktree:

```bash
dir="$(mktemp -d)/main"
git worktree add "$dir" origin/main
cp <test file> "$dir/<same path>"
ln -s "$PWD/node_modules" "$dir/node_modules"
(cd "$dir" && bun test <test file> -t "<name>")
git worktree remove --force "$dir"
```

## 6. Test for real

Unit tests aren't real testing. Run the changes against this machine's journal from source, without touching an installed triage:

- Run the CLI with `bun run src/index.ts <command>`, and point anything that writes state at a throwaway database under `/tmp/opencode`.
- Exercise the changed behaviour with real entries: capture recent crashes and errors, then check grouping, redaction and cursor resume by capturing twice.
- Read the captured events back and confirm nothing secret or personal survived redaction before reporting them.

Report what was exercised, the results, and what couldn't be tested live and why.

## 7. Finish

For a pull request, report CI state (`gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup`) and wait. Merge only when the user says so: squash is the only allowed method, with `gh pr merge <n> --squash --delete-branch`.

After a merge, switch to `main`, pull, and delete local branches whose upstream is gone or whose commits are merged. Leave branches checked out in another worktree alone.
