These rules govern the Worker's web pages under `src/web/`: the router, the
response function that sets every page's security headers, the page shell
and the pages. "Web pages" in `docs/design.md` describes them;
`src/web/AGENTS.md` says how to add and test a page.

## Pages build HTML with JSX only
only: *.{ts,tsx}

Every piece of HTML a page sends is JSX rendered by `htmlResponse`, because
JSX escapes text and attribute values and a string does not: a location
name, a member's nickname or a form value put into an HTML string can inject
markup and script. Write the markup as JSX in a component under
`src/web/pages/` and put values in as expressions (`{name}`,
`href={url}`). Never build HTML by concatenating or interpolating strings,
never answer with a hand-made `text/html` `Response`, and never use
`dangerouslySetInnerHTML`. The one string of markup is the `<!doctype html>`
that `htmlResponse` puts before the rendered page.

```tsx good
export function TrailPage({ trail }: { trail: Trail }) {
  return (
    <Layout title={`${trail.name} · hikebot`}>
      <h1>{trail.name}</h1>
      <p>Proposed by {trail.proposer}</p>
    </Layout>
  );
}

router.get("/trail", () => htmlResponse(<TrailPage trail={trail} />));
```

```ts bad
router.get("/trail", () =>
  new Response(`<h1>${trail.name}</h1><p>Proposed by ${trail.proposer}</p>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }),
);
```

```tsx bad
<div dangerouslySetInnerHTML={{ __html: `<b>${trail.name}</b>` }} />
```

## No HTML strings, innerHTML or hand-made HTML responses in src/web/
only: *.{ts,tsx}

This backs up "Pages build HTML with JSX only" for when no model judges it.
On the printed line, replace the string of markup, the
`dangerouslySetInnerHTML` or the `text/html` header with JSX rendered by
`htmlResponse` in `src/web/response.ts`, as "Add a page" in
`src/web/AGENTS.md` shows.

```sh
case "$FILE" in ./response.ts) export SKIP_TYPE=1 ;; *) export SKIP_TYPE= ;; esac
perl -0777 -ne '
  my $text = $_;
  my @found;
  my $at = sub {
    my ($pos, $why) = @_;
    my $start = rindex($text, "\n", $pos) + 1;
    my $end = index($text, "\n", $pos);
    my $line = substr($text, $start, ($end < 0 ? length($text) : $end) - $start);
    return if $line =~ m{^\s*(//|/?\*|\{/\*)};
    push @found, [$pos, $why];
  };
  $text =~ s/<!doctype html>/               /gi;
  $at->($-[0], "dangerouslySetInnerHTML or innerHTML") while $text =~ /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b/g;
  while ($text =~ /(?:^|[=(,+{:?\[!&|]|\breturn|=>)[ \t]*\K(?:"((?:[^"\\\n]|\\.)*)"|\x27((?:[^\x27\\\n]|\\.)*)\x27|`((?:[^`\\]|\\.)*)`)/gm) {
    my ($pos, $body) = ($-[0], $1 // $2 // $3);
    $at->($pos, "a string of HTML markup") if $body =~ /<\/?[a-zA-Z!][^<>]*>/;
  }
  if (!$ENV{SKIP_TYPE}) {
    $at->($-[0], "a text/html response built by hand") while $text =~ /text\/html/g;
  }
  for my $f (sort { $a->[0] <=> $b->[0] } @found) {
    my $line = 1 + (substr($text, 0, $f->[0]) =~ tr/\n//);
    print "$ARGV:$line: $f->[1]; build the page with JSX and answer with htmlResponse (\"Add a page\" in src/web/AGENTS.md)\n";
  }
  exit(@found ? 1 : 0);
' "$FILE"
```

## Pages carry no inline script or style
only: *.tsx

The Content-Security-Policy that `htmlResponse` sets allows scripts and
styles from the Worker's own files only, so a browser ignores a `<script>`
with code in it, a `<style>` element, a `style` attribute and an `on…`
event attribute; they would also make the page depend on JavaScript, and
every page must work with it off. Give the element a class and put the rule
in a stylesheet under `public/assets/` ("Add a static asset" in
`src/web/AGENTS.md`); do on the server, in the route's handler, what a
script would have done in the browser, such as with a form that posts to a
route.

```tsx good
<p class="notice">Voting closes on Saturday.</p>
```

```tsx good
<form method="post" action="/settings">
  <button type="submit">Save</button>
</form>
```

```tsx bad
<p style={{ color: "red" }}>Voting closes on Saturday.</p>
```

```tsx bad
<script>{`document.querySelector("form").submit()`}</script>
```

```tsx bad
<button onClick={() => save()}>Save</button>
```

```sh
perl -0777 -ne '
  my $text = $_;
  my @found;
  my $at = sub {
    my ($pos, $why) = @_;
    my $start = rindex($text, "\n", $pos) + 1;
    my $end = index($text, "\n", $pos);
    my $line = substr($text, $start, ($end < 0 ? length($text) : $end) - $start);
    return if $line =~ m{^\s*(//|/?\*|\{/\*)};
    push @found, [$pos, $why];
  };
  $at->($-[0], "an inline <script>") while $text =~ /<script\b(?![^>]*\bsrc=)/g;
  $at->($-[0], "a <style> element") while $text =~ /<style\b/g;
  $at->($-[0], "a style attribute") while $text =~ /\sstyle=/g;
  $at->($-[0], "an event attribute") while $text =~ /\son(?:[A-Z][A-Za-z]*|(?:click|dblclick|change|submit|reset|input|load|error|focus|blur|key(?:down|up|press)|mouse[a-z]+|pointer[a-z]+|touch[a-z]+))=/g;
  for my $f (sort { $a->[0] <=> $b->[0] } @found) {
    my $line = 1 + (substr($text, 0, $f->[0]) =~ tr/\n//);
    print "$ARGV:$line: $f->[1]; put styles in a stylesheet under public/assets/ and do the work on the server (\"Add a static asset\" in src/web/AGENTS.md)\n";
  }
  exit(@found ? 1 : 0);
' "$FILE"
```

## Pages load nothing from another host
only: *.{ts,tsx}

A page loads its styles, scripts, fonts and images from the Worker's own
origin, by a root-relative path such as `/assets/app.css`; the only
exception is images from Discord's CDN (`https://cdn.discordapp.com`), for
avatars and server icons. No font service, CDN, analytics or other
third-party host: the Content-Security-Policy blocks them anyway, and each
would tell another company who opened the page. Copy the file into
`public/assets/` and link it by its path instead. A plain link to another
site (`<a href>`) loads nothing and is fine, and so are requests the Worker
itself makes on the server.

```tsx good
<link rel="stylesheet" href="/assets/app.css" />
```

```tsx good
<img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} alt="" />
```

```tsx bad
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
```

```tsx bad
<script src="https://www.googletagmanager.com/gtag/js?id=G-1" />
```

```sh
perl -0777 -ne '
  my $text = $_;
  my @found;
  my $at = sub {
    my ($pos, $why) = @_;
    my $start = rindex($text, "\n", $pos) + 1;
    my $end = index($text, "\n", $pos);
    my $line = substr($text, $start, ($end < 0 ? length($text) : $end) - $start);
    return if $line =~ m{^\s*(//|/?\*|\{/\*)};
    push @found, [$pos, $why];
  };
  while ($text =~ /\b(src|srcSet|srcset|poster|action|formAction|data)=\{?\s*["\x27`]((?:https?:)?\/\/[^"\x27`\s]*)/g) {
    my ($pos, $attr, $url) = ($-[0], $1, $2);
    next if $attr =~ /^src/i && $url =~ m{^https://cdn\.discordapp\.com/};
    $at->($pos, "loads a file from another host");
  }
  $at->($-[0], "loads a file from another host") while $text =~ /<(?:link|image|use)\b[^>]*?\K\b(?:href|xlinkHref|xlink:href)=\{?\s*["\x27`](https?:)?\/\//g;
  for my $f (sort { $a->[0] <=> $b->[0] } @found) {
    my $line = 1 + (substr($text, 0, $f->[0]) =~ tr/\n//);
    print "$ARGV:$line: $f->[1]; copy it into public/assets/ and link it by its path (\"Add a static asset\" in src/web/AGENTS.md)\n";
  }
  exit(@found ? 1 : 0);
' "$FILE"
```

## The Content-Security-Policy stays strict
only: response.ts

The policy `htmlResponse` sets is `default-src 'none'`, with styles,
scripts, fonts and connections from `'self'` only, images from `'self'`,
`data:` and `https://cdn.discordapp.com`, `form-action 'self'`,
`base-uri 'none'` and `frame-ancestors 'none'`. Put back the directive the
printed line names. To show something the policy blocks, change the page
instead: move inline code or style into a file under `public/assets/`, and
copy a third-party file there.

```sh
node -e '
const text = require("node:fs").readFileSync(process.argv[1], "utf8");
const block = /CONTENT_SECURITY_POLICY\s*=\s*\[([^\]]*)\]/.exec(text);
const problems = [];
if (!block) problems.push("it no longer lists the policy as CONTENT_SECURITY_POLICY = [...]");
const directives = [...(block?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);
const expected = ["default-src \x27none\x27", "style-src \x27self\x27", "script-src \x27self\x27", "font-src \x27self\x27", "connect-src \x27self\x27", "img-src \x27self\x27 data: https://cdn.discordapp.com", "form-action \x27self\x27", "base-uri \x27none\x27", "frame-ancestors \x27none\x27"];
for (const directive of expected) {
  if (!directives.includes(directive)) problems.push(`the directive "${directive}" is missing or changed`);
}
for (const directive of directives) {
  if (!expected.includes(directive)) problems.push(`it adds or loosens the directive "${directive}"`);
}
for (const p of problems) console.log(`${process.argv[1]}: ${p}; restore the policy in "Web pages" of docs/design.md`);
process.exit(problems.length > 0 ? 1 : 0);
' "$FILE"
```

## Pages read a server only through readGuild
only: *.{ts,tsx}

A page never opens a guild object's storage. It reads a server with
`readGuild(env, guildId, userId)` from `src/web/guild.ts`, which calls the
guild object's `webView` method through the `GUILD_HIKE` binding: inside the
object, that read checks with Discord that the user is a member, decides
whether they are an admin with the same rule as the bot's interactions, and
builds everything the page shows from the existing stores. Nothing under
`src/web/` imports `PollStore` (`src/polls/store.ts`), `GuildConfig` or the
other storage modules of `src/guild/` (`config.ts`, `schema.ts`,
`schedule.ts`), or a feature's state module (`src/features/*-state.ts`);
nothing here touches `DurableObjectStorage`, `storage.sql` or `storage.kv`,
or calls `readWebView` itself. When a page needs data the view lacks, add a
field to the view, as "Add a field to the web view" in
`src/guild/AGENTS.md` says. Type-only imports of the view's types are fine.

```tsx good
import { readGuild } from "../guild";

const result = await readGuild(env, guildId, session.userId, { page: 2 });
if (result.kind !== "view") return notFoundPage();
return htmlResponse(<ServerPage view={result.view} />);
```

```ts good
import type { WebView } from "../../guild/web-view";
```

```ts bad
import { PollStore } from "../polls/store";

const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
const round = await runInDurableObject(stub, (_i, state) =>
  new PollStore(state.storage).getActiveRound(),
);
```

```ts bad
import { hikeThreadStatus } from "../features/hike-thread-state";
import { GuildConfig } from "../guild/config";
```

```sh
if grep -HnE "(from|import\()[[:space:]]*[\"'][./]*(polls/store|guild/(config|schema|schedule)|features/[a-z0-9-]*-state)[\"']|\b(PollStore|GuildConfig|DurableObjectStorage|readWebView|WebViewCache)\b|storage\.(sql|kv)\b|ctx\.storage\b" "$FILE"; then
  echo "$FILE: reads a guild object's storage; read the server with readGuild from src/web/guild.ts instead, and add what is missing to the web view (\"Add a field to the web view\" in src/guild/AGENTS.md)"
  exit 1
fi
```
