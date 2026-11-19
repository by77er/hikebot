/** Style guide: Form row on a page of its own: its parts, and rows in a form. */
import { Button } from "../../components/button";
import { FormActions } from "../../components/form-actions";
import { describedBy, FormRow } from "../../components/form-row";
import { Textarea } from "../../components/textarea";
import { TextField } from "../../components/text-field";
import { HINTS, LIMITS } from "./form-content";
import { ExampleList, Section, type StyleguideSection } from "./section";

function FormRowSection() {
  // The last example is a whole form that submits to this page.
  return (
    <Section
      id="form-row"
      title="Form row"
      intro="The frame of every form control: label, hint, error, the control, its limit, always in that order, 4px apart. Rows in a form are 32px apart (stack--loose), and the actions follow the last one."
    >
      <ExampleList
        examples={[
          {
            state: "Every part: label, hint, error, control, limit",
            example: (
              <TextField
                id="form-row-all"
                name="name"
                label="Name"
                required
                hint="The place to hike, as members know it."
                maxLength={LIMITS.name}
                autoComplete="off"
                value="Mailbox Peak"
                error="Mailbox Peak is already on the list. Vote for it instead."
              />
            ),
          },
          {
            state: "Around a control Cairn has no component for",
            example: (
              <FormRow
                id="form-row-rest"
                label="Hikes a location rests"
                hint="A location that was hiked can be suggested again after this many hikes."
              >
                <input
                  class="input input--short"
                  id="form-row-rest"
                  name="rest"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={10}
                  value="2"
                  aria-describedby={describedBy("form-row-rest", {
                    hint: true,
                  })}
                />
              </FormRow>
            ),
          },
          {
            state: "Rows in a form, then its actions",
            example: (
              <form
                class="stack stack--loose"
                method="get"
                action="/styleguide/form-row#form-row"
              >
                <TextField
                  id="form-row-name"
                  name="name"
                  label="Name"
                  required
                  maxLength={LIMITS.name}
                  autoComplete="off"
                />
                <Textarea
                  id="form-row-details"
                  name="details"
                  label="Details"
                  hint={HINTS.details}
                  maxLength={LIMITS.details}
                  rows={3}
                />
                <TextField
                  id="form-row-map"
                  name="map"
                  label="Map link or coordinates"
                  hint={HINTS.mapLink}
                  maxLength={LIMITS.mapLink}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FormActions>
                  <Button variant="primary">Propose a location</Button>
                  <Button href="/styleguide">Back</Button>
                </FormActions>
              </form>
            ),
          },
        ]}
      />
    </Section>
  );
}

export const formRowSection: StyleguideSection = {
  id: "form-row",
  title: "Form row",
  render: FormRowSection,
  ownPage: true,
};
