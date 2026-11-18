/** Style guide: Button in every variant and state, as a button and a link. */
import {
  Button,
  type ButtonVariant,
  type Preview,
} from "../../components/button";
import {
  ArrowLeftIcon,
  MapPinIcon,
  VoteIcon,
  XIcon,
} from "../../components/icons";
import type { IconComponent } from "../../components/icon";
import { Section, StateList, type StyleguideSection } from "./section";

const VARIANTS: {
  variant: ButtonVariant;
  label: string;
  icon: IconComponent;
  use: string;
}[] = [
  {
    variant: "primary",
    label: "Vote",
    icon: VoteIcon,
    use: "The one main action of a view.",
  },
  {
    variant: "secondary",
    label: "Propose a location",
    icon: MapPinIcon,
    use: "Other actions.",
  },
  {
    variant: "quiet",
    label: "Back",
    icon: ArrowLeftIcon,
    use: "Minor actions in a row of controls.",
  },
  {
    variant: "danger",
    label: "Cancel round",
    icon: XIcon,
    use: "Actions that destroy or cancel.",
  },
];

const STATES: { state: string; preview?: Preview; disabled?: boolean }[] = [
  { state: "Default" },
  { state: "Hover", preview: "hover" },
  { state: "Focus visible", preview: "focus" },
  { state: "Active", preview: "active" },
  { state: "Disabled", disabled: true },
];

function ButtonSection() {
  return (
    <Section
      id="button"
      title="Button"
      intro="A verb in the bot's words. One primary button per view; it may fill the width at the foot of a phone screen."
    >
      {VARIANTS.map(({ variant, label, icon, use }) => (
        <div class="stack stack--tight" key={variant}>
          <h3>
            {variant[0]?.toUpperCase()}
            {variant.slice(1)}
          </h3>
          <p>{use}</p>
          <StateList
            examples={STATES.map(({ state, preview, disabled }) => ({
              state: `${state}, button`,
              example: (
                <Button
                  variant={variant}
                  icon={icon}
                  type="button"
                  preview={preview}
                  disabled={disabled}
                >
                  {label}
                </Button>
              ),
            }))}
          />
          <StateList
            examples={STATES.map(({ state, preview, disabled }) => ({
              state: `${state}, link`,
              example: (
                <Button
                  variant={variant}
                  href="/styleguide#button"
                  preview={preview}
                  disabled={disabled}
                >
                  {label}
                </Button>
              ),
            }))}
          />
        </div>
      ))}
      <h3>Full width</h3>
      <Button variant="primary" icon={VoteIcon} type="button" block>
        Vote
      </Button>
    </Section>
  );
}

export const buttonSection: StyleguideSection = {
  id: "button",
  title: "Button",
  render: ButtonSection,
};
