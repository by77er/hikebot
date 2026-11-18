/**
 * The page for a sign-in that could not finish: an expired or reused
 * sign-in link, or Discord failing to answer. It never shows the code or
 * state from the address.
 */
import { Layout } from "../layout";

export function SignInFailedPage() {
  return (
    <Layout title="Sign-in failed · hikebot">
      <h1>Sign-in failed</h1>
      <p>
        hikebot could not finish signing you in. The sign-in may have taken
        longer than ten minutes, been used already, or Discord may not have
        answered.
      </p>
      <p>
        <a href="/login">Try again</a>
      </p>
    </Layout>
  );
}
