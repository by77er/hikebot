/**
 * Radio: one of a few choices that exclude each other, such as a time
 * zone among PT, MT, CT, ET and UTC, with its label to the right and an
 * optional hint under it; the whole row is the target. Radios always come
 * in a choice group, which gives them their question (the legend), a hint
 * and an error; the arrow keys move between the radios of one `name`.
 * `checked` is what was chosen before, so a form returned with errors
 * keeps it; a settings page checks the current value, such as the
 * server's time zone.
 */
import type { ComponentChildren } from "preact";
import type { Preview } from "./button";
import { describedBy, fieldIds } from "./form-row";

export interface RadioProps {
  id: string;
  /** The same for every radio of one question. */
  name: string;
  value: string;
  label: ComponentChildren;
  hint?: ComponentChildren;
  checked?: boolean;
  /** Set on every radio of a question that must be answered. */
  required?: boolean;
  disabled?: boolean;
  /** Set by a choice group in error, so each radio is marked invalid. */
  invalid?: boolean;
  preview?: Preview;
}

export function Radio({
  id,
  name,
  value,
  label,
  hint,
  checked,
  required,
  disabled,
  invalid,
  preview,
}: RadioProps) {
  return (
    <div class="choice">
      <div class="choice__item">
        <input
          class="choice__input radio"
          type="radio"
          id={id}
          name={name}
          value={value}
          checked={checked}
          required={required}
          disabled={disabled}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy(id, { hint })}
          data-preview={preview}
        />
        <label class="choice__label" for={id}>
          {label}
        </label>
        {hint !== undefined && (
          <p class="choice__hint" id={fieldIds(id).hint}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
