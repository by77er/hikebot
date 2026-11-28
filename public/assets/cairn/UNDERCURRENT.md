These rules govern Cairn's CSS: `cairn.css`, `tokens.css`, `layout.css`
and the files under `components/` and `pages/` in `public/assets/cairn/`.
They keep the design method of `docs/design-system.md` from being undone
by a later change: every design value comes from a token, no colour is
eased, and every press shows at once. `public/UNDERCURRENT.md` holds the
rules for all of `public/`; "Add a token" and "Add a component to the
design system" in `src/web/AGENTS.md` say how to change Cairn.

## Component and page CSS uses tokens only
only: *.css

Every colour, length, duration and font weight in Cairn is a token, defined
once in `tokens.css` with its light and dark value, its place on the scale
and its reduced-motion value; a literal written anywhere else skips all of
that. Outside `tokens.css`, write the token's custom property instead
(`var(--color-text-muted)`, `var(--space-3)`, `var(--duration-quick)`,
`var(--font-weight-semibold)`), or add a token as "Add a token" in
`src/web/AGENTS.md` says. A declaration value has no hex colour, no colour
function (`rgb()`, `hsl()`, `oklch()` and the rest), no named colour, no
number with a length or time unit, and no `font-weight` or `font-family`
other than a token (`var(--font-sans)`, `var(--font-mono)`).

These are allowed, each matching how Cairn is written today:

- `0`, bare: no distance at all, the same in every unit.
- Percentages, such as `100%`, `50%` for centring, `translateY(-200%)` or a
  `color-mix()` share: they are proportions of a box or a colour, not sizes
  on the scale.
- `fr`, angles (`deg`) and unitless numbers (`z-index`, `flex: 1`,
  `grid-column: 2`, `line-height: 1`, the icon's `stroke-width: 2` in its
  24-unit grid, `aspect-ratio: 3 / 2`): they are counts, shares and turns,
  not lengths, durations or weights.
- `transparent` and `currentColor`, which are keywords, not colours, and
  `inherit`, `none` and the other CSS-wide keywords.
- `1px` and `-1px` on `width`, `height` and `margin`: the one-pixel box of
  the visually hidden utility in `cairn.css`. Hairlines are not an
  exception: a border is `var(--border-width)`.
- An `em` factor in `cairn.css`'s base element styles, such as `code`'s
  `max(0.9375em, var(--font-size-small))`, which is a shade smaller than the
  text around it, so its size depends on where it sits; a component sizes
  text with `--font-size-*`.
- `@media` conditions, because a custom property cannot be read there.
- `@font-face` descriptors (the family names, `font-weight: 100 900`,
  `size-adjust` and the metric overrides), which describe the font file,
  not a design value.
- Comments and `url()` paths.

```css good
.pill {
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--color-border);
  font-weight: var(--font-weight-semibold);
  color: var(--color-success);
  transition-duration: var(--duration-quick);
}
```

```css bad
.pill {
  padding: 3px 10px;
  border: 1px solid #d5dbd3;
  font-weight: 600;
  color: green;
  transition-duration: 150ms;
}
```

```sh
case "$FILE" in ./tokens.css) exit 0 ;; esac
perl -0777 -ne '
  my $text = $_;
  my $file = $ARGV;
  my $blank = sub { my $c = shift; $c =~ s/[^\n]/ /g; $c };
  $text =~ s!/\*.*?\*/!$blank->($&)!gse;
  $text =~ s!url\([^)]*\)!$blank->($&)!ge;
  $text =~ s!\@media[^\x7b]*!$blank->($&)!ge;
  $text =~ s!\@font-face\s*\x7b[^\x7d]*\x7d!$blank->($&)!ge;
  $text =~ s!var\(\s*--[\w-]+!var(!g;
  my $named = qr/aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen/i;
  my $length = qr/px|rem|em|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|[sld]v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max)|cm|mm|q|in|pt|pc/i;
  my $bad = 0;
  my $say = sub {
    my ($at, $why) = @_;
    my $line = 1 + (substr($text, 0, $at) =~ tr/\n//);
    print "$file:$line: $why\n";
    $bad = 1;
  };
  while ($text =~ /([\w-]+)\s*:\s*([^;\x7b\x7d]*)(?=[;\x7d])/g) {
    my ($property, $value, $at) = (lc $1, $2, $-[0]);
    if ($value =~ /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:$named)(?![\w-])/) {
      $say->($at, "a literal colour in \"$property\"; use a colour token such as var(--color-text) from public/assets/cairn/tokens.css (\"Add a token\" in src/web/AGENTS.md)");
    }
    while ($value =~ /(?<![\w-])(-?\d*\.?\d+)($length|ms|s)(?![\w-])/g) {
      my ($number, $unit) = ($1, lc $2);
      next if $number =~ /^-?1$/ && $unit eq "px" && $property =~ /^(?:width|height|margin)$/;
      next if $unit eq "em" && $file =~ m{(?:^|/)cairn\.css$};
      my $kind = ($unit eq "ms" || $unit eq "s") ? "duration" : "length";
      my $token = $kind eq "duration" ? "var(--duration-quick)" : "var(--space-3)";
      $say->($at, "a literal $kind ($number$unit) in \"$property\"; use a token such as $token from public/assets/cairn/tokens.css (\"Add a token\" in src/web/AGENTS.md)");
    }
    my $weight = $property eq "font-weight" ? $value
      : $property eq "font" ? join(" ", $value =~ /(?<![\w.-])(?:[1-9]00|bold|bolder|lighter)(?![\w.-])/gi)
      : "";
    if ($weight =~ /\S/ && $weight !~ /^\s*(?:var\([^)]*\)|inherit|initial|unset|revert|revert-layer)\s*$/i) {
      $say->($at, "a literal font weight in \"$property\"; use a weight token such as var(--font-weight-semibold) from public/assets/cairn/tokens.css");
    }
    if ($property eq "font-family" && $value !~ /^\s*(?:var\([^)]*\)|inherit)\s*$/i) {
      $say->($at, "a font family by name; use var(--font-sans), Cairn has one typeface (\"Typography\" in docs/design-system.md)");
    }
  }
  exit $bad;
' "$FILE"
```

