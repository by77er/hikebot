These rules govern the scripts under `scripts/`, which run on a developer's
machine and in CI, such as `npm run register` in the `Deploy` workflow. CI
runs them with the production credentials in the environment and its logs
are public, so a script reaches Discord only through `DiscordApi`, never
prints a secret, and keeps its logic in a tested module.

## Scripts send Discord requests through DiscordApi
only: *.ts

A script never calls `fetch` itself and never names a `discord.com` or
`discordapp.com` API URL, so authentication, rate limits and token-free
errors stay in `src/discord/api.ts`. Build a `DiscordApi` from
`src/discord/api.ts` and call one of its methods instead. When the endpoint
has no method yet, add one to `DiscordApi` first, following "Add a REST
method to the client" in `src/discord/AGENTS.md`. Reading `DISCORD_API_BASE`
from the environment and passing it to `DiscordApi` as `baseUrl`, and
passing an injected `fetch` on to `DiscordApi`, are how tests point a script
at a stub, and pass. Message links (`discord.com/channels/…`) and links to
Discord's docs (`discord.com/developers/…`) are not requests and pass.
Comment lines are skipped.

```sh
awk '
  /^[[:space:]]*(\/\/|\/?\*)/ { next }
  /discord(app)?\.com/ && !/discord(app)?\.com\/(channels|developers)\// { hit = 1 }
  /(^|[^A-Za-z0-9_$])fetch[[:space:]]*\(/ && !/^[[:space:]]*(async[[:space:]]+)?fetch[[:space:]]*\([^)]*\)[[:space:]]*(:[^=]*)?\{/ { hit = 1 }
  hit { print FILENAME ":" FNR ": requests Discord outside DiscordApi; build a DiscordApi from src/discord/api.ts and call its method instead, adding the method there first if it is missing (see src/discord/AGENTS.md): " $0; bad = 1; hit = 0 }
  END { exit bad }
' "$FILE"
```

## Scripts never print a secret
only: *.ts

Nothing a script writes to its output, and nothing it puts in an error
message, contains the bot token or any other secret from the environment:
CI prints it into a public log. Report which variable is missing by name,
never its value. Before printing the text of an error that may embed a
secret, such as a failed request's message or its `cause`, replace every
secret in it, as `register` in `scripts/register.ts` replaces the token with
`[bot token]`. Never print the environment, or an object holding a secret,
as a whole; print the fields that are not secret, one by one.

```ts good
if (token === "") {
  output.error(
    "Cannot register the slash commands: set DISCORD_BOT_TOKEN in the environment.",
  );
  return 1;
}
```

```ts good
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  output.error(
    `Registering the slash commands failed: ${reason.replaceAll(token, "[bot token]")}`,
  );
  return 1;
}
```

```ts bad
output.log(`Registering as application ${applicationId} with token ${token}`);
```

```ts bad
} catch (error) {
  output.error(`Registering the slash commands failed: ${String(error)}`);
  return 1;
}
```

```ts bad
console.error("Cannot register the slash commands, environment:", process.env);
```

```ts bad
throw new Error(`Discord refused Bot ${env.DISCORD_BOT_TOKEN}: ${response.status}`);
```

## Scripts print no secret variable and no environment
only: *.ts

Print the variable's name, or the error text with the secret replaced (as
`register` in `scripts/register.ts` does with `[bot token]`), instead. This
backstops "Scripts never print a secret" for what a command can see: inside
the arguments of a print call (`console.*`, `.log`, `.error`, `.warn`,
`.info`, `.debug`, `.trace`, `.dir`, `.table`, `.write`) or of a
`new …Error(...)`, it flags `process.env` or `env` used whole, and any
variable, property or environment variable whose name says it is a secret
(`token`, `secret`, `password`, `credential`, `private`, `api key`; names
with `public` are exempt). An argument of `replace`, `replaceAll` or a
`redact…` call is not printed and is skipped.

