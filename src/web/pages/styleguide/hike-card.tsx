/** Style guide: Hike card, full and compact, upcoming and past. */
import { HikeCard, type HikeLinks } from "../../components/hike-card";
import { LONGEST_DETAILS, LONGEST_LOCATION } from "./samples";
import { Section, type StyleguideSection } from "./section";

const LINKS: HikeLinks = {
  thread: "https://discord.com/channels/400000000000000100/400000000000000700",
  event: "https://discord.com/events/400000000000000100/400000000000000800",
  calendar: "/styleguide/hike-card",
  map: "https://www.openstreetmap.org/?mlat=47.4337&mlon=-121.7685",
};

function HikeCardSection() {
  return (
    <Section
      id="hike-card"
      title="Hike card"
      intro="One hike: a calendar leaf and the bot's date label with the time and time zone, the location, the details, and links to the hike thread, the Discord event, the calendar and a map. Pine for a hike to come, sandstone for one that is past."
    >
      <h3>Full, upcoming, at the longest name and details</h3>
      <HikeCard
        headingLevel={4}
        location={LONGEST_LOCATION}
        details={LONGEST_DETAILS}
        proposer="Margarethe from the Thursday group"
        start={{
          date: "2026-12-05",
          time: "11:00",
          timeZone: "America/Los_Angeles",
        }}
        when="upcoming"
        links={LINKS}
      />
      <h3>Full, upcoming, without a thread, event or details yet</h3>
      <HikeCard
        headingLevel={4}
        location="Lake 22"
        proposer="kestrel_hikes"
        start={{ date: "2026-12-12", time: "09:00", timeZone: "Europe/London" }}
        when="upcoming"
        links={{ calendar: LINKS.calendar }}
      />
      <h3>Full, past</h3>
      <HikeCard
        headingLevel={4}
        location="Mailbox Peak"
        details="Old trail up, new trail down. 9.4 miles, 4,000 feet."
        proposer="Ana"
        start={{
          date: "2026-11-14",
          time: "08:30",
          timeZone: "America/Los_Angeles",
        }}
        when="past"
        links={{ thread: LINKS.thread, event: LINKS.event }}
      />
      <h3>Compact, in a list such as the hike log</h3>
      <ul class="stack list-reset">
        <li>
          <HikeCard
            size="compact"
            headingLevel={4}
            location={LONGEST_LOCATION}
            details={LONGEST_DETAILS}
            start={{
              date: "2026-12-05",
              time: "11:00",
              timeZone: "America/Los_Angeles",
            }}
            when="upcoming"
            links={{ thread: LINKS.thread, event: LINKS.event }}
          />
        </li>
        <li>
          <HikeCard
            size="compact"
            headingLevel={4}
            location="Mailbox Peak"
            start={{
              date: "2026-11-14",
              time: "08:30",
              timeZone: "America/Los_Angeles",
            }}
            when="past"
            links={{ thread: LINKS.thread }}
          />
        </li>
        <li>
          <HikeCard
            size="compact"
            headingLevel={4}
            location="Little Si"
            start={{
              date: "2026-10-31",
              time: "11:00",
              timeZone: "America/Los_Angeles",
            }}
            when="past"
          />
        </li>
      </ul>
    </Section>
  );
}

export const hikeCardSection: StyleguideSection = {
  id: "hike-card",
  title: "Hike card",
  render: HikeCardSection,
  ownPage: true,
};
