# Cairn: hikebot's design system

A cairn is the stack of stones that marks a trail: small, built from simple
parts, there to show the way. Cairn is the design system of hikebot's web
pages: the principles, the tokens, the stylesheet, the page shell and the
components every page is built from. `/styleguide` shows all of it, drawn
with the real stylesheet; this document says why it is the way it is.

How to build with it is in `src/web/AGENTS.md`: "Build a page from the
design system", "Add a token" and "Add a component to the design system".

## Who it is for, and where

- **Members of a hiking group**, mostly on a phone, often outdoors or on the
  move: on a trailhead, on a bus, in a tent. They come from a link in
  Discord to see what is being planned, vote, and get out again. They read
  in sunlight and in the dark, with one hand, with patchy signal.
- **Organisers**, sometimes at a desk, who start and close votes and set the
  bot up. They need the same clarity with more on the page.
- **Everyone already knows the bot from Discord.** The web pages are the
  same bot in another place, not a new product: same words, same steps.

So the design is judged first at 390px wide, outdoors, in both colour
schemes, and only then on a desktop.

## Principles

1. **Wayfinding first.** Every page answers three questions at a glance:
   where am I, what state is the hike in, what can I do next. There is one
   primary action per view, and it looks like one.
2. **Quiet by default.** Calm neutral surfaces and plenty of space. Colour
   is reserved for state and for the one primary action, so that when
   something is coloured it means something.
3. **Legible outdoors.** High contrast, body text of at least 16px, targets
   of at least 44px. It works on a phone in sunlight and in a tent at night:
   the dark scheme is designed, not inverted.
4. **Honest states.** Open, closed, decided, cancelled and planned look
   different and say so in words. Nothing is conveyed by colour alone: a
   state has a word, and usually an icon, as well as a colour.
