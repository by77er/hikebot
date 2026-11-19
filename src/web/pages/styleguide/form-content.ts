/**
 * The bot's content at its limits, for the style guide's form and page
 * furniture examples: the limits of `src/polls/store.ts`, the words of
 * the Discord modals and settings in `src/features/`, and member text
 * as long as Discord lets it be.
 */

/** A location's name at the bot's limit of 80 characters. */
export const LONGEST_NAME =
  "Mount Si, Little Si and Teneriffe Falls loop from the Mount Si trailhead parking";

/** A location's details at the bot's limit of 300 characters. */
export const LONGEST_DETAILS =
  "Mailbox Peak by the new trail: 9.4 miles round trip, 4,000 feet of gain. Steep and rocky near the top, with snow until June, so bring microspikes. Parking fills by 08:00 on weekends. Trail map: https://www.wta.org/go-hiking/hikes/mailbox-peak. Meet at the lower lot; we carpool from Seattle at 06:45.";

/** A channel name at Discord's limit of 100 characters. */
export const LONGEST_CHANNEL =
  "#weekend-hikes-and-trail-reports-for-the-cascades-and-olympics-carpools-gear-swaps-and-planning-chats";

/** The limits of `src/polls/store.ts` and the modals. */
export const LIMITS = {
  name: 80,
  details: 300,
  mapLink: 1000,
  date: 16,
  candidateDates: 1000,
  initialLocations: 4000,
  timeZone: 64,
  homeArea: 100,
} as const;

/** The words of the bot's fields, from its modals and settings. */
export const HINTS = {
  details: "A trail link, the distance, notes.",
  mapLink:
    "A Google Maps, OpenStreetMap or Apple Maps link, or lat, lon, such as 47.4875, -121.7234.",
  date: "2026-12-05 to 2027-01-05, as YYYY-MM-DD or YYYY-MM-DD HH:MM; the time defaults to 11:00.",
  candidateDates:
    "2 to 25 dates, one per line, as YYYY-MM-DD or YYYY-MM-DD HH:MM (24-hour); the time defaults to 11:00.",
  initialLocations:
    "Up to 25, each up to 80 characters. Members can propose more.",
  timeZone:
    "Dates are planned in this time zone; a date typed without a time starts at 11:00.",
  homeArea: "A city or region. Leave it empty to look locations up worldwide.",
  votingChannel:
    "Where the location and date polls are posted. Text channels only.",
  announcementsChannel:
    "Where results are announced. Text or announcement channels.",
  hikeThreadsChannel:
    "The forum that gets a thread for each hike. Forum channels only.",
  adminRole:
    "Members with this role can use the admin panel, besides the server owner.",
} as const;

/** A server's channels by category, as a channel select lists them. */
export const CHANNEL_GROUPS = [
  {
    group: "Hiking",
    options: [
      "#trail-talk",
      "#hike-votes",
      "#announcements",
      LONGEST_CHANNEL,
      "#trip-reports",
      "#carpools",
      "#gear-swap",
    ],
  },
  {
    group: "Seasons",
    options: [
      "#snowshoe-and-winter-trips",
      "#summer-backpacking",
      "#larch-march-2026",
    ],
  },
  {
    group: "Community",
    options: ["#general", "#introductions", "#photos", "#off-topic"],
  },
].map(({ group, options }) => ({
  group,
  options: options.map((label) => ({ value: label, label })),
}));

/** The server's roles, as a role select lists them. */
export const ROLES = [
  "Organisers",
  "Trail leaders",
  "Members",
  "Weekend regulars",
  "New hikers (first three hikes, ask in #introductions)",
].map((label) => ({ value: label, label }));

/**
 * Every IANA time zone the runtime knows, grouped by region (America,
 * Europe and so on), so the long list is easy to scan.
 */
export function timeZoneGroups() {
  const zones = Intl.supportedValuesOf("timeZone");
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const region = zone.includes("/") ? (zone.split("/")[0] ?? zone) : "Other";
    groups.set(region, [...(groups.get(region) ?? []), zone]);
  }
  return [...groups].map(([group, names]) => ({
    group,
    options: names.map((name) => ({ value: name, label: name })),
  }));
}

/** The short names the bot accepts for a time zone, and what they mean. */
export const TIME_ZONE_CHOICES = [
  { value: "America/Los_Angeles", label: "PT", hint: "America/Los_Angeles" },
  { value: "America/Denver", label: "MT", hint: "America/Denver" },
  { value: "America/Chicago", label: "CT", hint: "America/Chicago" },
  { value: "America/New_York", label: "ET", hint: "America/New_York" },
  { value: "UTC", label: "UTC", hint: "Coordinated Universal Time" },
];

/** The next two weekends at 11:00, as the bot prefills a date vote. */
export const CANDIDATE_DATES = [
  { value: "2026-12-05 11:00", label: "Sat, 5 Dec 2026 · 11:00" },
  { value: "2026-12-06 11:00", label: "Sun, 6 Dec 2026 · 11:00" },
  { value: "2026-12-12 11:00", label: "Sat, 12 Dec 2026 · 11:00" },
  { value: "2026-12-13 11:00", label: "Sun, 13 Dec 2026 · 11:00" },
];
