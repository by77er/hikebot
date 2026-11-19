/**
 * Checkbox: a choice a member turns on or off, such as one candidate date
 * of a date vote, with its label to the right and an optional hint under
 * it; the whole row is the target. Alone it can carry its own error;
 * several that answer one question go in a choice group, which gives
 * them a legend, a hint and an error together. `checked` is what was
 * chosen before, so a form returned with errors keeps it.
 */
import type { ComponentChildren } from "preact";
import type { Preview } from "./button";
import { describedBy, FieldError, fieldIds } from "./form-row";

export interface CheckboxProps {
  id: string;
  name: string;
  /** Sent when checked; defaults to `on`, as the browser does. */
  value?: string;
  label: ComponentChildren;
  hint?: ComponentChildren;
  /** Only for a checkbox on its own; a group says its error once. */
  error?: ComponentChildren;
  checked?: boolean;
  disabled?: boolean;
  /** Set by a choice group in error, so each box is marked invalid. */
  invalid?: boolean;
  preview?: Preview;
}

export function Checkbox({
  id,
  name,
  value,
  label,
  hint,
  error,
  checked,
  disabled,
  invalid,
  preview,
}: CheckboxProps) {
  const ids = fieldIds(id);
  return (
    <div class={error === undefined ? "choice" : "choice choice--error"}>
      {error !== undefined && <FieldError id={ids.error}>{error}</FieldError>}
      <div class="choice__item">
        <input
          class="choice__input checkbox"
          type="checkbox"
          id={id}
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || error !== undefined ? "true" : undefined}
          aria-describedby={describedBy(id, { hint, error })}
          data-preview={preview}
        />
        <label class="choice__label" for={id}>
          {label}
        </label>
        {hint !== undefined && (
          <p class="choice__hint" id={ids.hint}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
