/**
 * Select: one choice from a list the server already knows, such as a
 * channel, a role or a time zone, as the browser's own `<select>`, in a
 * form row with its label, hint and error. The native control works
 * without JavaScript, with every keyboard and screen reader, and opens
 * the phone's own picker for a long list. Group long lists with `group`
 * (a channel's category); start with a `placeholder` option when nothing
 * is chosen yet. For two to five short choices that should all be seen,
 * use a radio group instead.
 */
import type { Preview } from "./button";
import { describedBy, FormRow, type FieldText } from "./form-row";

export interface SelectOption {
  value: string;
  /** Shown as text, never as markup. */
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  /** The group's name, such as a channel category. */
  group: string;
  options: SelectOption[];
}

export interface SelectProps extends FieldText {
  id: string;
  name: string;
  options: (SelectOption | SelectGroup)[];
  /** The chosen value, or what was chosen before the form came back. */
  value?: string;
  /** A first option with an empty value, such as "Pick the voting channel". */
  placeholder?: string;
  disabled?: boolean;
  preview?: Preview;
}

function Option({ option, chosen }: { option: SelectOption; chosen?: string }) {
  return (
    <option
      value={option.value}
      selected={option.value === chosen}
      disabled={option.disabled}
    >
      {option.label}
    </option>
  );
}

export function Select({
  id,
  name,
  label,
  hint,
  error,
  required,
  options,
  value,
  placeholder,
  disabled,
  preview,
}: SelectProps) {
  return (
    <FormRow
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <span class="select">
        <select
          class="input select__input"
          id={id}
          name={name}
          required={required}
          disabled={disabled}
          aria-invalid={error !== undefined ? "true" : undefined}
          aria-describedby={describedBy(id, { hint, error })}
          data-preview={preview}
        >
          {placeholder !== undefined && (
            <option value="" selected={value === undefined || value === ""}>
              {placeholder}
            </option>
          )}
          {options.map((entry) =>
            "group" in entry ? (
              <optgroup key={entry.group} label={entry.group}>
                {entry.options.map((option) => (
                  <Option key={option.value} option={option} chosen={value} />
                ))}
              </optgroup>
            ) : (
              <Option key={entry.value} option={entry} chosen={value} />
            ),
          )}
        </select>
      </span>
    </FormRow>
  );
}
