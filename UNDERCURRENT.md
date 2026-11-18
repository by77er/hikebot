hikebot is a Discord bot on Cloudflare Workers and Durable Objects. These rules
govern the whole repository. Read `docs/design.md` for the design they enforce.

## Files are formatted with Prettier
only: *.{ts,tsx,js,json,jsonc,md,css}

Run `npm run format` and commit the result.

```sh
npx prettier --check "$FILE"
```

## ESLint passes

Fix what ESLint reports instead of disabling the rule.

```sh
npm run lint
```

## Types check

`npm run typecheck` also fails when `worker-configuration.d.ts` is stale; run
`npm run cf-typegen` after changing `wrangler.jsonc`.

```sh
npm run typecheck
```

## The tests pass

A failing test means the change is wrong or the test is out of date; fix
whichever it is. Never delete or skip a test to get past this rule.

Only the first lines of a failing rule's output are shown, so on failure the
command prints the file holding `npm test`'s full output, then one `FAIL`
line per failing test with its error, then the end of Vitest's output.

```sh
out="${TMPDIR:-/tmp}/hikebot-npm-test.$$"
rm -rf "$out"
mkdir -p "$out"
status=0
npm test -- --reporter=default --reporter=json --outputFile.json="$out/report.json" > "$out/output.txt" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  tail -n 6 "$out/output.txt"
  rm -rf "$out"
  exit 0
fi
echo "npm test failed (exit $status). Full output: $out/output.txt"
node -e '
const fs = require("node:fs");
const path = require("node:path");
const firstLine = (text) =>
  String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((line) => line.trim()).find(Boolean) ?? "(no message)";
let report;
try {
  report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch {
  console.log("Vitest wrote no report; the end of its output follows.");
  process.exit(0);
}
const failures = [];
for (const file of report.testResults ?? []) {
  const name = path.relative(process.cwd(), file.name);
  const failed = (file.assertionResults ?? []).filter((test) => test.status === "failed");
  for (const test of failed) {
    failures.push(`FAIL ${name} > ${[...test.ancestorTitles, test.title].join(" > ")}: ${firstLine(test.failureMessages?.[0])}`.slice(0, 400));
  }
  if (failed.length === 0 && file.status === "failed") {
    failures.push(`FAIL ${name}: ${firstLine(file.message)}`.slice(0, 400));
  }
}
for (const line of failures) console.log(line);
if (failures.length === 0) console.log("No test failed; the end of the output says what did.");
' "$out/report.json"
tail -n 12 "$out/output.txt"
exit "$status"
```

## No Discord SDK
only: package.json

hikebot talks to Discord over plain HTTP with types from `discord-api-types`.
Remove the Discord client library and call the REST API through
`src/discord/api.ts` instead.

```sh
node -e '
const pkg = require("./package.json");
const sdk = /^(discord\.js|discord\.io|discordeno|eris|oceanic\.js|detritus-client|slash-create|@discordjs\/.+|@discordeno\/.+|@sapphire\/.+)$/;
const found = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
  .flatMap((field) => Object.keys(pkg[field] ?? {}))
  .filter((name) => sdk.test(name));
if (found.length > 0) {
  console.error("package.json depends on a Discord client library: " + found.join(", ") + ". Remove it; only discord-api-types is allowed.");
  process.exit(1);
}
'
```

## Bot messages use Components V2 only
only: *.ts

Every message the bot sends or edits, whether an interaction response that
carries a message (`ChannelMessageWithSource`, `UpdateMessage`), a follow-up,
a webhook edit or a REST call, sets the `IS_COMPONENTS_V2` flag (`32768`,
`MessageFlags.IsComponentsV2`) and puts all text in components such as Text
Display. It never sets `content` or `embeds`. Ephemeral replies add `64` to
the flags. Build the payload with Components V2 parts instead of plain text.

A deferred response (`DeferredChannelMessageWithSource`), a deferred update
(`DeferredMessageUpdate`) and a modal (`Modal`) are not messages and set no
`IS_COMPONENTS_V2`; "Deferred responses carry only the ephemeral flag" in
`src/UNDERCURRENT.md` says what a deferral may carry. The edit that replaces a
deferred response, or the edit after a deferred update, is the message and
sets `IS_COMPONENTS_V2`.

```ts good
return {
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [{ type: ComponentType.TextDisplay, content: "Vote saved." }],
    allowed_mentions: { parse: [] },
  },
};
```

```ts good
await api.editMessage(channelId, messageId, {
  flags: MessageFlags.IsComponentsV2,
  components: [pollContainer(poll)],
  allowed_mentions: { parse: [] },
});
```

