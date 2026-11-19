/** Style guide: Definition list of a server's settings, set and not set. */
import { DefinitionList } from "../../components/definition-list";
import { LONGEST_CHANNEL, LONGEST_NAME } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

const CHANGE = "/styleguide/definition-list";

function DefinitionListSection() {
  return (
    <Section
      id="definition-list"
      title="Definition list"
      intro="Settings and facts as names and values, each with an optional link to change it. A value that is not set says so in words."
    >
      <ExampleList
        examples={[
          {
            state: "Settings, set and not set, with change links",
            example: (
              <DefinitionList
                items={[
                  {
                    name: "Voting channel",
                    value: LONGEST_CHANNEL,
                    change: { href: CHANGE },
                  },
                  {
                    name: "Announcements channel",
                    value: "#announcements",
                    change: { href: CHANGE },
                  },
                  {
                    name: "Hike threads channel",
                    change: { href: CHANGE, label: "Set" },
                  },
                  {
                    name: "Admin role",
                    notSet: "Not set: only the server owner can use the panel.",
                    change: { href: CHANGE, label: "Set" },
                  },
                  {
                    name: "Time zone",
                    value: "America/Los_Angeles · now Wed 11:42",
                    change: { href: CHANGE },
                  },
                  {
                    name: "Home area",
                    value:
                      "Seattle, Washington (found as Seattle, King County, Washington, United States)",
                    change: { href: CHANGE },
                  },
                ]}
              />
            ),
          },
          {
            state: "Change link: hover, focus visible",
            example: (
              <DefinitionList
                items={[
                  {
                    name: "Voting channel",
                    value: "#hike-votes",
                    change: { href: CHANGE, preview: "hover" },
                  },
                  {
                    name: "Time zone",
                    value: "Europe/Berlin",
                    change: { href: CHANGE, preview: "focus" },
                  },
                ]}
              />
            ),
          },
          {
            state: "Facts without actions",
            example: (
              <DefinitionList
                items={[
                  { name: "Location", value: LONGEST_NAME },
                  { name: "Date", value: "Sat, 5 Dec 2026 · 11:00" },
                  { name: "Hike thread" },
                ]}
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const definitionListSection: StyleguideSection = {
  id: "definition-list",
  title: "Definition list",
  render: DefinitionListSection,
  ownPage: true,
};
