/** Style guide: Radio on a page of its own, one choice in every state. */
import { Radio } from "../../components/radio";
import { LONGEST_NAME } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

const PACIFIC = {
  value: "America/Los_Angeles",
  label: "PT",
  hint: "America/Los_Angeles",
};

function RadioSection() {
  // Each radio gets a name of its own, so every state shows at once.
  return (
    <Section
      id="radio"
      title="Radio"
      intro="One of a few choices that exclude each other. Radios always come in a choice group, which asks the question; each one here is shown on its own, in its own group name."
    >
      <ExampleList
        examples={[
          {
            state: "Not chosen",
            example: <Radio id="radio-off" name="radio-off" {...PACIFIC} />,
          },
          {
            state: "Chosen",
            example: (
              <Radio id="radio-on" name="radio-on" {...PACIFIC} checked />
            ),
          },
          {
            state: "Hover",
            example: (
              <Radio
                id="radio-hover"
                name="radio-hover"
                {...PACIFIC}
                preview="hover"
              />
            ),
          },
          {
            state: "Focus visible",
            example: (
              <Radio
                id="radio-focus"
                name="radio-focus"
                {...PACIFIC}
                checked
                preview="focus"
              />
            ),
          },
          {
            state: "In a group in error",
            example: (
              <Radio
                id="radio-invalid"
                name="radio-invalid"
                {...PACIFIC}
                invalid
              />
            ),
          },
          {
            state: "Disabled, not chosen and chosen",
            example: (
              <div>
                <Radio
                  id="radio-disabled"
                  name="radio-disabled"
                  value="UTC"
                  label="UTC"
                  disabled
                />
                <Radio
                  id="radio-disabled-on"
                  name="radio-disabled-on"
                  {...PACIFIC}
                  checked
                  disabled
                />
              </div>
            ),
          },
          {
            state: "A label of 80 characters wraps beside the circle",
            example: (
              <Radio
                id="radio-long"
                name="radio-long"
                value="mount-si"
                label={LONGEST_NAME}
                hint="Proposed by Ana · 4 votes"
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const radioSection: StyleguideSection = {
  id: "radio",
  title: "Radio",
  render: RadioSection,
  ownPage: true,
};
