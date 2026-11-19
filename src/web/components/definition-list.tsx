/**
 * Definition list: settings or facts as name and value pairs, such as a
 * server's voting channel, time zone and admin role, each with an
 * optional action to change it. A value that has not been set says so in
 * words ("Not set", or the bot's longer sentence, such as "Not set: only
 * the server owner can use the panel."), in muted text, never as a blank.
 * The action is a link named after its row ("Change voting channel"), so
 * a list of them still makes sense out of context.
 */
import type { ComponentChildren } from "preact";
import { Button, type Preview } from "./button";

export interface DefinitionItem {
  /** The setting's name: "Voting channel". */
  name: string;
  /** Its value; leave it out, or null, when it is not set. */
  value?: ComponentChildren;
  /** What an unset value means; defaults to "Not set". */
  notSet?: ComponentChildren;
  /** The page that changes it; the link reads "Change" and the name. */
  change?: { href: string; label?: string; preview?: Preview };
}

export function DefinitionList({ items }: { items: DefinitionItem[] }) {
  return (
    <dl class="definition-list">
      {items.map(({ name, value, notSet, change }) => {
        const set = value !== undefined && value !== null;
        return (
          <div class="definition-list__row" key={name}>
            <dt class="definition-list__name">{name}</dt>
            <dd
              class={
                set
                  ? "definition-list__value"
                  : "definition-list__value definition-list__value--not-set"
              }
            >
              {set ? value : (notSet ?? "Not set")}
            </dd>
            {change !== undefined && (
              <dd class="definition-list__action">
                <Button
                  variant="quiet"
                  href={change.href}
                  preview={change.preview}
                >
                  {change.label ?? "Change"}
                  <span class="u-visually-hidden"> {name.toLowerCase()}</span>
                </Button>
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}
