## Home Assistant

- A Core traceback is kept whole when it's read across two batches of the journal. Before, catching up on the journal could cut one short, so the same error started more than one issue. Issues split this way in 0.16.0 can be [merged](https://triage.timmo.dev/issues/#merging).
- Catching up on the journal logs one line when it's done, rather than a line for every batch.
- [Privacy](https://triage.timmo.dev/privacy) covers how Core's errors are redacted. Entity, device and area names in them aren't redacted yet.

