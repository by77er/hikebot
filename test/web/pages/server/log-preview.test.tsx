import { describe, expect, it } from "vitest";
import { LogPreview } from "../../../../src/web/pages/server/log-preview";
import { render, spokenText } from "../../components/render";
import {
  baseView,
  GUILD,
  logEntry,
  logSection,
  MARKUP,
  plannedHike,
  TIME_ZONE,
} from "./view";

describe("LogPreview", () => {
  it("says the log is empty in the bot's words", async () => {
    const text = await spokenText(render(<LogPreview view={baseView()} />));
    expect(text).toContain(
      "No hikes yet. The first one appears here when a date vote closes.",
    );
    expect(text).not.toContain("See the whole hike log");
  });

  it("shows the five latest hikes and links the whole log", async () => {
    const html = render(
      <LogPreview view={baseView({ log: logSection(12, 1, 5) })} />,
    );
    const text = await spokenText(html);
    expect(text).toContain("12 hikes");
    expect([...html.matchAll(/<article/g)]).toHaveLength(5);
    expect(text.indexOf("Hike 12")).toBeLessThan(text.indexOf("Hike 8"));
    expect(text).not.toContain("Hike 7");
    expect(text).toContain(`Wed, 12 Jun 2030 · 09:30 ${TIME_ZONE}`);
    expect(html).toContain(`href="/g/${GUILD}/log"`);
  });

  it("does not link the whole log when the page shows all of it", async () => {
    const text = await spokenText(
      render(<LogPreview view={baseView({ log: logSection(1, 1, 5) })} />),
    );
    expect(text).toContain("1 hike");
    expect(text).not.toContain("See the whole hike log");
  });

  it("draws the planned hike as planned and the others as past", () => {
    const view = baseView({
      log: logSection(2, 1, 5),
      plannedHike: plannedHike({ roundId: 2 }),
    });
    const html = render(<LogPreview view={view} />);
    expect(html).toContain("hike-card--upcoming");
    expect([...html.matchAll(/hike-card--past/g)]).toHaveLength(1);
  });

  it("shows a location with markup in it as text", () => {
    const log = {
      ...logSection(0, 1, 5),
      entries: [logEntry(1, MARKUP)],
      total: 1,
    };
    const html = render(<LogPreview view={baseView({ log })} />);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
  });
});
