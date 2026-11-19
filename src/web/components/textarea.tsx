/**
 * Textarea: several lines of text, such as a location's details or a list
 * of candidate dates one per line, in a form row with its label, hint,
 * error and character limit. It looks like the text field (the `input`
 * class) and grows taller, not wider; the member can make it taller.
 * `value` is what was typed before, so a form returned with errors keeps
 * it.
 */
import type { Preview } from "./button";
import { describedBy, FormRow, type FieldText } from "./form-row";

export interface TextareaProps extends FieldText {
  id: string;
  name: string;
  /** What was typed before; shown as text, never as markup. */
  value?: string;
  /** Lines shown before it scrolls; defaults to 4. */
  rows?: number;
  /** Enforced with `maxlength` and said under the field. */
  maxLength?: number;
  spellCheck?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  preview?: Preview;
}

export function Textarea({
  id,
  name,
  label,
  hint,
  error,
  required,
  value,
  rows = 4,
  maxLength,
  spellCheck,
  disabled,
  readOnly,
  preview,
}: TextareaProps) {
  return (
    <FormRow
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      maxLength={maxLength}
    >
      <textarea
        class="input textarea"
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        spellcheck={spellCheck}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={error !== undefined ? "true" : undefined}
        aria-describedby={describedBy(id, {
          hint,
          error,
          limit: maxLength,
        })}
        data-preview={preview}
      >
        {value}
      </textarea>
    </FormRow>
  );
}
