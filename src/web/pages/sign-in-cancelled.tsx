/** The page for a sign-in the user cancelled at Discord. */
import { Layout } from "../layout";

export function SignInCancelledPage() {
  return (
    <Layout title="Sign-in was cancelled · hikebot">
      <h1>Sign-in was cancelled</h1>
      <p>You did not sign in. Discord told hikebot nothing about you.</p>
      <p>
        <a href="/login">Try again</a>
      </p>
    </Layout>
  );
}
