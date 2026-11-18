/** The page for a form the Worker refused: no valid token, or another site. */
import { Layout } from "../layout";

export function ForbiddenPage() {
  return (
    <Layout title="Request refused · hikebot">
      <h1>Request refused</h1>
      <p>
        hikebot did not accept this form. It may have been open too long, or
        sent from another site. Go back, reload the page and try again.
      </p>
      <p>
        <a href="/">Go to the hikebot home page</a>
      </p>
    </Layout>
  );
}
