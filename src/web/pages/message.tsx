/**
 * A page that only says what happened and offers one way on: the error
 * pages and the sign-in outcomes. An optional eyebrow (such as "Error 404")
 * sits above the title.
 */
import { Button } from "../components/button";
import type { IconComponent } from "../components/icon";
import { Layout } from "../layout";

export interface MessagePageProps {
  title: string;
  eyebrow?: string;
  lead: string;
  /** The page's one action, a link drawn as the primary button. */
  action: { href: string; label: string; icon?: IconComponent };
}

export function MessagePage({
  title,
  eyebrow,
  lead,
  action,
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
        </div>
      </div>
    </Layout>
  );
}
