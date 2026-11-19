import { describe, expect, it } from "vitest";
import type { WebAdminAction } from "../../../../src/features/web-admin";
import type { WebView } from "../../../../src/guild/web-view";
import { AdminControls } from "../../../../src/web/pages/server/admin-controls";
import { render, spokenText } from "../../components/render";
import {
  adminAction,
  adminSection,
  asAdmin,
  baseView,
  DATE_CLOSE,
  GUILD,
  MARKUP,
  openVote,
  plannedHike,
  round,
} from "./view";

const CSRF = "csrf-token";

/** Each button or button-styled link in `html`, in order. */
function controls(html: string) {
  return [
    ...html.matchAll(
      /<(a|button) class="button button--(\w+)"([^>]*)>(?:<svg[\s\S]*?<\/svg>)?<span>([^<]*)<\/span>/g,
    ),
  ].map(([, tag = "", variant = "", attributes = "", label = ""]) => ({
    tag,
    variant,
    label,
    href: /href="([^"]*)"/.exec(attributes)?.[1] ?? null,
  }));
}

function primaries(html: string): number {
  return [...html.matchAll(/button--primary/g)].length;
}

/** The part of the card after its body: the footer. */
function footer(html: string): string {
  const at = html.indexOf('class="card__footer"');
  return at < 0 ? "" : html.slice(at);
}

function show(view: WebView) {
  return render(<AdminControls view={view} notice={null} csrf={CSRF} />);
}

const locationOpen = baseView({
  round: round(
    "location_vote_open",
    openVote("location", [{ label: "Lake", votes: 1 }]),
  ),
});
const dateOpen = baseView({
  round: round(
    "date_vote_open",
    openVote("date", [{ label: "Sat, 15 Jun 2030", votes: 1 }]),
    "Mailbox Peak",
  ),
});
const closeDate = adminAction("close-vote", {
  label: "Close date vote",
  target: 2,
  confirm: DATE_CLOSE,
});

