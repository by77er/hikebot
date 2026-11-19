/**
 * Style guide: Confirmation, for an action that destroys something
 * (cancelling a round) and one that does not (closing a vote). Each is a
 * page of its own in the app; here they are framed with lower headings.
 * Their forms post to this page, which changes nothing.
 */
import { Banner } from "../../components/banner";
import { Confirmation } from "../../components/confirmation";
import { DefinitionList } from "../../components/definition-list";
import { CheckIcon, XIcon } from "../../components/icons";
import {
  ExampleList,
  Section,
  type SectionProps,
  type StyleguideSection,
} from "./section";

const BACK = { href: "/styleguide", label: "Back" };

function ConfirmationSection({ query }: SectionProps) {
  return (
    <Section
      id="confirmation"
      title="Confirmation"
      intro="A page, never a dialog, between a click and an action that cannot be undone: the bot's question, what will happen in its words, the action and the way back."
    >
      {query?.has("posted") && (
        <Banner tone="info" title="The form was posted.">
          This is the style guide: nothing was cancelled or closed.
        </Banner>
      )}
      <ExampleList
        examples={[
          {
            state: "Destroys something: the danger action",
            example: (
              <Confirmation
                headingLevel={3}
                eyebrow="Location vote · open"
                title="Cancel this round?"
                formAction="/styleguide/confirmation"
                action={{
                  label: "Cancel round",
                  variant: "danger",
                  icon: XIcon,
                }}
                back={BACK}
              >
                <p>
                  Any open vote closes without a result and its votes are
                  discarded. You can start a new round afterwards.
                </p>
                <DefinitionList
                  items={[
                    { name: "Location vote", value: "Open, 11 locations" },
                    { name: "Votes", value: "37 votes from 14 members" },
                  ]}
                />
              </Confirmation>
            ),
          },
          {
            state: "Ends something without destroying it: the primary action",
            example: (
              <Confirmation
                headingLevel={3}
                eyebrow="Location vote · open"
                title="Close the location vote now?"
                formAction="/styleguide/confirmation"
                action={{
                  label: "Close location vote",
                  variant: "primary",
                  icon: CheckIcon,
                }}
                back={BACK}
              >
                <p>
                  The location with the most votes wins; a tie is broken at
                  random. Members can no longer vote, and the result is
                  announced.
                </p>
                <DefinitionList
                  items={[
                    { name: "Leading", value: "Mailbox Peak, 12 votes" },
                    { name: "Locations", value: "11" },
                  ]}
                />
              </Confirmation>
            ),
          },
        ]}
      />
    </Section>
  );
}

export const confirmationSection: StyleguideSection = {
  id: "confirmation",
  title: "Confirmation",
  render: ConfirmationSection,
  ownPage: true,
};
