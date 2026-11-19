/**
 * The page for a sign-in the user cancelled at Discord: calm, one
 * sentence, Try again as its primary action, and the way home as a quiet
 * second one.
 */
import { HOME_ACTION, MessagePage } from "./message";

export function SignInCancelledPage() {
  return (
    <MessagePage
      title="Sign-in was cancelled"
      lead="You did not sign in, so Discord told hikebot nothing about you."
      action={{ href: "/login", label: "Try again" }}
      secondary={HOME_ACTION}
    />
  );
}
