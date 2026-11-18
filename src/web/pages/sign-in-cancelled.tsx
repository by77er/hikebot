/** The page for a sign-in the user cancelled at Discord. */
import { MessagePage } from "./message";

export function SignInCancelledPage() {
  return (
    <MessagePage
      title="Sign-in was cancelled"
      lead="You did not sign in. Discord told hikebot nothing about you."
      action={{ href: "/login", label: "Try again" }}
    />
  );
}
