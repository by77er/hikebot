/** The pages for a path with no route and a method a route lacks. */
import { ArrowLeftIcon } from "../components/icons";
import { MessagePage } from "./message";

const HOME = { href: "/", label: "Go to the home page", icon: ArrowLeftIcon };

export function NotFoundPage() {
  return (
    <MessagePage
      title="Page not found"
      eyebrow="Error 404"
      lead="There is no page at this address. The link may be wrong, or the page may have moved."
      action={HOME}
    />
  );
}

export function MethodNotAllowedPage() {
  return (
    <MessagePage
      title="Method not allowed"
      eyebrow="Error 405"
      lead="This page does not accept that kind of request."
      action={HOME}
    />
  );
}
