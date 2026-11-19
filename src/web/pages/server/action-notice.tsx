/**
 * The server's page, under its heading: what the member's last action came
 * to. After a saved vote or an added proposal, the one-time banner ("Your
 * votes are saved.", "Added Lake."). After a refusal whose form is no
 * longer on the page, such as a vote sent after the vote closed, the bot's
 * sentence; a refusal whose form is still there is shown by that form.
 * Nothing otherwise.
 */
import type { WebView } from "../../../guild/web-view";
import { Banner } from "../../components/banner";
import type { Flash } from "../../flash";
import { BotSentence } from "./bot-sentence";
import { orphanRefusal, type PageForms } from "./forms";

export function ActionNotice({
  view,
  forms,
  flash,
}: {
  view: WebView;
  forms: PageForms;
  flash: Flash | null;
}) {
  if (forms.refusal !== null && orphanRefusal(view, forms)) {
    return (
      <Banner
        tone="danger"
        title={<BotSentence text={forms.refusal.message} />}
      />
    );
  }
  if (flash === null) return null;
  return (
    <Banner tone="success" title={flash.banner}>
      {flash.note !== null && <p>{flash.note}</p>}
    </Banner>
  );
}
