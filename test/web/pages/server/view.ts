/**
 * Fixed read-model data for the server page's tests: a `WebView` as
 * `readGuild` answers it, with no round, no planned hike and an empty log,
 * and builders for each step of a round. Times are in Europe/Berlin, so a
 * page that showed Pacific time would be caught.
 */
import type {
  WebOpenVote,
  WebRoundSection,
} from "../../../../src/features/round-section";
import type { WebMapPin } from "../../../../src/features/hike-place-section";
import type { WebHikeLogEntry } from "../../../../src/features/hike-log";
import type { WebPlannedHike } from "../../../../src/features/planned-hike-section";
import type {
  WebAdminAction,
  WebAdminSection,
} from "../../../../src/features/web-admin";
import {
  DATE_POLL,
  START_DATES_FIELD,
} from "../../../../src/features/date-vote";
import {
  LOCATION_POLL,
  START_LOCATIONS_FIELD,
} from "../../../../src/features/location-vote";
import {
  CANCEL_QUESTION,
  closeQuestion,
} from "../../../../src/features/poll-ui";
import type { WebView } from "../../../../src/guild/web-view";

export const GUILD = "200000000000007001";
export const VIEWER = "400000000000007001";
export const TIME_ZONE = "Europe/Berlin";
export const MARKUP = "<script>alert(1)</script><b>Ridge</b>";

/** A member's view of a server with nothing planned and no hikes. */
export function baseView(overrides: Partial<WebView> = {}): WebView {
  return {
    server: {
      id: GUILD,
      name: "Ridge Walkers",
      iconUrl: `https://cdn.discordapp.com/icons/${GUILD}/abc.png`,
    },
    viewer: { userId: VIEWER, isAdmin: false },
    settings: {
      timeZone: TIME_ZONE,
      voteChannel: null,
      announceChannel: null,
      forumChannel: null,
    },
    round: null,
    plannedHike: null,
    hikePlace: null,
    hikeForecast: null,
    schedule: null,
    log: { entries: [], page: 1, pageSize: 5, pages: 1, total: 0 },
    calendar: { url: `https://hikebot.example/calendar/${GUILD}/sig.ics` },
    admin: null,
    ...overrides,
  };
}

export function openVote(
  kind: "location" | "date",
  options: {
    label: string;
    votes: number;
    viewerVoted?: boolean;
    details?: string;
    place?: WebMapPin | null;
  }[],
  messageUrl:
    | string
    | null = `https://discord.com/channels/${GUILD}/300000000000007001/300000000000007002`,
): WebOpenVote {
  return {
    pollId: 1,
    kind,
    options: options.map((option, index) => ({
      optionId: index + 1,
      label: option.label,
      details: option.details ?? null,
      dateValue: null,
      proposedBy: VIEWER,
      place: option.place ?? null,
      votes: option.votes,
      viewerVoted: option.viewerVoted ?? false,
    })),
    voterCount: Math.max(0, ...options.map((option) => option.votes)),
    closesAt: null,
    messageUrl,
  };
}

export function round(
  step: WebRoundSection["step"],
  vote: WebOpenVote | null,
  location: string | null = null,
): WebRoundSection {
  return {
    roundId: 1,
    step,
    location:
      location === null
        ? null
        : { label: location, details: "Meet at the trailhead." },
    vote,
  };
}

export function plannedHike(
  overrides: Partial<WebPlannedHike> = {},
): WebPlannedHike {
  return {
    roundId: 12,
    location: {
      label: "Mailbox Peak",
      details: "Bring poles.",
      proposedBy: VIEWER,
    },
    start: {
      at: Date.UTC(2030, 5, 15, 7),
      date: "2030-06-15",
      time: "09:00",
      label: "Sat, 15 Jun 2030",
      timeZone: TIME_ZONE,
    },
    threadId: "300000000000007010",
    threadUrl: `https://discord.com/channels/${GUILD}/300000000000007010`,
    eventId: "300000000000007011",
    eventUrl: `https://discord.com/events/${GUILD}/300000000000007011`,
    mapPictureKey: null,
    ...overrides,
  };
}