```ts good
return {
  response: deferredReply({ ephemeral: true }),
  followUp: async () => {
    await api.editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      messageBody([container([textDisplay(resultText(result))])]),
    );
  },
};
```

```ts good
return {
  response: modal(customId("poll", "propose"), "Propose a location", [
    label("Location", textInput({ custom_id: customId("poll", "name") })),
  ]),
};
```

```ts bad
return {
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content: "Vote saved.", flags: MessageFlags.Ephemeral },
};
```

```ts bad
await api.createMessage(channelId, {
  embeds: [{ title: "Location vote", description: optionsList }],
});
```

## Bot messages never ping
only: *.ts

Every message the bot sends or edits sets `allowed_mentions: { parse: [] }`,
so a mention in a location name or a role in an announcement never notifies
anyone. Add it to the payload; do not list users or roles to ping.

A deferred response, a deferred update and a modal are not messages and carry
no `allowed_mentions`; the edit or follow-up that carries the message does, as
`messageBody(...)` sets it.

```ts good
await api.createMessage(announcementsChannelId, {
  flags: MessageFlags.IsComponentsV2,
  components: [resultContainer(result)],
  allowed_mentions: { parse: [] },
});
```

```ts good
return {
  response: deferredReply(),
  followUp: async () => {
    await api.editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      messageBody([resultContainer(result)]),
    );
  },
};
```

```ts bad
await api.createMessage(announcementsChannelId, {
  flags: MessageFlags.IsComponentsV2,
  components: [resultContainer(result)],
});
```

```ts bad
await api.createMessage(announcementsChannelId, {
  flags: MessageFlags.IsComponentsV2,
  components: [resultContainer(result)],
  allowed_mentions: { parse: ["roles"] },
});
```

## custom_ids follow the hb scheme
only: *.ts

Every `custom_id` on a button, select, modal or modal field is
`hb:<feature>:<action>` with an optional `:<arg>`, for example
`hb:poll:vote:<poll id>`, and handlers register under the matching prefix. Rename an
id that does not fit, and its handler's prefix with it.

```ts good
const vote = {
  type: ComponentType.Button,
  style: ButtonStyle.Primary,
  label: "Vote",
  custom_id: `hb:poll:vote:${poll.id}`,
};
router.component("hb:poll:vote", openVoteSelect);
```

```ts bad
const vote = {
  type: ComponentType.Button,
  style: ButtonStyle.Primary,
  label: "Vote",
  custom_id: `vote_${poll.id}`,
};
```

```ts bad
const modal = {
  custom_id: "proposeLocationModal",
  title: "Propose",
  components,
};
```

## TypeScript stays strict
only: tsconfig.json

Every `tsconfig.json` resolves to `"strict": true` and sets no option of the
strict family (`noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`,
`strictBindCallApply`, `strictPropertyInitialization`,
`strictBuiltinIteratorReturn`, `noImplicitThis`, `useUnknownInCatchVariables`,
`alwaysStrict`) to `false`. Put the option back and fix the type errors `tsc`
reports instead.

```sh
config="$(npx tsc --showConfig -p "$FILE")"
printf '%s' "$config" | node -e '
let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const options = JSON.parse(text).compilerOptions ?? {};
  const family = ["noImplicitAny", "strictNullChecks", "strictFunctionTypes", "strictBindCallApply", "strictPropertyInitialization", "strictBuiltinIteratorReturn", "noImplicitThis", "useUnknownInCatchVariables", "alwaysStrict"];
  const problems = options.strict === true
    ? family.filter((name) => options[name] === false).map((name) => `"${name}": false`)
    : [`"strict" is not true`];
  if (problems.length > 0) {
    console.error(`${process.env.FILE}: ${problems.join(", ")}. Set "strict": true, remove the options that turn part of it off, and fix the type errors tsc reports instead.`);
    process.exit(1);
  }
});
'
```

## A source change comes with tests
only: src/**/*.{ts,tsx}

A change that adds or changes what code under `src/` does adds or updates a
test under `test/` in the same pull request, one that fails without the
change. Put the tests for `src/<dir>/<file>.ts` in `test/<dir>/<file>.test.ts`
and follow `test/AGENTS.md` to write them. A change that keeps behaviour as it
is, such as a comment, a rename, formatting or a refactor the existing tests
already cover, needs no new test. Put the tests for a page in
`src/web/pages/<file>.tsx` in `test/web/`, as "Test a page" in
`src/web/AGENTS.md` says.

