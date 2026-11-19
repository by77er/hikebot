/** Style guide: Checkbox on its own, in every state. */
import { Checkbox } from "../../components/checkbox";
import { CANDIDATE_DATES, LONGEST_NAME } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

const ANNOUNCE = {
  name: "announce",
  label: "Announce the location vote",
  hint: "Posts it in the announcements channel, #announcements.",
};

function CheckboxSection() {
  return (
    <Section
      id="checkbox"
      title="Checkbox"
      intro="A choice to turn on or off. The whole row is the target; several that answer one question go in a choice group."
    >
      <ExampleList
        examples={[
          {
            state: "Off",
            example: <Checkbox id="checkbox-off" {...ANNOUNCE} />,
          },
          {
            state: "On",
            example: <Checkbox id="checkbox-on" {...ANNOUNCE} checked />,
          },
          {
            state: "Hover",
            example: (
              <Checkbox id="checkbox-hover" {...ANNOUNCE} preview="hover" />
            ),
          },
          {
            state: "Focus visible",
            example: (
              <Checkbox id="checkbox-focus" {...ANNOUNCE} preview="focus" />
            ),
          },
          {
            state: "In error, on its own",
            example: (
              <Checkbox
                id="checkbox-error"
                {...ANNOUNCE}
                checked
                error="Set the announcements channel under Settings before announcing a vote."
              />
            ),
          },
          {
            state: "Disabled, off and on",
            example: (
              <div>
                <Checkbox
                  id="checkbox-disabled"
                  name="date"
                  label={CANDIDATE_DATES[0]?.label}
                  disabled
                />
                <Checkbox
                  id="checkbox-disabled-on"
                  name="date"
                  label={CANDIDATE_DATES[1]?.label}
                  checked
                  disabled
                />
              </div>
            ),
          },
          {
            state: "A label of 80 characters wraps beside the box",
            example: (
              <Checkbox
                id="checkbox-long"
                name="location"
                label={LONGEST_NAME}
                hint="Proposed by Ana · 4 votes"
                checked
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const checkboxSection: StyleguideSection = {
  id: "checkbox",
  title: "Checkbox",
  render: CheckboxSection,
  ownPage: true,
};
