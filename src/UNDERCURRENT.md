These rules govern the Worker's source. They come from building the Discord
REST client in `src/discord/api.ts`; `src/discord/AGENTS.md` says how to use
it.

## Interaction tokens never appear in errors or logs
only: *.ts

An interaction token lets anyone who holds it edit the bot's reply and send
follow-ups for 15 minutes. Wherever an error message, a thrown error's
fields or a log line names a webhook route or URL, write `:token` in place of
the token, as `DiscordApiError.route` does, and log the interaction's `id`
and `type` instead of the interaction itself. Pass the token only to
`DiscordApi` methods, as an argument.

```ts good
throw new DiscordApiError(
  "PATCH",
  `/webhooks/${applicationId}/:token/messages/@original`,
  response.status,
  error.code,
  error.message,
);
```

```ts good
console.error(
  `follow-up for interaction ${interaction.id} failed: ${error.message}`,
);
```

```ts bad
throw new Error(
  `PATCH ${baseUrl}/webhooks/${applicationId}/${interaction.token}/messages/@original failed with ${response.status}`,
);
```

```ts bad
console.error("follow-up failed", interaction);
```

```ts bad
console.log(`PATCH /webhooks/${applicationId}/${token}/messages/@original`);
```

## Deferred responses carry only the ephemeral flag
only: *.ts

A deferred response (type 5, `DeferredChannelMessageWithSource`) is not a
message: it shows "thinking…" until a follow-up replaces it. Discord accepts
only flag `64` (ephemeral) on it and rejects any other flag, so a deferral
never sets `IS_COMPONENTS_V2`, `content` or `components`. Return
`deferredReply()` or `deferredReply({ ephemeral: true })`, and put Components
V2 on the edit that replaces it: `editOriginalInteractionResponse` with a
`messageBody(...)`, which sets `IS_COMPONENTS_V2`. That edit is the message,
and it follows "Bot messages use Components V2 only".

```ts good
return {
  response: deferredReply({ ephemeral: true }),
  followUp: async () => {
    const result = await tallyVotes(storage, pollId);
    await api.editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      messageBody([container([textDisplay(resultText(result))])]),
    );
  },
};
```

```ts bad
return {
  response: {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: MessageFlags.IsComponentsV2 },
  },
  followUp,
};
```

```ts bad
return {
  response: {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: messageBody([container([textDisplay("Working…")])], {
      ephemeral: true,
    }),
  },
  followUp,
};
```

## Discord requests go through DiscordApi
only: *.ts

Only `src/discord/api.ts` calls `fetch` against Discord or names a
`discord.com` URL, so authentication, `allowed_mentions`, rate limits and
token-free errors stay in one place. Call a `DiscordApi` method from
`discordApi(env)` instead. When the endpoint has no method yet, add one to
`DiscordApi` first, following "Add a REST method to the client" in
`src/discord/AGENTS.md`. Message links (`discord.com/channels/…`) and links to
Discord's docs (`discord.com/developers/…`) are not requests and pass.

```sh
case "$FILE" in ./discord/api.ts) exit 0 ;; esac
! awk '
  /discord(app)?\.com|DISCORD_API_BASE/ && !/discord(app)?\.com\/(channels|developers)\// { hit = 1 }
  /(^|[^A-Za-z0-9_$])fetch[[:space:]]*\(/ && !/^[[:space:]]*(async[[:space:]]+)?fetch[[:space:]]*\([^)]*\)[[:space:]]*(:[^=]*)?\{/ && tolower($0) ~ /discord|\/webhooks\/|\/channels\/|\/guilds\/|\/applications\/|\/interactions\// { hit = 1 }
  hit { print FILENAME ":" FNR ": requests Discord outside DiscordApi; call a DiscordApi method instead, adding it to src/discord/api.ts first if it is missing (see src/discord/AGENTS.md): " $0; bad = 1; hit = 0 }
  END { exit !bad }
' "$FILE"
```

## Modal fields are Labels
only: *.ts

A modal's components are Label components (type 18), each wrapping one
input, and Text Display components for text that is not a field. Build them
with `label(...)` and `textDisplay(...)` and pass them to `modal(...)` from
`src/discord/components.ts`. A text input or select inside an action row
(type 1) is the old modal layout, which Discord has deprecated, and is not
used: move the input into `label("<field name>", input)` and put the label
text on the Label instead of the input. Reading a submit is different:
`textInputValue` and `selectValues` accept both wrappers, because that is
data Discord sends.

