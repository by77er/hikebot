/** The pages for a path with no route and a method a route lacks. */
import { HOME_ACTION, MessagePage } from "./message";

export function NotFoundPage() {
  return (
    <MessagePage
      title="Page not found"
      eyebrow="Error 404"
      lead="There is no page at this address. The link may be wrong, or the page may have moved."
      action={HOME_ACTION}
    />
  );
}

export function MethodNotAllowedPage() {
  return (
    <MessagePage
      title="Method not allowed"
      eyebrow="Error 405"
      lead="This page does not accept that kind of request."
      action={HOME_ACTION}
    />
  );
}
