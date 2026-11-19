import { describe, expect, it } from "vitest";
import { START_DATES_FIELD } from "../../../../../src/features/date-vote";
import { START_LOCATIONS_FIELD } from "../../../../../src/features/location-vote";
import {
  StartVotePage,
  type StartKind,
} from "../../../../../src/web/pages/server/admin/start-vote";
import { htmlResponse } from "../../../../../src/web/response";
import { spokenText } from "../../../components/render";
import { outline } from "../../../helpers";
import { asAdmin, baseView, GUILD, MARKUP, round } from "../view";

const USER = { name: "Ana", avatar: null, csrf: "token" };
const CSRF = "form-token";
const DATES = ["2030-06-15 11:00", "2030-06-16 11:00"];

async function page(kind: StartKind, typed: string, error?: string) {
  const view = asAdmin(
    baseView({ round: round("location_decided", null, "Mailbox Peak") }),
    [],
  );
  const field =
    kind === "start-location-vote" ? START_LOCATIONS_FIELD : START_DATES_FIELD;
  const html = await htmlResponse(
    <StartVotePage
      user={USER}
      view={view}
      kind={kind}
      field={field}
      csrf={CSRF}
      typed={typed}
      error={error}
    />,
  ).text();
  return { html, page: await outline(html) };
}

/** The text of the element `<tag class="class" ...>` in `html`. */
function textOf(html: string, tag: string, cls: string): string | undefined {
  return new RegExp(`<${tag} class="${cls}"[^>]*>([^<]*)<`).exec(html)?.[1];
}

describe("StartVotePage", () => {
  it("asks for the initial locations as the Discord modal does", async () => {
    const { html, page: shown } = await page("start-location-vote", "");
    expect(shown.title).toBe("Start location vote · Ridge Walkers · hikebot");
    expect([...html.matchAll(/<h1/g)]).toHaveLength(1);
    expect(html).toContain("<h1>Start location vote</h1>");
    expect(html).toMatch(
      /<button class="button button--primary" type="submit"><span>Start location vote<\/span><\/button>/,
    );
    expect(textOf(html, "label", "form-row__label")).toBe(
      START_LOCATIONS_FIELD.label,
    );
    expect(textOf(html, "p", "form-row__hint")).toBe(
      START_LOCATIONS_FIELD.hint,
    );
    expect(html).toContain(
      `<form class="stack stack--loose" method="post" action="/g/${GUILD}/admin/start-location-vote" novalidate>`,
    );
    expect(html).toContain(`<input type="hidden" name="csrf" value="${CSRF}"`);
    expect(html).toMatch(/<textarea [^>]*name="text"[^>]*><\/textarea>/);
    expect(shown.scripts).toBe(0);
  });

  it("asks for the candidate dates, filled in one per line", async () => {
    const { html, page: shown } = await page(
      "start-date-vote",
      DATES.join("\n"),
    );
    expect(shown.title).toBe("Start date vote · Ridge Walkers · hikebot");
    expect(html).toContain("<h1>Start date vote</h1>");
    expect(html).toMatch(
      /<button class="button button--primary" type="submit"><span>Start date vote<\/span><\/button>/,
    );
    expect(textOf(html, "label", "form-row__label")).toBe(
      START_DATES_FIELD.label,
    );
    expect(textOf(html, "p", "form-row__hint")).toBe(START_DATES_FIELD.hint);
    expect(html).toContain(
      `action="/g/${GUILD}/admin/start-date-vote" novalidate>`,
    );
    expect(html).toContain(`<input type="hidden" name="csrf" value="${CSRF}"`);
    expect(html).toMatch(
      /<textarea [^>]*name="text"[^>]*>2030-06-15 11:00\n2030-06-16 11:00<\/textarea>/,
    );
    expect(await spokenText(html)).toContain(
      "The vote opens in the voting channel for Mailbox Peak.",
    );
  });

  it("comes back from a refused start with the error and what was typed", async () => {
    const error = "Give at least 2 dates.";
    const { html, page: shown } = await page(
      "start-date-vote",
      "2030-06-15",
      error,
    );
    expect(shown.title).toBe(
      "Error: Start date vote · Ridge Walkers · hikebot",
    );
    expect(html).toContain('class="error-summary"');
    const text = await spokenText(html);
    expect(text).toContain(`The date vote was not started. ${error}`);
    expect(html).toContain('<a href="#start-text">Give at least 2 dates.</a>');
    expect(html).toMatch(
      /<p class="form-row__error" id="start-text-error">[\s\S]*Give at least 2 dates\.<\/span><\/p>/,
    );
    expect(html).toMatch(/aria-invalid="true"/);
    expect(html).toMatch(/<textarea [^>]*>2030-06-15<\/textarea>/);
  });

  it("keeps typed markup as text", async () => {
    const { html, page: shown } = await page(
      "start-location-vote",
      MARKUP,
      "Too long.",
    );
    expect(shown.scripts).toBe(0);
    expect(shown.elements).not.toContain("b");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>&lt;b>Ridge&lt;/b>");
  });
});
