# Cairn: hikebot's design system

A cairn is the stack of stones that marks a trail: small, built from simple
parts, there to show the way. Cairn is the design system of hikebot's web
pages: the principles, the tokens, the stylesheet, the page shell and the
components every page is built from. `/styleguide` shows all of it, drawn
with the real stylesheet (a component whose examples would make that page
too tall to screenshot has a page of its own at `/styleguide/<id>`, linked
from its index); this document says why it is the way it is.

How to build with it is in `src/web/AGENTS.md`: "Build a page from the
design system", "Add a token" and "Add a component to the design system".
The map picture is part of it too: "Cairn map" below.

Cairn's method (the question, the presence test, the build order, honest
feedback and the review rubric) is adapted from the design system of viz,
in `design-system/` on the `claude/cloudflare-observability-platform-ibaqya`
branch of `by77er/viz`.

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

1. **Start from the question.** Every page, and every change to one,
   begins with one sentence: who is looking, and what they are trying to
   find out or do ("Method" below). The page is judged against that
   sentence, not against taste.
2. **Wayfinding first.** Every page answers three questions at a glance:
   where am I, what state is the hike in, what can I do next. There is one
   primary action per view, and it looks like one.
3. **Each element answers a question.** An element stays only if it
   answers a question for the person in the sentence that nothing else on
   the screen answers (the presence test, "Method" below). That goes for
   eyebrows, leads, icons, helper text, rules and empty space as much as
   for cards and buttons. Calm comes from what is left out, so colour is
   kept for state and for the one primary action, and when something is
   coloured it means something.
4. **Legible outdoors.** High contrast, body text of at least 16px, targets
   of at least 44px. It works on a phone in sunlight and in a tent at night:
   the dark scheme is designed, not inverted.
5. **Every input answers in the next frame, and every answer is true.** A
   tap shows as pressed at once, with a finger as with a mouse, and a vote
   or a proposal that takes a moment on a trailhead's signal shows it is
   busy. Anything that describes data describes the data on the screen: a
   forecast or a tally says how old it is, and that age is the age of what
   is shown ("States").
6. **Honest states.** Open, closed, decided, cancelled and planned look
   different and say so in words. Nothing is conveyed by colour alone: a
   state has a word, and usually an icon, as well as a colour.
