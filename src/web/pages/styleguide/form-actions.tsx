/** Style guide: Form actions, with each kind of primary action and a way back. */
import { Button } from "../../components/button";
import { FormActions } from "../../components/form-actions";
import { MapPinIcon, XIcon } from "../../components/icons";
import { ExampleList, Section, type StyleguideSection } from "./section";

const ACTION = "/styleguide/form-actions#form-actions";

function FormActionsSection() {
  return (
    <Section
      id="form-actions"
      title="Form actions"
      intro="The foot of a form: its one primary action, then the way back. On a phone they stack and fill the width, primary on top; on a desktop they sit in a row."
    >
      <ExampleList
        examples={[
          {
            state: "Primary action and a way back",
            example: (
              <form method="get" action={ACTION}>
                <FormActions>
                  <Button variant="primary" icon={MapPinIcon}>
                    Propose a location
                  </Button>
                  <Button href="/styleguide">Back</Button>
                </FormActions>
              </form>
            ),
          },
          {
            state: "Danger action and a way back",
            example: (
              <form method="get" action={ACTION}>
                <FormActions>
                  <Button variant="danger" icon={XIcon}>
                    Cancel round
                  </Button>
                  <Button href="/styleguide">Back</Button>
                </FormActions>
              </form>
            ),
          },
          {
            state: "The primary action alone, when the page has its back link",
            example: (
              <form method="get" action={ACTION}>
                <FormActions>
                  <Button variant="primary">Set home area</Button>
                </FormActions>
              </form>
            ),
          },
        ]}
      />
    </Section>
  );
}

export const formActionsSection: StyleguideSection = {
  id: "form-actions",
  title: "Form actions",
  render: FormActionsSection,
  ownPage: true,
};
