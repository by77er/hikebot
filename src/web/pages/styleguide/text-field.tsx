/** Style guide: Text field in every state, with the bot's fields at their limits. */
import { TextField } from "../../components/text-field";
import { HINTS, LIMITS, LONGEST_NAME } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

function TextFieldSection() {
  return (
    <Section
      id="text-field"
      title="Text field"
      intro="One line of text: the label, a hint, an error, the field and its limit, in that order. The examples are the bot's own fields at their limits."
    >
      <ExampleList
        examples={[
          {
            state: "Required, with a limit, empty",
            example: (
              <TextField
                id="text-field-name"
                name="name"
                label="Name"
                required
                maxLength={LIMITS.name}
                autoComplete="off"
              />
            ),
          },
          {
            state: "Filled to the limit of 80 characters",
            example: (
              <TextField
                id="text-field-name-full"
                name="name"
                label="Name"
                required
                maxLength={LIMITS.name}
                autoComplete="off"
                value={LONGEST_NAME}
              />
            ),
          },
          {
            state: "Hover",
            example: (
              <TextField
                id="text-field-hover"
                name="name"
                label="Name"
                required
                maxLength={LIMITS.name}
                autoComplete="off"
                value="Rattlesnake Ledge"
                preview="hover"
              />
            ),
          },
          {
            state: "Focus visible",
            example: (
              <TextField
                id="text-field-focus"
                name="name"
                label="Name"
                required
                maxLength={LIMITS.name}
                autoComplete="off"
                value="Rattlesnake Ledge"
                preview="focus"
              />
            ),
          },
          {
            state: "Error, keeping what was typed",
            example: (
              <TextField
                id="text-field-error"
                name="name"
                label="Name"
                required
                maxLength={LIMITS.name}
                autoComplete="off"
                value="Mailbox Peak"
                error="Mailbox Peak is already on the list. Vote for it instead."
              />
            ),
          },
          {
            state: "Optional, with a hint; no spell check for links",
            example: (
              <TextField
                id="text-field-map"
                name="map"
                label="Map link or coordinates"
                hint={HINTS.mapLink}
                maxLength={LIMITS.mapLink}
                autoComplete="off"
                spellCheck={false}
              />
            ),
          },
          {
            state: "Short, for a date, in error",
            example: (
              <TextField
                id="text-field-date"
                name="date"
                label="Date"
                required
                width="short"
                hint={HINTS.date}
                maxLength={LIMITS.date}
                autoComplete="off"
                spellCheck={false}
                value="2026-02-30"
                error={
                  <>
                    <code>2026-02-30</code> is not a date. Write it as{" "}
                    <code>YYYY-MM-DD</code> or <code>YYYY-MM-DD HH:MM</code>{" "}
                    (24-hour), for example <code>2026-12-05</code> or{" "}
                    <code>2026-12-05 09:00</code>.
                  </>
                }
              />
            ),
          },
          {
            state: "Autofill: a city fills from the member's address",
            example: (
              <TextField
                id="text-field-home"
                name="home"
                label="Home area"
                hint={HINTS.homeArea}
                maxLength={LIMITS.homeArea}
                autoComplete="address-level2"
                value="Seattle, Washington"
              />
            ),
          },
          {
            state: "Read-only: it can be read and copied, not changed",
            example: (
              <TextField
                id="text-field-read-only"
                name="timezone"
                label="Time zone"
                hint={HINTS.timeZone}
                value="America/Los_Angeles"
                readOnly
              />
            ),
          },
          {
            state: "Disabled",
            example: (
              <TextField
                id="text-field-disabled"
                name="home"
                label="Home area"
                hint={HINTS.homeArea}
                maxLength={LIMITS.homeArea}
                autoComplete="address-level2"
                value="Seattle, Washington"
                disabled
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

export const textFieldSection: StyleguideSection = {
  id: "text-field",
  title: "Text field",
  render: TextFieldSection,
  ownPage: true,
};
