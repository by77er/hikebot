/**
 * A page that only says what happened and offers one way on: the error
 * pages and the sign-in outcomes. An optional eyebrow (such as "Error 404")
 * sits above the title, and an optional quiet second way (such as the way
 * home) follows the primary action.
 */
import { Button } from "../components/button";
import type { IconComponent } from "../components/icon";
import { ArrowLeftIcon } from "../components/icons";
import { Layout } from "../layout";

/** The way back from a page that went wrong. */
export const HOME_ACTION = {
  href: "/",
  label: "Go to the home page",
  icon: ArrowLeftIcon,
};

export interface MessagePageProps {
  title: string;
  eyebrow?: string;
  lead: string;
  /** The page's one action, a link drawn as the primary button. */
  action: MessageAction;
  /** Another way on, a link drawn as a quiet button. */
  secondary?: MessageAction;
}

export interface MessageAction {
  href: string;
  label: string;
  icon?: IconComponent;
}

export function MessagePage({
  title,
  eyebrow,
  lead,
  action,
  secondary,
}: MessagePageProps) {
  return (
    <Layout title={`${title} · hikebot`}>
      <div class="stack stack--loose">
        <div class="page-heading">
          {eyebrow !== undefined && (
            <p class="page-heading__eyebrow">{eyebrow}</p>
          )}
          <h1>{title}</h1>
          <p class="page-heading__lead">{lead}</p>
        </div>
        <div class="cluster">
          <Button variant="primary" href={action.href} icon={action.icon}>
            {action.label}
          </Button>
          {secondary && (
            <Button variant="quiet" href={secondary.href} icon={secondary.icon}>
              {secondary.label}
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
}
