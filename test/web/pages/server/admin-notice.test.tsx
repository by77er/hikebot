import { describe, expect, it } from "vitest";
import type { WebView } from "../../../../src/guild/web-view";
import {
  fitNotice,
  MAX_NOTICE_LINE,
  type AdminNotice,
} from "../../../../src/web/admin/notice";
import { AdminNoticeBanner } from "../../../../src/web/pages/server/admin-notice";
import { NoteText } from "../../../../src/web/pages/server/note-text";
import { render, spokenText } from "../../components/render";
import { outline } from "../../helpers";
import {
  adminAction,
  asAdmin,
  baseView,
  GUILD,
  MARKUP,
  plannedHike,
  TIME_ZONE,
} from "./view";

const CSRF = "csrf-token";
const CHANNEL = "300000000000007003";

function banner(view: WebView, notice: AdminNotice | null) {
  return render(<AdminNoticeBanner view={view} notice={notice} csrf={CSRF} />);
}

function note(text: string, view: WebView = baseView()) {
  return render(
    <p>
      <NoteText text={text} view={view} />
    </p>,
  );
}

const thread = adminAction("create-hike-thread");
const admin = asAdmin(baseView({ plannedHike: plannedHike() }), [thread]);
const done: AdminNotice = {
  kind: "done",
  lines: ["**Hike planned.**", "The event is created."],
  retries: [],
};

describe("AdminNoticeBanner", () => {
  it("shows nothing without a notice", () => {
    expect(banner(admin, null)).toBe("");
  });

  it("shows nothing to a member who is no longer an admin", () => {
    expect(banner(baseView(), done)).toBe("");
  });

  it("shows a done action as a success banner titled with its first note", async () => {
    const html = banner(asAdmin(baseView(), []), done);
    expect(html).toContain("banner--success");
    expect(html).toContain('role="status"');
    expect(html).toMatch(
      /<p class="banner__title" id="[^"]+"><strong>Hike planned\.<\/strong><\/p>/,
    );
    expect(html).toContain("<p>The event is created.</p>");
    expect(await spokenText(html)).toBe(
      "Done Hike planned. The event is created.",
    );
  });

  it("warns with the retry's form when a step failed and is still offered", async () => {
    const html = banner(admin, { ...done, retries: [thread] });
    expect(html).toContain("banner--warning");
    expect(html).toContain('role="alert"');
    const text = await spokenText(html);
    expect(text).toContain("Hike planned.");
    expect(text).toContain("Done, but a step failed.");
    expect(text).toContain("Try it again:");
    expect(text).toContain("Hike thread: not created.");
    expect(html).toContain(
      `<form method="post" action="/g/${GUILD}/admin/create-hike-thread">`,
    );
    expect(html).toContain(`<input type="hidden" name="csrf" value="${CSRF}"`);
    expect(html).toContain('<input type="hidden" name="target" value="1"');
    expect(text).toContain("Create hike thread");
  });

  it("leaves out a retry the view no longer offers", async () => {
    const html = banner(asAdmin(baseView({ plannedHike: plannedHike() }), []), {
      ...done,
      retries: [thread],
    });
    expect(html).toContain("banner--success");
    expect(html).not.toContain("<form");
    expect(await spokenText(html)).not.toContain("a step failed");
  });

  it("says Discord is still finishing a finishing action", async () => {
    const html = banner(admin, {
      kind: "finishing",
      lines: ["**Hike planned.**"],
      retries: [],
    });
    expect(html).toContain("banner--info");
    const text = await spokenText(html);
    expect(text).toContain("Done. Discord is still finishing it.");
    expect(text).toContain("Reload this page to see how it went.");
  });

  it("says nothing was changed for a refusal, with the panel's sentence", async () => {
    const html = banner(admin, {
      kind: "refused",
      lines: ["A round is already running."],
      retries: [],
    });
    expect(html).toContain("banner--warning");
    expect(await spokenText(html)).toBe(
      "Warning Nothing was changed. A round is already running.",
    );
  });

  it("shows notes with markup in them as text", async () => {
    const html = banner(admin, {
      kind: "done",
      lines: [MARKUP, MARKUP],
      retries: [],
    });
    expect((await outline(html)).scripts).toBe(0);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});

describe("NoteText", () => {
  it("makes **bold** strong", () => {
    expect(note("**Hike thread:** not created.")).toBe(
      "<p><strong>Hike thread:</strong> not created.</p>",
    );
  });

  it("links a channel mention by its name when the settings know it", () => {
    const view = baseView();
    const named = baseView({
      settings: {
        ...view.settings,
        voteChannel: { id: CHANNEL, name: "votes" },
      },
    });
    expect(note(`Posted in <#${CHANNEL}>.`, named)).toBe(
      `<p>Posted in <a href="https://discord.com/channels/${GUILD}/${CHANNEL}">#votes</a>.</p>`,
    );
    expect(note(`Posted in <#${CHANNEL}>.`)).toBe(
      `<p>Posted in <a href="https://discord.com/channels/${GUILD}/${CHANNEL}">the channel in Discord</a>.</p>`,
    );
  });

  it("writes a timestamp as the date and time in the server's time zone", () => {
    const expected = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TIME_ZONE,
    }).format(new Date(1_900_000_000_000));
    const html = note("Closes <t:1900000000:f>.");
    expect(html).toBe(`<p>Closes ${expected}.</p>`);
    // 2030-03-17 17:46 UTC is 18:46 in Berlin.
    expect(html).toContain("18:46");
  });

  it("links a bare address without the sentence's full stop", () => {
    expect(note("See https://example.com/hike.")).toBe(
      '<p>See <a href="https://example.com/hike">https://example.com/hike</a>.</p>',
    );
  });

  it("names a Discord event link as the event", () => {
    const url = `https://discord.com/events/${GUILD}/300000000000007011`;
    expect(note(`Event: ${url}`)).toBe(
      `<p>Event: <a href="${url}">the event in Discord</a></p>`,
    );
  });

  it("shows markup as text", async () => {
    const html = note(`${MARKUP} **${MARKUP}**`);
    expect((await outline(html)).scripts).toBe(0);
    expect(html).not.toContain("<b>");
    expect(html).toContain("<strong>&lt;script>");
  });
});

describe("fitNotice", () => {
  it("ends a line longer than the limit in an ellipsis", () => {
    const long = "a".repeat(MAX_NOTICE_LINE + 50);
    const fitted = fitNotice({
      kind: "done",
      lines: [long, "short"],
      retries: [{ ...thread, note: long }],
    });
    expect(fitted.lines[0]).toHaveLength(MAX_NOTICE_LINE);
    expect(fitted.lines[0]?.endsWith("…")).toBe(true);
    expect(fitted.lines[1]).toBe("short");
    expect(fitted.retries[0]?.note).toHaveLength(MAX_NOTICE_LINE);
    expect(fitted.retries[0]?.note?.endsWith("…")).toBe(true);
  });

  it("cuts a very long notice to fit the cookie", () => {
    const long = "b".repeat(1000);
    const fitted = fitNotice({
      kind: "done",
      lines: Array.from({ length: 20 }, () => long),
      retries: Array.from({ length: 5 }, () => ({ ...thread, note: long })),
    });
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(2400);
    expect(fitted.lines.length).toBeGreaterThanOrEqual(1);
    expect(fitted.retries).toHaveLength(5);
  });
});
