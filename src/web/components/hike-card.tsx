/**
 * Hike card: one planned or past hike. A date block (a calendar leaf with
 * the weekday, day and month, and a line with the bot's date label, the
 * time and the time zone), the location as its heading, the details and
 * the proposer, and a row of links to the hike thread, the Discord event,
 * the calendar feed and a map, with room for a small map picture. `full`
 * for the page of one hike or the planned hike on a server's page;
 * `compact` (no details, proposer or picture) for lists such as the hike
 * log. An upcoming hike says "Planned", a past one "Past hike". The
 * location's name is the card's accessible name.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import type { IconComponent } from "./icon";
import {
  CalendarIcon,
  CalendarPlusIcon,
  ClockIcon,
  MapIcon,
  MessagesSquareIcon,
} from "./icons";
import { StatusPill } from "./status-pill";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface HikeStart {
  /** The calendar day in the server's time zone, `YYYY-MM-DD`. */
  date: string;
  /** The wall-clock time there, `HH:MM`. */
  time: string;
  /** The server's time zone, such as `America/Los_Angeles`. */
  timeZone: string;
}

export interface HikeLinks {
  thread?: string | null;
  event?: string | null;
  calendar?: string | null;
  map?: string | null;
}

export interface HikeCardProps {
  location: string;
  details?: string | null;
  /** Who proposed the location, by name. */
  proposer?: string | null;
  start: HikeStart;
  /** Whether the hike is still to come; a past hike is drawn quieter. */
  when: "upcoming" | "past";
  /** Defaults to `full`. */
  size?: "full" | "compact";
  links?: HikeLinks;
  /** A small map picture, in the full card only. */
  picture?: ComponentChildren;
  /** Defaults to 2; pick it to follow the page's outline. */
  headingLevel?: 2 | 3 | 4;
}

/** The parts of a `YYYY-MM-DD` day: "Sat", "5", "Dec", "2026". */
export function dayParts(date: string) {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    weekday: WEEKDAYS[weekday] ?? "",
    day: String(day),
    month: MONTHS[month - 1] ?? "",
    year: String(year),
  };
}

const LINKS: { key: keyof HikeLinks; label: string; icon: IconComponent }[] = [
  { key: "thread", label: "Hike thread", icon: MessagesSquareIcon },
  { key: "event", label: "Hike event", icon: CalendarIcon },
  { key: "calendar", label: "Calendar", icon: CalendarPlusIcon },
  { key: "map", label: "Map", icon: MapIcon },
];

export function HikeCard({
  location,
  details,
  proposer,
  start,
  when,
  size = "full",
  links = {},
  picture,
  headingLevel = 2,
}: HikeCardProps) {
  const titleId = useId();
  const Heading = (["h2", "h3", "h4"] as const)[headingLevel - 2] ?? "h2";
  const { weekday, day, month, year } = dayParts(start.date);
  const full = size === "full";
  const shown = LINKS.filter(({ key }) => links[key]);
  return (
    <article
      class={`hike-card hike-card--${size} hike-card--${when}`}
      aria-labelledby={titleId}
    >
      <p class="hike-card__leaf" aria-hidden="true">
        <span class="hike-card__weekday">{weekday}</span>
        <span class="hike-card__day">{day}</span>
        <span class="hike-card__month">{month}</span>
      </p>
      <div class="hike-card__body">
        <Heading class="hike-card__title" id={titleId}>
          {location}
        </Heading>
        <p class="hike-card__time">
          <ClockIcon class="hike-card__icon" size="small" />
          <span>
            <time datetime={`${start.date}T${start.time}`}>
              {`${weekday}, ${day} ${month} ${year} · ${start.time}`}
            </time>{" "}
            <span class="hike-card__zone">{start.timeZone}</span>
          </span>
        </p>
        <p class="hike-card__state">
          {when === "upcoming" ? <StatusPill status="planned" /> : "Past hike"}
        </p>
        {full && details && <p class="hike-card__details">{details}</p>}
        {full && proposer && (
          <p class="hike-card__proposer">Proposed by {proposer}</p>
        )}
        {full && picture !== undefined && (
          <div class="hike-card__picture">{picture}</div>
        )}
        {shown.length > 0 && (
          <ul class="hike-card__links">
            {shown.map(({ key, label, icon: LinkIcon }) => (
              <li key={key}>
                <a class="hike-card__link" href={links[key] ?? undefined}>
                  <LinkIcon class="hike-card__icon" size="small" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
