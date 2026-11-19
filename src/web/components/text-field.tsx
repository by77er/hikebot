/**
 * Text field: one line of text, such as a location's name, a date or a
 * time zone, in a form row with its label, hint, error and character
 * limit. Give it the `type`, `inputMode` and `autoComplete` that fit what
 * is typed, so a phone shows the right keyboard and the browser offers
 * only what helps. `value` is what the member typed before, so a form
 * returned with errors keeps it. For several lines use Textarea.
 */
import type { Preview } from "./button";
import { describedBy, FormRow, type FieldText } from "./form-row";

export type TextFieldType = "text" | "url" | "email" | "search" | "tel";

export type InputMode =
  "text" | "numeric" | "decimal" | "url" | "email" | "tel" | "search";

export interface TextFieldProps extends FieldText {
  id: string;
  name: string;
  /** What was typed before; shown as text, never as markup. */
  value?: string;
  /** Defaults to `text`; `url` only when nothing but a link is valid. */
  type?: TextFieldType;
  inputMode?: InputMode;
  /** An autofill token such as `address-level2`, or `off`. */
  autoComplete?: string;
  /** Off for codes and names a spell checker would mark. */
  spellCheck?: boolean;
  /** Enforced with `maxlength` and said under the field. */
  maxLength?: number;
  /** `short` for a value of a few characters, such as a date. */
  width?: "full" | "short";
  disabled?: boolean;
  readOnly?: boolean;
  preview?: Preview;
}

export function TextField({
  id,
  name,
  label,
  hint,
  error,
  required,
  value,
  type = "text",
  inputMode,
  autoComplete,
  spellCheck,
  maxLength,
  width = "full",
  disabled,
  readOnly,
  preview,
}: TextFieldProps) {
  return (
    <FormRow
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      maxLength={maxLength}
    >
      <input
        class={width === "short" ? "input input--short" : "input"}
        id={id}
        name={name}
        // Preact types each input type on its own and refuses a union of
        // them, which ESLint's view of the types does not see.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        type={type as "text"}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        spellcheck={spellCheck}
        autoCapitalize={spellCheck === false ? "none" : undefined}
        maxLength={maxLength}
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
      />
    </FormRow>
  );
}
