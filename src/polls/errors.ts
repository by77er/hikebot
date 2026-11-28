/** Why a poll operation was refused. Feature code maps each to a message. */
export type PollErrorCode =
  | "round_active"
  | "round_not_found"
  | "poll_not_found"
  | "poll_closed"
  | "invalid_state"
  | "invalid_label"
  | "invalid_details"
  | "invalid_date"
  | "date_in_past"
  | "date_too_far"
  | "date_outside_window"
  | "duplicate_option"
  | "too_many_options"
  | "too_few_options"
  | "unknown_option"
  | "no_options"
  | "location_on_cooldown"
  | "already_proposed";

export class PollError extends Error {
  override readonly name = "PollError";

  constructor(
    readonly code: PollErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

export function isPollError(
  error: unknown,
  code?: PollErrorCode,
): error is PollError {
  return (
    error instanceof PollError && (code === undefined || error.code === code)
  );
}