/** Hike number `n` of the log, dated `n` days into June 2030. */
export function logEntry(
  n: number,
  label = `Hike ${String(n)}`,
): WebHikeLogEntry {
  const day = String(n).padStart(2, "0");
  return {
    roundId: n,
    location: { label, details: null, proposedBy: VIEWER },
    date: { value: `2030-06-${day} 09:30`, label: `2030-06-${day}` },
    threadUrl: `https://discord.com/channels/${GUILD}/3000000000000071${day}`,
    eventUrl: null,
    completedAt: Date.UTC(2030, 4, n),
  };
}

/** The log's page `page` of `total` hikes, newest first, `pageSize` a page. */
export function logSection(
  total: number,
  page: number,
  pageSize: number,
): WebView["log"] {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const newest = total - (page - 1) * pageSize;
  const count = Math.max(0, Math.min(pageSize, newest));
  return {
    entries: Array.from({ length: count }, (_, i) => logEntry(newest - i)),
    page,
    pageSize,
    pages,
    total,
  };
}

/** A control of the admin section, as `webAdminActions` makes it. */
export function adminAction(
  kind: WebAdminAction["kind"],
  overrides: Partial<WebAdminAction> = {},
): WebAdminAction {
  const base: Record<WebAdminAction["kind"], Omit<WebAdminAction, "kind">> = {
    "start-location-vote": plain("Start location vote", null, "primary"),
    "start-date-vote": plain("Start date vote", null, "primary"),
    "close-vote": {
      ...plain("Close location vote", 1, "primary"),
      confirm: closeQuestion(LOCATION_POLL),
    },
    "withdraw-date-vote": {
      ...plain("Withdraw date vote", 2, "quiet"),
      confirm: {
        question: "Withdraw the date vote?",
        consequence: "The date vote is taken back.",
      },
    },
    "cancel-round": {
      ...plain("Cancel round", 1, "danger"),
      confirm: CANCEL_QUESTION,
    },
    "post-vote-message": {
      ...plain("Post vote message", 1, "secondary"),
      note: "**The location vote is open**, but its message has not been posted. Click Post vote message to post it.",
    },
    "create-hike-thread": {
      ...plain("Create hike thread", 1, "secondary"),
      note: "**Hike thread:** not created. Could not create the hike thread in <#300000000000007003>: Discord answered: Missing Permissions (HTTP 403, code 50013).",
    },
    "create-hike-event": {
      ...plain("Create hike event", 1, "secondary"),
      note: "**Hike event:** not created. Click Create hike event to create it.",
    },
    "show-map-picture": {
      ...plain("Show map picture", 1, "secondary"),
      note: "**Map picture:** not shown. Click Show map picture to draw it.",
    },
    "post-hike-day": {
      ...plain("Post hike-day announcement", 1, "secondary"),
      note: "**Hike-day announcement:** not posted.",
    },
    announce: {
      ...plain("Announce date vote", 2, "secondary"),
      note: "**Date vote announcement:** not posted.",
    },
  };
  return { kind, ...base[kind], ...overrides };
}

function plain(
  label: string,
  target: number | null,
  style: WebAdminAction["style"],
): Omit<WebAdminAction, "kind"> {
  return { label, target, style, note: null, confirm: null };
}

/** An admin's section offering `actions`, with setup complete. */
export function adminSection(
  actions: WebAdminAction[],
  overrides: Partial<WebAdminSection> = {},
): WebAdminSection {
  return {
    actions,
    setupMissing: null,
    locationsField: { ...START_LOCATIONS_FIELD },
    datesField: {
      ...START_DATES_FIELD,
      value: ["2030-06-15 11:00", "2030-06-16 11:00"],
    },
    ...overrides,
  };
}

/** `view` as an admin sees it, offering `actions`. */
export function asAdmin(view: WebView, actions: WebAdminAction[]): WebView {
  return {
    ...view,
    viewer: { ...view.viewer, isAdmin: true },
    admin: adminSection(actions),
  };
}

/** The date vote's wording, for a close of the date vote. */
export const DATE_CLOSE = closeQuestion(DATE_POLL);
