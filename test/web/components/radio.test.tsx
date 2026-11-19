import { describe, expect, it } from "vitest";
import { Radio } from "../../../src/web/components/radio";
import { render, spokenText } from "./render";

describe("Radio", () => {
  it("is a radio named by its label beside it, its hint tied to it", async () => {
    const html = render(
      <Radio
        id="zone"
        name="timezone"
        value="America/Los_Angeles"
        label="PT"
        hint="America/Los_Angeles"
      />,
    );
    expect(html).toBe(
      '<div class="choice"><div class="choice__item"><input class="choice__input radio" type="radio" id="zone" name="timezone" value="America/Los_Angeles" aria-describedby="zone-hint"/><label class="choice__label" for="zone">PT</label><p class="choice__hint" id="zone-hint">America/Los_Angeles</p></div></div>',
    );
    expect(await spokenText(html)).toBe("PT America/Los_Angeles");
  });

  it("keeps what was chosen, and is required, invalid, disabled or previewed as asked", () => {
    const html = render(
      <Radio
        id="z"
        name="z"
        value="UTC"
        label="UTC"
        checked
        required
        invalid
        disabled
        preview="focus"
      />,
    );
    expect(html).toContain(
      'value="UTC" checked required disabled aria-invalid="true" data-preview="focus"',
    );
  });
});