5. **The same words as the bot.** Labels match the Discord buttons and
   messages ("Vote", "Propose a location", "Start location vote", "Cancel
   round"), so a member never has to translate between the two.

## Visual direction

Hiking-themed through material and restraint, not decoration.

- **A palette from the trail.** Warm paper and sandstone for surfaces,
  granite greys with a green cast for text, pine green for actions, lake
  blue for links and information, and trail-blaze orange as the single
  accent. At night the paper becomes a dark forest floor, not black.
- **One confident sans-serif**, Public Sans, in three weights.
- **Two motifs, used sparingly:**
  - The **trail blaze**, the small painted rectangle that marks a path. It
    is the brand mark in the header, and it marks "you are here" (the
    current page in the navigation) and "winner". It is never decoration
    and never the only signal: the words next to it say the same.
  - **Contour lines**, a very low-contrast topographic pattern
    (`public/assets/cairn/contours.svg`, drawn in `--color-contour` at
    `--contour-opacity`) behind the page header, and for empty states.
- **Deliberately left out:** photos, illustrations, emoji, gradients for
  their own sake, drop shadows except on overlays, more than one accent
  colour, more than one typeface, italic as a style of its own (emphasis
  is weight), and animation that is not feedback.

## Tokens

Every colour, size, radius, duration and font is a CSS custom property in
`public/assets/cairn/tokens.css`, in the `tokens` cascade layer. Layout,
component and page CSS use tokens only; the test in
`test/web/token-use.test.ts` fails on a raw colour, size, duration or font
family there, and on a raw colour in any stylesheet but the tokens file or
in a `style`, `fill` or `stroke` attribute under `src/web/`.

Names are `--<group>-<role>[-<variant>]`: `--color-primary-hover`,
`--font-size-h2`, `--space-4`, `--radius-card`. Colour tokens name a role
(what it is for), never a hue, so the dark scheme can change the value
without changing the meaning.

### Colour

Light values are in `:root`; the `@media (prefers-color-scheme: dark)`
block replaces them for the dark scheme, and `color-scheme: light dark`
makes form controls and scroll bars follow. Every colour role has a dark
value.

| Token                    | Light     | Dark      | Role, and when to use it                                                                                       |
| ------------------------ | --------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `--color-bg`             | `#faf8f3` | `#121613` | The page: warm paper; at night a dark forest floor.                                                            |
| `--color-surface`        | `#ffffff` | `#1a1f1c` | Cards and anything that sits on the page as a thing of its own.                                                |
| `--color-surface-raised` | `#ffffff` | `#232a26` | Overlays (menus, dialogs, the skip link), with `--elevation-overlay`.                                          |
| `--color-surface-subtle` | `#efeae0` | `#252b26` | Sandstone: hover and pressed backgrounds, code, disabled controls, quiet panels.                               |
| `--color-text`           | `#1f2421` | `#e9ece7` | Body text and headings.                                                                                        |
| `--color-text-muted`     | `#566059` | `#a8b2ac` | Secondary text: meta, captions, the lead paragraph, the footer. Never for a control's label.                   |
| `--color-border`         | `#ddd6c8` | `#323b36` | Dividers and card edges: decoration, not a boundary anyone must see.                                           |
| `--color-border-strong`  | `#7d8781` | `#7a847e` | The boundary of a control (a secondary button, later inputs), at 3:1 or more.                                  |
| `--color-primary`        | `#1f5d45` | `#7cc4a0` | Pine. The one primary action's fill; the label of secondary and quiet buttons.                                 |
| `--color-primary-hover`  | `#174a37` | `#97d3b5` | The primary button under the pointer.                                                                          |
| `--color-primary-active` | `#103627` | `#b1e0c8` | The primary button while pressed.                                                                              |
| `--color-on-primary`     | `#ffffff` | `#0d1a13` | Text and icons on a primary fill.                                                                              |
| `--color-accent`         | `#d9541e` | `#f07f4a` | Trail-blaze orange: the blaze only (brand mark, "you are here", "winner"). Never text, never a fill for areas. |
| `--color-link`           | `#1d5e86` | `#8ec5ec` | Lake blue: links in running text.                                                                              |
| `--color-info`           | `#1d5e86` | `#8ec5ec` | Information: the info banner's icon and edge; status text.                                                     |
| `--color-info-subtle`    | `#e3edf3` | `#16252f` | The info banner's background.                                                                                  |
| `--color-success`        | `#2c6a35` | `#8acb92` | Success: done, decided, saved.                                                                                 |
| `--color-success-subtle` | `#e4f0e3` | `#17261a` | The success banner's background.                                                                               |
| `--color-warning`        | `#8a5300` | `#e9ba5b` | Warning: closing soon, needs attention.                                                                        |
| `--color-warning-subtle` | `#fbefd5` | `#2a2212` | The warning banner's background.                                                                               |
| `--color-danger`         | `#b3261e` | `#f4958c` | Errors, and actions that destroy or cancel.                                                                    |
| `--color-danger-hover`   | `#932019` | `#f7aca5` | The danger button under the pointer.                                                                           |
| `--color-danger-active`  | `#73190f` | `#fac3be` | The danger button while pressed.                                                                               |
| `--color-on-danger`      | `#ffffff` | `#1f0d0b` | Text and icons on a danger fill.                                                                               |
| `--color-danger-subtle`  | `#fbe7e4` | `#2e1816` | The danger banner's background.                                                                                |
| `--color-focus`          | `#1d5e86` | `#8ec5ec` | The focus ring, on every interactive element.                                                                  |
| `--color-contour`        | `#1f5d45` | `#7cc4a0` | The contour-line pattern, always at `--contour-opacity` (0.09 light, 0.12 dark).                               |

The text colours are granite greys with a green cast, so grey text sits in
the same family as the pine; the muted grey was darkened from the brief's
`#5c6661` to `#566059` to keep 5:1 or more on sandstone. The dark scheme
lifts pine and lake blue rather than inverting them, and puts dark text on
light-pine buttons, because white on a light fill fails.

#### Allowed pairings

A colour may only be drawn on a background in a pairing the system allows.
The pairings are listed in `PAIRINGS` in `src/web/tokens.ts`;
`test/web/contrast.test.ts` reads the values from `tokens.css` and checks
every pairing in both schemes, and `/styleguide#contrast` shows each with
its ratio. "Surfaces" are `bg`, `surface`, `surface-raised` and
`surface-subtle`.

| Pairing                                                                                                  | Minimum (WCAG 2.2 AA)   |
| -------------------------------------------------------------------------------------------------------- | ----------------------- |
| `text`, `text-muted`, `link`, `primary`, `danger`, `info`, `success`, `warning` as text on every surface | 4.5:1 (1.4.3)           |
| Headings (`text`) on every surface                                                                       | 3:1 (1.4.3, large text) |
| `on-primary` on `primary`, `primary-hover`, `primary-active`                                             | 4.5:1                   |
| `on-danger` on `danger`, `danger-hover`, `danger-active`                                                 | 4.5:1                   |
| `text` and `link` on each `*-subtle` banner background                                                   | 4.5:1                   |
| Each tone (`info`, `success`, `warning`, `danger`) on its `*-subtle` background                          | 3:1 (1.4.11, icon)      |
| `border-strong` on every surface (control boundary)                                                      | 3:1 (1.4.11)            |
| `primary` and `danger` fills on `bg` and `surface` (button boundary)                                     | 3:1 (1.4.11)            |
| `focus` on every surface (focus ring)                                                                    | 3:1 (1.4.11, 2.4.13)    |
| `accent` on every surface (the blaze)                                                                    | 3:1 (1.4.11)            |
| `info`, `success`, `danger` as text on their `*-subtle` background (status pills)                        | 4.5:1                   |
| `primary` on `surface-subtle` (the tally bar's fill on its track)                                        | 3:1 (1.4.11)            |

Every text pairing in fact clears 4.5:1, headings included; the 3:1
large-text minimum is the floor, not the target. Disabled controls are
exempt in WCAG but still use `text-muted` on `surface-subtle` (5:1 or more)
so they stay readable.

### Typography

#### The typeface: Public Sans

Five open-licence variable sans-serifs from `@fontsource-variable` were set
on the same specimen at phone size (390px wide, 16px body): a heading
("Where should we hike next?"), a date ("Voting closes Sat 12 Dec 2026,
18:00"), a paragraph, a three-row tally with tabular numbers, and the
characters `Il1 O0 rn m 3 5 6 8 9`. The specimens are in the pull request
that introduced Cairn.

| Candidate      | Latin wght woff2 | Weights | `Il1`    | `O0`     | Numerals                           |
| -------------- | ---------------- | ------- | -------- | -------- | ---------------------------------- |
| Figtree        | 20 KB            | 300–900 | I = l    | close    | proportional, `tnum` available     |
| Hanken Grotesk | 35 KB            | 100–900 | tailed l | distinct | always tabular: gappy "11" in text |
| Public Sans    | 27 KB            | 100–900 | tailed l | distinct | proportional, `tnum` available     |
| Inter          | 48 KB            | 100–900 | I = l    | close    | proportional, `tnum` available     |
| Source Sans 3  | 29 KB            | 200–900 | tailed l | distinct | always tabular; small x-height     |

Public Sans won on the criteria in order:

1. **Legibility at 16px:** a large x-height and open apertures; it was drawn
   for the US government's web design system, for exactly this job.
2. **Distinct letterforms:** the `l` has a tail, so `Il1` are three
   different shapes, and `0` is narrower than `O`. Location names and dates
   are read once, quickly, outdoors; Figtree and Inter (whose
   disambiguation features the Latin subset leaves out) draw `I` and `l`
   the same.
3. **Numerals:** proportional by default, so "11 votes" in a sentence does
   not gap, with tabular figures (`font-variant-numeric: tabular-nums`,
   `.u-numeric`) for tallies, tables and dates.
4. **Weight range:** 100–900 in one file, so the three weights cost nothing
   extra.
5. **File size:** 27 KB, less than Inter, Hanken Grotesk and Source Sans 3;
   only Figtree is smaller, and it failed on letterforms.

Public Sans is © The Public Sans Project Authors, under the **SIL Open Font
License 1.1** (`public/assets/fonts/public-sans-OFL.txt`). It comes from
the npm package `@fontsource-variable/public-sans` (a pinned
devDependency); the Latin `wght` subset is copied to
`public/assets/fonts/public-sans-<version>-latin-wght-normal.woff2`, served
from the Worker's own origin and preloaded by every page. Characters
outside the Latin subset (such as `ł` or `ő` in a location name) fall back
to the system font for those characters only.

#### Fallback with matched metrics

Until the font arrives (`font-display: swap`), text is set in a local font
scaled to Public Sans's average character width and vertical metrics,
computed with Capsize's metrics, so lines neither reflow nor jump when it
swaps:

- `"Cairn fallback"`: Arial or Helvetica, `size-adjust: 104.87%`,
  `ascent-override: 90.59%`, `descent-override: 21.46%`,
  `line-gap-override: 0%`.
- `"Cairn fallback Roboto"`: Roboto (Android), `size-adjust: 105.1%`,
  `ascent-override: 90.39%`, `descent-override: 21.41%`.

`--font-sans` is `"Public Sans Variable", "Cairn fallback", "Cairn fallback
Roboto", system-ui, sans-serif`. `--font-mono` is the system's monospace,
for code only.

#### Scale, weights and measure

Six sizes on a 16px base, each with its line height; a step is about 1.2
times the one below it. Line heights are on the 4px grid for body sizes.

| Token               | Size                   | Line height | Use                                         |
| ------------------- | ---------------------- | ----------- | ------------------------------------------- |
| `--font-size-h1`    | 28px to 36px (`clamp`) | 1.2         | The page title, one per page.               |
| `--font-size-h2`    | 24px                   | 32px        | Section headings.                           |
| `--font-size-h3`    | 20px                   | 28px        | Card titles, sub-sections, the brand.       |
| `--font-size-lead`  | 18px                   | 28px        | The sentence under a page title.            |
| `--font-size-body`  | 16px                   | 24px        | Everything else. Never smaller for reading. |
| `--font-size-small` | 14px                   | 20px        | Meta only: dates, counts, captions, footer. |

Weights: `--font-weight-regular` (400) for text, `--font-weight-semibold`
(600) for labels, buttons and emphasis, `--font-weight-bold` (700) for
headings. No other weights. `--measure` (68ch) caps running text;
`--letter-spacing-tight` (-0.01em) tightens the h1 and the brand, and
`--letter-spacing-wide` (0.04em) is for the style guide's glyph specimen.

### Space

A 4px base, eight steps. Related things sit one step apart, groups the next
step up; `.stack`, `.cluster` and `.grid` apply them.

| Token       | Value | Use                                                |
| ----------- | ----- | -------------------------------------------------- |
| `--space-1` | 4px   | Inside a line: an icon's gap to small text.        |
| `--space-2` | 8px   | Icon to label; tight stacks.                       |
| `--space-3` | 12px  | Between controls in a row.                         |
| `--space-4` | 16px  | The default gap; the phone gutter; button padding. |
| `--space-5` | 24px  | Card padding; the indent of lists.                 |
| `--space-6` | 32px  | Between blocks; the desktop gutter.                |
| `--space-7` | 48px  | Between sections.                                  |
| `--space-8` | 64px  | Above the footer on a desktop.                     |

### Radius, borders, focus and elevation

| Token                   | Value            | Use                                                                                          |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| `--radius-control`      | 8px              | Buttons, banners, inputs.                                                                    |
| `--radius-card`         | 12px             | Cards.                                                                                       |
| `--radius-pill`         | 999px            | Status pills and counts.                                                                     |
| `--radius-blaze`        | 2px              | The blaze, inline code.                                                                      |
| `--border-width`        | 1px              | Dividers, card edges, banners.                                                               |
| `--border-width-strong` | 2px              | Control boundaries.                                                                          |
| `--focus-width`         | 3px              | The focus ring.                                                                              |
| `--focus-offset`        | 2px              | The gap between an element and its focus ring.                                               |
| `--underline-offset`    | 0.2em            | Link underlines.                                                                             |
| `--elevation-overlay`   | two soft shadows | The one elevation: overlays only (menus, dialogs, the skip link). Nothing else has a shadow. |

### Motion

| Token                 | Value                        | Use                            |
| --------------------- | ---------------------------- | ------------------------------ |
| `--duration-quick`    | 120ms                        | Hover and press feedback.      |
| `--duration-moderate` | 240ms                        | Something appearing or moving. |
| `--easing-standard`   | `cubic-bezier(0.2, 0, 0, 1)` | All motion.                    |

Under `prefers-reduced-motion: reduce` both durations are `0ms`, so every
transition stops without each component handling it. Motion is feedback
only; nothing moves on its own.

### Layout and fixed sizes

| Token                             | Value                          | Use                                                                                                                              |
| --------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `--width-task`                    | 720px                          | The content width of a page that does one job (the default).                                                                     |
| `--width-overview`                | 1080px                         | Lists and dashboards (`Layout width="overview"`).                                                                                |
| `--gutter`                        | 16px, 32px from the breakpoint | Space between the content and the screen edge.                                                                                   |
| `--width-card-min`                | 216px                          | The narrowest a card gets in a `.grid` before it wraps.                                                                          |
| `--height-screen`                 | 100dvh                         | The shell's minimum height, so the footer stays at the bottom.                                                                   |
| `--target-min`                    | 44px                           | The smallest tap target, in both directions.                                                                                     |
| `--icon-size`                     | 20px                           | Icons next to body text.                                                                                                         |
| `--icon-size-small`               | 16px                           | Icons next to small text.                                                                                                        |
| `--blaze-width`, `--blaze-height` | 8px by 18px                    | The blaze.                                                                                                                       |
| `--width-date-leaf`               | 64px                           | The hike card's calendar leaf: room for a two-digit day at h2 size and "Wed" or "Sep" in small semibold, with space either side. |

The one breakpoint is **48rem (768px)**, written out in media queries
because they cannot read custom properties. Below it there is a single
column; above it the gutters and the space above the content grow.
`--width-index`, `--width-swatch`, `--width-pair`, `--width-pair-sample`,
`--width-shape` and `--width-scale-label` size the style guide's own grids
and are used nowhere else.

## The stylesheet

Plain CSS, no framework, no preprocessor, no build step. A page links one
file, `public/assets/cairn/cairn.css`, which:

1. names the cascade layers in order: `reset, tokens, base, layout,
components, utilities`. A later layer wins over an earlier one whatever
   the selectors' specificity, so a utility always wins and a component
   never fights the base;
2. imports `tokens.css` into `tokens`, `layout.css` into `layout`, and one
   file per component (`components/<name>.css`) and per page that needs its
   own styles (`pages/<name>.css`) into `components`, one `@import` line
   each, in alphabetical order;
3. declares the typeface and its fallbacks, and holds the reset, the base
   element styles and the utilities.

**One file per component**, rather than sections of one file, so that the
tasks that add components at the same time never edit the same lines: a
new component adds a new file and one `@import` line, and alphabetical
order spreads those lines apart. The imports cost one extra round trip
after `cairn.css`, in parallel, on a connection already open; the files
are small and cached for a year.

**Caching.** Pages link the stylesheet at
`/assets/v/<version>/cairn/cairn.css`, where `<version>` is the deployed
Worker version's id (`CF_VERSION_METADATA`). The stylesheet's relative
`@import`s and `url()`s resolve under the same path, and the Worker answers
every `/assets/v/<version>/...` path with the file from `public/assets/`
and `Cache-Control: public, max-age=31536000, immutable`. A deploy changes
every URL, so a browser never keeps an old file, and between deploys it
never asks again. A path naming another version, as a page rendered by the
other version asks for during a gradual deploy, gets the current files with
the five-minute caching only. The plain `/assets/...` paths keep the five-minute
caching of `public/_headers`.

### Class names

Block, element, modifier, in lower case with hyphens:

- A **component** is a block named after it: `.button`, `.banner`,
  `.card`. Its parts are `__part` (`.card__title`), its variants
  `--variant` (`.button--primary`).
- **States** come from the platform, not classes: `:hover`, `:active`,
  `:focus-visible`, `:disabled`, `[aria-disabled="true"]`,
  `[aria-current="page"]`. `[data-preview="hover|active|focus"]` shows a
  state on the style guide only.
- **Layout** classes name the arrangement: `.shell` and its parts,
  `.stack`, `.cluster`, `.grid`, `.page-heading`, `.list-reset`.
- **Page** styles are blocks named after the page: `.styleguide-swatch`.
- **Utilities** start with `u-`: `.u-visually-hidden`, `.u-muted`,
  `.u-small`, `.u-lead`, `.u-numeric`.

## The page shell

`Layout` in `src/web/layout.tsx` is the document every page renders into:

- the `<head>`: language, viewport, title, the preloaded font and the
  stylesheet;
- a **skip link**, the first focusable element, hidden until focused, to
  `<main id="main" tabindex="-1">`;
- the **header**: the brand mark (blaze and "hikebot", linking home) on
  the contour pattern, then room for navigation (`nav`, a `<ul>` of links
  with the current one marked `aria-current="page"`, which draws a blaze
  under it) and for the signed-in member (`user`);
- **main**, at the task width or, with `width="overview"`, the overview
  width;
- the **footer**: the project link and the style guide.

Content placed straight into `main` gets `--space-4` between blocks; pages
normally lay themselves out with `.stack`. A page that only says what
happened and offers one way on (the 404 and 405 pages, the sign-in
outcomes, a refused form) is a `MessagePage` (`src/web/pages/message.tsx`):
an optional eyebrow such as "Error 404", the title, a lead sentence and one
primary button.

## Components

Each component is a typed Preact component in `src/web/components/`, with
its styles in `public/assets/cairn/components/`, its unit test in
`test/web/components/` and its style guide section in
`src/web/pages/styleguide/`, one file each. In alphabetical order:

- **Banner** (`banner.tsx`): a message about the page or what just
  happened, in four tones: `info` and `success` (`role="status"`),
  `warning` and `danger` (`role="alert"`). The tone is said by the icon's
  shape, the icon's name ("Warning") and the title's words, then repeated
  in colour. The title is its accessible name.
- **Blaze** (`blaze.tsx`): the trail blaze. Decorative, or with a `label`
  ("Winner") an image named by it; the words next to it must say the same.
- **Button** (`button.tsx`): `primary` (the one main action), `secondary`
  (other actions), `quiet` (minor ones in a row), `danger` (destroys or
  cancels). A `<button>` (submitting its form by default, since pages work
  without JavaScript) or, with `href`, an `<a>` that looks the same. States:
  default, hover, focus-visible, active and disabled (a disabled link drops
  its `href`). An optional icon before or after the label; `block` fills
  the width.
- **Card** (`card.tsx`): one thing on a surface of its own, named by its
  heading (level 2 to 4). With `href` the heading's link covers the card,
  which gets hover, active and focus states; links and buttons in its
  footer stay separately clickable.
- **Empty state** (`empty-state.tsx`): what a page or section shows when
  it has nothing yet.
  - _Purpose_: say there is nothing, why, and what happens next, so an
    empty page is never a dead end.
  - _Anatomy_: a `<section>` named by its heading (level 2 to 4), one
    sentence on what happens next in the bot's words ("The first one
    appears here when a date vote closes."), an optional action, on the
    contour-line pattern inside a dashed `border-strong` edge.
  - _Variants_: without an action; with one action (one `Button`, primary
    when it is the page's main action).
  - _States_: none of its own; the action has the button's.
  - _Do_: use it for "no vote open", "no hikes yet", "no options yet". _Don't_:
    use it for errors (a `Banner`), put more than one action in it, or use
    the contour pattern anywhere else in a page's body. The text sits on
    the page colour plus the pattern's tint; `test/web/contrast.test.ts`
    checks text, muted text, the button and focus ring against a contour
    line in both schemes.
- **Hike card** (`hike-card.tsx`): one planned or past hike.
  - _Purpose_: when and where a hike is, and the way to everything about
    it (thread, event, calendar, map), at a glance.
  - _Anatomy_: an `<article>` named by its heading, the location. The
    date block: a calendar leaf (weekday, day, month; hidden from screen
    readers, which read the line beside it) and a line with the bot's date
    label ("Sat, 5 Dec 2026 · 11:00") in a `<time>` and the server's time
    zone. Then the state (the `Planned` status pill, or "Past hike"), the
    details, "Proposed by", room for a small map picture (`picture`), and a
    row of links, each with an icon and a 44px target: Hike thread, Hike
    event, Calendar, Map, shown only when given.
  - _Variants_: `full` (details, proposer, picture) for a hike's page or
    the planned hike on a server's page; `compact` (headline and links
    only) for lists such as the hike log. `upcoming` has a pine leaf,
    `past` a sandstone one with muted figures.
  - _States_: the links' own (hover, focus, active).
  - _Do_: pass the date and time as the server's wall clock with its time
    zone, as the bot shows them. _Don't_: reformat the bot's date label,
    or leave a link in that has nowhere to go (leave it out).
- **Icons** (`icon.tsx`, `icons.tsx`): stroke icons on a 24-unit grid with
  a 2-unit round stroke in the current text colour, at 20px or 16px. They
  are the shapes of **Lucide** (lucide.dev) 1.75.0, under the **ISC
  licence**, whose notice is in `icons.tsx`. Decorative (`aria-hidden`)
  unless given a `label`, which names them.
- **Round stepper** (`round-stepper.tsx`): where a hike round is.
  - _Purpose_: the page's "where are we": which of the round's steps are
    done, which is now and which are to come.
  - _Anatomy_: an `<ol>` named "Hike round" with three steps (Location vote,
    Date vote, Hike planned), each a marker, its name and its state in
    words, joined by a line drawn in the success colour as far as the
    round has got.
  - _Variants_: at the location vote, at the date vote (also while the
    date vote is still to be started), the hike planned (every step done);
    cancelled at the location vote or the date vote.
  - _States_ of a step: **Done** (a check, success colour), **Now** (the
    blaze, with `aria-current="step"`), **To come** (an open dashed
    circle), **Cancelled** (a cross, danger colour, also
    `aria-current="step"`) and **Not reached** (after a cancelled step).
    The planned step, reached, is "Done" with the blaze. A screen reader
    hears "Date vote, Now, current step".
  - _Do_: put one near the top of a round's page. _Don't_: use it for
    anything but a round, or rely on the marker's colour: the word is the
    state.
- **Status pill** (`status-pill.tsx`): a state in one word with an icon.
  - _Purpose_: the honest state of a vote, round or hike, in the bot's
    words.
  - _Anatomy_: a pill (`--radius-pill`) with an icon and the word, in
    small semibold text. The word is the accessible text; the icon is
    decorative.
  - _Variants_: **Open** (vote icon, info colours), **Closed** (lock,
    neutral), **Decided** (check in a circle, success colours), **Planned**
    (calendar with a check, filled pine: the one filled pill, for the end
    of a round), **Cancelled** (cross in a circle, danger colours).
  - _States_: none; it is not interactive.
  - _Do_: put it next to the heading of what it describes. _Don't_: make it
    a link or a button, or invent a state the bot does not have.
- **Tally list** (`tally-list.tsx`): every option of a vote.
  - _Purpose_: the whole vote at a glance, up to 25 options, readable on a
    phone.
  - _Anatomy_: the bot's voter line ("No one has voted yet.", "1 member
    has voted.", "14 members have voted."), then an `<ol>` named by `label`
    ("Locations", "Dates") of tally rows divided by hairlines, not boxed,
    so the labels and counts form two columns the eye runs down.
  - _Variants_: open and closed (with the winner and the tie note on the
    winning row); with no options it shows the `empty` sentence, such as
    "There are no locations to vote for yet. Propose one first."; past six
    options every row's details fold behind "Details", so 25 rows stay
    scannable.
  - _States_: the rows' own.
  - _Do_: keep the bot's order (locations by votes, dates by date). _Don't_:
    sort it differently from Discord, or page it: 25 is the most a vote
    holds.
- **Tally row** (`tally-row.tsx`): one option of a vote.
  - _Purpose_: what the option is, how it is doing, and whether it is the
    viewer's vote or the winner.
  - _Anatomy_: the label (semibold) and the count in tabular figures ("7
    votes", "1 vote") on one line; a bar (a native `<meter>`, hidden from
    screen readers, which read the count) whose full length is the members
    who voted; the marks **Winner** (with the blaze) and **Your vote**
    (with a check); the tie note, in the bot's words ("3 options tied with
    4 votes each; the winner was drawn at random."); the details; "Proposed
    by" and the name ("hikebot" for the bot's own). Date options have no
    proposer.
  - _Variants_: open or closed; winner, winner from a tie; with the details
    shown or folded behind a "Details" disclosure (a native `<details>`
    whose summary is a 44px target named "Details of <label>"); votable
    (`choice`, below).
  - _States_: no votes (an empty bar), one vote, the viewer's vote, the
    winner; the disclosure's open, hover and focus.
  - _Do_: pass the label, details and proposer as they are; they are
    rendered as text, so markup or Markdown in them shows as typed. Long
    words and links wrap. _Don't_: colour a row to mark the winner or the
    viewer's vote: the marks say it in words.
- **Tally vote** (`tally-vote.tsx`): the votable form of a tally.
  - _Purpose_: vote on the web as with the bot's Vote button, without
    JavaScript.
  - _Anatomy_: a `<form method="post">` holding the caller's hidden fields
    (the CSRF token), a `<fieldset>` whose legend is the bot's instructions
    ("Vote for every location you would go to; you can change your votes
    until the vote closes."), the tally list with each row's label as a
    real checkbox's `<label>` (checked for the saved votes, described by
    the row's count), and one primary **Vote** button right after the
    list. It does not stick to the foot of the screen: a sticky bar sits
    over the top of the list until the list is scrolled to, and the list
    stays short enough (details folded past six options) to reach the
    end. The form sends every checked option's id under one name, so the route
    replaces the member's votes with them, as the bot's select does.
  - _Variants_: with options; with none it is no form, only the `empty`
    sentence.
  - _States_ of a row: not voted, voted (checked), hover (the label in pine
    and underlined), focus visible (the ring on the checkbox). The
    checkbox is styled here, as part of the row: the native control at
    `--icon-size` in `accent-color: var(--color-primary)`, inside a label
    at least `--target-min` tall that is the whole tap target. The row's
    "Your vote" mark is left out, since the checkbox shows it.
  - _Do_: put the CSRF field in `hidden`. _Don't_: submit on change (it
    would need JavaScript), or add a second Vote button.

## Layout rules

- **One column on a phone.** Content runs the full width less the gutter.
  Nothing scrolls sideways at 390px: long words wrap
  (`overflow-wrap: break-word`), tables scroll inside their own box, grids
  collapse to one column.
- **Two widths on a desktop**: 720px for a page that does one job, 1080px
  for overviews. Running text stops at 68 characters whatever the width.
- **Spacing from the scale** through `.stack` (vertical; `--tight`,
  `--loose`, `--section`), `.cluster` (a wrapping row) and `.grid` (cards
  side by side, one column on a phone). A page's structure: the
  `.page-heading` (eyebrow, h1, lead), then sections `--space-7` apart.
- **The primary action** sits right after what it acts on, never at the
  bottom of a long page only; on a phone it may fill the width
  (`block`).

## Accessibility rules

Cairn meets WCAG 2.2 AA:

- **Contrast**: text 4.5:1, large text 3:1, control boundaries, the focus
  ring and meaningful graphics 3:1, in both schemes, for every pairing in
  "Allowed pairings", enforced by `test/web/contrast.test.ts`.
- **Targets**: every interactive element is at least 44 by 44px
  (`--target-min`), links in running text excepted (2.5.8 allows inline
  links).
- **Focus**: every interactive element shows a 3px `--color-focus` ring
  2px outside it on `:focus-visible`; nothing removes an outline without
  drawing another. Focus order follows the reading order; the skip link
  comes first.
- **Headings** go in order without skipping a level: one h1 per page, then
  h2, then h3. A card's heading level follows the page's outline.
- **Not by colour alone**: states, tones and the blaze always come with
  words, and usually an icon.
- **Names**: every control has a visible label that is also its accessible
  name; icons that carry meaning on their own have a `label`.
- **Motion** stops under `prefers-reduced-motion` (the duration tokens
  become 0ms).
- **Zoom and reflow**: sizes are in `rem`, so text follows the browser's
  font size; at 320 CSS pixels wide nothing is cut off.
- **Forced colours**: buttons have transparent borders, which forced-colour
  modes draw, and the blaze draws itself as a border there.

## Content rules

- **Plain words.** Short sentences a member reads at a glance. "There is
  no page at this address", not "404 resource not found".
- **Sentence case** everywhere: headings, buttons, labels, titles.
- **Verbs on buttons**, naming what happens: "Vote", "Go to the home
  page", not "OK" or "Submit".
- **The bot's vocabulary.** Use the words of the Discord buttons and
  messages for the same things: "Vote", "Propose a location", "Propose a
  date", "New location", "Start location vote", "Start date vote", "Cancel
  round", "Back", "Settings". A location vote and a date vote; a round; an
  organiser; a hike thread.
- **States in words**: open, closed, decided, cancelled, planned.
- **No emoji, no exclamation marks**, no jokes in error messages.
- **Numbers** as digits, with tabular figures in tallies and tables;
  dates as the bot shows them.

## Size budget

`test/web/size-budget.test.ts` fails when an asset outgrows its budget:

| What                                            | Budget | Now         |
| ----------------------------------------------- | ------ | ----------- |
| The font file                                   | 32 KB  | 27 KB       |
| All stylesheets, each gzipped, together         | 20 KB  | about 10 KB |
| The contour pattern                             | 12 KB  | 9 KB        |
| Everything a page loads from Cairn, transferred | 64 KB  | about 41 KB |

## Designing a new page

1. **Who and where.** Write down who opens the page, on what device, and
   what they came to do. Design it at 390px first.
2. **Answer the three questions.** Where am I (the h1 and the eyebrow),
   what state is the hike in (in words, with a banner or a status), what
   can I do next (one primary button).
3. **Build from the parts.** `Layout` at the task width unless it is an
   overview; `.page-heading`; `.stack` sections; existing components. A new
   look is a new component in the design system, not page CSS.
4. **Use tokens only**, and only the pairings in "Allowed pairings".
5. **Write it in the bot's words**, in sentence case, with verbs on
   buttons.
6. **Check every state**: empty, one item, many items (25), a 100-character
   name, an error, disabled, signed out.
7. **Check accessibility**: heading order, focus order and visibility,
   44px targets, nothing by colour alone, no sideways scrolling.
8. **Look at it** in both schemes at both sizes, as "Review your own UI
   change as a designer" in `src/web/AGENTS.md` says.
