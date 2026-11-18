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
perl -ne '
  next if m{^\s*(//|/?\*)};
  my $line = $_;
  $line =~ s/<!doctype html>//gi;
  my $why = "";
  $why = "dangerouslySetInnerHTML or innerHTML" if $line =~ /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b/;
  $why = "a string of HTML markup" if !$why && $line =~ /["\x27`]\s*<\/?[a-zA-Z!][^"\x27`]*>/;
  $why = "a text/html response built by hand" if !$why && !$ENV{SKIP_TYPE} && $line =~ /text\/html/;
  if ($why) {
    print "$ARGV:$.: $why; build the page with JSX and answer with htmlResponse (\"Add a page\" in src/web/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
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
perl -ne '
  next if m{^\s*(//|/?\*|\{/\*)};
  my $why = "";
  $why = "an inline <script>" if /<script\b(?![^>]*\bsrc=)/;
  $why = "a <style> element" if !$why && /<style\b/;
  $why = "a style attribute" if !$why && /\sstyle=/;
  $why = "an event attribute" if !$why && /\son[A-Z][A-Za-z]*=/;
  if ($why) {
    print "$ARGV:$.: $why; put styles in a stylesheet under public/assets/ and do the work on the server (\"Add a static asset\" in src/web/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
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
perl -ne '
  next if m{^\s*(//|/?\*|\{/\*)};
  my $line = $_;
  $line =~ s{https://cdn\.discordapp\.com/}{}g if $line =~ /\b(src|srcSet|srcset)=/;
  if ($line =~ /\b(src|srcSet|srcset|poster|action|formAction|data)=\{?["\x27`](https?:)?\/\//
      || ($line =~ /<link\b/ && $line =~ /\bhref=\{?["\x27`](https?:)?\/\//)) {
    print "$ARGV:$.: loads a file from another host; copy it into public/assets/ and link it by its path (\"Add a static asset\" in src/web/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
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
