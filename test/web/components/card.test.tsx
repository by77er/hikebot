import { describe, expect, it } from "vitest";
import { Card } from "../../../src/web/components/card";
import { render, spokenText } from "./render";

describe("Card", () => {
  it("is an article named by its h2 heading", async () => {
    const html = render(
      <Card title="Mailbox Peak" footer="11 votes">
        <p>Steep.</p>
      </Card>,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(html).toMatch(/^<article class="card" aria-labelledby="/);
    expect(html).toContain(
      `<h2 class="card__title" id="${id}">Mailbox Peak</h2>`,
    );
    expect(html).toContain('<div class="card__body"><p>Steep.</p></div>');
    expect(html).toContain('<div class="card__footer">11 votes</div>');
    expect(await spokenText(html)).toBe("Mailbox Peak Steep. 11 votes");
  });

  it("uses the heading level it is given", () => {
    expect(render(<Card title="Lake 22" headingLevel={3} />)).toContain(
      '<h3 class="card__title"',
    );
  });

  it("links the whole card through its title when given href", () => {
    const html = render(<Card title="Saturday hike" href="/hikes/1" />);
    expect(html).toMatch(/^<article class="card card--link"/);
    expect(html).toContain(
      '<a class="card__link" href="/hikes/1">Saturday hike</a>',
    );
  });

  it("previews focus on the link and other states on the card", () => {
    expect(render(<Card title="Hike" href="/h" preview="focus" />)).toContain(
      '<a class="card__link" href="/h" data-preview="focus">',
    );
    expect(render(<Card title="Hike" href="/h" preview="hover" />)).toMatch(
      /^<article class="card card--link" aria-labelledby="[^"]+" data-preview="hover">/,
    );
  });
});
