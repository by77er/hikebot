These rules govern the tests and their helpers under `test/`.

## Tests never pause for a fixed amount of time
only: *.ts

No test and no test helper sleeps, delays or waits a fixed time and then
carries on. A fixed pause is slow when it is generous and flaky when it is
not. Wait for the thing itself instead:

- Run a Durable Object alarm directly with `runDurableObjectAlarm` from
  `cloudflare:test`; never wait for it to fire.
- Give time-dependent code an injected clock and move it, or use Vitest's
  fake timers (`vi.useFakeTimers`) and advance them.
- Await background work through what it produces: the promise it returns,
  `waitOnExecutionContext` for `waitUntil` work, or the request arriving at
  the fake Discord API.
- When only a condition can be observed, wait on the condition with
  `expect.poll` or `vi.waitFor`, which return as soon as it holds. Do not
  hand-roll a loop that sleeps a fixed interval between checks.

A deadline that only bounds such a wait, and fails the test with a message
when it passes, is not a pause and is allowed: a `timeout` option to
`expect.poll` or `vi.waitFor`, `AbortSignal.timeout`, or a `setTimeout` that
rejects a wait for an event with an error.

```ts bad
await callWorker(signer, await signedRequest(signer, interaction), ctx);
await new Promise((resolve) => setTimeout(resolve, 500));
expect(discord.requests).toHaveLength(1);
```

```ts bad
await stub.recordVote(pollId, userId, locationId);
await sleep(2000);
expect(discord.edits(pollMessageId)).toHaveLength(1);
```

```ts bad
await scheduler.wait(100);
expect(await stub.pollMessage(pollId)).toMatchObject({ refreshed: true });
```

```ts bad
for (let attempt = 0; attempt < 10; attempt++) {
  if (discord.requests.length > 0) break;
  await delay(50);
}
expect(discord.requests).toHaveLength(1);
```

```ts good
await stub.recordVote(pollId, userId, locationId);
expect(await runDurableObjectAlarm(stub)).toBe(true);
expect(discord.edits(pollMessageId)).toHaveLength(1);
```

```ts good
const clock = fakeClock("2026-11-18T09:00:00Z");
const api = createDiscordApi({ token, fetch: discord.fetch, clock });
const sending = api.createMessage(channelId, message);
await discord.nextRequest();
clock.advance(1_500);
await sending;
expect(discord.requests).toHaveLength(2);
```

```ts good
vi.useFakeTimers();
const sending = api.createMessage(channelId, message);
await vi.advanceTimersByTimeAsync(1_500);
await sending;
expect(discord.requests).toHaveLength(2);
```

```ts good
const ctx = createExecutionContext();
await callWorker(signer, await signedRequest(signer, interaction), ctx);
const edit = await discord.nextRequest("PATCH");
expect(edit.body).toMatchObject({ flags: MessageFlags.IsComponentsV2 });
await waitOnExecutionContext(ctx);
```

```ts good
await fetch(`${worker.url}/interactions`, { method: "POST", headers, body });
await expect
  .poll(() => discord.requests.length, { timeout: 5_000 })
  .toBeGreaterThan(0);
```

```ts good
export function nextRequest(method: string): Promise<RecordedRequest> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`no ${method} request reached the fake within 5s`)),
      5_000,
    );
    waiters.push({ method, resolve, deadline });
  });
}
```

## Test files call no sleep, delay or timer pause
only: *.ts

This backstops the rule above for the cases that are a pause whatever the
context: a promise resolved by `setTimeout`, an awaited or numeric
promisified `setTimeout`, `scheduler.wait`, and a call to anything named
`sleep`, `delay`, `pause` or `wait` with an argument. A `setTimeout` that
rejects, `AbortSignal.timeout` and a `timeout` option are deadlines and pass.
Replace the pause with what the message names.

```sh
perl -0777 -ne '
  my $fix = "pauses for a fixed time; wait for the thing itself: runDurableObjectAlarm for an alarm, vi.useFakeTimers or an injected clock for time, the returned promise, waitOnExecutionContext or the request at the fake Discord API for background work, expect.poll or vi.waitFor for a condition";
  my @pauses = (
    [qr/new\s+Promise\s*(?:<[^>]*>)?\(\s*\(?\s*([\w\$]+)[^)=]*\)?\s*=>\s*\{?\s*setTimeout\(\s*(?:\1|\(\s*\)\s*=>\s*\{?\s*\1\(\s*\)\s*;?\s*\}?)\s*,/, "a promise resolved by setTimeout"],
    [qr/(?<![\w\$.])setTimeout\(\s*(?:resolve|res|r|done|next)\s*,/, "a promise resolved by setTimeout"],
    [qr/(?<![\w\$])(?:await\s+(?:[\w\$]+\.)*setTimeout\s*\(|setTimeout\s*\(\s*[\d_.]+\s*[,)])/, "a promisified setTimeout"],
    [qr/(?<![\w\$.])scheduler\.wait\s*\(/, "scheduler.wait"],
    [qr/(?<![\w\$.])(?:[\w\$]+\.)*(?:sleep|delay|pause|wait)\s*\(\s*[^\s)]/, "a sleep or delay call"],
  );
  my (%found, @spans);
  for my $pause (@pauses) {
    my ($pattern, $what) = @$pause;
    while (/$pattern/g) {
      my ($start, $end) = ($-[0], $+[0]);
      next if grep { $start >= $_->[0] && $start < $_->[1] } @spans;
      push @spans, [$start, $end];
      my $before = substr($_, 0, $start);
      my $rest = substr($_, $start);
      $rest =~ s/\n.*//s;
      next if $what eq "a sleep or delay call" && ($before =~ /function\s*\*?\s*$/ || $rest =~ /\)\s*(?::[^;{=]+)?\{\s*$/);
      my $line = 1 + ($before =~ tr/\n//);
      $found{$line} //= "$what $fix";
    }
  }
  print "$ARGV:$_: $found{$_}\n" for sort { $a <=> $b } keys %found;
  exit(%found ? 1 : 0);
' "$FILE"
```
