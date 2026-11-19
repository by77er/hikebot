/**
 * What the server's page needs for its forms besides the view: the CSRF
 * token every form posts, and an action the guild object refused, with
 * the bot's sentence and what the member sent, so the form comes back as
 * it was. The form a refusal belongs to shows it; when that form is no
 * longer on the page (the vote closed since the page loaded), the page
 * shows the sentence at its top instead.
 */
import type { WebOpenVote } from "../../../features/round-section";
import type { WebView } from "../../../guild/web-view";

/** The forms an action is sent from. */
export type FormName = "votes" | "location" | "again" | "date";

/** A refused action: the poll it was for, the bot's sentence, what was sent. */
export type Refusal = {
  pollId: number;
  /** The bot's sentence, in Discord markdown (`**Lake**`). */
  message: string;
  /** The store's refusal, such as `duplicate_option`. */
  code: string;
} & (
  | { form: "votes"; optionIds: number[] }
  | { form: "location"; name: string; details: string; map: string }
  | { form: "again"; optionId: number }
  | { form: "date"; date: string; time: string }
);

export interface PageForms {
  csrf: string;
  refusal: Refusal | null;
}

/** Where the vote form of poll `pollId` posts. */
export function votesPath(guildId: string, pollId: number): string {
  return `/g/${guildId}/polls/${String(pollId)}/votes`;
}

/** Where the propose forms of poll `pollId` post. */
export function optionsPath(guildId: string, pollId: number): string {
  return `/g/${guildId}/polls/${String(pollId)}/options`;
}

/** Whether `vote` shows the form `form`. */
export function offersForm(vote: WebOpenVote, form: FormName): boolean {
  const { propose } = vote;
  switch (form) {
    case "votes":
      return vote.options.length > 0;
    case "location":
      return propose.kind === "location" && propose.refusal === null;
    case "again":
      return (
        propose.kind === "location" &&
        propose.refusal === null &&
        propose.again.length > 0
      );
    case "date":
      return propose.kind === "date" && propose.refusal === null;
  }
}

/**
 * The refusal the form `form` of the open vote shows, or null: one for
 * that form and that poll, while the page still shows the form.
 */
export function refusalFor<F extends FormName>(
  view: WebView,
  forms: PageForms,
  form: F,
): Extract<Refusal, { form: F }> | null {
  const refusal = forms.refusal;
  const vote = view.round?.vote ?? null;
  if (
    refusal === null ||
    refusal.form !== form ||
    vote === null ||
    vote.pollId !== refusal.pollId ||
    !offersForm(vote, form)
  ) {
    return null;
  }
  return refusal as Extract<Refusal, { form: F }>;
}

/** Whether the refusal has no form on the page to show it. */
export function orphanRefusal(view: WebView, forms: PageForms): boolean {
  const refusal = forms.refusal;
  return refusal !== null && refusalFor(view, forms, refusal.form) === null;
}
