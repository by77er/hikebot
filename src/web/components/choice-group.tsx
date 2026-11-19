/**
 * Choice group: the checkboxes or radios that answer one question, in a
 * `fieldset` whose `legend` is the question, with one hint and one error
 * for the whole group. Radios pick one of a few (two to five short
 * choices, all in view); checkboxes pick any number, such as the
 * candidate dates of a date vote. The first choice gets the group's `id`,
 * so the error summary's link to the group lands on it. `value` is what
 * was chosen before, so a form returned with errors keeps it.
 */
import type { ComponentChildren } from "preact";
import { Checkbox } from "./checkbox";
import {
  describedBy,
  FieldError,
  fieldIds,
  RequiredMark,
  type FieldText,
} from "./form-row";
import { Radio } from "./radio";

export interface Choice {
  value: string;
  /** Shown as text, never as markup. */
  label: ComponentChildren;
  hint?: ComponentChildren;
  disabled?: boolean;
}

export interface ChoiceGroupProps extends Omit<FieldText, "label"> {
  /** `radio` to pick one, `checkbox` to pick any number. */
  type: "radio" | "checkbox";
  /** The first choice's id; the others add `-2`, `-3` and so on. */
  id: string;
  name: string;
  /** The question, such as "Time zone" or "Candidate dates". */
  legend: ComponentChildren;
  choices: Choice[];
  /** The chosen value (radio) or values (checkbox). */
  value?: string | string[];
  disabled?: boolean;
}

export function ChoiceGroup({
  type,
  id,
  name,
  legend,
  hint,
  error,
  required,
  choices,
  value,
  disabled,
}: ChoiceGroupProps) {
  // The first choice has the group's id, and its own hint the id
  // `<id>-hint`, so the group's hint and error are named after `<id>-group`.
  const group = `${id}-group`;
  const ids = fieldIds(group);
  const chosen = new Set(
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  );
  const invalid = error !== undefined;
  return (
    <fieldset
      class={invalid ? "choice-group choice-group--error" : "choice-group"}
      aria-describedby={describedBy(group, { hint, error })}
      disabled={disabled}
    >
      <legend class="choice-group__legend">
        {legend}
        {required && <RequiredMark spoken />}
      </legend>
      {hint !== undefined && (
        <p class="form-row__hint" id={ids.hint}>
          {hint}
        </p>
      )}
      {invalid && <FieldError id={ids.error}>{error}</FieldError>}
      <div class="choice-group__choices">
        {choices.map((choice, index) => {
          const props = {
            id: index === 0 ? id : `${id}-${String(index + 1)}`,
            name,
            value: choice.value,
            label: choice.label,
            hint: choice.hint,
            checked: chosen.has(choice.value),
            disabled: choice.disabled,
            invalid,
          };
          return type === "radio" ? (
            <Radio key={choice.value} {...props} required={required} />
          ) : (
            <Checkbox key={choice.value} {...props} />
          );
        })}
      </div>
    </fieldset>
  );
}
