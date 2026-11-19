import { describe, expect, it } from "vitest";
import { ServerHeading } from "../../../../src/web/pages/server/server-heading";
import { render, spokenText } from "../../components/render";
import { baseView, GUILD, MARKUP, openVote, plannedHike, round } from "./view";

/** The label of the stepper's current step, or null without a stepper. */
function currentStep(html: string): string | null {
  const match =
    /aria-current="step"[^>]*>.*?round-stepper__label">([^<]*)</.exec(html);
  return match?.[1] ?? null;
}

describe("ServerHeading", () => {
  it("shows the server's icon and name, and Switch server", async () => {
    const html = render(<ServerHeading view={baseView()} />);
    expect(html).toContain(
      `src="https://cdn.discordapp.com/icons/${GUILD}/abc.png"`,
    );
    expect(html).toContain("<h1");
    expect(html).toContain('<a class="back-link" href="/servers">');
    expect(await spokenText(html)).toContain("Switch server Ridge Walkers");
  });

  it("offers Settings to an admin only", () => {
    expect(render(<ServerHeading view={baseView()} />)).not.toContain(
      "/settings",
    );
    const html = render(
      <ServerHeading
        view={baseView({ viewer: { userId: "1", isAdmin: true } })}
      />,
    );
    expect(html).toContain(`href="/g/${GUILD}/settings"`);
    expect(html).toContain("<span>Settings</span>");
  });

  it("has no stepper with no round and no planned hike", () => {
    const html = render(<ServerHeading view={baseView()} />);
    expect(html).not.toContain("round-stepper");
  });

  it("marks the step the round is at", () => {
    const at = (view: Parameters<typeof ServerHeading>[0]["view"]) =>
      currentStep(render(<ServerHeading view={view} />));
    expect(
      at(
        baseView({
          round: round("location_vote_open", openVote("location", [])),
        }),
      ),
    ).toBe("Location vote");
    expect(
      at(baseView({ round: round("location_decided", null, "Ridge") })),
    ).toBe("Date vote");
    expect(
      at(
        baseView({
          round: round("date_vote_open", openVote("date", []), "Ridge"),
        }),
      ),
    ).toBe("Date vote");
    expect(at(baseView({ plannedHike: plannedHike() }))).toBe("Hike planned");
  });

  it("shows a server name with markup in it as text", () => {
    const view = baseView();
    const html = render(
      <ServerHeading
        view={{ ...view, server: { ...view.server, name: MARKUP } }}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script>alert(1)&lt;/script>&lt;b>Ridge&lt;/b>");
  });

  it("draws the initials for a server without an icon", () => {
    const view = baseView();
    const html = render(
      <ServerHeading
        view={{ ...view, server: { ...view.server, iconUrl: null } }}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain(">RW<");
  });
});
