/**
 * Renders a component to HTML for the component tests, and reads the text
 * a screen reader would announce from it: text content, plus the
 * `aria-label` of labelled elements, minus anything `aria-hidden`.
 */
import type { VNode } from "preact";
import { renderToString } from "preact-render-to-string";

export function render(node: VNode): string {
  return renderToString(node);
}

/** The accessible text of an HTML fragment, whitespace collapsed. */
export async function spokenText(html: string): Promise<string> {
  let hidden = 0;
  let text = "";
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        const isHidden = element.getAttribute("aria-hidden") === "true";
        const label = element.getAttribute("aria-label");
        // Elements are separate words, as a screen reader reads them.
        if (hidden === 0) text += label === null ? " " : ` ${label} `;
        if (isHidden) {
          hidden += 1;
          element.onEndTag(() => {
            hidden -= 1;
          });
        }
      },
      text(chunk) {
        if (hidden === 0) text += chunk.text;
      },
    })
    .transform(new Response(`<div>${html}</div>`))
    .text();
  return text.replace(/\s+/g, " ").trim();
}
