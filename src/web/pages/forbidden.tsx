/** The page for a form the Worker refused: no valid token, or another site. */
import { ArrowLeftIcon } from "../components/icons";
import { MessagePage } from "./message";

export function ForbiddenPage() {
  return (
    <MessagePage
      title="Request refused"
      lead="hikebot did not accept this form. It may have been open too long, or sent from another site. Go back, reload the page and try again."
      action={{ href: "/", label: "Go to the home page", icon: ArrowLeftIcon }}
    />
  );
}
