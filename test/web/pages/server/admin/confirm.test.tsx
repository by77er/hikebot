import { describe, expect, it } from "vitest";
import { LOCATION_POLL } from "../../../../../src/features/location-vote";
import {
  CANCEL_QUESTION,
  closeQuestion,
} from "../../../../../src/features/poll-ui";
import type { WebAdminAction } from "../../../../../src/features/web-admin";
import type { WebView } from "../../../../../src/guild/web-view";
import { AdminConfirmPage } from "../../../../../src/web/pages/server/admin/confirm";
import { htmlResponse } from "../../../../../src/web/response";
import { spokenText } from "../../../components/render";
import { outline } from "../../../helpers";
import {
  adminAction,
  asAdmin,
  baseView,
  GUILD,
  MARKUP,
  openVote,
  round,
} from "../view";

const USER = { name: "Ana", avatar: null, csrf: "token" };
const CSRF = "form-token";

const locationOpen = baseView({
  round: round(
    "location_vote_open",
    openVote("location", [
      { label: "Lake", votes: 3 },
      { label: "Ridge", votes: 1 },
    ]),
  ),
});
const dateOpen = baseView({
  round: round(
    "date_vote_open",
    openVote("date", [{ label: "Sat, 15 Jun 2030 · 09:00", votes: 2 }]),
    "Mailbox Peak",
  ),
});

async function page(view: WebView, action: WebAdminAction) {
  const html = await htmlResponse(
    <AdminConfirmPage
      user={USER}
      view={asAdmin(view, [action])}
      action={action}
      csrf={CSRF}
    />,
  ).text();
  const shown = await outline(html);
  expect(shown.scripts).toBe(0);
  expect([...html.matchAll(/<h1/g)]).toHaveLength(1);
  return { html, page: shown, text: await spokenText(html) };
}

function form(html: string, kind: string, target: number) {
  expect(html).toContain(
    `<form class="confirmation__form" method="post" action="/g/${GUILD}/admin/${kind}">`,
  );
  expect(html).toContain(`<input type="hidden" name="csrf" value="${CSRF}"`);
  expect(html).toContain(
    `<input type="hidden" name="target" value="${String(target)}"`,
  );
}

function button(variant: string, label: string): RegExp {
  return new RegExp(
    `<button class="button button--${variant}" type="submit"><span>${label}</span></button>`,
  );
}

describe("AdminConfirmPage", () => {
  it("asks before it closes the location vote, with its current tally", async () => {
    const close = closeQuestion(LOCATION_POLL);
    const {
      html,
      page: shown,
      text,
    } = await page(locationOpen, adminAction("close-vote"));
    expect(html).toContain(
      `<h1 class="confirmation__title">${close.question}</h1>`,
    );
    expect(shown.title).toBe(`${close.question} · Ridge Walkers · hikebot`);
    expect(text).toContain("Location vote · open");
    expect(text).toContain(close.consequence);
    expect(text).toContain("Lake 3 votes");
    expect(text).toContain("Ridge 1 vote");
    expect(text).toContain("3 members have voted.");
    expect(text).toContain("This cannot be undone.");
    form(html, "close-vote", 1);
    expect(html).toMatch(button("primary", "Close location vote"));
    expect([...html.matchAll(/button--primary/g)]).toHaveLength(1);
    expect(html).toContain(`href="/g/${GUILD}"`);
  });

  it("asks before it cancels the round, with a danger button", async () => {
    const { html, text } = await page(
      locationOpen,
      adminAction("cancel-round"),
    );
    expect(html).toContain(
      `<h1 class="confirmation__title">${CANCEL_QUESTION.question}</h1>`,
    );
    expect(text).toContain(CANCEL_QUESTION.consequence);
    form(html, "cancel-round", 1);
    expect(html).toMatch(button("danger", "Cancel round"));
    expect(html).not.toContain("button--primary");
  });

  it("asks before it withdraws the date vote, with a danger button", async () => {
    const withdraw = adminAction("withdraw-date-vote");
    const { html, text } = await page(dateOpen, withdraw);
    expect(html).toContain(
      `<h1 class="confirmation__title">${withdraw.confirm?.question ?? ""}</h1>`,
    );
    expect(text).toContain(withdraw.confirm?.consequence ?? "");
    expect(text).toContain("Date vote · open");
    expect(text).toContain("Location: Mailbox Peak");
    expect(text).toContain("Sat, 15 Jun 2030 · 09:00 2 votes");
    expect(text).toContain("Times are in Europe/Berlin.");
    form(html, "withdraw-date-vote", 2);
    expect(html).toMatch(button("danger", "Withdraw date vote"));
    expect(html).not.toContain("button--primary");
  });

  it("shows option labels with markup in them as text", async () => {
    const view = baseView({
      round: round(
        "location_vote_open",
        openVote("location", [{ label: MARKUP, votes: 1, details: MARKUP }]),
      ),
    });
    const { html, page: shown } = await page(view, adminAction("close-vote"));
    expect(shown.elements).not.toContain("b");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
