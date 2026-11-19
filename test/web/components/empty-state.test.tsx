import { describe, expect, it } from "vitest";
import { Button } from "../../../src/web/components/button";
import { EmptyState } from "../../../src/web/components/empty-state";
import { render, spokenText } from "./render";

describe("EmptyState", () => {
  it("is a section named by its heading, with the sentence on what happens next", async () => {
    const html = render(
      <EmptyState title="No hikes yet">
        The first one appears here when a date vote closes.
      </EmptyState>,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(html).toBe(
      `<section class="empty-state" aria-labelledby="${id}"><h2 class="empty-state__title" id="${id}">No hikes yet</h2><p class="empty-state__text">The first one appears here when a date vote closes.</p></section>`,
    );
    expect(await spokenText(html)).toBe(
      "No hikes yet The first one appears here when a date vote closes.",
    );
  });

  it("takes an optional action and a heading level", async () => {
    const html = render(
      <EmptyState
        title="No locations yet"
        headingLevel={3}
        action={
          <Button variant="primary" href="/propose">
            Propose a location
          </Button>
        }
      >
        There are no locations to vote for yet. Propose one first.
      </EmptyState>,
    );
    expect(html).toContain('<h3 class="empty-state__title"');
    expect(html).toContain(
      '<div class="empty-state__action"><a class="button button--primary" href="/propose">',
    );
    expect(await spokenText(html)).toMatch(/Propose a location$/);
  });

  it("renders its title as text", () => {
    const html = render(
      <EmptyState title="<script>alert(1)</script>">Nothing.</EmptyState>,
    );
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