7. **The same words as the bot.** Labels match the Discord buttons and
   messages ("Vote", "Propose a location", "Start location vote", "Cancel
   round"), and one event has one time on the page, in the Discord message
   and on the event, so a member never has to translate between the two.

## Method

How to design a page, or a change to one, so that it can be reviewed
against Cairn. "Designing a new page" below is the same method as a
checklist; "Review your own UI change as a designer" in `src/web/AGENTS.md`
is the review that judges by it.

### Start from the question

Write one sentence: who is looking, and what they are trying to find out or
do. "Who it is for, and where" names the people; the sentence picks one of
them, the place they are in and the one job:

- "A member who tapped the link in the vote's Discord message, on their
  phone, wants to see which places are in the location vote and vote for
  the ones they would go to."
- "A member on the bus on the morning of the hike wants to know where to
  meet, at what time, and whether it will rain."
- "An organiser at a desk wants to close the date vote and see that the
  hike is planned."

Every later decision is checked against the sentence. If you cannot write
it, the page is not ready to design. It goes at the top of the pull
request's design review, and the reviewer judges the page by it.

### The presence test

For each element on the screen, from largest to smallest (a section, a
card, a heading, a line of text, an icon, a rule, a gap):

1. What question does it answer for the person in the sentence?
2. Is that question already answered by something else on the screen?
3. If it went, what would they be unable to do or know?

An element with no answer to 1, a yes to 2, or "nothing" to 3 is removed.
Eyebrows, leads, icons, helper text, rules and empty space are elements
too. An eyebrow "Location vote" above a card headed "Location vote" answers
nothing the heading does not; a helper line "Optional" under a label that
already says "(optional)" is said twice; the Discord mark on "See the vote
in Discord" stays, because it says where the button goes faster than the
words. Write the answers down, one row per element (the presence table):
this test, not a feeling of "remove what you don't need", is how a page is
judged.

### Build order

1. **Real words and real numbers.** The bot's words, real place names, and
   dates and figures of the kind the bot posts, with their units ("6.7
   miles round trip", "4 votes", "Sat, 5 Dec 2026 · 09:00"). No placeholder
   text. For a flow across several pages and Discord messages, fix one set
   of times and numbers first, so every screen says the same.
2. **Hierarchy with type and space only.** Heading levels, weights and the
   space scale, until the reading order is right in greyscale: name the
   first three things the eye should reach, in order, and check them on a
   greyscale copy of the screenshot.
3. **Structure.** Cards, rules and surfaces, only where grouping is still
   unclear without them.
4. **Colour last.** The one primary action, then state (status pills,
   banners), then the blaze where it marks "you are here" or "winner".
5. **Every state** of every element and every data view ("States").
6. **The second scheme.** Look at dark on its own; it is designed, not
   assumed.
7. **Phone and 200% zoom.** 390px with a finger: targets of 44px, nothing
   sideways, nothing that needs hover, the main path a button or a
   standalone link. Then the desktop at 200% zoom.

### Nothing that marks generated work

No gradient heroes, no emoji bullets, no pill badges on everything (the
status pill marks the one state of a vote, round or hike), no card with a
coloured edge for decoration (an edge on a banner or a form in error marks
a state its words also say), no eyebrow above every heading, and nothing
centred for its own sake: text is left-aligned. Cairn's eyebrow stays only
where the presence test keeps it, such as a page whose h1 is a name and
whose eyebrow says what kind of page it is.

### Measure what can be measured

What a measurement can decide is measured, not judged from a picture.
Each checkable rule below says how a review measures it, and which kind of
automated check it belongs in: a test in `npm test`, an Undercurrent rule
(a check on the changed files), or a page audit (a browser run over every
page at each size, scheme, pointer and zoom). A rule whose automated check
is not in the repository is measured by hand in the review, as its middle
column says, and the review says so.

| Rule                                                       | Measured in a review by                                                                                                                                                                                                                                                                              | Automated check it belongs in                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Text, controls and the focus ring meet the contrast floors | `test/web/contrast.test.ts`, in `npm test`, for every pairing in "Allowed pairings" in both schemes.                                                                                                                                                                                                 | That test.                                                            |
| Only tokens in component and page CSS                      | `test/web/token-use.test.ts`, in `npm test`.                                                                                                                                                                                                                                                         | That test.                                                            |
| No colour is eased                                         | `test/web/press-states.test.ts`, in `npm test`: every `transition` in Cairn's stylesheets names only `opacity` or `transform`, with a property list; `test/e2e/press-browser.test.ts` reads every element's computed transition on the server's page and the style guide, with a mouse and a finger. | That test, an Undercurrent rule on the stylesheets, and a page audit. |
| A press shows at once, with a finger as with a mouse       | `test/web/press-states.test.ts`: every `:active` has its `[data-pressed]` twin; `test/e2e/press-browser.test.ts`: a finger on "Save votes" shows the pressed fill before it lifts. Other controls by hand, with touch emulation at 390px.                                                            | Those tests, and a page audit.                                        |
| A submit that takes time shows it is busy                  | `test/e2e/press-browser.test.ts`: after the tap, "Save votes" has `aria-busy` and the pressed fill, and a second press sends nothing. Other forms by hand, on a throttled network.                                                                                                                   | That test, and a page audit.                                          |
| The main path is not a link inside a sentence              | `npm run screenshots:audit`, check `inline-main-path`: the primary action (`.button--primary` or `[data-main-path]`) is not a link inside a sentence; and checking that the thing the question sentence is about is that action.                                                                     | The page audit (`test/screenshots/audit.ts`).                         |
| Numbers people compare are tabular and right-aligned       | Reading the component's CSS for `tabular-nums` and the screenshot for the alignment.                                                                                                                                                                                                                 | An Undercurrent rule on the component stylesheets, and a page audit.  |
| Every target is at least 44 by 44px, with no overlap       | `npm run screenshots:audit`, checks `target` (at 390px, fine and coarse pointer) and `overlap`.                                                                                                                                                                                                      | The page audit.                                                       |
| Nothing scrolls sideways and no word is cut                | `npm run screenshots:audit`, checks `overflow` and `cut`, at 320px, 390px (fine and coarse pointer), 1280px and at 200% zoom.                                                                                                                                                                        | The page audit.                                                       |
| Layout shift stays under 0.05                              | `npm run screenshots:audit`, check `shift`, loading each page in every configuration.                                                                                                                                                                                                                | The page audit.                                                       |
| Ages and durations are written one way                     | Reading the page's words against "Content rules".                                                                                                                                                                                                                                                    | An Undercurrent rule on `src/web/` ("0 s ago", minutes as "m").       |

### What Cairn did not take from viz

viz shows system data to engineers at desks; Cairn shows a hiking group's
plans to members on phones outdoors. So Cairn keeps its own look: its warm
palette (paper, pine, blaze) rather than viz's true greys and four action
colours, because a calm warm page with one accent reads better in sunlight
and keeps colour for state; Public Sans alone rather than Schibsted
Grotesk and JetBrains Mono, because tabular figures give Cairn's few
compared numbers what a mono gives viz's many; its cards rather than viz's
rule-topped panels with no box, because a card groups one vote or one hike
for a thumb on a small screen; and none of viz's charts or dashboards,
which a hiking group's pages do not have.

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
| `--color-discord-mark`   | `#ffffff` | `#000000` | Discord's mark on Sign in with Discord: exactly white or black, as Discord's brand guidelines allow.           |
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
| `discord-mark` on `primary`, `primary-hover`, `primary-active` (Discord's mark)                          | 3:1 (1.4.11, graphic)   |
| `on-danger` on `danger`, `danger-hover`, `danger-active`                                                 | 4.5:1                   |
| `text` and `link` on each `*-subtle` banner background                                                   | 4.5:1                   |
| Each tone (`info`, `success`, `warning`, `danger`) on its `*-subtle` background                          | 3:1 (1.4.11, icon)      |
| `border-strong` on every surface (control boundary)                                                      | 3:1 (1.4.11)            |
| `primary` and `danger` fills on `bg` and `surface` (button boundary)                                     | 3:1 (1.4.11)            |
| `primary` on `bg` and `surface` (a checked box, a chosen radio)                                          | 3:1 (1.4.11)            |
| `danger` on `bg` and `surface` (the boundary and side bar of a field in error)                           | 3:1 (1.4.11)            |
| `focus` on every surface (focus ring)                                                                    | 3:1 (1.4.11, 2.4.13)    |
| `accent` on every surface (the blaze)                                                                    | 3:1 (1.4.11)            |
| `info`, `success`, `danger` as text on their `*-subtle` background (status pills)                        | 4.5:1                   |
| `primary` on `surface-subtle` (the tally bar's fill on its track)                                        | 3:1 (1.4.11)            |

Every text pairing in fact clears 4.5:1, headings included; the 3:1
large-text minimum is the floor, not the target. Disabled controls are
exempt in WCAG but still use `text-muted` on `surface-subtle` (5:1 or more)
so they stay readable.

Form controls use only these pairings, on `bg` and `surface`: a control's
boundary is `border-strong` (3:1), its label and typed text `text`, its hint
and limit `text-muted` and its error `danger` (4.5:1 as text), a field in
error has a `danger` boundary and side bar (3:1), and a checked box is a
`primary` fill with an `on-primary` tick. The contrast test checks each of
them in both schemes ("cover the form controls" in
`test/web/contrast.test.ts`).

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

| Token                 | Value                        | Use                                                          |
| --------------------- | ---------------------------- | ------------------------------------------------------------ |
| `--duration-quick`    | 120ms                        | A short movement, such as a chevron turning; never a colour. |
| `--duration-moderate` | 240ms                        | Something appearing or moving.                               |
| `--easing-standard`   | `cubic-bezier(0.2, 0, 0, 1)` | All motion.                                                  |

The rules for motion hold for every stylesheet; a stylesheet that breaks
one is a finding in the review of a change to it.

- **A press and a hover change in the next frame, with no transition.**
  A member who taps "Save votes" on a trailhead is to see it pressed at
  once, not 120ms later.
- **No colour is ever eased.** A transition names only `opacity` or
  `transform`: never a colour, a background, a border colour, a
  shorthand that holds one, or `all`, and never a duration without a
  property list (which eases `all`). An eased colour also shows the old
  scheme for a moment when the device turns dark. How it is measured:
  "Measure what can be measured".
- **Motion moves opacity and position only**, as feedback to something
  the member did. Nothing loops, pulses or moves on its own. Data never
  animates into place: a tally bar is drawn at its length, a count is
  drawn at its value.
- **Reduced motion removes transitions.** Under
  `prefers-reduced-motion: reduce` both durations are `0ms`, so every
  transition stops without each component handling it.

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
| `--width-vote-word`               | 40px                           | The word after a tally's count ("votes" in small text), so the counts of "1 vote" and "4 votes" line up on the right.            |
| `--avatar-size`                   | 48px                           | An avatar or server icon in a list, such as a server tile.                                                                       |
| `--avatar-size-small`             | 32px                           | The user's avatar in the header.                                                                                                 |
| `--width-tile-min`                | 288px                          | The narrowest a server tile gets in its grid before it wraps.                                                                    |
| `--width-header-name`             | 128px                          | The most of the user's name the header shows before "…".                                                                         |
| `--width-menu`                    | 256px                          | The user menu's panel (narrower on a narrow screen).                                                                             |
| `--choice-size`                   | 24px                           | The box of a checkbox and the circle of a radio.                                                                                 |
| `--width-input-short`             | 200px                          | A text field for a short value, such as a date (`--short`).                                                                      |

`--choice-size` is 24px rather than the 20px of an icon: a box drawn at
the body's line height is easy to see in sunlight and to aim at, and it
still sits inside the 44px row that is the real target (the label covers
the box's column). `--width-input-short` is 200px so that the longest
value the bot takes in a short field, a date with a time
(`2026-12-05 09:00`, 16 characters), fits with the padding, and the field's
width says how much is expected; anything longer gets the full width.

The one breakpoint is **48rem (768px)**, written out in media queries
because they cannot read custom properties. Below it there is a single
column; above it the gutters and the space above the content grow.
`--width-index`, `--width-swatch`, `--width-pair`, `--width-pair-sample`,
`--width-shape`, `--width-scale-label`, `--width-map-sample` and
`--width-map-swatch` size the style guide's own grids and are used nowhere
else.

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
  `[aria-current="page"]`, and the two the press script sets ("States"):
  `[data-pressed]` (the press, from the touch on) and `[aria-busy="true"]`
  (a submit on its way). `[data-preview="hover|active|focus"]` shows a
  state on the style guide only.
- **Layout** classes name the arrangement: `.shell` and its parts,
  `.stack`, `.cluster`, `.grid`, `.page-heading`, `.list-reset`.
- **Page** styles are blocks named after the page: `.styleguide-swatch`.
- **Utilities** start with `u-`: `.u-visually-hidden`, `.u-muted`,
  `.u-small`, `.u-lead`, `.u-numeric`, `.u-target` (a link standing alone
  on a small line, at least 44px high and wide).

## The page shell

`Layout` in `src/web/layout.tsx` is the document every page renders into:

- the `<head>`: language, viewport, title, the preloaded font, the
  stylesheet and the press script (`press.mjs`, a module, so it runs after
  the page is parsed; pages work without it, "States");
- a **skip link**, the first focusable element, hidden until focused, to
  `<main id="main" tabindex="-1">`;
- the **header**, the App header component: the brand mark (blaze and
  "hikebot", linking home) on the contour pattern, then room for the
  server the page is about (`context`), for navigation (`nav`, a `<ul>` of
  links with the current one marked `aria-current="page"`, which draws a
  blaze under it) and for the signed-in member's menu (`user`);
- **main**, at the task width or, with `width="overview"`, the overview
  width;
- the **footer**: the project link and the style guide.

Content placed straight into `main` gets `--space-4` between blocks; pages
normally lay themselves out with `.stack`. A page that only says what
happened and offers one way on (the 404 and 405 pages, the sign-in
outcomes, a refused form) is a `MessagePage` (`src/web/pages/message.tsx`):
the title, a lead sentence and one primary button (an optional eyebrow
only where the presence test keeps one; the error pages have none, as
"Page not found" says what "Error 404" would).

## Components

Each component is a typed Preact component in `src/web/components/`, with
its styles in `public/assets/cairn/components/`, its unit test in
`test/web/components/` and its style guide section in
`src/web/pages/styleguide/`, one file each. In alphabetical order:

- **Age** (`age.tsx`): how old a piece of data on the page is, in the
  words of "Content rules" ("just now", "14 min ago", "3 h ago", from a day
  on "Thu, 3 Dec 2026 · 07:00"), after a verb the page writes ("Updated",
  "Counted"). A `<time datetime>` holding the instant, written by the
  server (`ageText` in `src/web/age.ts`) and rewritten every 15 seconds by
  `public/assets/cairn/ages.mjs`, which it loads, so the words stay true
  on a page left open; without JavaScript they stay as served. It has no
  style of its own and no style guide section: its words depend on the
  clock, so it is seen on the server page's screenshots (the forecast's
  "Updated 14 min ago", the tally's "Counted just now"), where the clock
  is frozen.
- **App header** (`app-header.tsx`, its own style guide page): the band at
  the top of every page, which `Layout` renders. The brand mark links home;
  then the server a page is about (`context`; on a phone a row of its own
  under the brand) and the navigation (`nav`); at the end, for a signed-in
  member, the **user menu**: a `<details>` whose summary is their small
  avatar and their name (shortened with "…" past `--width-header-name`),
  named "Your account: <name>", opening a panel (an overlay, with
  `--elevation-overlay`) that says "Signed in as <name>." and holds **Sign
  out**, a quiet button in a form posting to `/logout` with the CSRF token.
  States of the summary: default, hover, focus-visible, active, open.
  **Why a menu and not an always-visible Sign out:** on the screenshots at
  390px both fit a short name, but the always-visible form (avatar, name,
  Sign out) left about 70px for the name, and a 32-character name (the
  longest Discord allows) pushed it onto a second header row, with the
  server's name to come on a third; the menu keeps the header one row for
  any name, leaves room for the server and navigation, and keeps a
  rarely-used, session-ending action one deliberate tap away. A
  `<details>` opens and closes without script and from the keyboard.
- **Avatar** (`avatar.tsx`, its own style guide page): a member's picture
  (round) or a server's icon (a rounded square), 48px or 32px (`small`),
  from Discord's CDN at twice that size, asked for without a referrer.
  Behind it are the initials (one for a member, two for a server) in
  `primary` on `surface-subtle`; they show when there is no picture, and
  when the picture fails to load an `::after` that browsers draw only on a
  broken image covers the broken-image mark with them, so no script is
  needed. Decorative (`aria-hidden`, empty `alt`) because the name is next
  to it; with a `label` (only where no name is beside it) it is an image
  named by that label. The style guide's sample pictures are
  `public/assets/cairn/samples/picture.svg` and `broken.svg` (deliberately
  not a valid picture), made in this repository.
- **Back link** (`back-link.tsx`, `/styleguide/back-link`): the way up
  to the page this one belongs to, such as from a setting to the
  settings.
  - _Anatomy:_ a left arrow (decorative) and the words, in the link colour
    and underlined, a 44px target, first in `main` above the page heading.
  - _Variants:_ none.
  - _States:_ default, hover (a thicker underline), focus-visible, active
    (the text colour). A long destination wraps beside the arrow.
  - _Name:_ its words, which say where it goes ("Back to settings").
  - _Do:_ name the destination; link to a fixed path, so it works however
    the member arrived.
  - _Don't:_ write "Back" alone, rely on the browser's history, or use it
    at the foot of a form (the form actions bar has the way back there).
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
  default, hover, focus-visible, pressed (`:active` or `[data-pressed]`),
  busy (`aria-busy="true"`, the pressed fill, from a form's submit until the
  next page) and disabled (a disabled link drops its `href`). An optional icon before or after the label; `block` fills
  the width.
- **Card** (`card.tsx`): one thing on a surface of its own, named by its
  heading (level 2 to 4). With `href` the heading's link covers the card,
  which gets hover, active and focus states; links and buttons in its
  footer stay separately clickable.
- **Checkbox** (`checkbox.tsx`, `/styleguide/checkbox`): a choice a member
  turns on or off.
  - _Anatomy:_ a 24px box (`--choice-size`) with a `border-strong`
    boundary, the label beside it and an optional hint under the label. The
    label covers the box's column too, so the whole row, at least 44px tall,
    is the target.
  - _Variants:_ on its own (with its own error, shown above it with the
    danger bar) or in a choice group (marked invalid by the group).
  - _States:_ off, on (a `primary` fill and an `on-primary` tick, drawn
    with borders so forced-colour modes keep it), hover, focus-visible, in
    error (a `danger` boundary), disabled off and on (sandstone, muted).
  - _Name:_ its label; the hint and error are tied with `aria-describedby`.
  - _Do:_ use it for an independent yes or no ("Announce the location
    vote"), and for any number of choices from a list, in a choice group.
  - _Don't:_ use one for a choice between two things (use radios), or
    submit the form when it is clicked.
- **Choice group** (`choice-group.tsx`, `/styleguide/choice-group`): the
  checkboxes or radios that answer one question.
  - _Anatomy:_ a `fieldset` without a border; its `legend` asks the question
    and looks like a label, then the group's hint, its error, and one row per
    choice. The fieldset's `aria-describedby` names the hint and error; the
    first choice takes the group's `id`, so the error summary's link lands
    on it, and the group's own hint and error are named after `<id>-group`.
  - _Variants:_ `radio` (pick one: two to five short choices that should
    all be seen, such as PT, MT, CT, ET or UTC) and `checkbox` (pick any
    number, such as the candidate dates of a date vote).
  - _States:_ default, chosen (kept from `value` when the form comes back),
    required ("(required)" in the legend, spoken, and `required` on each
    radio), in error (the danger bar, the error's icon and words, and
    `aria-invalid` on every choice), disabled (the fieldset's `disabled`).
  - _Name:_ the legend, read before each choice.
  - _Do:_ ask the question in the legend in the bot's words ("Time zone",
    "Candidate dates"); say the group's error once, at the group.
  - _Don't:_ put radios outside a group, use radios for more than five
    choices or long ones (use a select), or give each choice its own error.
- **Confirmation** (`confirmation.tsx`, `/styleguide/confirmation`): the
  page between a click and an action that cannot be undone, such as
  closing a vote or cancelling a round.
  - _Anatomy:_ an optional eyebrow (the server's name on the admin
    controls' pages, as nothing else there names the server the action is
    taken on), the bot's question as the page's h1 ("Cancel this round?"),
    what will happen in the bot's words with what it applies to (a
    definition list), "This cannot be undone." with a warning icon, then a
    form that posts (with the CSRF field and what identifies the thing) and
    holds the form actions: the action, then "Back".
  - _Variants:_ `danger` for an action that destroys or discards something
    ("Cancel round": its votes are discarded); `primary` for one that ends
    something but keeps it ("Close location vote": the votes decide the
    winner). Discord draws both in red; on the web the colour says whether
    anything is lost.
  - _States:_ the page itself has none; its buttons have theirs.
  - _Name:_ the page's h1, and the title starts with the question.
  - _Do:_ make the click that leads here a link to the page, so it works
    without JavaScript and the browser's back leaves it; restate the
    consequences, not "Are you sure?".
  - _Don't:_ use a dialog or a script's `confirm()`, or do anything on the
    request that shows the page.
- **Definition list** (`definition-list.tsx`, `/styleguide/definition-list`):
  settings or facts as names and values, each with an optional action to
  change it.
  - _Anatomy:_ a `dl`, one row per item divided by hairlines: the name
    (`dt`, semibold), the value (`dd`) and the action (`dd`, a quiet
    Button link). On a phone the name sits over the value and the action
    beside both; from the breakpoint the three share a line. Long values (a
    100-character channel name) wrap anywhere rather than widen the page.
  - _Variants:_ with change actions (settings) or without (facts).
  - _States:_ set; not set (muted words: "Not set", or the bot's sentence,
    such as "Not set: only the server owner can use the panel."); the
    action's hover and focus-visible.
  - _Name:_ the action reads its label and the row's name ("Change voting
    channel", "Set admin role"), the name visually hidden.
  - _Do:_ say what an unset value means when the bot does; use "Set" for
    an unset value and "Change" for a set one.
  - _Don't:_ leave a value blank or write a dash, or use a table for
    settings.
- **Discord sign-in** (`discord-sign-in.tsx`, its own style guide page):
  **Sign in with Discord**, a variant of Button: the primary button,
  linking to `/login` (with `next` when given), with Discord's mark before
  the label, drawn in `--color-discord-mark`. Discord's brand guidelines
  (https://discord.com/branding) allow its logo in colour, black or white,
  unedited, and the mark only where the Discord brand is clearly visible:
  here the mark is unchanged, exactly white on the light scheme's pine and
  exactly black on the dark scheme's light pine, next to the word
  "Discord". It is an SVG in the icon set, not a file from Discord. States:
  the primary button's (default, hover, focus-visible, active); `block`
  fills the width. Its accessible name is its label.
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
- **Error summary** (`error-summary.tsx`, `/styleguide/error-summary`): the
  box at the top of a form that came back with errors.
  - _Anatomy:_ an error icon (named "Error"), the title saying what did not
    happen in the bot's words ("Your location was not added.", "The date
    vote was not started."), then a link per field in error in the same
    words as the error at the field, each a 44px row. It is built like the
    danger banner, with a 2px boundary since it holds focus.
  - _Variants:_ none.
  - _States:_ on a page that answers a submission it takes focus
    (`autofocus`, no JavaScript needed) and is an alert, so it is
    announced; `autoFocus={false}` only where several are shown.
  - _Name:_ its title. The title is a paragraph, not a heading, so the
    page's h1 still comes first in the outline.
  - _Do:_ put it first in `main`, above the heading, and start the page's
    `<title>` with "Error: "; link each error to its field's `id` (a
    group's first choice).
  - _Don't:_ show it without the errors at the fields, or list errors the
    member cannot fix there.
- **Forecast table** (`forecast-table.tsx`, `/styleguide/forecast-table`):
  a hike's hourly forecast, as the hike thread gives it.
  - _Anatomy:_ a `table` named by its caption (the day and the time zone,
    small and muted); columns Time (each hour, with its conditions in
    words and a weather icon under it), then the numbers a member compares
    down the column: Temp, Chance, Rain and Wind (read out as
    "Temperature, °F", "Chance of rain or snow, %", "Rain or snow, in",
    "Wind, mph"). Each number column says its unit once, in its head under
    its name, and its cells are bare figures in tabular digits, aligned
    right, head included ("Layout rules"); the temperature and wind cells
    have a second figure that says what it is ("feels 46", "gusts 12").
    One row per hour headed by its time (a `<time>`) and its conditions,
    words with a weather icon beside them (decorative: the words carry
    them). A value the forecast lacks is a dash, as in the thread.
  - _Variants:_ the server's units: °F, inches and mph, or °C, mm and
    km/h.
  - _States:_ none; it is not interactive.
  - _Layout:_ on a phone each second figure sits under the first in muted
    small text and the cells are tight, so the five columns fit 390px
    (checked on the screenshots); from the breakpoint it sits beside it.
    Like every table it still scrolls inside its own box rather than widen
    the page.
  - _Do:_ pass the hours, words and times the bot shows, in the server's
    time zone. _Don't:_ colour a row for the weather, or drop the words for
    the icon.
- **Form actions** (`form-actions.tsx`, `/styleguide/form-actions`): the bar
  at the foot of a form.
  - _Anatomy:_ the one primary action (a submit Button: primary, or danger
    on a confirmation), then the way back (a secondary Button link,
    "Back").
  - _Variants:_ with or without the way back (a page that has a back link
    at its top may leave it out).
  - _States:_ on a phone the buttons stack and fill the width, primary on
    top where the thumb finds it; from the breakpoint they sit in a row,
    primary first.
  - _Do:_ name the action as the bot does ("Propose a location", "Set time
    zone", "Cancel round").
  - _Don't:_ add a reset button, put two primary actions in the bar, or put
    the way back first.
- **Form row** (`form-row.tsx`, `/styleguide/form-row`): the frame of every
  form control, used by the text field, textarea and select.
  - _Anatomy:_ in this order, 4px apart: the label (semibold; "(required)"
    after it in muted text, hidden from assistive technology since the
    control's `required` says it), the hint (muted), the error (danger,
    semibold, an alert icon and a visually hidden "Error: "), the control,
    and the limit ("Up to 80 characters.", small and muted). The error sits
    above the control so it is read before it and stays in view above a
    phone's keyboard; the limit sits under it, next to what is typed.
  - _Variants:_ around a Cairn control, or around a control Cairn has no
    component for (`describedBy(id, …)` gives its `aria-describedby`).
  - _States:_ default; in error, a 4px danger bar down its side, the
    control's danger boundary and `aria-invalid="true"`, so the error is
    never colour alone.
  - _Name:_ the label, by `for`; `aria-describedby` names the hint, error
    and limit, in that order.
  - _Do:_ write a label as a noun in sentence case ("Name", "Time zone"),
    and a hint in the bot's words.
  - _Don't:_ use a placeholder instead of a label or hint, or put the error
    under the control.
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
    zone, as the bot shows them, and the bot's label itself as
    `start.label`, so the card says exactly what the hike's thread and
    event say (a test compares the page with the thread's message from one
    round). _Don't_: reformat the bot's date label,
    or leave a link in that has nowhere to go (leave it out).
- **Icons** (`icon.tsx`, `icons.tsx`): stroke icons on a 24-unit grid with
  a 2-unit round stroke in the current text colour, at 20px or 16px. They
  are the shapes of **Lucide** (lucide.dev) 1.75.0, under the **ISC
  licence**, whose notice is in `icons.tsx`. Decorative (`aria-hidden`)
  unless given a `label`, which names them. The one exception is
  `DiscordIcon`, Discord's mark, filled rather than stroked, for **Sign in
  with Discord** only: its shape is Discord's own, as published in the
  `simple-icons` package (16.38.0, CC0; the mark itself is Discord's
  trademark, used as its brand guidelines say, see Discord sign-in). The
  weather icons (`weather-icons.tsx`, shown with the forecast table) are
  Lucide's too: sun, cloud and sun, cloud, fog, drizzle, rain, snow,
  thunderstorm, hail, sunrise and sunset, and a question mark for a code
  without data; `WeatherIcon` picks the one for a WMO weather code.
- **Map links** (`map-links.tsx`, `/styleguide/map-links`): where a
  location is, as the bot shows it.
  - _Anatomy:_ `full`: the place name (semibold, after a map pin icon), or
    the pin's coordinates when it has no name; the coordinates under a name
    (small, muted); **Open in OpenStreetMap** and **Open in Google Maps**,
    quiet buttons with the external-link icon after the words; then
    OpenStreetMap's credit, "© OpenStreetMap contributors", linking its
    copyright page. `compact`, in a vote's row, as the poll message does:
    one small muted line, a map pin, the place name and a **Map** link
    named after the option ("Map of Lake Serene"); without a place name the
    Map link stands alone and is a whole 44px target; the tally list
    carries the credit once, under its rows.
  - _Variants:_ `full`, `compact`; with or without a place name.
  - _States:_ the links' and buttons' own.
  - _Do:_ use plain links. _Don't:_ embed a map, a tile or a picture from
    another site: the content security policy forbids it, and it would
    tell that site who opened the page.
  - It is built from the layout classes, the utilities and Button, and has
    no stylesheet of its own.
- **Map view** (`map-view.tsx`, `/styleguide/map-view`): a map of one
  place or a few, drawn in the browser from hikebot's own vector tiles by
  MapLibre GL JS, in the Cairn map style ("In the browser" under "Cairn
  map"). One marker is the hike's **pin**, the blaze on a pointer with the
  place's name in a popup over it, and the map is centred on it at zoom
  13 (the picture is zoom 12 drawn from zoom 13 tiles, which hold the
  trails; the browser draws a zoom from its own tiles); several markers are **numbered** circles (the
  map's label colour, a white ring and a dark keyline), the map fitted to
  them, with their **list** under it: the same number, the name and the
  coordinates. The frame is 3:2, the picture's shape. The library is
  **MapLibre GL JS 6.19.0**, from the `maplibre-gl` npm package, under the
  **BSD 3-Clause licence**, copied unchanged into
  `public/assets/maps/maplibre/` with its `LICENSE.txt`. Without JavaScript
  it shows the stored map picture in it, or, with none, the line "Turn on
  JavaScript to see the map."; the map replaces either once it has drawn,
  so nothing moves. Where the map data has none of its places it keeps
  its picture, or without one is left out with its section
  (`data-map-section`). The **zoom buttons** (Zoom in, Zoom out, 44px, top
  right) appear with the map; the **attribution** is always shown, bottom
  left. The map is focusable (its accessible name is the `title`, such as
  "Map of Mount Si"): the arrow keys pan it and `+` and `-` zoom it, with
  the focus ring inside its frame. Under `prefers-reduced-motion` nothing
  is animated. The `caption` (the place and its coordinates) and the list
  are its text alternative. `framed={false}` inside something that frames
  it already, such as the hike card's picture slot. Inside the frame
  everything keeps the map's one look, in both schemes: markers, popups,
  buttons and the attribution use the `--map-*` tokens.
- **Pagination** (`pagination.tsx`, `/styleguide/pagination`): the way
  through a list that comes in pages, newest first, such as the hike log.
  - _Anatomy:_ a `nav` named by its `label` ("Hike log pages"), with
    "Newer" (left arrow) on the left, "Older" (right arrow) on the right,
    as the bot's buttons say, and the position in words ("43 hikes · page 2
    of 5", the bot's line). On a phone the position sits above the buttons;
    from the breakpoint between them.
  - _Variants:_ none.
  - _States:_ first page (Newer disabled), middle, last page (Older
    disabled): a disabled direction has no link, so it cannot be focused
    or followed, and keeps its place so the bar keeps its shape, as in
    Discord.
  - _Name:_ the `nav`'s label; the buttons say their direction.
  - _Do:_ leave the bar out when there is only one page.
  - _Don't:_ number every page, or say "Previous" and "Next", which the
    bot does not.
- **Radio** (`radio.tsx`, `/styleguide/radio`): one of a few choices that
  exclude each other, always inside a choice group.
  - _Anatomy:_ a 24px circle with a `border-strong` boundary, the label
    beside it and an optional hint under it (such as "America/Los_Angeles"
    under "PT"); the whole 44px row is the target.
  - _Variants:_ none.
  - _States:_ not chosen, chosen (a `primary` ring round a `primary` dot,
    drawn as a border so forced-colour modes keep it), hover,
    focus-visible, in a group in error (`aria-invalid`, a danger boundary),
    disabled not chosen and chosen.
  - _Name:_ its label, after the group's legend.
  - _Do:_ give the radios of one question the same `name`, so the arrow
    keys move between them; choose the current value for the member (the
    server's time zone).
  - _Don't:_ use one alone, or use radios for a yes or no (use a
    checkbox).
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
- **Select** (`select.tsx`, `/styleguide/select`): one choice from a list
  the server knows, such as a channel, a role or a time zone.
  - _Anatomy:_ the browser's own `<select>` in the text field's box
    (`.input`), with a chevron drawn in the text colour, in a form row.
    Options can be grouped (a channel's category, a time zone's region);
    a `placeholder` option with an empty value says what to pick ("Pick the
    voting channel", as the bot's select says) or what nothing means ("Not
    set").
  - _Variants:_ flat or grouped options.
  - _States:_ nothing chosen, chosen (kept from `value`), hover,
    focus-visible, in error, disabled. A long option (a 100-character
    channel) ends in an ellipsis inside the box; the open list is the
    phone's or browser's own picker, which handles a list of 400 time
    zones.
  - _Name:_ its label, with the hint and error tied by `aria-describedby`.
  - _Do:_ use it for a long list or long options; offer only valid choices
    (only forum channels for the hike threads channel).
  - _Don't:_ build a custom drop-down, or use a select for two to five
    short choices (use radios).
- **Server tile** (`server-tile.tsx`, its own style guide page): one server
  to choose, as one link to `/g/<id>` with one focus ring: the server's
  icon or initials (Avatar, decorative), its name and a chevron, at least
  44px high. The name wraps onto as many lines as it needs and is never
  cut short; a long word breaks rather than widening the tile. States:
  default, hover (stronger edge, underlined name), focus-visible, active.
  `ServerTileList` lays tiles out in one column below the breakpoint and
  in a grid of tiles at least `--width-tile-min` wide from it, each row as
  tall as its tallest tile.
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
    has voted.", "14 members have voted."), with, given `counted`, when the
    votes were counted ("Counted just now.", an Age, so a page left open
    on a phone says how old its tally is), then an `<ol>` named by `label`
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
    proposer. A located option has its place line (compact Map links) after
    the marks, and the list then ends with OpenStreetMap's credit.
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
    list (its words from `submit`: the server's page says **Save votes**). It does not stick to the foot of the screen: a sticky bar sits
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
- **Text field** (`text-field.tsx`, `/styleguide/text-field`): one line of
  text, such as a location's name, a date or a home area.
  - _Anatomy:_ an `<input>` in the `.input` box (a 2px `border-strong`
    boundary, 44px tall, the full width of its column) in a form row.
  - _Variants:_ full width, or `short` (`--width-input-short`) for a value
    of a few characters such as a date. `type` is `text` unless only a URL,
    an email address or a telephone number is valid, or the browser's own
    picker helps: `date` and `time`, with `min` and `max` naming the days
    the server accepts (it checks them again); `inputMode` asks for
    the phone's keyboard (`numeric` for digits); `autoComplete` is `off`
    for things that are not about the member (a location's name) and an
    autofill token where the member's own data helps (`address-level2` for
    the home area); `spellCheck={false}` for links, codes and time zones.
  - _States:_ empty, filled (kept from `value` when the form comes back, at
    the 80-character limit), hover (a `text` boundary), focus-visible, in
    error, required, read-only (sandstone with a dashed boundary: it can be
    read, selected and copied), disabled (sandstone, muted, a faint
    boundary).
  - _Limit:_ `maxLength` sets `maxlength` and says "Up to 80 characters."
    under the field; the server checks it again.
  - _Name:_ its label, with the hint, error and limit tied by
    `aria-describedby`.
  - _Do:_ take the limits from the bot (`src/polls/store.ts`); say the
    expected form in the hint ("as YYYY-MM-DD or YYYY-MM-DD HH:MM").
  - _Don't:_ use a placeholder as a label or an example, or `type="number"`
    for something that is not a quantity.
- **Textarea** (`textarea.tsx`, `/styleguide/textarea`): several lines of
  text, such as a location's details or dates one per line.
  - _Anatomy:_ a `<textarea>` in the text field's box, four lines tall by
    default (`rows`), in a form row.
  - _Variants:_ by `rows`.
  - _States:_ as the text field: empty, filled to the 300-character limit,
    hover, focus-visible, in error, required, read-only, disabled. The
    member can make it taller, never wider.
  - _Name:_ its label, with the hint, error and limit tied by
    `aria-describedby`.
  - _Do:_ say "(one per line)" in the label when it takes a list, as the
    bot's modals do.
  - _Don't:_ use it for one line, or for a list members choose from (use a
    choice group).

## Layout rules

- **One column on a phone.** Content runs the full width less the gutter.
  Nothing scrolls sideways at 390px: long words wrap
  (`overflow-wrap: break-word`), tables scroll inside their own box, grids
  collapse to one column.
- **Two widths on a desktop**: 720px for a page that does one job, 1080px
  for overviews. Running text stops at 68 characters whatever the width.
- **Spacing from the scale** through `.stack` (vertical; `--tight`,
  `--loose`, `--section`), `.cluster` (a wrapping row; `--nowrap` keeps an
  icon beside words that wrap) and `.grid` (cards
  side by side, one column on a phone). A page's structure: the
  `.page-heading` (an h1, with an eyebrow and a lead only where the
  presence test keeps them), then sections `--space-7` apart.
- **The primary action** sits right after what it acts on, never at the
  bottom of a long page only; on a phone it may fill the width
  (`block`).
- **The main path is never a link inside a sentence.** A link in running
  text keeps the line's height, so it is a small target for a thumb on a
  trailhead, and it reads as an aside. The thing the page's question
  sentence is about ("Vote", "Open the hike thread", "Start location
  vote") is a button, or a standalone link whose whole row is its 44px
  target. A link inside a sentence is only ever a way to something else,
  such as the project's source in the footer.
- **Numbers people compare line up.** Counts in a tally and the columns
  of a forecast use tabular figures (`font-variant-numeric:
tabular-nums`), align right, and carry their unit once, in the column
  head ("Rain, mm", "Wind, km/h"), with the cells bare. A column whose
  cells have different units is left-aligned with a unit in each cell. A
  list with no column head, such as the tally's rows, says the unit at
  each count ("4 votes"). Public Sans has tabular figures, so Cairn has no
  monospace face for numbers.
- **Measured, not judged by eye:** targets, sideways overflow, cut words,
  links on the main path and layout shift are measured by the checks in
  "Measure what can be measured", at 320 to 1440px and at 200% zoom.
- **A part that loads after the page reserves its size.** The map and
  anything drawn from data that arrives later take their final height in
  the markup, so nothing below them moves when they arrive (layout shift
  under 0.05).

## States

Every element and every view says what is true at every moment, and
answers every input in the next frame.

### Every element

Every interactive element defines **rest, hover, focus-visible, pressed,
disabled**, and **busy** if it starts work. That includes the small ones:
a link in the footer, a tally row's "Show details", the user menu's rows,
the switch-server link.

- **Pressed** must show in the next frame, never eased, and outrank
  hover. Browsers apply `:active` to a finger only when it lifts, so on a
  phone a plain `:active` shows the press too late or not at all. Cairn's
  answer is `[data-pressed]`: a small shared script,
  `public/assets/cairn/press.mjs`, loaded by every page as a module from
  the Worker's own origin, sets it on the control under the finger or the
  mouse from `pointerdown` and clears it when the pointer lifts
  (`pointerup`), leaves the control (`pointerleave`, or a move off it), or
  the browser takes the gesture as a scroll (`pointercancel`), and each
  `:active` rule has a `[data-pressed]` twin in the same selector
  (`:where(:active, [data-pressed], [data-preview="active"])`). Without
  JavaScript, `:active` alone is the press.
- **Busy** is the state a control needs when its work takes time: "Save
  votes" or "Propose location" posting over a trailhead's signal. From
  the submit, the button that submitted carries `aria-busy="true"`
  (set by the same script), holds its pressed fill without easing, and
  a second press of the form is ignored, so a vote is not sent twice. Without JavaScript,
  the browser's own loading indicator is the busy state.
- **Disabled** says why near the control when the reason is not on the
  screen already ("Voting closed Sat, 5 Dec 2026 · 18:00").
- **Chosen** (a ticked vote, the current page) is marked by a tick, a
  ring or the blaze, with words, as each component says.

### Every data view

A vote's tally, the hike log, the forecast, the map and the server list
each define:

- **Loading.** Pages are drawn on the server, so a page arrives whole.
  A part that loads after it (the interactive map) keeps its size and
  what was there before (the map picture or its words), and says what it
  is waiting for in words, never a spinner over data.
- **Empty.** Say what was asked and that nothing matched: "Nobody has
  proposed a location for this vote." under the location vote, not a bare
  "Nothing here".
- **Error.** What happened, then what to do: "The forecast could not be
  fetched. The bot tries again every hour; the hike thread has the last
  one."
- **Partial.** Say what is missing, next to it: "Forecast for 09:00 to
  15:00 only; later hours are not out yet."
- **First run**, where a view can have had nothing: a server with no hike
  yet is not empty but new: "No hikes yet. The first one appears here when
  a date vote closes."

### Chrome that describes data describes the data on screen

Headings, counts, captions, ages and accessible names come from what is
drawn, not from a request in flight. A forecast or a tally says how old it
is ("Updated 14 min ago"), and that age is the age of what is shown: the
time the forecast was fetched, or the votes were counted, not the time the
page was served. The exact time goes in a `<time datetime>` beside it.

## Forms

Every form that changes something is a page of its own, built from the
form components, and works without JavaScript:

1. **It posts.** `<form method="post" novalidate>` with the CSRF field ("Add
   a form that changes something" in `src/web/AGENTS.md`). `novalidate`
   leaves the checking to the server, so every error appears the same way,
   in the bot's words; `required` and `maxlength` stay on the controls,
   which still announce them and stop overlong typing. While it posts,
   the button that submitted it is busy ("States").
2. **Rows, then actions.** Form rows are 32px apart (`.stack.stack--loose`),
   in the order a member thinks of them; the form actions bar follows the
   last one. One question per row; a choice group for several related
   choices.
3. **A form that fails comes back as itself.** The server answers with the
   same page, given what was typed (each component's `value` or `checked`)
   and the errors: the error summary first in `main` (focused and
   announced), the `<title>` starting with "Error: ", and each error at its
   field, tied by `aria-describedby`, with `aria-invalid` on the control.
4. **A form that succeeds redirects** with `303` to the page that shows the
   result, so the page works without JavaScript and a reload does not post
   again. The change is its own confirmation where it can be: the page
   shows what is now true, and the banner says it in the bot's words
   rather than only what happened ("The location vote is open until Wed,
   2 Dec 2026 · 18:00.", not "Vote started.").
5. **An action its opposite undoes says what is now true in place.** A
   vote can be changed until the vote closes, a proposal withdrawn, a
   setting set back: next to the thing, the page says what is now true and
   how to change it ("You voted for Snow Lake. You can change your votes
   until the vote closes Wed, 2 Dec 2026 · 18:00."), with the form still
   there to change it again, and the redirect's fragment and `autofocus`
   bring the member back to it. Which applies when: in place, when the
   form sits next to what it changed (a vote, a proposal, a setting); a
   banner that says what is now true, when the result is somewhere else
   (an admin starting a vote, an action taken on a confirmation page).
6. **An action that cannot be undone** goes through a confirmation page.
7. **Text from members is text.** Values go into the markup as JSX
   expressions, never as HTML.

A text field's limit is shown as words and enforced with `maxlength`; it
does not count down as the member types, since that would need a script,
and the server checks the limit again.

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
- **From the reader's side: what happened, then what to do.** "The map
  link could not be read. Paste a Google Maps, OpenStreetMap or Apple Maps
  link, or lat, lon.", not "Invalid input". After an action, say what is
  now true ("Forms").
- **Numbers as digits, and every number carries its unit**: "6.7 miles
  round trip", "1,800 ft of gain", "4 votes", "7 members have voted",
  "12 °C". A forecast column carries the unit once, in its head ("Layout
  rules"). Tallies and tables use tabular figures.
- **Ages and durations in one format.** An age is "just now" under 5 s,
  then "12 s ago", "14 min ago", "3 h ago", and beyond a day the date and
  time as the bot writes them: "Updated 14 min ago" under the forecast,
  "Updated Thu, 3 Dec 2026 · 07:00" two days later. Never "0 s ago";
  minutes are "min", never "m". A duration has at most two parts, largest
  first: a hike of "5 h 30 min", a vote that "closes in 2 h 9 min".
- **One event has one time everywhere.** The hike's start, a vote's
  closing time and a forecast's hour are written the way the bot writes
  them, `Sat, 5 Dec 2026 · 09:00`, in the server's time zone, on the web
  page, in the Discord message, in the hike thread and on the Discord
  event, so a member who reads "The location vote closes Wed, 2 Dec
  2026 · 18:00" on the page reads the same in Discord. Figures shown
  together agree: "7 members have voted" and the counts under it are
  counted from the same votes at the same moment.

## Cairn map

The map picture the bot posts with a hike (`src/maps/`, "Map pictures" in
`docs/design.md`) is part of Cairn: the same palette, the same typeface and
the blaze, drawn by the renderer from the style data in `src/maps/style.ts`.
`/styleguide/map` shows the committed sample pictures and every colour role
as a swatch; how to change it is "Change the map style" in
`src/maps/AGENTS.md`.

### One look in both schemes

A picture is a PNG posted into Discord, where the dark and the light theme
show the same image, so the map has one look: Cairn's light scheme, a paper
map. It is judged at about 400 pixels wide, as Discord shows it on a phone,
on Discord's dark (`#313338`) and light (`#ffffff`) backgrounds. The paper
(`#faf8f3`) is 11.9:1 against the dark background and the frame
(`--map-frame`) 3.4:1, so the picture keeps its edge there, and 3.7:1
against white.

### Colour roles and their tokens

Each role of the map is a token, `--map-<role>`, in the map group at the end
of `:root` in `tokens.css`. The roles need tints the palette does not have
(a forest, a lake, a road's casing), so each is made from one palette
colour by a recipe, as CSS `color-mix(in srgb, var(--<token>) <share>,
var(--<into>))` would make it: the token itself, or a share of it mixed into
the paper (`--color-bg`) or another colour. The map tokens have no dark
values: the picture has one look. `RECIPES` in `src/maps/style.ts` holds the
recipes and `CAIRN` the palette's light values they read;
`test/maps/style-tokens.test.ts` reads `tokens.css` and fails when a palette
value, a recipe's result and its map token disagree, so changing a palette
colour means updating `CAIRN` and the map tokens it feeds.

| Role                   | Token                          | Value     | Made from                                  | Draws                                                    |
| ---------------------- | ------------------------------ | --------- | ------------------------------------------ | -------------------------------------------------------- |
| `land`                 | `--map-land`                   | `#faf8f3` | `--color-bg`                               | The paper: everything that is not another fill.          |
| `forest`               | `--map-forest`                 | `#cdd9c9` | `22% --color-success in --color-bg`        | Forest and woods.                                        |
| `grass`                | `--map-grass`                  | `#e5eae0` | `10% --color-success in --color-bg`        | Grass, meadow, scrub and wetland.                        |
| `bareRock`             | `--map-bare-rock`              | `#e6e0d5` | `70% --color-border in --color-bg`         | Bare rock, scree and sand.                               |
| `ice`                  | `--map-ice`                    | `#f1f5f8` | `6% --color-info in --color-surface`       | Glaciers and permanent snow.                             |
| `settled`              | `--map-settled`                | `#ede9e0` | `45% --color-border in --color-bg`         | Towns' built-up areas.                                   |
| `park`                 | `--map-park`                   | `#dbe3d6` | `15% --color-success in --color-bg`        | Parks, gardens and pitches.                              |
| `protectedArea`        | `--map-protected-area`         | `#1f5d45` | `--color-primary`                          | Protected areas, at 8 % over the fills.                  |
| `protectedAreaOutline` | `--map-protected-area-outline` | `#82a393` | `55% --color-primary in --color-bg`        | Their dashed edge.                                       |
| `water`                | `--map-water`                  | `#8eafc3` | `50% --color-info in --color-surface`      | Lakes, rivers and streams.                               |
| `waterLabel`           | `--map-water-label`            | `#1d5e86` | `--color-info`                             | Names of water.                                          |
| `path`                 | `--map-path`                   | `#8f411f` | `60% --color-accent in --color-text`       | Trails and footpaths: the first thing a hiker looks for. |
| `track`                | `--map-track`                  | `#845c44` | `35% --color-accent in --color-text-muted` | Unpaved tracks and forest roads.                         |
| `pathHalo`             | `--map-path-halo`              | `#faf8f3` | `--color-bg`                               | The light line under trails and tracks.                  |
| `roadMajor`            | `--map-road-major`             | `#ffffff` | `--color-surface`                          | Major roads, such as the road to a trailhead.            |
| `roadMajorCasing`      | `--map-road-major-casing`      | `#566059` | `--color-text-muted`                       | Their edges.                                             |
| `roadMinor`            | `--map-road-minor`             | `#ffffff` | `--color-surface`                          | Minor roads and streets.                                 |
| `roadMinorCasing`      | `--map-road-minor-casing`      | `#a9afa9` | `65% --color-border-strong in --color-bg`  | Their edges.                                             |
| `roadMotorway`         | `--map-road-motorway`          | `#ced0cb` | `35% --color-border-strong in --color-bg`  | Motorways, kept quiet.                                   |
| `roadMotorwayCasing`   | `--map-road-motorway-casing`   | `#7d8781` | `--color-border-strong`                    | Their edges.                                             |
| `rail`                 | `--map-rail`                   | `#566059` | `--color-text-muted`                       | Railways.                                                |
| `building`             | `--map-building`               | `#7d8781` | `--color-border-strong`                    | Buildings, at 40 %.                                      |
| `label`                | `--map-label`                  | `#1f2421` | `--color-text`                             | Names of places and peaks.                               |
| `labelHalo`            | `--map-label-halo`             | `#faf8f3` | `--color-bg`                               | The halo round every label.                              |
| `peak`                 | `--map-peak`                   | `#1f2421` | `--color-text`                             | Peaks' triangles.                                        |
| `pin`                  | `--map-pin`                    | `#d9541e` | `--color-accent`                           | The pin: the trail blaze.                                |
| `pinOutline`           | `--map-pin-outline`            | `#ffffff` | `--color-surface`                          | The pin's light outline.                                 |
| `pinKeyline`           | `--map-pin-keyline`            | `#1f2421` | `--color-text`                             | The dark line round it, for snow and pale fills.         |
| `furniture`            | `--map-furniture`              | `#1f2421` | `--color-text`                             | The scale bar and the attribution.                       |
| `furnitureBackground`  | `--map-furniture-background`   | `#ffffff` | `--color-surface`                          | Their backing, at 80 %.                                  |
| `frame`                | `--map-frame`                  | `#7d8781` | `--color-border-strong`                    | The line round the picture.                              |

Why these:

- **Paper and greens.** Land is the page's paper. Forest, grass and parks
  are the success green at 22, 10 and 15 per cent: greener than pine, which
  turns grey when mixed this light. Built-up areas and bare rock are the
  border colour, sandstone, at 45 and 70 per cent.
- **Water** is lake blue at half strength in white, so lakes and rivers
  read blue against both the paper and the forest; water names are lake
  blue itself.
- **Trails** are the blaze weathered: 60 per cent of the accent in the text
  colour, a rust that is the strongest line on the map (4.9:1 on forest,
  6.7:1 on the paper) without competing with the pin's pure orange. Tracks
  are the accent at 35 per cent in the muted text colour, quieter.
- **Roads** are white with granite casings; a major road, such as the road
  to a trailhead, has the darker muted-text casing. Motorways are a pale
  grey with a light casing, so a motorway across the picture does not pull
  the eye from the trail.
- **The pin** is the accent with a white outline (4.0:1 between them) and a
  dark keyline outside it (10.8:1 on forest, 6.8:1 on water, 14.4:1 on
  snow), so it stays visible on any fill, including snow, where the white
  outline alone would vanish, and water, where orange alone is 1.7:1.
- **Labels** are the text colour on a paper halo (14.9:1); water names are
  lake blue on it (6.6:1).

Fills are told apart by hue and by what is drawn on them, not by contrast:
water on forest is 1.6:1. Lines and marks are checked: the test above also
fails when a trail falls below 3:1 on any land fill, or the pin's keyline
below 3:1 on any fill or water.

### Typeface

Labels, the scale bar and the attribution are set in **Public Sans**,
regular, semibold and italic, from the static TrueType files of the Public
Sans release 2.001 (the version the web font carries), subset with fontTools
to Latin with its extensions and the punctuation in use, and unhinted; the
rasterizer, resvg, takes TrueType or OpenType, not WOFF2. The files and the
licence (`PublicSans-OFL.txt`, SIL Open Font License 1.1) are in
`src/maps/fonts/`.

Public Sans has no IPA and few combining marks, and OpenStreetMap names here
use them (`Mount Si / q̓əlbc̓`). resvg would draw a missing mark from another
font beside its letter rather than on it, so a label with any character
Public Sans lacks is set wholly in **Noto Sans** (OFL, `NotoSans-OFL.txt`),
subset to Latin, IPA and combining marks. Its semibold file carries the
typographic family name "Noto Sans", so resvg finds it for weight 600.

Italic marks water names only, as on every topographic map: there it names
a kind of feature, not emphasis, which is why the map keeps it while the
pages do not.

### Hierarchy

A hiker opens the picture to find the trail, the road to the trailhead,
water, and the summit's name and height, in that order, at about 400 pixels
wide. The style is tuned at zooms 11, 12 and 14 on the samples for that:

1. **The pin** is the only orange shape and the largest mark: the blaze,
   13 by 28 logical pixels on an 8-pixel pointer whose tip is on the point.
2. **Trails** are the widest dashed lines, 2.8 logical pixels at zoom 11,
   where few trails are in the data and each must show, 2.5 at 12 and 2.6
   at 14, over a paper halo, drawn above every road.
3. **Summits** are labelled first: semibold, 15.5 to 17 logical pixels,
   with the height on a second line, and they win every overlap with other
   labels (`LABEL_PRIORITY`: peaks, then water, towns, villages,
   neighbourhoods).
4. **Water** is lake blue, its names italic in the same blue.
5. **Roads** are white with casings; major roads are wider, with the darker
   casing; minor roads 0.8 logical pixels from zoom 11.
6. **Places** are regular weight, smaller than summits at the zooms a hike
   is shown at.
7. **Everything else** (built-up areas, buildings at 40 per cent,
   protected areas at 8 per cent with a dashed edge, railways, the scale bar
   and the attribution) stays quiet.

### In the browser

The map on the web pages (the map view component) is drawn by MapLibre GL
JS from the same vector tiles, with a style made from the same data:
`browserStyle` in `src/maps/browser-style.ts` reads the roles, opacities,
widths, dashes, first zooms, label sizes and priorities of
`src/maps/style.ts`, and the same reading of the tiles as the picture
(`src/maps/svg.ts`), so a change to the style changes both, and
`test/maps/browser-style.test.ts` fails if the browser's style holds a
colour that is not a role's. What differs, because the browser draws it:

- **Labels** are set in the page's own Public Sans (the web font Cairn
  already loads), so nothing more is downloaded for text: regular, semibold
  for peaks and villages, and water names slanted by the browser, as the
  web font has no italic. A character Public Sans lacks comes from the
  browser's sans-serif.
- **Peaks' triangles** are drawn by the page's script, in the `peak` and
  `labelHalo` colours the style passes it.
- **The pin and markers** are page elements over the map (see "Map view").
- **No scale bar**: the map can be zoomed; the attribution is shown.

**Dark scheme.** The map has no dark variant, as the picture has none: it
keeps its light, paper look on a dark page, inside a frame
(`--color-border`) that sets it off, and the furniture over it (markers,
popups, zoom buttons, attribution) uses the `--map-*` tokens, so it does
not change with the scheme either. A dark map would be a second style to
keep in step with the picture for little gain: the paper reads well on the
dark page, and members compare the web map with the picture in Discord.

### Do and don't

- **Do** add a colour as a role: a recipe in `RECIPES`, its `--map-*` token
  in `tokens.css`, its swatch line in `pages/styleguide.css`, and a row in
  the table above.
- **Do** judge a change on every sample at about 400 pixels wide on
  Discord's dark and light backgrounds, not only at full size.
- **Do** keep the trail, the pin and the summit the strongest marks.
- **Don't** use the accent for anything but the pin: a second orange shape
  would make the pin harder to find. Trails are the weathered blaze, not
  the blaze.
- **Don't** write a colour in the drawing code, or give the map a dark
  variant: one picture serves both themes.
- **Don't** add a typeface: a label Public Sans cannot set falls back to
  Noto Sans, and nothing else.
- **Don't** make a label bold or larger for emphasis beyond its role, or
  add colours for kinds of feature that `src/maps/svg.ts` does not draw.

## Size budget

`test/web/size-budget.test.ts` fails when an asset outgrows its budget:

| What                                            | Budget | Now         |
| ----------------------------------------------- | ------ | ----------- |
| The font file                                   | 32 KB  | 27 KB       |
| All stylesheets, each gzipped, together         | 26 KB  | about 26 KB |
| The contour pattern                             | 12 KB  | 9 KB        |
| Everything a page loads from Cairn, transferred | 64 KB  | about 56 KB |

The stylesheets' budget is 26 KB rather than 20 KB, for three reasons.
Each file is compressed on its own, and one file per component means 33
small files whose shared vocabulary (`var(--space-`, `border-radius`) is
compressed again in each: joined into one file, the same rules are about
13.5 KB gzipped. The cost a member pays is the whole page's, which
stays within its 64 KB, with every file cached for a year. And the map
view's file, about 1.8 KB gzipped, lays out and styles MapLibre's own
markup, in place of MapLibre's stylesheet (72 KB, about 10 KB gzipped,
with colours of its own) that pages would otherwise load. Raise it again
only with the same kind of reason, and first look for rules components can
share.

The interactive map's files are outside this budget, as they are not
Cairn's: MapLibre GL JS and its worker (about 450 KB gzipped together) and
the map's own script load only on a page with a map, under the versioned
path, so a browser fetches them once a deploy.

## Designing a new page

The method ("Method") as a checklist, in its order:

1. **Write the question sentence.** Who opens the page, where, on what
   device, and what they are trying to find out or do, in one sentence
   ("Start from the question"). It usually names a member on a phone who
   came from a link in Discord. If you cannot write it, stop: the page is
   not ready to design.
2. **Run the presence test before drawing anything.** List what the
   person in the sentence needs, largest first, each with the question it
   answers and nothing else on the page answers (the presence table). The
   three questions come first: where am I (the h1), what state is the hike
   in (in words, with a banner or a status), what can I do next (one
   primary button, never a link inside a sentence). Anything with no row
   is not built: no eyebrow, lead, icon, helper text, rule or gap for its
   own sake.
3. **Write the real words and numbers.** The bot's words in sentence case,
   verbs on buttons, real names and dates of the kind the bot posts,
   numbers with units, times as the bot writes them ("Content rules"). No
   placeholder text.
4. **Set the hierarchy with type and space only**, from the parts:
   `Layout` at the task width unless it is an overview, `.page-heading`,
   `.stack` sections. Name the first three things the eye should reach and
   check them on a greyscale copy of the screenshot.
5. **Add structure**: existing components, cards where grouping needs
   them. A new look is a new component in the design system, not page CSS.
6. **Add colour last**: tokens only, and only the pairings in "Allowed
   pairings".
7. **Run the presence test again** on the drawn page, element by element,
   largest to smallest, and update the table. Remove each element that
   answers nothing, or answers what something else already does.
8. **Design every state** ("States"):
   - each data view: loading, empty (what was asked and that nothing
     matched), error (what happened, then what to do), partial (what is
     missing), and first run where it can have had nothing; and the
     content's extremes: one item, many items (25), a 100-character name;
   - each control, small links included: rest, hover, focus-visible,
     pressed (on touch too), disabled, and busy if it starts work;
   - after each action: what is now true, in place or in a banner
     ("Forms"); signed out.
9. **Look at the second scheme** on its own.
10. **Check the phone and 200% zoom**: 390px with a finger, 44px targets,
    nothing sideways, nothing that needs hover, heading and focus order,
    nothing by colour alone; then the desktop at 200% zoom. Read the
    measured checks ("Measure what can be measured") rather than judging
    those from a picture.
11. **Review it** as "Review your own UI change as a designer" in
    `src/web/AGENTS.md` says.
