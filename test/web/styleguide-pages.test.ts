/**
 * The style guide's component pages at `/styleguide/<id>`: each is a page
 * in the shell with its headings in order, every control labelled and
 * every `aria-describedby` pointing at text on the page, and its forms
 * submit to the page itself without JavaScript. The error summary's form
 * comes back with errors and keeps what was typed.
 */
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { STYLEGUIDE_SECTIONS } from "../../src/web/pages/styleguide";
import { webRouter } from "../../src/web/routes";
import { EXPECTED_PAGE_HEADERS, outline, pageHeaders } from "./helpers";

function request(path: string, method = "GET"): Promise<Response> {
  return webRouter.handle(
    new Request(`https://hikebot.example${path}`, { method }),
    env,
    createExecutionContext(),
  );
}

async function html(path: string): Promise<string> {
  const response = await request(path);
  expect(response.status, path).toBe(200);
  return response.text();
}

const OWN_PAGES = STYLEGUIDE_SECTIONS.filter(({ ownPage }) => ownPage);
const IDS = OWN_PAGES.map(({ id }) => id);

describe("the style guide's component pages", () => {
  it("include every form control and piece of page furniture", () => {
    expect(IDS).toEqual(
      expect.arrayContaining([
        "back-link",
        "checkbox",
        "choice-group",
        "confirmation",
        "definition-list",
        "error-summary",
        "form-actions",
        "form-row",
        "pagination",
        "radio",
        "select",
        "text-field",
        "textarea",
      ]),
    );
  });

  it("are each linked from the style guide's index", async () => {
    const index = await html("/styleguide");
    for (const id of IDS)
      expect(index).toContain(`<a href="/styleguide/${id}">`);
  });

  it("answer 404 for a component without a page", async () => {
    expect((await request("/styleguide/button")).status).toBe(404);
    expect((await request("/styleguide/no-such")).status).toBe(404);
    expect((await request("/styleguide/no-such", "POST")).status).toBe(404);
  });

  describe.each(OWN_PAGES)("/styleguide/$id", ({ id, title }) => {
    it("is a page in the shell with its section and a way back", async () => {
      const response = await request(`/styleguide/${id}`);
      expect(response.status).toBe(200);
      expect(pageHeaders(response)).toEqual(EXPECTED_PAGE_HEADERS);
      const text = await response.text();
      const page = await outline(text);
      expect(page).toMatchObject({
        title: `${title} · Style guide · hikebot`,
        scripts: 0,
        styleElements: 0,
        styleAttributes: 0,
        eventAttributes: 0,
      });
      expect(text).toContain(`<section class="styleguide-section" id="${id}"`);
      expect(text).toContain('<a class="back-link" href="/styleguide">');
    });

    it("has one h1 and headings that skip no level", async () => {
      const page = await outline(await html(`/styleguide/${id}`));
      const levels = page.elements
        .filter((name) => /^h[1-6]$/.test(name))
        .map((name) => Number(name.slice(1)));
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      expect(levels[0]).toBe(1);
      levels.reduce((previous, level) => {
        expect(
          level,
          `h${String(level)} after h${String(previous)}`,
        ).toBeLessThanOrEqual(previous + 1);
        return level;
      });
    });

    it("gives every id once, labels every control and resolves every aria-describedby", async () => {
      const text = await html(`/styleguide/${id}`);
      const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map(
        ([, value]) => value,
      );
      expect(ids.length).toBe(new Set(ids).size);
      for (const [control] of text.matchAll(
        /<(input|select|textarea)\b[^>]*>/g,
      )) {
        if (control.includes('type="hidden"')) continue;
        const controlId = /\sid="([^"]+)"/.exec(control)?.[1];
        expect(controlId, control).toBeDefined();
        expect(text, control).toContain(`for="${controlId ?? ""}"`);
      }
      for (const [, list = ""] of text.matchAll(
        /aria-describedby="([^"]+)"/g,
      )) {
        for (const described of list.split(" ")) {
          expect(ids, `aria-describedby="${list}"`).toContain(described);
        }
      }
    });

    it("has only forms that submit to a route that answers them", async () => {
      const text = await html(`/styleguide/${id}`);
      for (const [form] of text.matchAll(/<form\b[^>]*>/g)) {
        const method = /method="(get|post)"/.exec(form)?.[1];
        expect(method, form).toBeDefined();
        const action = /action="([^"]+)"/.exec(form)?.[1] ?? "";
        const path = new URL(action, "https://hikebot.example").pathname;
        const routes = webRouter.paths(method === "post" ? "POST" : "GET");
        expect(
          routes.some((route) =>
            route.endsWith("/*")
              ? path.startsWith(route.slice(0, -1))
              : path === route,
          ),
          form,
        ).toBe(true);
      }
      for (const [, body = ""] of text.matchAll(
        /<form\b[^>]*>([^]*?)<\/form>/g,
      )) {
        expect(body).toMatch(/<button [^>]*type="submit"/);
      }
    });
  });
});

