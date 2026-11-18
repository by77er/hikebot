/**
 * The page for a sign-in that could not finish: an expired or reused
 * sign-in link, or Discord failing to answer. It never shows the code or
 * state from the address.
 */
import { MessagePage } from "./message";

export function SignInFailedPage() {
  return (
    <MessagePage
      title="Sign-in failed"
      lead="hikebot could not finish signing you in. The sign-in may have taken longer than ten minutes, been used already, or Discord may not have answered."
      action={{ href: "/login", label: "Try again" }}
    />
  );
}