## No colour is eased
only: *.css

A colour that fades in over a few hundred milliseconds makes a press look
late and a state look unsure, so Cairn changes colour at once and eases only
movement ("Motion" in `docs/design-system.md`). A `transition` or
`transition-property` never names `color`, a `background*`, a `border*` or
`outline*` colour (or the `border` and `outline` shorthands), `fill`,
`stroke`, `box-shadow`, `text-shadow`, another `*-color`, or `all`; and a
`transition` shorthand always names its property, since without one it
eases `all`. Name only the moving property, such as `transform` or
`opacity`, and let colour change at once.

```css good
.tally-row__chevron {
  transition: transform var(--duration-quick) var(--easing-standard);
}
```

```css bad
.button--primary {
  transition: background-color var(--duration-quick) var(--easing-standard);
}
```

```css bad
.card--link {
  transition: var(--duration-quick);
}
```

```sh
perl -0777 -ne '
  my $text = $_;
  my $blank = sub { my $c = shift; $c =~ s/[^\n]/ /g; $c };
  $text =~ s!/\*.*?\*/!$blank->($&)!gse;
  my $colour = qr/^(?:color|.*-color|background(?:-.*)?|border|border-(?:top|right|bottom|left|block|inline)(?:-start|-end)?|outline|fill|stroke|box-shadow|text-shadow|text-decoration|all)$/i;
  my $not_property = qr/^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|allow-discrete|normal)$/i;
  my $bad = 0;
  while ($text =~ /(?<![\w-])((?:-webkit-)?transition(?:-property)?)\s*:\s*([^;\x7b\x7d]*)(?=[;\x7d])/gi) {
    my ($property, $value, $at) = (lc $1, $2, $-[0]);
    my $line = 1 + (substr($text, 0, $at) =~ tr/\n//);
    next if $value =~ /^\s*(?:none|inherit|initial|unset|revert|revert-layer)\s*$/i;
    my $flat = $value;
    1 while $flat =~ s/([\w-]*)\([^()]*\)/ /;
    for my $item (split /,/, $flat) {
      my @names = grep { !/$not_property/ } ($item =~ /(?<![\w.-])(-?[a-zA-Z][\w-]*)/g);
      if ($property =~ /transition$/ && !@names) {
        print "$ARGV:$line: a transition with no property, which eases all, colour too; name the moving property, such as transform (\"Motion\" in docs/design-system.md)\n";
        $bad = 1;
        next;
      }
      for my $name (@names) {
        next unless $name =~ $colour;
        print "$ARGV:$line: \"$property\" eases $name; change colour at once and ease only movement, such as transform (\"Motion\" in docs/design-system.md)\n";
        $bad = 1;
      }
    }
  }
  exit $bad;
' "$FILE"
```

## Every :active has its [data-pressed] twin
only: *.css

Phone browsers apply `:active` to a finger only when it lifts, so
`press.mjs` sets `data-pressed` on the control under the pointer from
`pointerdown`, and the pressed look shows the moment a thumb lands. A
selector with `:active` and no `[data-pressed]` beside it shows the press
late on a phone. Put `[data-pressed]` in the same selector list as the
`:active`: inside the same `:where()` or `:is()`, or as another selector of
the same rule.

```css good
.server-tile:where(:active, [data-pressed], [data-preview="active"]) {
  background: var(--color-surface-subtle);
}
```

```css bad
.server-tile:active {
  background: var(--color-surface-subtle);
}
```

```sh
perl -0777 -ne '
  my $text = $_;
  my $blank = sub { my $c = shift; $c =~ s/[^\n]/ /g; $c };
  $text =~ s!/\*.*?\*/!$blank->($&)!gse;
  $text =~ s!"[^"\n]*"|\x27[^\x27\n]*\x27!$blank->($&)!ge;
  my $bad = 0;
  while ($text =~ /(?:^|[\x7b\x7d;])\s*\K([^\x7b\x7d;\@]*?):active\b[^\x7b\x7d;]*(?=\x7b)/g) {
    my ($start, $end) = ($-[0], $+[0]);
    my $prelude = substr($text, $start, $end - $start);
    my $pos = 0;
    while ($prelude =~ /:active\b/g) {
      my $at = $-[0];
      my ($depth, $open) = (0, -1);
      for (my $i = $at - 1; $i >= 0; $i--) {
        my $c = substr($prelude, $i, 1);
        if ($c eq ")") { $depth++ }
        elsif ($c eq "(") { if ($depth == 0) { $open = $i; last } $depth-- }
      }
      my $list = $prelude;
      if ($open >= 0) {
        my $d = 0;
        my $close = length $prelude;
        for (my $i = $open + 1; $i < length $prelude; $i++) {
          my $c = substr($prelude, $i, 1);
          if ($c eq "(") { $d++ }
          elsif ($c eq ")") { if ($d == 0) { $close = $i; last } $d-- }
        }
        $list = substr($prelude, $open + 1, $close - $open - 1);
      }
      next if $list =~ /\[data-pressed\]/;
      my $line = 1 + (substr($text, 0, $start + $at) =~ tr/\n//);
      print "$ARGV:$line: :active without [data-pressed]; add [data-pressed] to the same selector list, such as :where(:active, [data-pressed]), so a press shows when the finger lands\n";
      $bad = 1;
    }
  }
  exit $bad;
' "$FILE"
```
