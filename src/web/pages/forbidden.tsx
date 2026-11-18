/** The page for a form the Worker refused: no valid token, or another site. */
import { HOME_ACTION, MessagePage } from "./message";

export function ForbiddenPage() {
  return (
    <MessagePage
      title="Request refused"
      lead="hikebot did not accept this form. It may have been open too long, or sent from another site. Go back, reload the page and try again."
      action={HOME_ACTION}
    />
  );
}
