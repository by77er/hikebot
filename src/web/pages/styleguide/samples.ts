/**
 * Content for the style guide's hike components, at the limits the bot
 * allows: a location name of 80 characters, details of 300 characters with
 * a link, 25 options, a tie, no votes and one vote. The words are the
 * bot's ("docs/design.md", "Polls" and "Voting").
 */
import type { TallyOption } from "../../components/tally-row";

/** A location name of exactly 80 characters, the longest a label may be. */
export const LONGEST_LOCATION =
  "Rattlesnake Ledge via the Snoqualmie Valley Trail and the Rattlesnake Lake shore";

/** Details of exactly 300 characters, the most allowed, with a link. */
export const LONGEST_DETAILS =
  "Steep but short: 4 miles round trip and 1,160 feet of gain, with the view from the upper ledge over the whole valley. Park at Rattlesnake Lake (Discover Pass needed). Trail report: https://www.wta.org/go-hiking/hikes/rattlesnake-ledge - bring microspikes after November, and a layer for lunch up top.";

/** The bot's instructions for each vote. */
export const LOCATION_INSTRUCTIONS =
  "Vote for every location you would go to; you can change your votes until the vote closes.";
export const DATE_INSTRUCTIONS =
  "Vote for every date you could make; you can change your votes until the vote closes.";

const NAMES: [string, string | null, string][] = [
  [
    "Mailbox Peak",
    "Old trail up, new trail down. 9.4 miles, 4,000 feet.",
    "Ana",
  ],
  [LONGEST_LOCATION, LONGEST_DETAILS, "Margarethe from the Thursday group"],
  [
    "Lake 22",
    "Old-growth forest to a lake under Mount Pilchuck.",
    "kestrel_hikes",
  ],
  ["Poo Poo Point", null, "Bo"],
  ["Mount Si", "The classic. Busy on weekends: meet at 8.", "Ana"],
  ["Little Si", "Short and good for a wet day.", "hikebot"],
  ["Twin Falls", null, "Dev"],
  ["Wallace Falls", "Nine falls, 5.6 miles.", "Ines"],
  ["Heather Lake", null, "Bo"],
  ["Lake Serene", "Bridal Veil Falls on the way.", "kestrel_hikes"],
  [
    "Granite Mountain",
    "Avalanche terrain in winter: check the forecast.",
    "Dev",
  ],
  ["Snow Lake", null, "Ines"],
  ["Annette Lake", null, "Ana"],
  ["Franklin Falls", "Easy, 2 miles. Kids welcome.", "Sam"],
  ["Mount Pilchuck", "Fire lookout at the top.", "Bo"],
  ["Blanca Lake", "Turquoise lake, rough road to the trailhead.", "Sam"],
  ["Lake Valhalla", null, "Dev"],
  ["Colchuck Lake", "Long drive; car-share from the park and ride.", "Ines"],
  ["Oyster Dome", "Views over the San Juan Islands.", "Ana"],
  ["Hurricane Hill", null, "Sam"],
  ["Cougar Mountain loop", null, "Bo"],
  ["Squak Mountain", null, "hikebot"],
  ["Dirty Harry's Balcony", "Short and steep.", "Dev"],
  ["Tiger Mountain", null, "Ines"],
  ["Rattlesnake Mountain traverse", "One way: we need two cars.", "Sam"],
];

/** Votes for each of the 25 options, most first: a tie at the top. */
const VOTES = [
  9, 9, 9, 7, 6, 6, 5, 4, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
];

/** 25 location options at the limits, as a closed vote has them. */
export const LOCATIONS: TallyOption[] = NAMES.map(
  ([label, details, proposer], index) => ({
    id: String(index + 1),
    label,
    details,
    proposer,
    votes: VOTES[index] ?? 0,
    yourVote: index === 1 || index === 4,
  }),
);

/** How many members voted in the 25-option vote. */
export const LOCATION_VOTERS = 14;

/** A date vote's options, by date; dates show no proposer. */
export const DATES: TallyOption[] = [
  { id: "d1", label: "Sat, 5 Dec 2026 · 11:00", votes: 6, yourVote: true },
  { id: "d2", label: "Sun, 6 Dec 2026 · 11:00", votes: 3 },
  { id: "d3", label: "Sat, 12 Dec 2026 · 09:00", votes: 1 },
  { id: "d4", label: "Sun, 13 Dec 2026 · 11:00", votes: 0 },
];
