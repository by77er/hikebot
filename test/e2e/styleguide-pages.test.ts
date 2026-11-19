/**
 * The style guide's pages for the form controls and page furniture, each
 * requested from the real bundle: /styleguide/back-link,
 * /styleguide/checkbox, /styleguide/choice-group, /styleguide/confirmation,
 * /styleguide/definition-list, /styleguide/error-summary,
 * /styleguide/form-actions, /styleguide/form-row, /styleguide/pagination,
 * /styleguide/radio, /styleguide/select, /styleguide/text-field and
 * /styleguide/textarea. Each answers 200 with its component in every
 * state and the way back, and the style guide's index links to it.
 */
import { describe, expect, it } from "vitest";
import { PageClient } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();

/** A GET form's submission: its action with the fields as the query. */
function submitted(action: string, fields: Record<string, string>): string {
  const url = new URL(action, "https://hikebot.example");
  return `${url.pathname}?${new URLSearchParams(fields).toString()}`;
}

describe("the style guide's form controls and page furniture", () => {
  /** Each page's path, title and a mark of its component in every state. */
  const PAGES = [
    ["/styleguide/back-link", "Back link", "Back to settings</span></a>"],
    [
      "/styleguide/checkbox",
      "Checkbox",
      'class="choice__input checkbox" type="checkbox"',
    ],
    [
      "/styleguide/choice-group",
      "Choice group",
      '<fieldset class="choice-group choice-group--error"',
    ],
    [
      "/styleguide/confirmation",
      "Confirmation",
      '<form class="confirmation__form" method="post" action="/styleguide/confirmation">',
    ],
    [
      "/styleguide/definition-list",
      "Definition list",
      '<dl class="definition-list">',
    ],
    [
      "/styleguide/error-summary",
      "Error summary",
      '<div class="error-summary" role="alert"',
    ],
    ["/styleguide/form-actions", "Form actions", '<div class="form-actions">'],
    [
      "/styleguide/form-row",
      "Form row",
      '<div class="form-row form-row--error">',
    ],
    [
      "/styleguide/pagination",
      "Pagination",
      '<nav class="pagination" aria-label=',
    ],
    ["/styleguide/radio", "Radio", 'class="choice__input radio" type="radio"'],
    ["/styleguide/select", "Select", '<select class="input select__input"'],
    [
      "/styleguide/text-field",
      "Text field",
      '<input class="input input--short"',
    ],
    ["/styleguide/textarea", "Textarea", '<textarea class="input textarea"'],
  ];

  it("lists every one in the index, each linking to its own page", async () => {
    const page = await new PageClient(e2e.url).get("/styleguide");
    for (const [path = "", title = ""] of PAGES) {
      expect(page.body).toContain(`<a href="${path}">${title}</a>`);
    }
  });

  it.each(PAGES)(
    "shows %s in every state, with the way back",
    async (path, title, marker) => {
      const page = await new PageClient(e2e.url).get(path);
      expect(page.status).toBe(200);
      expect(page.body).toContain(
        `<title>${title} · Style guide · hikebot</title>`,
      );
      expect(page.body).toContain(
        `<section class="styleguide-section" id="${path.slice("/styleguide/".length)}"`,
      );
      expect(page.body).toContain(marker);
      expect(page.body).toContain('<a class="back-link" href="/styleguide">');
      expect(page.body).not.toMatch(/<script|\sstyle=|\son[a-z]+=/i);
    },
  );

  it("submits the time zone form on /styleguide/choice-group and comes back to it", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get("/styleguide/choice-group");
    expect(page.body).toContain(
      '<form class="stack" method="get" action="/styleguide/choice-group#choice-group">',
    );
    const back = await client.get(
      submitted("/styleguide/choice-group#choice-group", {
        timezone: "America/Denver",
      }),
    );
    expect(back.status).toBe(200);
    expect(back.body).toContain(
      '<section class="styleguide-section" id="choice-group"',
    );
  });
});
