/**
 * Form row: the frame of one form control, in a fixed order: the label,
 * the hint, the error, the control, then the character limit. The error
 * sits above the control so it is read before it and stays in view when a
 * phone's keyboard covers what is below. Every part but the label is
 * optional; the control names the hint, error and limit with
 * `aria-describedby` (from `describedBy`), so they are read with it. Text
 * field, textarea and select are drawn in it; use it directly only for a
 * control Cairn has no component for, such as a number field.
 */
import type { ComponentChildren } from "preact";
import { CircleAlertIcon } from "./icons";

/** The words around a control, shared by every form control. */
export interface FieldText {
  /** Names the control: a noun in sentence case, such as "Name". */
  label: ComponentChildren;
  /** What to enter and in what form, in the bot's words. */
  hint?: ComponentChildren;
  /** What is wrong and how to fix it, from the server's check. */
  error?: ComponentChildren;
  /** Marks the label "(required)" and sets `required` on the control. */
  required?: boolean;
}

/** The ids of a control's hint, error and limit, from its own id. */
export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error`, limit: `${id}-limit` };
}

/** The `aria-describedby` of a control: its hint, error and limit. */
export function describedBy(
  id: string,
  parts: { hint?: unknown; error?: unknown; limit?: unknown },
): string | undefined {
  const ids = fieldIds(id);
  const named = [
    parts.hint !== undefined && ids.hint,
    parts.error !== undefined && ids.error,
    parts.limit !== undefined && ids.limit,
  ].filter((value): value is string => typeof value === "string");
  return named.length > 0 ? named.join(" ") : undefined;
}

/**
 * "(required)" after a label. A control's own `required` says it to
 * assistive technology, so there it is hidden; a group's legend has no
 * such attribute, so there it is `spoken`.
 */
export function RequiredMark({ spoken }: { spoken?: boolean }) {
  return (
    <span class="form-row__required" aria-hidden={spoken ? undefined : "true"}>
      {" "}
      (required)
    </span>
  );
}

/** A field's error: an icon and "Error:" before the words, never colour alone. */
export function FieldError({
  id,
  children,
}: {
  id: string;
  children: ComponentChildren;
}) {
  return (
    <p class="form-row__error" id={id}>
      <CircleAlertIcon class="form-row__error-icon" />
      <span>
        <span class="u-visually-hidden">Error: </span>
        {children}
      </span>
    </p>
  );
}

export interface FormRowProps extends FieldText {
  /** The id of the control the label is for. */
  id: string;
  /** The most characters the control takes, said under it. */
  maxLength?: number;
  /** The control, with `id` and `describedBy(id, …)` set. */
  children: ComponentChildren;
}

export function FormRow({
  id,
  label,
  hint,
  error,
  required,
  maxLength,
  children,
}: FormRowProps) {
  const ids = fieldIds(id);
  return (
    <div class={error === undefined ? "form-row" : "form-row form-row--error"}>
      <label class="form-row__label" for={id}>
        {label}
        {required && <RequiredMark />}
      </label>
      {hint !== undefined && (
        <p class="form-row__hint" id={ids.hint}>
          {hint}
        </p>
      )}
      {error !== undefined && <FieldError id={ids.error}>{error}</FieldError>}
      {children}
      {maxLength !== undefined && (
        <p class="form-row__limit" id={ids.limit}>
          Up to {maxLength.toLocaleString("en")} characters.
        </p>
      )}
    </div>
  );
}
