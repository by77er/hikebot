/** Style guide: Select in every state, for a channel, a role and a time zone. */
import { Select } from "../../components/select";
import {
  CHANNEL_GROUPS,
  HINTS,
  LONGEST_CHANNEL,
  ROLES,
  timeZoneGroups,
} from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

function SelectSection() {
  const zones = timeZoneGroups();
  const zoneCount = zones.reduce((sum, { options }) => sum + options.length, 0);
  return (
    <Section
      id="select"
      title="Select"
      intro="One choice from a list the server knows, as the browser's own select: it opens the phone's picker for a long list. A long option is cut off inside the box."
    >
      <ExampleList
        examples={[
          {
            state: "Nothing chosen yet, channels in their categories",
            example: (
              <Select
                id="select-voting"
                name="voting"
                label="Voting channel"
                hint={HINTS.votingChannel}
                placeholder="Pick the voting channel"
                options={CHANNEL_GROUPS}
              />
            ),
          },
          {
            state: "A 100-character channel chosen",
            example: (
              <Select
                id="select-long"
                name="voting"
                label="Voting channel"
                hint={HINTS.votingChannel}
                placeholder="Pick the voting channel"
                options={CHANNEL_GROUPS}
                value={LONGEST_CHANNEL}
              />
            ),
          },
          {
            state: "Hover",
            example: (
              <Select
                id="select-hover"
                name="announcements"
                label="Announcements channel"
                options={CHANNEL_GROUPS}
                value="#announcements"
                preview="hover"
              />
            ),
          },
          {
            state: "Focus visible",
            example: (
              <Select
                id="select-focus"
                name="announcements"
                label="Announcements channel"
                options={CHANNEL_GROUPS}
                value="#announcements"
                preview="focus"
              />
            ),
          },
          {
            state: "Required, in error",
            example: (
              <Select
                id="select-error"
                name="threads"
                label="Hike threads channel"
                required
                hint={HINTS.hikeThreadsChannel}
                placeholder="Pick the hike threads channel"
                options={CHANNEL_GROUPS}
                value="#trail-talk"
                error="That channel cannot be the hike threads channel. The forum that gets a thread for each hike. Forum channels only."
              />
            ),
          },
          {
            state: "A role; nothing chosen means not set",
            example: (
              <Select
                id="select-role"
                name="role"
                label="Admin role"
                hint={`${HINTS.adminRole} Choose Not set to leave the panel to the owner alone.`}
                placeholder="Not set"
                options={ROLES}
              />
            ),
          },
          {
            state: `A long list: all ${String(zoneCount)} time zones, by region`,
            example: (
              <Select
                id="select-zone"
                name="timezone"
                label="Time zone"
                hint={HINTS.timeZone}
                options={zones}
                value="America/Los_Angeles"
              />
            ),
          },
          {
            state: "Disabled",
            example: (
              <Select
                id="select-disabled"
                name="voting"
                label="Voting channel"
                hint={HINTS.votingChannel}
                options={CHANNEL_GROUPS}
                value="#hike-votes"
                disabled
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const selectSection: StyleguideSection = {
  id: "select",
  title: "Select",
  render: SelectSection,
  ownPage: true,
};