```diff good
--- a/src/polls/dates.ts
+++ b/src/polls/dates.ts
@@
-  if (!/^\d{4}-\d{2}-\d{2}$/.test(line)) {
+  if (!/^\d{4}-\d{2}-\d{2}$/.test(line.trim())) {
--- a/test/polls/dates.test.ts
+++ b/test/polls/dates.test.ts
@@
+  it("accepts a date with spaces around it", () => {
+    expect(parseDate(" 2026-06-14 ")).toEqual(parseDate("2026-06-14"));
+  });
```

```diff good
--- a/src/guild/router.ts
+++ b/src/guild/router.ts
@@
-  private readonly commands = new Map<string, CommandHandler>();
+  private readonly commandHandlers = new Map<string, CommandHandler>();
```

```diff bad
--- a/src/polls/store.ts
+++ b/src/polls/store.ts
@@
   closePoll(pollId: number, userId: string): PollView {
     return this.storage.transactionSync(() => {
+      if (this.optionCount(pollId) === 0) {
+        throw new PollError("no_options", "Add an option before closing the poll.");
+      }
```

```diff bad
--- a/src/features/index.ts
+++ b/src/features/index.ts
@@
   router.command("hike", hikeCommand);
+  router.command("trail", trailCommand);
   return router;
```

## AGENTS.md files give procedures, not facts
only: AGENTS.md

Each entry in an `AGENTS.md` tells an agent how to do a job in that
directory: a heading that names the job, then steps with real paths and the
exact commands, ending with the command that checks the result. A
description of what the code is or does is a fact the code already states,
and it goes stale when the code changes. Delete it, or rewrite it as the
procedure that needs it, following "Record what you learned" in the root
`AGENTS.md`. Behaviour and design belong in `docs/design.md`.

```md bad
The Durable Object stores migrations in `src/guild/schema.ts`.
```

```md bad
## Layout

- `src/discord/` is the REST client and the Components V2 builders.
- `src/guild/router.ts` dispatches interactions to handlers by custom_id
  prefix.
```

```md bad
`PollStore` wraps the poll tables and returns read models such as
`PollView`.
```

````md good
## Add a SQLite migration

1. To add a table, append a migration to the list in `src/guild/schema.ts`.
   To change a table that has shipped, append a migration that runs
   `ALTER TABLE`, not an edit of the old one.
2. Run the tests:

   ```sh
   npm test
   ```
````

````md good
## Add a REST method to the client

1. Add a method to `DiscordApi` in `src/discord/api.ts` that returns
   `this.call({ method, path, body, auth })`.
2. Add the method to the `cases` table in `test/discord/api.test.ts` and
   run `npx vitest run test/discord/api.test.ts`.
````

## AGENTS.md files hold nothing near-term
only: AGENTS.md

An `AGENTS.md` holds only what stays true until the code changes. Status,
plans, what is unfinished, what a later task will do, follow-up work, task
and pull request numbers, and dates belong on the task board or in the pull
request description. Move the statement there, or delete it. If it hides a
procedure ("run the migrations by hand until the script exists"), write the
procedure as it is today and nothing about when it will change.

```md bad
Polls are currently stored in memory; a later task moves them to SQLite.
```

```md bad
## Deploy

TODO: write the deploy steps once the workflow from #12 lands.
```

```md bad
Voting by reaction is not yet supported (tsk_3q714r0o051t4m5b, planned for
2026-12).
```

````md good
## Run one test file

```sh
npx vitest run test/guild/router.test.ts
```
````

```md good
## Add a Worker secret

1. Add the name to `secrets.required` in `wrangler.jsonc`.
2. Add a line with a dummy value to `.dev.vars.example`.
```

## AGENTS.md files hold no near-term markers
only: AGENTS.md

This backs up "AGENTS.md files hold nothing near-term" for when no model
judges it. Move the statement on the printed line to the task or the pull
request description, or delete it. The words matched are `TODO`, `FIXME`,
`WIP`, `TBD` (upper case, whole word), `todo:`, `fixme:`, `currently`,
`for now`, `for the time being`, `not yet`, `later task`, `follow-up task`,
`temporarily`, `work in progress`, task ids (`tsk_…`) and pull request
references (`#12`, `PR 12`). Plain `later` is not matched, because "Node.js
22.13 or later" is a procedure, and neither is `TODOs` in a sentence about
where TODOs go.

