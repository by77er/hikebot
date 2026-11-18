/** The pages for a path with no route and a method a route lacks. */
import { Button } from "../components/button";
import { ArrowLeftIcon } from "../components/icons";
import { Layout } from "../layout";

function ErrorPage({
  title,
  status,
  lead,
}: {
  title: string;
  status: number;
  lead: string;
}) {
  return (
    <Layout title={`${title} · hikebot`}>
      <div class="stack stack--loose">
        <div class="page-heading">
          <p class="page-heading__eyebrow">Error {status}</p>
          <h1>{title}</h1>
          <p class="page-heading__lead">{lead}</p>
        </div>
        <div class="cluster">
          <Button variant="primary" href="/" icon={ArrowLeftIcon}>
            Go to the home page
          </Button>
        </div>
      </div>
    </Layout>
  );
}

export function NotFoundPage() {
  return (
    <ErrorPage
      title="Page not found"
      status={404}
      lead="There is no page at this address. The link may be wrong, or the page may have moved."
    />
  );
}

export function MethodNotAllowedPage() {
  return (
    <ErrorPage
      title="Method not allowed"
      status={405}
      lead="This page does not accept that kind of request."
    />
  );
}
