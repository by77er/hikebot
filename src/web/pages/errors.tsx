/** The pages for a path with no route and a method a route lacks. */
import { Layout } from "../layout";

export function NotFoundPage() {
  return (
    <Layout title="Page not found · hikebot">
      <h1>Page not found</h1>
      <p>There is no page at this address.</p>
      <p>
        <a href="/">Go to the hikebot home page</a>
      </p>
    </Layout>
  );
}

export function MethodNotAllowedPage() {
  return (
    <Layout title="Method not allowed · hikebot">
      <h1>Method not allowed</h1>
      <p>This page does not accept that kind of request.</p>
      <p>
        <a href="/">Go to the hikebot home page</a>
      </p>
    </Layout>
  );
}
