/** Style guide: Choice group of radios and of checkboxes, in every state. */
import { Button } from "../../components/button";
import { ChoiceGroup } from "../../components/choice-group";
import { FormActions } from "../../components/form-actions";
import { CANDIDATE_DATES, TIME_ZONE_CHOICES } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

const DATE_CHOICES = [
  ...CANDIDATE_DATES,
  {
    value: "2026-12-19 09:00",
    label: "Sat, 19 Dec 2026 · 09:00",
    hint: "Proposed by Ana",
  },
];

function ChoiceGroupSection() {
  return (
    <Section
      id="choice-group"
      title="Choice group"
      intro="The checkboxes or radios that answer one question: a fieldset whose legend asks it, with one hint and one error for the whole group."
    >
      <ExampleList
        examples={[
          {
            state: "Radios, in a form that submits",
            example: (
              <form
                class="stack"
                method="get"
                action="/styleguide/choice-group#choice-group"
              >
                <ChoiceGroup
                  type="radio"
                  id="choice-group-zone"
                  name="timezone"
                  legend="Time zone"
                  hint="Dates are planned in this time zone."
                  required
                  choices={TIME_ZONE_CHOICES}
                  value="America/Los_Angeles"
                />
                <FormActions>
                  <Button variant="primary">Set time zone</Button>
                  <Button href="/styleguide">Back</Button>
                </FormActions>
              </form>
            ),
          },
          {
            state: "Radios in error, none chosen",
            example: (
              <ChoiceGroup
                type="radio"
                id="choice-group-zone-error"
                name="timezone-error"
                legend="Time zone"
                hint="Dates are planned in this time zone."
                required
                choices={TIME_ZONE_CHOICES}
                error="No time zone was chosen, so it is still America/Los_Angeles."
              />
            ),
          },
          {
            state: "Checkboxes, some chosen",
            example: (
              <ChoiceGroup
                type="checkbox"
                id="choice-group-dates"
                name="dates"
                legend="Candidate dates"
                hint="2 to 25 dates. Members can propose more."
                choices={DATE_CHOICES}
                value={["2026-12-05 11:00", "2026-12-06 11:00"]}
              />
            ),
          },
          {
            state: "Checkboxes in error, keeping the one chosen",
            example: (
              <ChoiceGroup
                type="checkbox"
                id="choice-group-dates-error"
                name="dates-error"
                legend="Candidate dates"
                hint="2 to 25 dates. Members can propose more."
                choices={DATE_CHOICES}
                value={["2026-12-12 11:00"]}
                error="You chose 1 date; a date vote needs 2 to 25 different dates."
              />
            ),
          },
          {
            state: "Disabled",
            example: (
              <ChoiceGroup
                type="radio"
                id="choice-group-disabled"
                name="timezone-disabled"
                legend="Time zone"
                choices={TIME_ZONE_CHOICES.slice(0, 2)}
                value="America/Los_Angeles"
                disabled
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const choiceGroupSection: StyleguideSection = {
  id: "choice-group",
  title: "Choice group",
  render: ChoiceGroupSection,
  ownPage: true,
};