describe("AdminControls", () => {
  it("shows nothing to a member", () => {
    expect(show(locationOpen)).toBe("");
  });

  it("offers Start location vote with no round, as a link to its form", async () => {
    const html = show(
      asAdmin(baseView(), [adminAction("start-location-vote")]),
    );
    expect(controls(html)).toEqual([
      {
        tag: "a",
        variant: "primary",
        label: "Start location vote",
        href: `/g/${GUILD}/admin/start-location-vote`,
      },
    ]);
    expect(primaries(html)).toBe(1);
    const text = await spokenText(html);
    expect(text).toContain("Admin");
    expect(text).toContain("Only admins see this.");
    expect(html).not.toContain("<form");
  });

  it("offers Close location vote and Cancel round while the location vote is open", () => {
    const html = show(
      asAdmin(locationOpen, [
        adminAction("close-vote"),
        adminAction("cancel-round"),
      ]),
    );
    expect(controls(html)).toEqual([
      {
        tag: "a",
        variant: "primary",
        label: "Close location vote",
        href: `/g/${GUILD}/admin/close-vote?target=1`,
      },
      {
        tag: "a",
        variant: "danger",
        label: "Cancel round",
        href: `/g/${GUILD}/admin/cancel-round?target=1`,
      },
    ]);
    expect(primaries(html)).toBe(1);
    expect(controls(footer(html))).toEqual([
      expect.objectContaining({ label: "Cancel round", variant: "danger" }),
    ]);
  });

  it("offers Start date vote once the location is decided", () => {
    const html = show(
      asAdmin(baseView({ round: round("location_decided", null, "Peak") }), [
        adminAction("start-date-vote"),
        adminAction("cancel-round"),
      ]),
    );
    expect(controls(html)).toEqual([
      {
        tag: "a",
        variant: "primary",
        label: "Start date vote",
        href: `/g/${GUILD}/admin/start-date-vote`,
      },
      {
        tag: "a",
        variant: "danger",
        label: "Cancel round",
        href: `/g/${GUILD}/admin/cancel-round?target=1`,
      },
    ]);
    expect(primaries(html)).toBe(1);
  });

  it("offers Close date vote, with Withdraw date vote and Cancel round apart", () => {
    const html = show(
      asAdmin(dateOpen, [
        closeDate,
        adminAction("withdraw-date-vote"),
        adminAction("cancel-round"),
      ]),
    );
    expect(controls(html)).toEqual([
      {
        tag: "a",
        variant: "primary",
        label: "Close date vote",
        href: `/g/${GUILD}/admin/close-vote?target=2`,
      },
      {
        tag: "a",
        variant: "quiet",
        label: "Withdraw date vote",
        href: `/g/${GUILD}/admin/withdraw-date-vote?target=2`,
      },
      {
        tag: "a",
        variant: "danger",
        label: "Cancel round",
        href: `/g/${GUILD}/admin/cancel-round?target=1`,
      },
    ]);
    expect(primaries(html)).toBe(1);
    expect(controls(footer(html)).map((control) => control.label)).toEqual([
      "Withdraw date vote",
      "Cancel round",
    ]);
  });

  it("offers a failed hike thread's retry with its note, as a form that posts", async () => {
    const html = show(
      asAdmin(baseView({ plannedHike: plannedHike() }), [
        adminAction("create-hike-thread"),
      ]),
    );
    expect(html).toContain("<strong>Hike thread:</strong>");
    const text = await spokenText(html);
    expect(text).toContain(
      "Hike thread: not created. Could not create the hike thread in the channel in Discord: Discord answered: Missing Permissions (HTTP 403, code 50013).",
    );
    expect(html).toContain(
      `<form method="post" action="/g/${GUILD}/admin/create-hike-thread">`,
    );
    expect(html).toContain(`<input type="hidden" name="csrf" value="${CSRF}"`);
    expect(html).toContain('<input type="hidden" name="target" value="1"');
    expect(controls(html)).toEqual([
      {
        tag: "button",
        variant: "secondary",
        label: "Create hike thread",
        href: null,
      },
    ]);
    expect(primaries(html)).toBe(0);
  });

  it("says what setup lacks while it is incomplete", async () => {
    const missing =
      "Setup is not complete: set the voting channel with /hike setup.";
    const view: WebView = {
      ...asAdmin(baseView(), []),
      admin: adminSection([], { setupMissing: missing }),
    };
    const html = show(view);
    expect(await spokenText(html)).toContain(missing);
    expect(controls(html)).toEqual([]);
    expect(primaries(html)).toBe(0);
  });

  it("leaves out a retry the notice already offers", async () => {
    const thread = adminAction("create-hike-thread");
    const event = adminAction("create-hike-event");
    const view = asAdmin(baseView({ plannedHike: plannedHike() }), [
      thread,
      event,
    ]);
    const html = render(
      <AdminControls
        view={view}
        notice={{ kind: "done", lines: ["Done."], retries: [thread] }}
        csrf={CSRF}
      />,
    );
    expect(controls(html).map((control) => control.label)).toEqual([
      "Create hike event",
    ]);
    expect(await spokenText(html)).not.toContain("Hike thread:");
  });

  it("shows a setup sentence with markup in it as text", () => {
    const view: WebView = {
      ...asAdmin(baseView(), []),
      admin: adminSection([], { setupMissing: MARKUP }),
    };
    const html = show(view);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });

  it("keeps a retry whose target differs from the notice's", () => {
    const thread = adminAction("create-hike-thread");
    const other: WebAdminAction = { ...thread, target: 9 };
    const html = render(
      <AdminControls
        view={asAdmin(baseView({ plannedHike: plannedHike() }), [thread])}
        notice={{ kind: "done", lines: [], retries: [other] }}
        csrf={CSRF}
      />,
    );
    expect(controls(html).map((control) => control.label)).toEqual([
      "Create hike thread",
    ]);
  });
});
