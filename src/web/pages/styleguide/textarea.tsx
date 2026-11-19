/** Style guide: Textarea in every state, with the bot's fields at their limits. */
import { Textarea } from "../../components/textarea";
import { HINTS, LIMITS, LONGEST_DETAILS } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

function TextareaSection() {
  return (
    <Section
      id="textarea"
      title="Textarea"
      intro="Several lines of text, in the text field's box: a location's details, or dates and locations one per line."
    >
      <ExampleList
        examples={[
          {
            state: "Optional, with a hint and a limit, empty",
            example: (
              <Textarea
                id="textarea-details"
                name="details"
                label="Details"
                hint={HINTS.details}
                maxLength={LIMITS.details}
              />
            ),
          },
          {
            state: "Filled to the limit of 300 characters",
            example: (
              <Textarea
                id="textarea-details-full"
                name="details"
                label="Details"
                hint={HINTS.details}
                maxLength={LIMITS.details}
                value={LONGEST_DETAILS}
              />
            ),
          },
          {
            state: "Hover",
            example: (
              <Textarea
                id="textarea-hover"
                name="details"
                label="Details"
                hint={HINTS.details}
                maxLength={LIMITS.details}
                rows={2}
                preview="hover"
              />
            ),
          },
          {
            state: "Focus visible",
            example: (
              <Textarea
                id="textarea-focus"
                name="details"
                label="Details"
                hint={HINTS.details}
                maxLength={LIMITS.details}
                rows={2}
                preview="focus"
              />
            ),
          },
          {
            state: "Required, in error, keeping what was typed",
            example: (
              <Textarea
                id="textarea-dates"
                name="dates"
                label="Candidate dates (one per line)"
                required
                hint={HINTS.candidateDates}
                maxLength={LIMITS.candidateDates}
                rows={5}
                spellCheck={false}
                value={
                  "2026-12-05\n2026-02-30\n2026-12-12 09:00\n2026-11-28\n2026-12-19"
                }
                error={
                  <>
                    Line 2: <code>2026-02-30</code> is not a date. Line 4:{" "}
                    <code>2026-11-28</code> (Sat, 28 Nov 2026 · 11:00) is in the
                    past: today is 2026-12-01 in America/Los_Angeles.
                  </>
                }
              />
            ),
          },
          {
            state: "Read-only",
            example: (
              <Textarea
                id="textarea-read-only"
                name="details"
                label="Details"
                rows={2}
                value="Rattlesnake Ledge: 4 miles round trip, 1,160 feet of gain."
                readOnly
              />
            ),
          },
          {
            state: "Disabled",
            example: (
              <Textarea
                id="textarea-disabled"
                name="locations"
                label="Initial locations (one per line)"
                hint={HINTS.initialLocations}
                maxLength={LIMITS.initialLocations}
                rows={3}
                value={"Mailbox Peak\nRattlesnake Ledge\nLake Serene"}
                disabled
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const textareaSection: StyleguideSection = {
  id: "textarea",
  title: "Textarea",
  render: TextareaSection,
  ownPage: true,
};