```sh
node -e '
const ts = require("typescript");
const fs = require("fs");
const file = process.argv[1];
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const secret = (name) => /token|secret|password|passwd|credential|private|api_?key/i.test(name) && !/public/i.test(name);
const printers = new Set(["log", "error", "warn", "info", "debug", "trace", "dir", "table", "write"]);
const calleeName = (node) => ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : "";
const isPrint = (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && printers.has(node.expression.name.text);
const isNewError = (node) => ts.isNewExpression(node) && /Error$/.test(node.expression.getText(source));
const isRedaction = (node) => ts.isCallExpression(node) && /^(replace|replaceAll|redact.*)$/.test(calleeName(node));
const accessed = (node) => (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node;
const lines = new Map();
const report = (node, what) => {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  if (!lines.has(line)) lines.set(line, what);
};
const check = (node) => {
  if (isRedaction(node)) return check(node.expression);
  const text = node.getText(source);
  if (ts.isPropertyAccessExpression(node) && text === "process.env" && !accessed(node)) return report(node, "prints the whole environment");
  if (ts.isIdentifier(node) && node.text === "env" && !accessed(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return report(node, "prints the whole environment");
  if (ts.isPropertyAccessExpression(node) && secret(node.name.text)) return report(node, "prints a secret (" + text + ")");
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && secret(node.argumentExpression.text)) return report(node, "prints a secret (" + text + ")");
  if (ts.isIdentifier(node) && secret(node.text) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) return report(node, "prints a secret (" + text + ")");
  ts.forEachChild(node, check);
};
const visit = (node) => {
  if (isPrint(node) || isNewError(node)) for (const arg of node.arguments || []) check(arg);
  ts.forEachChild(node, visit);
};
visit(source);
for (const [line, what] of [...lines].sort((a, b) => a[0] - b[0])) {
  console.log(file + ":" + line + ": " + what + "; print the variable name, or the text with the secret replaced (reason.replaceAll(token, \"[bot token]\")), never its value or the environment");
}
process.exit(lines.size > 0 ? 1 : 0);
' "$FILE"
```

## A script change comes with tests
only: *.ts

A script's logic lives in an importable module, such as
`scripts/register.ts`, that takes its effects as arguments: the environment
as a `Record<string, string | undefined>`, an output with `log` and `error`,
and options such as `fetch` that it passes on to `DiscordApi`. It returns the
exit code instead of setting it. The entry file, such as
`scripts/register-commands.ts`, only passes `process.env` and `console` in
and sets `process.exitCode` from the result. A change that adds or changes
what a script does adds or updates a test in `test/scripts/<name>.test.ts`
in the same pull request, one that fails without the change and calls the
module with a fake environment, a captured output and a stub `fetch`. A
change that keeps behaviour as it is, such as a comment, a rename or
formatting, needs no new test.

```ts good
export async function register(
  env: Record<string, string | undefined>,
  output: Output,
  options: { fetch?: typeof fetch } = {},
): Promise<number> {
  const api = new DiscordApi({
    token,
    baseUrl: env.DISCORD_API_BASE || undefined,
    ...options,
  });
```

```ts good
import { register } from "./register";

process.exitCode = await register(process.env, {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
});
```

```diff good
--- a/scripts/register.ts
+++ b/scripts/register.ts
@@
-  const applicationId = env.DISCORD_APPLICATION_ID ?? "";
+  const applicationId = env.DISCORD_APPLICATION_ID?.trim() ?? "";
--- a/test/scripts/register.test.ts
+++ b/test/scripts/register.test.ts
@@
+  it("treats a blank application id as missing", async () => {
+    const { lines, output } = capture();
+    expect(await register({ ...ENV, DISCORD_APPLICATION_ID: " " }, output, { fetch: discord() })).toBe(1);
+    expect(lines.join("\n")).toContain("set DISCORD_APPLICATION_ID");
+  });
```

```ts bad
const api = new DiscordApi({ token: process.env.DISCORD_BOT_TOKEN ?? "" });
const registered = await api.bulkOverwriteGlobalCommands(
  process.env.DISCORD_APPLICATION_ID ?? "",
  commands,
);
console.log(`Registered ${String(registered.length)} global command(s)`);
process.exit(0);
```

```diff bad
--- a/scripts/register.ts
+++ b/scripts/register.ts
@@
     return 0;
   } catch (error) {
+    if (error instanceof DiscordApiError && error.status === 429) {
+      output.error("Discord is rate limiting the bot; run it again in a minute.");
+      return 2;
+    }
```