describe("the error summary's example form", () => {
  it("shows a typical try as it comes back, without taking focus", async () => {
    const text = await html("/styleguide/error-summary");
    expect(text).toContain('role="alert"');
    expect(text).not.toContain("autofocus");
    expect(text).toContain('<a href="#proposal-name">');
    expect(text).toContain('<a href="#proposal-map">');
  });

  it("comes back with each error, linked and tied to its field, keeping what was typed", async () => {
    const query = new URLSearchParams({
      name: "  mailbox peak",
      details: '<script>alert(1)</script> "steep"',
      map: "47.4875, -121.7234",
    });
    const text = await html(`/styleguide/error-summary?${query.toString()}`);
    expect(text).toContain("autofocus");
    expect(text).toContain(
      '<a href="#proposal-name">mailbox peak is already on the list. Vote for it instead.</a>',
    );
    expect(text).not.toContain('<a href="#proposal-map">');
    expect(text).toMatch(
      /<input class="input" id="proposal-name" name="name" type="text" value=" {2}mailbox peak"[^>]* aria-invalid="true" aria-describedby="proposal-name-error proposal-name-limit"/,
    );
    expect(text).toContain(
      ">&lt;script>alert(1)&lt;/script> &quot;steep&quot;</textarea>",
    );
    expect(text).toContain('value="47.4875, -121.7234"');
    expect((await outline(text)).scripts).toBe(0);
  });

  it("refuses a short map link and an empty name", async () => {
    const query = new URLSearchParams({
      name: " ",
      details: "",
      map: "https://maps.app.goo.gl/abc",
    });
    const text = await html(`/styleguide/error-summary?${query.toString()}`);
    expect(text).toContain(
      '<a href="#proposal-name">A name must be 1 to 80 characters.</a>',
    );
    expect(text).toContain('<a href="#proposal-map">No coordinates');
  });

  it("adds a good proposal and empties the form", async () => {
    const query = new URLSearchParams({
      name: "Ridge Trail",
      details: "",
      map: "",
    });
    const text = await html(`/styleguide/error-summary?${query.toString()}`);
    expect(text).not.toContain('class="error-summary"');
    expect(text).toContain(
      "Added <strong>Ridge Trail</strong> to the location vote.",
    );
    expect(text).not.toContain('value="Ridge Trail"');
  });
});

describe("the confirmation page's example forms", () => {
  it("post to the style guide, which changes nothing and says so", async () => {
    const response = await request("/styleguide/confirmation", "POST");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/styleguide/confirmation?posted=1#confirmation",
    );
    const text = await html("/styleguide/confirmation?posted=1");
    expect(text).toContain("The form was posted.");
    expect(await html("/styleguide/confirmation")).not.toContain(
      "The form was posted.",
    );
  });
});
