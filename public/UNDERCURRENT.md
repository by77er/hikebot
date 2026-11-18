These rules govern `public/`, the static files that Workers Static Assets
serves at the same path (`public/assets/app.css` is `/assets/app.css`).
"Web pages" in `docs/design.md` describes how they are served and cached;
"Add a static asset" in `src/web/AGENTS.md` says how to add one.

## Static files live under public/assets/

`public/_headers` makes everything under `/assets/` cacheable for five
minutes, so a deploy that changes a file reaches every browser within five
minutes; a file elsewhere in `public/` gets no such header and could be
served at a path a page route needs. Move the file into `public/assets/` and
link it as `/assets/<name>`. `_headers`, `.assetsignore` and the rule and
procedure files are the only other files here.

```sh
case "$FILE" in
  ./assets/*|./_headers|./.assetsignore|./UNDERCURRENT.md|./AGENTS.md) exit 0 ;;
esac
echo "$FILE is outside public/assets/; move it to public/assets/ and link it as /assets/<name> (\"Add a static asset\" in src/web/AGENTS.md)"
exit 1
```

## Stylesheets load nothing from another host
only: *.css

A stylesheet loads fonts, images and other stylesheets from the Worker's own
origin only, by a root-relative path such as `/assets/hills.svg`. The
Content-Security-Policy blocks other hosts, and a font service or CDN would
learn who opened the page. Copy the file into `public/assets/` and refer to
it by its path.

```sh
perl -ne '
  if (/\@import\s+(url\()?\s*["\x27]?(https?:)?\/\/|url\(\s*["\x27]?(https?:)?\/\//i) {
    print "$ARGV:$.: loads a file from another host; copy it into public/assets/ and refer to it as /assets/<name>\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```

## Colours are tokens, defined only in tokens.css
only: *.css

Cairn's colours are roles defined once, in
`public/assets/cairn/tokens.css`, with a light and a dark value and a
checked contrast; a colour written anywhere else skips the dark scheme and
the contrast test. Use the role's custom property (`var(--color-text-muted)`)
instead, or add a role as "Add a token" in `src/web/AGENTS.md` says.
`transparent` and `currentColor` are keywords, not colours, and are fine.

```css good
.pill--decided {
  background: var(--color-success-subtle);
  color: var(--color-success);
}
```

```css bad
.pill--decided {
  background: #e4f0e3;
  color: rgb(44 106 53);
}
```

```sh
case "$FILE" in ./assets/cairn/tokens.css) exit 0 ;; esac
perl -0777 -ne '
  my $text = $_;
  my $blank = sub { my $c = shift; $c =~ s/[^\n]/ /g; $c };
  $text =~ s!/\*.*?\*/!$blank->($&)!gse;
  $text =~ s!url\([^)]*\)!$blank->($&)!ge;
  $text =~ s!var\(\s*--[\w-]+!var(!g;
  my $bad = 0;
  while ($text =~ /([\w-]+)\s*:\s*([^;\x7b\x7d]*)(?=[;\x7d])/g) {
    my ($value, $at) = ($2, $-[0]);
    next unless $value =~ /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|brown|navy|teal|olive|maroon|silver|gold|tan)\b/;
    my $line = 1 + (substr($text, 0, $at) =~ tr/\n//);
    print "$ARGV:$line: a raw colour; use a colour token such as var(--color-text) from public/assets/cairn/tokens.css (\"Add a token\" in src/web/AGENTS.md)\n";
    $bad = 1;
  }
  exit $bad;
' "$FILE"
```

## Layout and component CSS use tokens for sizes, durations and fonts
only: *.css

Space, sizes, radii, durations and the font come from the token scale in
`public/assets/cairn/tokens.css`, so spacing stays on the 4px grid, type
stays on its six steps and motion stops under reduced motion. In
`public/assets/cairn/layout.css` and the files under
`public/assets/cairn/components/` and `public/assets/cairn/pages/`, write
`var(--space-3)`, `var(--radius-control)`, `var(--duration-quick)` and
`var(--font-sans)` instead of a number with a unit or a font name; `0`,
unitless numbers and percentages are fine, and so is the breakpoint in a
`@media` condition. If no token fits, add one as "Add a token" in
`src/web/AGENTS.md` says.

```css good
.pill {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--font-size-small);
  transition-duration: var(--duration-quick);
}
```

