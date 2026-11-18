import { describe, expect, it } from "vitest";
import { Banner } from "../../../src/web/components/banner";
import { render, spokenText } from "./render";

describe("Banner", () => {
  it.each([
    ["info", "status", "Information"],
    ["success", "status", "Done"],
    ["warning", "alert", "Warning"],
    ["danger", "alert", "Error"],
  ] as const)(
    "says the %s tone with a role, an icon label and the title",
    async (tone, role, label) => {
      const html = render(<Banner tone={tone} title="Your vote is saved." />);
      expect(html).toMatch(
        new RegExp(`^<div class="banner banner--${tone}" role="${role}"`),
      );
      expect(html).toContain(`role="img" aria-label="${label}"`);
      expect(await spokenText(html)).toBe(`${label} Your vote is saved.`);
    },
  );

  it("is named by its title", () => {
    const html = render(
      <Banner tone="warning" title="Voting closes in 2 hours.">
        You can change your vote until then.
      </Banner>,
    );
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(id).toBeTruthy();
    expect(html).toContain(
      `<p class="banner__title" id="${id}">Voting closes in 2 hours.</p>`,
    );
    expect(html).toContain("<div>You can change your vote until then.</div>");
  });

  it("leaves out the body when there is none", () => {
    expect(render(<Banner tone="info" title="Saved." />)).not.toContain(
      "<div>",
    );
  });
});
