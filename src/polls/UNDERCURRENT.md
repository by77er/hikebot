These rules govern `src/polls/`, the rules and storage for hike rounds and
their votes. Read the "Polls" section of `docs/design.md` and
`src/polls/AGENTS.md` for the design they enforce.

## Poll logic has no Discord code
only: *.ts

Nothing under `src/polls/` imports from `src/discord/`, `src/features/` or
`discord-api-types`. Poll logic returns data (a read model such as `PollView`)
or throws a `PollError` with a code; the feature in `src/features/` calls it
and builds the message, components and custom_ids from the result.

```sh
if grep -HnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]((\.\./)+(src/)?(discord|features)(/|['\"])|discord-api-types)" "$FILE"; then
  echo "src/polls must not import src/discord, src/features or discord-api-types. Return data or throw a PollError from the poll code, and build the Discord message in the feature under src/features/."
  exit 1
fi
```

## Poll code takes time and randomness from the injected sources
only: *.ts

`Date.now`, `new Date()` as the current time, `Math.random` and
`crypto.getRandomValues` appear only where the defaults are defined:
`PollStore`'s constructor (`options.now ?? Date.now`) and `defaultRandom` in
`tally.ts`. Operations call `this.now()` for the time and pass `this.random`
on to `randomIndex` or `pickWinner`; pure functions take a `RandomSource` or
a time as a parameter. Tests inject a clock and a random sequence, so code
that reads the real clock or randomness makes them nondeterministic.

```ts good
const at = this.now();
this.sql.exec(
  "UPDATE rounds SET status = 'cancelled', ended_by = ?, ended_at = ? WHERE id = ?",
  userId,
  at,
  roundId,
);
```

```ts good
const result = pickWinner(counts, this.random);
```

```ts bad
const started_at = Date.now();
this.sql.exec(
  "INSERT INTO rounds (status, started_by, started_at) VALUES ('location_voting', ?, ?)",
  userId,
  started_at,
);
```

```ts bad
const winner = tied[Math.floor(Math.random() * tied.length)];
```

```ts bad
const closedAt = new Date().getTime();
```

## Only the defaults read the clock and randomness directly
only: *.ts

Call `this.now()` instead of `Date.now()` or `new Date()`, and pass
`this.random` (or a `RandomSource` parameter) on instead of calling
`Math.random` or `crypto.getRandomValues`. Only `options.now ?? Date.now` in
`PollStore`'s constructor and `defaultRandom` in `tally.ts` may name them;
comment lines are skipped.

```sh
if ! awk '
  /^[[:space:]]*(\/\/|\/?\*)/ { prev = $0; next }
  /Date\.now|new Date\(\)|Math\.random|crypto\.getRandomValues/ {
    if ($0 ~ /^[[:space:]]*this\.now = options\.now \?\? Date\.now;$/) { prev = $0; next }
    if ($0 ~ /^export const defaultRandom: RandomSource = \(array\) => crypto\.getRandomValues\(array\);$/) { prev = $0; next }
    if ($0 ~ /^[[:space:]]*crypto\.getRandomValues\(array\);$/ && prev ~ /^export const defaultRandom: RandomSource = \(array\) =>$/) { prev = $0; next }
    print FILENAME ":" FNR ": " $0; bad = 1
  }
  { prev = $0 }
  END { exit bad }
' "$FILE"; then
  echo "Poll code reads the clock or randomness directly. Use this.now() for the time and pass this.random (or a RandomSource parameter) to randomIndex or pickWinner; only PollStore's constructor default (this.now = options.now ?? Date.now) and defaultRandom in tally.ts may name Date.now or crypto.getRandomValues."
  exit 1
fi
```

## A random index is drawn without modulo bias
only: *.ts

A random index comes from `randomIndex(n, random)` in `tally.ts`, which
rejects the values that would make some indexes likelier than others. Code
never reduces a raw random value with `%` or scales it with
`Math.floor(... * n)`; call `randomIndex` instead.

```ts good
const winner = tied[randomIndex(tied.length, random)];
```

```ts good
const index =
  topOptionIds.length === 1 ? 0 : randomIndex(topOptionIds.length, random);
```

```ts bad
const value = random(new Uint32Array(1))[0] ?? 0;
const winner = tied[value % tied.length];
```

```ts bad
const [value = 0] = this.random(new Uint32Array(1));
return options[value % options.length];
```

## Multi-row poll writes run in one transaction
only: *.ts

A `PollStore` method that runs more than one write statement (`INSERT`,
`UPDATE` or `DELETE`, directly or through a helper such as `insertPoll` or
`insertOption`) runs them all inside one
`this.storage.transactionSync(() => { ... })`, together with the reads its
checks depend on, so a failure part-way leaves nothing behind.

```ts good
cancelRound(roundId: number, userId: string): RoundView {
  return this.storage.transactionSync(() => {
    const at = this.now();
    this.sql.exec(
      "UPDATE polls SET status = 'closed', closed_by = ?, closed_at = ? WHERE round_id = ? AND status = 'open'",
      userId,
      at,
      roundId,
    );
    this.sql.exec(
      "UPDATE rounds SET status = 'cancelled', ended_by = ?, ended_at = ? WHERE id = ?",
      userId,
      at,
      roundId,
    );
    return this.roundView(this.roundRow(roundId), null);
  });
}
```

```ts bad
setVotes(pollId: number, userId: string, optionIds: readonly number[]): PollView {
  this.sql.exec(
    "DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?",
    pollId,
    userId,
  );
  for (const id of optionIds) {
    this.sql.exec(
      "INSERT INTO poll_votes (poll_id, option_id, user_id, voted_at) VALUES (?, ?, ?, ?)",
      pollId,
      id,
      userId,
      this.now(),
    );
  }
  return this.pollView(this.requirePollRow(pollId), userId);
}
```

```ts bad
startDatePoll(roundId: number, userId: string, dates: readonly string[]): PollView {
  const pollId = this.storage.transactionSync(() =>
    this.insertPoll(roundId, "date", userId, this.now()),
  );
  this.storage.transactionSync(() => {
    for (const option of dates.map((line) => validateDate(line, userId))) {
      this.insertOption(pollId, option, this.now());
    }
  });
  return this.pollView(this.requirePollRow(pollId), null);
}
```
