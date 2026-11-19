/**
 * Round stepper: where a hike round is, as the page's "where are we". The
 * three steps of a round (Location vote, Date vote, Hike planned) each say
 * in words whether they are done, the current one or still to come; the
 * current one carries the trail blaze and `aria-current="step"`. A
 * cancelled round says "Cancelled" on the step it stopped at, and the
 * steps after it were never reached. Use one per page, near the top.
 */
import { Blaze } from "./blaze";
import type { IconComponent } from "./icon";
import { CircleCheckIcon, CircleDashedIcon, CircleXIcon } from "./icons";

/** The step a round is at: its open vote, or the planned hike. */
export type RoundStep = "location" | "date" | "planned";

export const ROUND_STEPS: { step: RoundStep; label: string }[] = [
  { step: "location", label: "Location vote" },
  { step: "date", label: "Date vote" },
  { step: "planned", label: "Hike planned" },
];

type StepState = "done" | "current" | "upcoming" | "cancelled" | "skipped";

const STATE: Record<StepState, { word: string; icon?: IconComponent }> = {
  done: { word: "Done", icon: CircleCheckIcon },
  current: { word: "Now" },
  upcoming: { word: "To come", icon: CircleDashedIcon },
  cancelled: { word: "Cancelled", icon: CircleXIcon },
  skipped: { word: "Not reached", icon: CircleDashedIcon },
};

export interface RoundStepperProps {
  /** The step the round is at, or was at when it was cancelled. */
  step: RoundStep;
  /** The round was cancelled at `step`. */
  cancelled?: boolean;
}

function stateOf(
  index: number,
  at: number,
  step: RoundStep,
  cancelled: boolean,
): StepState {
  if (index < at) return "done";
  if (index > at) return cancelled ? "skipped" : "upcoming";
  if (cancelled) return "cancelled";
  // A planned hike is the end of the round: its last step is reached.
  return step === "planned" ? "done" : "current";
}

export function RoundStepper({ step, cancelled = false }: RoundStepperProps) {
  const at = ROUND_STEPS.findIndex((s) => s.step === step);
  return (
    <ol
      class={
        cancelled ? "round-stepper round-stepper--cancelled" : "round-stepper"
      }
      aria-label="Hike round"
    >
      {ROUND_STEPS.map(({ step: key, label }, index) => {
        const state = stateOf(index, at, step, cancelled);
        const { word, icon: StateIcon } = STATE[state];
        return (
          <li
            key={key}
            class={`round-stepper__step round-stepper__step--${state}`}
            aria-current={index === at ? "step" : undefined}
          >
            <span class="round-stepper__marker">
              {index === at && !cancelled ? (
                <Blaze />
              ) : (
                StateIcon && <StateIcon class="round-stepper__icon" />
              )}
            </span>
            <span class="round-stepper__label">{label}</span>
            <span class="round-stepper__state">{word}</span>
          </li>
        );
      })}
    </ol>
  );
}
