import { describe, expect, it } from "vitest";
import { Pagination } from "../../../src/web/components/pagination";
import { render, spokenText } from "./render";

describe("Pagination", () => {
  it("is a named navigation with Newer, the position in words and Older", async () => {
    const html = render(
      <Pagination
        label="Hike log pages"
        position="43 hikes · page 2 of 5"
        newer="/log?page=1"
        older="/log?page=3"
      />,
    );
    expect(html).toMatch(
      /^<nav class="pagination" aria-label="Hike log pages">/,
    );
    expect(html).toContain('href="/log?page=1"');
    expect(html).toContain('href="/log?page=3"');
    expect(await spokenText(html)).toBe(
      "Hike log pages Newer 43 hikes · page 2 of 5 Older",
    );
  });

  it("disables Newer on the first page: no link to follow or focus", () => {
    const html = render(
      <Pagination label="Pages" position="Page 1 of 5" older="/log?page=2" />,
    );
    const newer =
      /<span class="pagination__newer">([^]*?)<\/span><p/.exec(html)?.[1] ?? "";
    expect(newer).toContain('role="link" aria-disabled="true"');
    expect(newer).not.toContain("href");
    expect(html.match(/href=/g)).toHaveLength(1);
  });

  it("disables Older on the last page", () => {
    const html = render(
      <Pagination label="Pages" position="Page 5 of 5" newer="/log?page=4" />,
    );
    const older =
      /<span class="pagination__older">([^]*)<\/span><\/nav>/.exec(html)?.[1] ??
      "";
    expect(older).toContain('aria-disabled="true"');
    expect(older).not.toContain("href");
  });
});
