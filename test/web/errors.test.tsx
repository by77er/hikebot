import { describe, expect, it } from "vitest";
import { MethodNotAllowedPage, NotFoundPage } from "../../src/web/pages/errors";
import { ForbiddenPage } from "../../src/web/pages/forbidden";
import { htmlResponse } from "../../src/web/response";
import { outline } from "./helpers";

async function render(page: preact.JSX.Element) {
  const html = await htmlResponse(page).text();
  return { html, page: await outline(html) };
}

describe("the error pages", () => {
  it("say a 404 in words, with one primary action back home", async () => {
    const { html, page } = await render(<NotFoundPage />);
    expect(page.title).toBe("Page not found · hikebot");
    expect(page.text).toContain("Error 404");
    expect(page.text).toContain(
      "There is no page at this address. The link may be wrong, or the page may have moved.",
    );
    expect(html).toContain('<p class="page-heading__eyebrow">Error 404</p>');
    expect(html).toContain("<h1>Page not found</h1>");
    expect(
      [
        ...html.matchAll(/<a class="button button--primary" href="([^"]*)">/g),
      ].map(([, href]) => href),
    ).toEqual(["/"]);
    expect(page.text).toContain("Go to the home page");
  });

  it("say a 405 in words, with the same way back home", async () => {
    const { html, page } = await render(<MethodNotAllowedPage />);
    expect(page.title).toBe("Method not allowed · hikebot");
    expect(page.text).toContain("Error 405");
    expect(page.text).toContain(
      "This page does not accept that kind of request.",
    );
    expect(html).toContain('<a class="button button--primary" href="/">');
  });

  it("say a refused form in words, with the same way back home", async () => {
    const { html, page } = await render(<ForbiddenPage />);
    expect(page.title).toBe("Request refused · hikebot");
    expect(html).toContain("<h1>Request refused</h1>");
    expect(page.text).toContain(
      "hikebot did not accept this form. It may have been open too long, or sent from another site. Go back, reload the page and try again.",
    );
    expect(
      [
        ...html.matchAll(/<a class="button button--primary" href="([^"]*)">/g),
      ].map(([, href]) => href),
    ).toEqual(["/"]);
    expect(page.text).toContain("Go to the home page");
  });
});
