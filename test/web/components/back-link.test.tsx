import { describe, expect, it } from "vitest";
import { BackLink } from "../../../src/web/components/back-link";
import { render, spokenText } from "./render";

describe("BackLink", () => {
  it("is a link named by where it goes, its arrow hidden", async () => {
    const html = render(<BackLink href="/settings">Back to settings</BackLink>);
    expect(html).toMatch(
      /^<a class="back-link" href="\/settings"><svg class="icon back-link__icon"/,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(await spokenText(html)).toBe("Back to settings");
  });

  it("previews a state for the style guide", () => {
    expect(
      render(
        <BackLink href="/" preview="focus">
          Back
        </BackLink>,
      ),
    ).toContain('data-preview="focus"');
  });
});