```ts good
return {
  response: modal(customId("poll", "propose", String(pollId)), "Propose a location", [
    textDisplay("Each member can propose up to three locations."),
    label("Location", textInput({ custom_id: customId("poll", "name"), max_length: 80 })),
    label(
      "Details",
      textInput({ custom_id: customId("poll", "details"), style: TextInputStyle.Paragraph, required: false }),
      "Trailhead, distance, anything voters should know",
    ),
  ]),
};
```

```ts bad
return {
  response: modal(customId("poll", "propose", String(pollId)), "Propose a location", [
    {
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.TextInput, custom_id: customId("poll", "name"), label: "Location", style: TextInputStyle.Short },
      ],
    },
  ]),
};
```

```ts bad
return {
  type: InteractionResponseType.Modal,
  data: {
    custom_id: customId("poll", "dates"),
    title: "Pick dates",
    components: [actionRow(stringSelect({ custom_id: customId("poll", "date"), options: dateOptions }))],
  },
};
```

## Modals have no action rows
only: *.ts

Wrap each input in `label("<field name>", input)` from
`src/discord/components.ts` and pass the labels to `modal(...)`. This
backstops "Modal fields are Labels" for what a command can see: an action
row (`actionRow(...)`, `ComponentType.ActionRow` or `type: 1` with
`components`) inside the components given to `modal(...)` or inside an
`InteractionResponseType.Modal` response, and an action row holding a text
input anywhere, since text inputs exist only in modals.

```sh
node -e '
const ts = require("typescript");
const fs = require("fs");
const file = process.argv[1];
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const typeOf = (node) => {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const type = node.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(source) === "type");
  return type && type.initializer.getText(source).replace(/\s/g, "");
};
const has = (node, key) => ts.isObjectLiteralExpression(node) && node.properties.some((p) => p.name && p.name.getText(source) === key);
const calls = (node, name) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name;
const isRow = (node) => calls(node, "actionRow") || typeOf(node) === "ComponentType.ActionRow" || (typeOf(node) === "1" && has(node, "components"));
const isTextInput = (node) => calls(node, "textInput") || typeOf(node) === "ComponentType.TextInput" || (typeOf(node) === "4" && (has(node, "custom_id") || has(node, "style")));
const inside = (node, test) => {
  const found = [];
  const walk = (child) => { if (test(child)) found.push(child); ts.forEachChild(child, walk); };
  ts.forEachChild(node, walk);
  return found;
};
const lines = new Map();
const report = (node, what) => {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  if (!lines.has(line)) lines.set(line, what);
};
const visit = (node) => {
  if (calls(node, "modal") && node.arguments.length >= 3) {
    for (const row of inside(node.arguments[2], isRow)) report(row, "puts an action row in a modal");
  }
  if (typeOf(node) === "InteractionResponseType.Modal") {
    for (const row of inside(node, isRow)) report(row, "puts an action row in a modal");
  }
  if (isRow(node) && inside(node, isTextInput).length > 0) report(node, "wraps a text input in an action row");
  ts.forEachChild(node, visit);
};
visit(source);
for (const [line, what] of [...lines].sort((a, b) => a[0] - b[0])) {
  console.log(file + ":" + line + ": " + what + "; wrap each input in label(\"<field name>\", input) from src/discord/components.ts and pass the labels (and any textDisplay) to modal(...)");
}
process.exit(lines.size > 0 ? 1 : 0);
' "$FILE"
```

## A handler answers inside Discord's 3-second window
only: *.ts

Discord drops an interaction that gets no response within three seconds. A
handler returns its `HandlerResult.response` after storage work and a single
Discord REST call, or none. Every further step (a second REST call, a forum
thread, an announcement, a loop through members or messages, a wait on anything
slow) goes in the `followUp` job of the `HandlerResult`, behind
`deferredReply(...)` or `deferredUpdate()`, or behind an immediate answer
that is already final. Write what must survive to `context.storage` before
returning, because the job is lost if the object restarts; then finish the
work in `followUp` and replace the deferral with
`editOriginalInteractionResponse`.

