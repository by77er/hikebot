These rules govern `src/guild/`: the per-guild `GuildHike` Durable Object,
the router that dispatches interactions to feature handlers, and the SQLite
schema and its migrations. Read "GuildHike and the handler registry" and
"Storage" in `docs/design.md` and `src/guild/AGENTS.md` for the design they
enforce.

## A shipped migration is never edited, renamed, removed or reordered
only: schema.ts

`applyMigrations` records each migration by `name` in `_migrations` and never
runs it again. A guild that already ran a migration keeps the tables it made,
so editing a migration that is on the base branch changes nothing there and
makes new guilds differ from old ones; renaming it runs it a second time,
and removing or reordering it changes what new guilds get. Leave every
migration the base branch has exactly as it is, in its place, and append a
new migration to the end of `migrations` instead (`ALTER TABLE` to change a
table an earlier migration made), as "Add a SQLite migration" in
`src/guild/AGENTS.md` says. Deleting `schema.ts` or moving the list out of
it breaks this rule too.

```ts good
export const migrations: readonly Migration[] = [
  {
    name: "0001_polls",
    sql: `
      CREATE TABLE rounds (
        id INTEGER PRIMARY KEY,
        ...
    `,
  },
  {
    name: "0002_round_notes",
    sql: "ALTER TABLE rounds ADD COLUMN notes TEXT",
  },
];
```

```ts bad
export const migrations: readonly Migration[] = [
  {
    name: "0001_polls",
    sql: `
      CREATE TABLE rounds (
        id INTEGER PRIMARY KEY,
        notes TEXT,
        ...
    `,
  },
];
```

```ts bad
export const migrations: readonly Migration[] = [
  { name: "0001_trails", sql: "CREATE TABLE trails (id INTEGER PRIMARY KEY, name TEXT NOT NULL)" },
  { name: "0002_polls", sql: pollTables },
];
```

## Migrations on the base branch are unchanged
only: schema.ts

This backstops the rule above. It compares the `migrations` list in the
working tree with the one at the merge base of `HEAD` and the base branch
(`origin/$GITHUB_BASE_REF` in a pull request's CI, otherwise `origin/HEAD`
or `origin/main`), entry by entry, by each property's value: every entry the
base has must still be there, unchanged and in the same position. Entries
appended after them pass. On a push to the base branch the merge base is
`HEAD` itself, so only uncommitted changes are compared. Restore the entries
it names and append a new migration instead.

```sh
base=""
for ref in "${GITHUB_BASE_REF:+origin/$GITHUB_BASE_REF}" "$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD || true)" origin/main origin/master; do
  if [ -n "$ref" ] && git rev-parse --verify --quiet "$ref^{commit}" > /dev/null; then
    base="$ref"
    break
  fi
done
if [ -z "$base" ]; then
  echo "$FILE:1: cannot find the base branch to compare migrations with; run git fetch origin main (in CI, check out with fetch-depth: 0)"
  exit 1
fi
if ! shipped="$(git merge-base "$base" HEAD)"; then
  echo "$FILE:1: $base and HEAD share no history, so the shipped migrations cannot be read; fetch the full history (in CI, check out with fetch-depth: 0)"
  exit 1
fi
if ! git cat-file -e "$shipped:./${FILE#./}" 2> /dev/null; then
  exit 0
fi
git show "$shipped:./${FILE#./}" | node -e '
const ts = require("typescript");
const fs = require("fs");
const [file, base] = process.argv.slice(1);
const read = (text) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let list;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "migrations" && node.initializer) {
      let value = node.initializer;
      while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
      if (ts.isArrayLiteralExpression(value)) list = value;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!list) return undefined;
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const valueOf = (node) => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : node.getText(source));
  const entries = list.elements.map((element) => {
    const fields = {};
    if (ts.isObjectLiteralExpression(element)) {
      for (const property of element.properties) {
        const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : property.getText(source);
        fields[key] = ts.isPropertyAssignment(property) ? valueOf(property.initializer) : property.getText(source);
      }
    } else {
      fields["(expression)"] = element.getText(source);
    }
    const key = JSON.stringify(Object.keys(fields).sort().map((name) => [name, fields[name]]));
    return { name: typeof fields.name === "string" ? fields.name : undefined, key, line: lineOf(element) };
  });
  return { entries, line: lineOf(list) };
};
const shipped = read(fs.readFileSync(0, "utf8"));
if (!shipped) process.exit(0);
const fix = "restore it exactly as it is on " + base + " and append a new migration to the end of migrations instead (ALTER TABLE to change a table), as \"Add a SQLite migration\" in src/guild/AGENTS.md says";
const current = read(fs.readFileSync(file, "utf8"));
if (!current) {
  console.log(file + ":1: the migrations list that " + base + " has is gone; " + fix);
  process.exit(1);
}
const problems = [];
shipped.entries.forEach((old, index) => {
  const now = current.entries[index];
  if (now && now.key === old.key) return;
  const label = (old.name ? "migration " + old.name : "an unnamed migration") + " (position " + (index + 1) + " on " + base + ")";
  const moved = current.entries.findIndex((entry) => entry.key === old.key);
  const named = old.name === undefined ? -1 : current.entries.findIndex((entry) => entry.name === old.name);
  if (moved >= 0) {
    problems.push([current.entries[moved].line, label + " moved to position " + (moved + 1)]);
  } else if (named === index) {
    problems.push([now.line, label + " was edited"]);
  } else if (named >= 0) {
    problems.push([current.entries[named].line, label + " was edited and moved to position " + (named + 1)]);
  } else if (now) {
    problems.push([now.line, label + " was renamed or removed; position " + (index + 1) + " now holds " + (now.name || "an unnamed migration")]);
  } else {
    problems.push([current.line, label + " was removed"]);
  }
});
for (const [line, what] of problems) console.log(file + ":" + line + ": " + what + "; " + fix);
process.exit(problems.length > 0 ? 1 : 0);
' "$FILE" "$base"
```

## GuildHike only wires the guild's parts together
only: guild-hike.ts

`GuildHike` applies the migrations in its constructor, builds the router
through `registerFeatures`, dispatches each interaction to it with the
`HandlerContext`, and keeps and runs the follow-up jobs handlers return.
Nothing else goes in the class: SQL, `DiscordApi` calls, message and
component building, and feature decisions (who may do what, what a vote
means, when a poll closes) live in the feature's own file under
`src/features/` (with poll rules and storage in `src/polls/`), which
registers its handlers in `registerFeatures`. Move such code there and reach
it through the router. A new RPC method that a feature needs is a one-line
call into that feature's code.

```ts good
async handleInteraction(interaction: APIInteraction): Promise<InteractionOutcome> {
  const result = await this.router.dispatch(interaction, {
    env: this.env,
    storage: this.ctx.storage,
  });
  if (result.followUp) this.followUps.set(interaction.id, result.followUp);
  return { response: result.response, followUp: result.followUp !== undefined };
}
```

```ts good
export function registerFeatures(router: Router): Router {
  router.command("hike", hikeCommand);
  router.component("hb:poll:vote", openVoteSelect);
  return router;
}
```

```ts good
async alarm(): Promise<void> {
  await closeDuePolls({ env: this.env, storage: this.ctx.storage });
}
```

```ts bad
async handleInteraction(interaction: APIInteraction): Promise<InteractionOutcome> {
  if (interaction.type === InteractionType.ApplicationCommand && interaction.data.name === "hike") {
    const round = this.ctx.storage.sql
      .exec<{ id: number }>("SELECT id FROM rounds WHERE status = 'location_voting'")
      .toArray()[0];
    return { response: ephemeralReply([textDisplay(round ? "A hike vote is open." : "No hike is planned.")]), followUp: false };
  }
  return this.dispatch(interaction);
}
```

```ts bad
async alarm(): Promise<void> {
  const poll = new PollStore(this.ctx.storage).closePoll(this.pollId, "alarm");
  await discordApi(this.env).createMessage(this.announcementsChannelId, messageBody([resultContainer(poll)]));
}
```