```css bad
.pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 13px;
  transition-duration: 150ms;
}
```

```sh
case "$FILE" in
  ./assets/cairn/layout.css|./assets/cairn/components/*|./assets/cairn/pages/*) ;;
  *) exit 0 ;;
esac
perl -0777 -ne '
  my $text = $_;
  my $blank = sub { my $c = shift; $c =~ s/[^\n]/ /g; $c };
  $text =~ s!/\*.*?\*/!$blank->($&)!gse;
  $text =~ s!url\([^)]*\)!$blank->($&)!ge;
  $text =~ s!\@media[^\x7b]*!$blank->($&)!ge;
  $text =~ s!var\(\s*--[\w-]+!var(!g;
  my $bad = 0;
  while ($text =~ /([\w-]+)\s*:\s*([^;\x7b\x7d]*)(?=[;\x7d])/g) {
    my ($property, $value, $at) = ($1, $2, $-[0]);
    my $line = 1 + (substr($text, 0, $at) =~ tr/\n//);
    if ($value =~ /(?<![\w-])-?\d*\.?\d+(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|dvh|svh|lvh|pt|ms|s)\b/) {
      print "$ARGV:$line: a raw size or duration; use a token such as var(--space-3) or var(--duration-quick) (\"Add a token\" in src/web/AGENTS.md)\n";
      $bad = 1;
    }
    if ($property eq "font-family" && $value !~ /^\s*var\(/) {
      print "$ARGV:$line: a font family by name; use var(--font-sans), Cairn has one typeface\n";
      $bad = 1;
    }
  }
  exit $bad;
' "$FILE"
```

## One typeface: Public Sans
only: *.{css,woff,woff2,ttf,otf}

Cairn sets everything in Public Sans, self-hosted, with metric-matched
local fallbacks; a second typeface costs another download, breaks the
type scale's rhythm and dilutes the voice ("Typography" in
`docs/design-system.md`). Do not add another font file or `@font-face`:
use `var(--font-sans)` in another weight from the scale instead. The only
font files are `public/assets/fonts/public-sans-<version>-*.woff2`, and the
only `@font-face` families are "Public Sans Variable" and its fallbacks
"Cairn fallback" and "Cairn fallback Roboto".

```css good
.pill {
  font-family: var(--font-sans);
  font-weight: var(--font-weight-semibold);
}
```

```css bad
@font-face {
  font-family: "Trail Display";
  src: url("../fonts/trail-display.woff2") format("woff2");
}
```

```sh
case "$FILE" in
  *.woff|*.woff2|*.ttf|*.otf)
    case "$FILE" in
      ./assets/fonts/public-sans-*.woff2) exit 0 ;;
    esac
    echo "$FILE: a font file other than Public Sans; Cairn has one typeface (\"Typography\" in docs/design-system.md)"
    exit 1 ;;
esac
perl -0777 -ne '
  my $bad = 0;
  while (/\@font-face\s*\{([^}]*)\}/g) {
    my ($body, $at) = ($1, $-[0]);
    my ($family) = $body =~ /font-family\s*:\s*["\x27]?([^;"\x27]+)/;
    $family //= "";
    next if $family =~ /^(Public Sans Variable|Cairn fallback|Cairn fallback Roboto)$/;
    my $line = 1 + (substr($_, 0, $at) =~ tr/\n//);
    print "$ARGV:$line: \@font-face for \"$family\"; Cairn has one typeface, Public Sans (\"Typography\" in docs/design-system.md)\n";
    $bad = 1;
  }
  exit $bad;
' "$FILE"
```

## Static files are made here or come from an open-licence package

Every file under `public/` is either made in this repository (such as the
contour pattern) or copied from an npm package with an open licence that
`docs/design-system.md` names, along with its licence notice (Public Sans
from `@fontsource-variable/public-sans` under the OFL, Lucide's icon shapes
under ISC). Never add a file downloaded from a website, a CDN, a stock
photo or icon service, or a package without such a licence: say where it
comes from in `docs/design-system.md`, add the package as a pinned
devDependency, and copy the file from `node_modules/`.

```text good
public/assets/fonts/public-sans-5.3.0-latin-wght-normal.woff2  (copied from @fontsource-variable/public-sans, OFL, named in docs/design-system.md)
```

```text bad
public/assets/hero-mountain.jpg  (saved from a stock photo site)
```
