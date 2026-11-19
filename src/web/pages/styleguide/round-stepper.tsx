/** Style guide: Round stepper at each step, and cancelled at each step. */
import {
  ROUND_STEPS,
  RoundStepper,
  type RoundStep,
} from "../../components/round-stepper";
import { Section, type StyleguideSection } from "./section";

const AT: Record<RoundStep, string> = {
  location: "Location vote open",
  date: "Location decided; date vote open or about to start",
  planned: "Hike planned: the round is complete",
};

function RoundStepperSection() {
  return (
    <Section
      id="round-stepper"
      title="Round stepper"
      intro="Where the round is: done, now (marked with the blaze) and to come, each said in words. A screen reader hears the current step as the current step."
    >
      <ul class="stack stack--loose list-reset">
        {ROUND_STEPS.map(({ step }) => (
          <li key={step} class="stack stack--tight">
            <h3 class="u-small u-muted">{AT[step]}</h3>
            <RoundStepper step={step} />
          </li>
        ))}
        {ROUND_STEPS.slice(0, 2).map(({ step, label }) => (
          <li key={`cancelled-${step}`} class="stack stack--tight">
            <h3 class="u-small u-muted">
              Cancelled during the {label.toLowerCase()}
            </h3>
            <RoundStepper step={step} cancelled />
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const roundStepperSection: StyleguideSection = {
  id: "round-stepper",
  title: "Round stepper",
  render: RoundStepperSection,
  ownPage: true,
};