```ts good
export const closeLocationPoll: ComponentHandler = (interaction, context) => {
  const pollId = Number(parseCustomId(interaction.data.custom_id)?.arg);
  const poll = new PollStore(context.storage).closePoll(pollId, interaction.member?.user.id ?? "");
  return {
    response: deferredUpdate(),
    followUp: async () => {
      const api = discordApi(context.env);
      await api.editMessage(interaction.channel.id, interaction.message.id, messageBody([pollContainer(poll)]));
      await api.createMessage(announcementsChannelId, messageBody([resultContainer(poll)]));
    },
  };
};
```

```ts good
export const voteForLocation: ComponentHandler = (interaction, context) => {
  const poll = new PollStore(context.storage).setVotes(pollId, userId, selected);
  return { response: update([pollContainer(poll)]) };
};
```

```ts good
export const refreshPoll: ComponentHandler = async (interaction, context) => {
  const poll = new PollStore(context.storage).getPoll(pollId, userId);
  await discordApi(context.env).editMessage(poll.channelId, poll.messageId, messageBody([pollContainer(poll)]));
  return { response: ephemeralReply([textDisplay("Poll refreshed.")]) };
};
```

```ts bad
export const closeLocationPoll: ComponentHandler = async (interaction, context) => {
  const poll = new PollStore(context.storage).closePoll(pollId, userId);
  const api = discordApi(context.env);
  await api.editMessage(interaction.channel.id, interaction.message.id, messageBody([pollContainer(poll)]));
  await api.createMessage(announcementsChannelId, messageBody([resultContainer(poll)]));
  return { response: ephemeralReply([textDisplay("Poll closed.")]) };
};
```

