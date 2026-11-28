import { describe, expect, it } from "vitest";
import { MethodNotAllowedPage, NotFoundPage } from "../../src/web/pages/errors";
import { ForbiddenPage } from "../../src/web/pages/forbidden";
import { MessagePage } from "../../src/web/pages/message";
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
    // No "Error 404" eyebrow: the title says it in words.
    expect(page.text).not.toContain("404");
    expect(page.text).toContain(
      "There is no page at this address. The link may be wrong, or the page may have moved.",
    );
    expect(html).not.toContain("page-heading__eyebrow");
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
    expect(page.text).not.toContain("405");
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

  it("show the signed-in user's menu only on a message page given the user", async () => {
    const props = {
      title: "Discord could not be reached",
      lead: "Try again.",
      action: { href: "/", label: "Try again" },
    };
    const signedIn = await render(
      <MessagePage
        {...props}
        user={{ name: "Ana", avatar: null, csrf: "t" }}
      />,
    );
    expect(signedIn.page.text).toContain("Signed in as Ana.");
    const signedOut = await render(<MessagePage {...props} />);
    expect(signedOut.page.text).not.toContain("Signed in as");
  });
});
