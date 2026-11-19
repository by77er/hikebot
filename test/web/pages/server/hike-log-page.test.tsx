import { describe, expect, it } from "vitest";
import { HikeLogPage } from "../../../../src/web/pages/server/hike-log-page";
import { htmlResponse } from "../../../../src/web/response";
import { outline } from "../../helpers";
import { baseView, GUILD, logSection } from "./view";

const USER = { name: "Ana", avatar: null, csrf: "token" };

async function logPage(log: ReturnType<typeof logSection>) {
  const html = await htmlResponse(
    <HikeLogPage user={USER} view={baseView({ log })} />,
  ).text();
  return { html, page: await outline(html) };
}

describe("HikeLogPage", () => {
  it("shows the first page of ten, with Older and no Newer", async () => {
    const { html, page } = await logPage(logSection(12, 1, 10));
    expect(page.title).toBe("Hike log · Ridge Walkers · hikebot");
    expect([...html.matchAll(/<article/g)]).toHaveLength(10);
    expect(page.text).toContain("12 hikes · page 1 of 2");
    expect(page.text).toContain("Page 1 of 2");
    expect(page.text).toContain("Hike 12");
    expect(page.text).not.toContain("Hike 2<");
    expect(html).toContain(`href="/g/${GUILD}/log?page=2"`);
    expect(html).toMatch(
      /<a class="button button--secondary" role="link" aria-disabled="true"[^>]*>.*?Newer/,
    );
    expect(html).toContain(`<a class="back-link" href="/g/${GUILD}">`);
  });

  it("shows the older hikes on the second page, with Newer and no Older", async () => {
    const { html, page } = await logPage(logSection(12, 2, 10));
    expect([...html.matchAll(/<article/g)]).toHaveLength(2);
    expect(page.text).toContain("Hike 2");
    expect(page.text).toContain("Hike 1");
    expect(page.text).not.toContain("Hike 3");
    expect(html).toContain(`href="/g/${GUILD}/log"`);
    expect(html).toMatch(
      /<a class="button button--secondary" role="link" aria-disabled="true"[^>]*>.*?Older/,
    );
  });

  it("leaves the pagination out with one page", async () => {
    const { html, page } = await logPage(logSection(3, 1, 10));
    expect(html).not.toContain("pagination");
    expect(page.text).toContain("3 hikes");
  });

  it("says there are no hikes yet in the bot's words", async () => {
    const { page } = await logPage(logSection(0, 1, 10));
    expect(page.text).toContain(
      "No hikes yet. The first one appears here when a date vote closes.",
    );
  });
});
