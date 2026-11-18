# Working in src/polls

## Add a poll operation with its typed error

1. If the operation can fail in a way callers have to tell apart, add a code
   to `PollErrorCode` in `src/polls/errors.ts`.
2. Add a public method to `PollStore` in `src/polls/store.ts`:
   - Wrap every read-check-write sequence in
     `this.storage.transactionSync(() => { ... })`, so a throw rolls back
     every row written before it.
   - Load rows with the private helpers (`roundRow`, `requirePollRow`,
     `openPollRow`), which throw `round_not_found`, `poll_not_found` and
     `poll_closed` for you.
   - Throw `new PollError("<code>", "<message a member can read>")` for each
     refusal. Feature code shows the message or maps the code.
   - Take the time from `this.now()` and randomness from `this.random`
     (through `randomIndex` or `pickWinner` in `src/polls/tally.ts`).
3. Return a read model (`pollView`, `roundView`, or an `OptionView`) so the
   caller can redraw its message without a second query.
4. Add the operation to the "Polls" section of `docs/design.md`.
5. Add tests as described below, one per success path and one per error
   code, then run:

   ```sh
   npx vitest run test/polls
   ```

## Test an operation against Durable Object storage

1. In a test file under `test/polls/`, import `withStore`, `clock`,
   `sequence`, `expectCode` and `count` from `./helpers`. `withStore` opens a
   fresh GuildHike with its migrations applied and a `PollStore` over its
   storage:

   ```ts
   await withStore(
     (store, storage) => {
       // call store methods; count(storage, "polls") counts rows
     },
     { now: clock(1_800_000_000_000, 1000), random: sequence(2, 0) },
   );
   ```

   `clock(start, step)` returns `start`, then `start + step`, and so on.
   `sequence(...values)` fills each `getRandomValues` call with the values in
   turn and repeats the last one; for `n` tied options, value `v` picks tied
   option `v % n`. Both default to a stepping clock and `sequence(0)`.

2. Assert a refusal with `expectCode(() => store.op(...), "<code>")`. Use a
   braced body when the operation returns `void`.
3. Prove rollback by forcing a failure after the first write, then counting
   rows:

   ```ts
   storage.sql.exec(
     `CREATE TRIGGER fail_vote BEFORE INSERT ON poll_votes
      BEGIN SELECT RAISE(ABORT, 'forced'); END`,
   );
   expect(() => store.setVotes(pollId, "u1", [optionId])).toThrow(/forced/);
   storage.sql.exec("DROP TRIGGER fail_vote");
   ```

   Renaming a table (`ALTER TABLE poll_options RENAME TO poll_options_off`)
   and renaming it back works the same way for inserts.

4. For behaviour that depends on real randomness, call the pure function in
   `src/polls/tally.ts` with `defaultRandom` many times and assert each
   outcome's share lies within several standard deviations of uniform, as in
   `test/polls/tally.test.ts`.
5. Run the poll tests, then the full pre-PR check from the root `AGENTS.md`:

   ```sh
   npx vitest run test/polls
   npm run format:check && npm run lint && npm run typecheck && npm test
   ```

## Add a column or table for polls

1. Append a migration that runs `ALTER TABLE` or `CREATE TABLE`, following
   "Add a SQLite migration" in `src/guild/AGENTS.md`.
2. Add the column to the matching row type and read model in
   `src/polls/store.ts`.
3. Extend the "create the poll tables" test in `test/guild/schema.test.ts`
   and run:

   ```sh
   npx vitest run test/guild/schema.test.ts test/polls
   ```
