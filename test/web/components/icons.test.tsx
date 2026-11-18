import { describe, expect, it } from "vitest";
import { ICONS, MapPinIcon } from "../../../src/web/components/icons";
import { render, spokenText } from "./render";

describe("icons", () => {
  it.each(Object.entries(ICONS))(
    "%s is a decorative 24-unit stroke icon",
    async (_name, Glyph) => {
      const html = render(<Glyph />);
      expect(html).toMatch(
        /^<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">/,
      );
      expect(html).toMatch(/<(path|circle|rect)\b/);
      expect(await spokenText(html)).toBe("");
    },
  );

  it("is an image named by its label when given one", async () => {
    const html = render(<MapPinIcon label="Location" size="small" />);
    expect(html).toContain('class="icon icon--small"');
    expect(html).toContain('role="img" aria-label="Location"');
    expect(html).not.toContain("aria-hidden");
    expect(await spokenText(html)).toBe("Location");
  });

  it("takes the class of the part it sits in", () => {
    expect(render(<MapPinIcon class="button__icon" />)).toContain(
      'class="icon button__icon"',
    );
  });
});