```ts bad
export const startHike: CommandHandler = async (interaction, context) => {
  const round = new PollStore(context.storage).getLastRound();
  const thread = await discordApi(context.env).startForumThread(forumId, threadBody(round));
  return {
    response: deferredReply(),
    followUp: async () => {
      await discordApi(context.env).editOriginalInteractionResponse(
        interaction.application_id,
        interaction.token,
        messageBody([textDisplay(`Thread: <#${thread.id}>`)]),
      );
    },
  };
};
```

## Handlers make one Discord REST call before they answer
only: *.ts

Move every Discord REST call but one into the handler's `followUp` job,
behind `deferredReply(...)` or `deferredUpdate()`. This backstops "A handler
answers inside Discord's 3-second window" for what a command can count: in a
function typed `CommandHandler`, `ComponentHandler` or `ModalHandler`, or one
returning `HandlerResult`, the calls to `DiscordApi` methods outside its
`followUp` job, a call inside a loop or a `map`/`forEach` callback counting
as many. Calls made inside helper functions are not counted; the rule above
still covers them.

```sh
node -e '
const ts = require("typescript");
const fs = require("fs");
const file = process.argv[1];
const parse = (path) => ts.createSourceFile(path, fs.readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const rest = new Set();
if (fs.existsSync("discord/api.ts")) {
  ts.forEachChild(parse("discord/api.ts"), (node) => {
    if (!ts.isClassDeclaration(node) || !node.name || node.name.text !== "DiscordApi") return;
    for (const member of node.members) {
      const hidden = (member.modifiers || []).some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && !hidden) rest.add(member.name.text);
    }
  });
}
const source = parse(file);
const handlerTypes = new Set(["CommandHandler", "ComponentHandler", "ModalHandler"]);
const handlerOf = (node) => {
  if (ts.isVariableDeclaration(node) && node.type && handlerTypes.has(node.type.getText(source)) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.initializer;
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.type &&
      /^(Promise<)?HandlerResult>?$/.test(node.type.getText(source).replace(/\s/g, ""))) return node;
  return undefined;
};
const loops = [ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement];
const iterators = new Set(["map", "forEach", "flatMap", "filter", "reduce", "some", "every", "find"]);
const nameOf = (node) => (node.name && !ts.isComputedPropertyName(node.name) ? node.name.getText(source) : "");
const count = (body) => {
  const calls = [];
  const walk = (node, looped) => {
    if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isVariableDeclaration(node)) && nameOf(node) === "followUp") return;
    if (loops.includes(node.kind)) looped = true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (rest.has(method)) calls.push({ node, weight: looped ? 2 : 1 });
      if (iterators.has(method)) {
        walk(node.expression, looped);
        for (const arg of node.arguments) walk(arg, true);
        return;
      }
    }
    ts.forEachChild(node, (child) => walk(child, looped));
  };
  walk(body, false);
  return calls;
};
const found = [];
const visit = (node) => {
  const handler = handlerOf(node);
  if (handler && handler.body) {
    const calls = count(handler.body);
    const total = calls.reduce((sum, call) => sum + call.weight, 0);
    if (total > 1) {
      const extra = calls.length > 1 ? calls[1] : calls[0];
      const line = source.getLineAndCharacterOfPosition(extra.node.getStart(source)).line + 1;
      found.push(file + ":" + line + ": " + (calls[0].weight > 1 && calls.length === 1 ? "makes Discord REST calls in a loop" : "makes a further Discord REST call") +
        " before the handler returns its response; keep one call at most in the handler and move the rest into its followUp job, behind deferredReply(...) or deferredUpdate()");
      return;
    }
  }
  ts.forEachChild(node, visit);
};
visit(source);
for (const line of found) console.log(line);
process.exit(found.length > 0 ? 1 : 0);
' "$FILE"
```

## Code takes time and randomness from injected sources
only: *.ts

Nothing in `src/` reads the clock or randomness directly: no `Date.now()`,
no `new Date()` without an argument, no `Math.random()`, no
`crypto.getRandomValues` and no `crypto.randomUUID`. Take the current time
as a `now: () => number` and randomness as a `RandomSource` (from
`src/polls/tally.ts`), through a parameter or an options field the caller
fills, so tests can fix both. The defaults are defined once:
`this.now = options.now ?? Date.now` in `PollStore`'s constructor and
`defaultRandom` in `src/polls/tally.ts`; pass those on rather than writing a
second default. Under `src/polls/` the poll rules in
`src/polls/UNDERCURRENT.md` say the same for poll code. Converting a given
time, as in `new Date(round.started_at)`, is not reading the clock.

```ts good
export function pollDeadline(openedAt: number, hours: number): number {
  return openedAt + hours * 60 * 60 * 1000;
}
```

```ts good
export const openDatePoll: CommandHandler = (interaction, context) => {
  const store = new PollStore(context.storage);
  const poll = store.startDatePoll(roundId, userId, dates);
  return { response: reply([pollContainer(poll)]) };
};
```

```ts good
const started = new Date(round.started_at).toISOString().slice(0, 10);
```

```ts bad
export const remindVoters: CommandHandler = (interaction, context) => {
  const poll = new PollStore(context.storage).getPoll(pollId);
  const hoursOpen = (Date.now() - poll.openedAt) / 3_600_000;
  return { response: ephemeralReply([textDisplay(`Open for ${Math.floor(hoursOpen)} hours`)]) };
};
```

```ts bad
const nonce = crypto.randomUUID();
const featured = trails[Math.floor(Math.random() * trails.length)];
```

## Only the defaults read the clock and randomness, anywhere in src/
only: *.ts

Take the time as a `now: () => number` and randomness as a `RandomSource`
from the caller, through a parameter or an options field, instead of reading
them. This backstops "Code takes time and randomness from injected sources".
Under
`src/polls/` it matches exactly what "Only the defaults read the clock and
randomness directly" in `src/polls/UNDERCURRENT.md` matches, with the same
two exempt default lines, so the two never disagree about a line there;
elsewhere it also catches `crypto.randomUUID` and `new Date` with no
argument list, and exempts nothing. Comment lines are skipped.

```sh
case "$FILE" in ./polls/*) polls=1 ;; *) polls=0 ;; esac
if ! awk -v polls="$polls" '
  /^[[:space:]]*(\/\/|\/?\*)/ { prev = $0; next }
  /Date\.now|new Date\(\)|Math\.random|crypto\.getRandomValues/ || (!polls && /crypto\.randomUUID|new Date[[:space:]]*(\([[:space:]]*\)|$|[^[:space:](A-Za-z0-9_$])/) {
    if (polls && $0 ~ /^[[:space:]]*this\.now = options\.now \?\? Date\.now;$/) { prev = $0; next }
    if (polls && $0 ~ /^export const defaultRandom: RandomSource = \(array\) => crypto\.getRandomValues\(array\);$/) { prev = $0; next }
    if (polls && $0 ~ /^[[:space:]]*crypto\.getRandomValues\(array\);$/ && prev ~ /^export const defaultRandom: RandomSource = \(array\) =>$/) { prev = $0; next }
    print FILENAME ":" FNR ": reads the clock or randomness directly; take now: () => number or a RandomSource from the caller (a parameter or options field) instead: " $0; bad = 1
  }
  { prev = $0 }
  END { exit bad }
' "$FILE"; then
  echo "Only PollStore's constructor default (this.now = options.now ?? Date.now) and defaultRandom in src/polls/tally.ts may read the clock or randomness; everything else takes them from its caller."
  exit 1
fi
```

## Every user-visible flow has an end-to-end scenario
only: *.ts

A change that adds or changes something a member sees or does, a slash
command, a button, a select, a modal, or a message the bot posts or edits,
adds or updates a scenario in `test/e2e/` in the same pull request. The
scenario starts the real bundle with `useE2E()` (no `probe` option), drives
the flow as a member through signed interactions (`Member.run`, `click`,
`select`, `submitModal`), and asserts on what the fake Discord API stores or
on the reply the member gets. Follow "Write an end-to-end scenario" in
`test/AGENTS.md`. Unit tests under `test/<dir>/` do not replace it: they do
not show that Discord accepts the payload, that the reply arrives in
time, or that each control the bot renders has a handler. A change no
member can see, such as a refactor, a comment, or store logic whose unit
tests cover it, needs no scenario.

```diff good
--- a/src/features/index.ts
+++ b/src/features/index.ts
@@
 export function registerFeatures(router: Router): Router {
-  return router;
+  return router.command("hike", hikeCommand);
 }
--- a/test/e2e/hike.test.ts
+++ b/test/e2e/hike.test.ts
@@
+const e2e = useE2E();
+
+it("answers /hike admin with the admin panel", async () => {
+  e2e.discord.addGuild({ id: admin.guildId ?? "", ownerId: admin.userId });
+  const member = new Member(e2e.client, admin);
+  await member.run("hike", [subcommand("admin")]);
+  expect(messageText(member.lastReply())).toContain("Hike admin");
+  expect(findComponent(member.lastReply().components, "hb:round:start")).toBeDefined();
+});
```

```diff good
--- a/src/features/poll.ts
+++ b/src/features/poll.ts
@@
-      textDisplay(`Vote for a location (${String(options.length)} options)`),
+      textDisplay(`Vote for a location: ${String(options.length)} options, closes in 24 hours`),
--- a/test/e2e/poll.test.ts
+++ b/test/e2e/poll.test.ts
@@
   const vote = await waitForMessage(e2e.discord, admin.channelId, (m) =>
     messageText(m).includes("Vote for a location"),
   );
-  expect(messageText(vote)).toContain("(2 options)");
+  expect(messageText(vote)).toContain("2 options, closes in 24 hours");
```

```diff good
--- a/src/polls/store.ts
+++ b/src/polls/store.ts
@@
-  private optionRows(pollId: number): OptionRow[] {
+  private readOptions(pollId: number): OptionRow[] {
```

```diff bad
--- a/src/features/index.ts
+++ b/src/features/index.ts
@@
   router.command("hike", hikeCommand);
+  router.component("hb:poll:close", closePoll);
   return router;
--- a/test/guild/router.test.ts
+++ b/test/guild/router.test.ts
@@
+  it("routes hb:poll:close to its handler", async () => {
+    const result = await router.handle(component("hb:poll:close:1"), context);
+    expect(result.response.type).toBe(InteractionResponseType.UpdateMessage);
+  });
```

```diff bad
--- a/src/features/poll.ts
+++ b/src/features/poll.ts
@@
   return {
-    response: modal(customId("poll", "propose"), "Propose a location", [
+    response: modal(customId("poll", "propose"), "Propose a location for the next hike", [
       label("Location", textInput({ custom_id: customId("poll", "name") })),
```

```diff bad
--- a/src/features/admin-panel.ts
+++ b/src/features/admin-panel.ts
@@
+    await api.createMessage(announcementsChannelId, messageBody([resultContainer(result)]));
--- a/test/e2e/admin-panel.test.ts
+++ b/test/e2e/admin-panel.test.ts
@@
-const e2e = useE2E();
+const e2e = useE2E({ probe: true });
```