```sh
awk '
  {
    line = tolower($0)
    found = ""
    if (match($0, /(^|[^[:alnum:]_])(TODO|FIXME|WIP|TBD)([^[:alnum:]_]|$)/)) found = substr($0, RSTART, RLENGTH)
    else if (match(line, /todo:|fixme:|tsk_[[:alnum:]]+/)) found = substr($0, RSTART, RLENGTH)
    else if (match(line, /(^|[^[:alnum:]_])(currently|for now|for the time being|not yet|later task|follow-up task|temporarily|work in progress)([^[:alnum:]_]|$)/)) found = substr($0, RSTART, RLENGTH)
    else if (match(line, /(^|[[:space:](])(#|pr #?|pull request #?)[0-9]+([^[:alnum:]_]|$)/)) found = substr($0, RSTART, RLENGTH)
    if (found != "") {
      gsub(/^[^[:alnum:]_#]+|[^[:alnum:]_:]+$/, "", found)
      print FILENAME ":" FNR ": near-term statement (\"" found "\"); move it to the task or the pull request description, or delete it"
      bad = 1
    }
  }
  END { exit bad }
' "$FILE"
```

## AGENTS.md files hold no standing prohibitions
only: AGENTS.md

A "never", "do not" or "must not" that holds beyond the step it sits in is
negative knowledge, and prose is not checked. Write it as a rule in the
`UNDERCURRENT.md` of the directory it governs, as a command rule when a
command can detect it and a semantic rule with good and bad examples
otherwise, in a pull request of its own (see "Record what you learned" in the
root `AGENTS.md`), and remove it from the `AGENTS.md`. A caution inside a
procedure step, which says how to do that step right, stays.

```md bad
Never commit `.dev.vars` or any other file with secrets in it.
```

```md bad
## Conventions

- Do not use discord.js; talk to Discord over plain HTTP.
- Migrations must never be edited once shipped.
```

````md good
2. Install the dependencies with `npm ci`, not `npm install`, so the
   lockfile stays as it is:

   ```sh
   npm ci
   ```
````

```md good
1. Pick a command name that no line in `registerFeatures` registers yet;
   registering a name twice throws when the object starts.
```

## No secrets file is committed
only: {.dev.vars,.dev.vars.*,.env,.env.*}

`.dev.vars`, `.dev.vars.*`, `.env` and `.env.*` hold real values and are
never tracked. Put the value in `.dev.vars` on your machine, which git
ignores, or, for production, in the GitHub Actions secret of the same name
that the deploy workflow sets on the Worker ("Add a Worker secret" in the
root `AGENTS.md`), and take the file out of git with
`git rm --cached <file>`. If the file was
ever pushed, rotate every secret in it: deleting the file does not remove it
from the history. `.dev.vars.example`, with dummy values, is the one file of
this kind that is committed.

```sh
case "$FILE" in */.dev.vars.example) exit 0 ;; esac
echo "$FILE is a secrets file and must not be committed. Run git rm --cached on it, keep the values in .dev.vars on your machine (git-ignored) or, for production, in the GitHub Actions secrets the deploy workflow sets on the Worker, and rotate every secret in it if it was ever pushed."
exit 1
```

## Infrastructure is written with inframe, not HCL
only: *.{tf,tfvars,hcl}

`wrangler deploy` creates and updates the Worker and its Durable Object from
`wrangler.jsonc`; declare anything Cloudflare can create from there in that
file. Write any other infrastructure with the owner's `by77er/inframe`, the
functional frontend for OpenTofu, following "Add infrastructure" in the root
`AGENTS.md`, and delete the HCL file.

```sh
echo "$FILE is HCL. Declare Worker resources in wrangler.jsonc (wrangler deploy manages the Worker and its Durable Object), write any other infrastructure with by77er/inframe, and delete this file."
exit 1
```

## The deployed Worker never refers to the tests or the probe
only: {src/**/*.{ts,tsx},wrangler.jsonc}

`wrangler deploy` bundles `src/` from `wrangler.jsonc`, and anything they
reach ships to production. The probe Worker under `test/e2e/probe/` adds the
`/e2e-probe` command for the harness self-tests, and only
`useE2E({ probe: true })` in `test/e2e/harness/worker.ts` loads it. Remove the
import, path or name: code under `src/` and `wrangler.jsonc` refer to nothing
under `test/` and nothing named `e2e-probe`. To give the tests something the
Worker needs, put it in `src/` and import it from the test; for the end-to-end
suite, build it in `test/e2e/harness/` ("Write an end-to-end scenario" in
`test/AGENTS.md`).

```sh
awk '
  /(^|[^[:alnum:]_.-])test\/|e2e[-_\/]?probe/ {
    print FILENAME ":" FNR ": refers to test/ or the e2e probe; the deployed Worker must not, so remove it and keep test code under test/ (\"Write an end-to-end scenario\" in test/AGENTS.md): " $0
    bad = 1
  }
  END { exit bad }
' "$FILE"
```
