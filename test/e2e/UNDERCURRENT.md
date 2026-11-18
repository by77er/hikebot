These rules govern the end-to-end suite under `test/e2e/`: the scenarios, the
harness that runs the Worker in local workerd next to a fake Discord API, and
the probe Worker for the harness self-tests.

## End-to-end tests do not import from src/
only: *.ts

A scenario reaches the Worker only through signed HTTP requests, so it tests
the bundle Discord talks to and not the modules behind it. Build what the
test needs in `test/e2e/harness/`, import from `./harness/` and
`discord-api-types/v10` only, and write the text you expect as literals,
following "Write an end-to-end scenario" in `test/AGENTS.md`. The probe
Worker under `test/e2e/probe/` is Worker code and builds on `src/`; this rule
does not apply to it.

```sh
case "$FILE" in ./probe/*) exit 0 ;; esac
perl -0777 -ne '
  while (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["\x27`])([^"\x27`\n]*)\1/g) {
    my ($spec, $at) = ($2, $-[0]);
    next unless $spec =~ m{(?:^|/)src(?:/|$)};
    my $line = 1 + (substr($_, 0, $at) =~ tr/\n//);
    print "$ARGV:$line: imports \"$spec\" from src/; reach the Worker over HTTP with useE2E, build what the test needs in test/e2e/harness/, and write expected text as literals (\"Write an end-to-end scenario\" in test/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```

## Feature scenarios run the real bundle, not the probe
only: *.test.ts

`useE2E({ probe: true })` runs the probe Worker, which adds `/e2e-probe` to
the real Worker for the harness self-tests in `test/e2e/probe.test.ts`. A
feature is tested through its own commands and controls on the bundle that
`wrangler.jsonc` deploys: call `useE2E()` with no options, as "Write an
end-to-end scenario" in `test/AGENTS.md` shows. If the harness itself needs a
new self-test that makes the bot call Discord, add it to
`test/e2e/probe.test.ts`.

```sh
case "$FILE" in ./probe.test.ts) exit 0 ;; esac
perl -0777 -ne '
  while (/\buseE2E\s*\(([^)]*)\)|\bprobe\s*:/g) {
    my ($args, $at) = ($1, $-[0]);
    next if defined $args && $args !~ /\bprobe\b/;
    my $line = 1 + (substr($_, 0, $at) =~ tr/\n//);
    print "$ARGV:$line: passes probe to useE2E; the probe Worker is for the harness self-tests in test/e2e/probe.test.ts. Call useE2E() with no options and drive the feature through its own commands and controls (\"Write an end-to-end scenario\" in test/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```

## A scenario does not swallow the fake's refusals
only: *.test.ts

After each test, `useE2E` fails the test if the fake Discord API refused a
request from the Worker, because Discord would refuse it too.
`e2e.discord.takeRejections()` is only for a test that provokes a refusal on
purpose: it takes the refused requests and asserts on them, their method,
route, status or count, in the same test. Never call it to clear refusals the
test did not intend, in a `beforeEach` or `afterEach`, in a helper every test
runs, or by assigning the result and never asserting on it. Fix the payload
the fake refused instead (the failure names the rule and the Discord page that
states it), and if the fake is wrong, correct its rule as "Teach the fake
Discord API a new route or limit" in `test/AGENTS.md` says. The fake's own
self-tests in `test/e2e/fake-discord.test.ts` start a `FakeDiscord` without
`useE2E` and assert on each refused reply before they take its record; they
are not scenarios and nothing there is swallowed.

```ts good
it("reports a forum thread Discord refuses", async () => {
  e2e.discord.addChannel({ id: actor.channelId, guildId: actor.guildId ?? "" });
  await member.run("hike", [subcommand("start")]);
  const refused = e2e.discord.takeRejections();
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({ method: "POST", status: 400 });
});
```

```ts good
it("answers 401 to a bot route without the bot token", async () => {
  const reply = await call("POST", path, v2(text("hi")), null);
  expect(reply.status).toBe(401);
  expect(discord.takeRejections()).toHaveLength(1);
});
```

```ts bad
const e2e = useE2E();

afterEach(() => {
  e2e.discord.takeRejections();
});
```

```ts bad
it("posts the location vote", async () => {
  await member.run("hike", [subcommand("vote")]);
  const ignored = e2e.discord.takeRejections();
  expect(messageText(member.lastReply())).toContain("Location vote");
});
```

```ts bad
beforeEach(() => {
  const leftover = e2e.discord.takeRejections();
  void leftover;
});
```

## Scenarios assert on the refusals they take
only: *.test.ts

This backstops "A scenario does not swallow the fake's refusals" in files
that run the Worker with `useE2E`: a `takeRejections()` call whose result is
discarded, as a statement of its own or the body of an arrow function, hides
the refusals the harness would fail the test with. Assert on the result in the
same test (`const refused = e2e.discord.takeRejections();
expect(refused).toHaveLength(1);`), or fix the payload the fake refused.
The fake's own self-tests, which start a `FakeDiscord` without `useE2E`, are
not checked.

```sh
grep -Eq 'useE2E[[:space:]]*\(' "$FILE" || exit 0
perl -0777 -ne '
  while (/\btakeRejections\s*\(\s*\)/g) {
    my ($start, $end) = ($-[0], $+[0]);
    my $before = substr($_, 0, $start);
    $before =~ s/(?:[\w\$]+\s*\??\.\s*)*\z//;
    $before =~ s/\b(?:void|await)\s+\z//;
    next unless $before =~ /(?:\A|[;{}]|=>)\s*\z/;
    next unless substr($_, $end) =~ /\A[ \t]*(?:;|\}|\)|\r?\n|\z)/;
    my $line = 1 + (substr($_, 0, $start) =~ tr/\n//);
    print "$ARGV:$line: discards what takeRejections() took; assert on it (const refused = e2e.discord.takeRejections(); expect(refused)...) or fix the payload the fake refused (\"Teach the fake Discord API a new route or limit\" in test/AGENTS.md if the fake is wrong)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```

## A scenario waits on what the bot shows before reading what it stored
only: *.test.ts

The fake Discord API holds a new thread or message as soon as it receives
the request, before its answer reaches the Worker, and the Worker stores the
new id only once that answer arrives. A wait on the fake's state
(`e2e.discord.threads(...)`, `channelMessages(...)`, `requests`) therefore
ends before the bot has stored anything, and an interaction sent next, such
as Refresh, can be answered without it. A follow-up's edit is no proof
either when another interaction edits the same message, since the update
that lands last stays. After an action whose follow-up creates something on
Discord, wait with `eventually` until what the bot shows from storage holds
it, clicking Refresh inside the `eventually`, and only then assert on what
the bot shows. Assertions on the fake's state may follow that wait, as
"Write an end-to-end scenario" in `test/AGENTS.md` says.

```ts good
await Promise.all([g.owner.click(panel, id), g.owner.click(panel, id)]);
await eventually(async () => {
  await g.owner.click(panel, ROUND_IDS.refresh);
  expect(messageText(play.shown(panel))).toContain("**Hike thread:** <#");
});
const [thread] = e2e.discord.threads(g.channels.forum);
expect(messageText(play.shown(panel))).toContain(
  `**Hike thread:** <#${thread?.id ?? ""}>`,
);
```

```ts bad
await Promise.all([g.owner.click(panel, id), g.owner.click(panel, id)]);
await eventually(() => {
  expect(e2e.discord.threads(g.channels.forum)).toHaveLength(1);
});
await g.owner.click(panel, ROUND_IDS.refresh);
const [thread] = e2e.discord.threads(g.channels.forum);
expect(messageText(play.shown(panel))).toContain(
  `**Hike thread:** <#${thread?.id ?? ""}>`,
);
```

## End-to-end servers listen on a free port
only: *.ts

Every test file starts its own Worker and fake Discord API, and Vitest runs
files in parallel, so a fixed port collides with another file or with a dev
server on `8787`. Listen on port `0` and read the port the system chose from
`server.address()`, as `FakeDiscord.listen` does, and pass the URL on;
`harness.listen()` already picks a free port. "Run the end-to-end suite" in
`test/AGENTS.md` runs every file at once.

```sh
perl -ne '
  next if m{^\s*(?://|/?\*)};
  if (/\.listen\(\s*[1-9]|\bport\s*:\s*[1-9]|(?:localhost|127\.0\.0\.1):[1-9]/) {
    print "$ARGV:$.: uses a fixed port; listen on port 0 and read the chosen port from server.address(), or take the URL harness.listen() returns (\"Run the end-to-end suite\" in test/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```

## The Worker under test starts from a config file with the harness's secrets
only: *.ts

Start each Worker that `createTestHarness` runs from a Wrangler config file,
as `{ configPath, vars, secrets }`, and pass the harness's key pair, bot
token, application id and `DISCORD_API_BASE` as those `vars` and `secrets`.
An inline `{ config }` takes no `secrets`, and Wrangler lets the checkout's
`.dev.vars` or `.env` override its vars, so in a checkout set up as
`AGENTS.md` says the Worker checks signatures with another key and answers
every interaction with 401. To run a changed config, write it to a file in a
temporary directory and pass that file's path, as `writeProbeConfig` in
`test/e2e/harness/worker.ts` does.

```sh
! grep -HnE '\{ *config: *(\{|[A-Za-z_$][A-Za-z0-9_$]*\()' "$FILE" | grep -v readConfig
```
