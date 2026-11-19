import { describe, expect, it } from "vitest";
import { Checkbox } from "../../../src/web/components/checkbox";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

describe("Checkbox", () => {
  it("is a checkbox named by its label beside it", async () => {
    const html = render(
      <Checkbox
        id="announce"
        name="announce"
        label="Announce the location vote"
      />,
    );
    expect(html).toBe(
      '<div class="choice"><div class="choice__item"><input class="choice__input checkbox" type="checkbox" id="announce" name="announce"/><label class="choice__label" for="announce">Announce the location vote</label></div></div>',
    );
    expect(await spokenText(html)).toBe("Announce the location vote");
  });

  it("keeps what was checked, and its value", () => {
    const html = render(
      <Checkbox
        id="d1"
        name="dates"
        value="2026-12-05 11:00"
        label="Sat, 5 Dec 2026 · 11:00"
        checked
      />,
    );
    expect(html).toContain('value="2026-12-05 11:00" checked');
  });

  it("ties its hint to it", () => {
    const html = render(
      <Checkbox id="a" name="a" label="Announce" hint="In #announcements." />,
    );
    expect(html).toContain('aria-describedby="a-hint"');
    expect(html).toContain('<p class="choice__hint" id="a-hint">');
  });

  it("says its own error above it when on its own", async () => {
    const html = render(
      <Checkbox
        id="a"
        name="a"
        label="Announce the location vote"
        error="Set the announcements channel under Settings first."
      />,
    );
    expect(html).toMatch(
      /^<div class="choice choice--error"><p class="form-row__error" id="a-error">/,
    );
    expect(html).toContain('aria-invalid="true" aria-describedby="a-error"');
    expect(await spokenText(html)).toBe(
      "Error: Set the announcements channel under Settings first. Announce the location vote",
    );
  });

  it("is marked invalid by a group in error, disabled and previewed as asked", () => {
    expect(render(<Checkbox id="a" name="a" label="A" invalid />)).toContain(
      'aria-invalid="true"',
    );
    expect(
      render(<Checkbox id="a" name="a" label="A" disabled checked />),
    ).toContain(" checked disabled");
    expect(
      render(<Checkbox id="a" name="a" label="A" preview="hover" />),
    ).toContain('data-preview="hover"');
  });

  it("shows a member's words as text", async () => {
    const html = render(
      <Checkbox id="a" name="a" label="<script>alert(1)</script>" />,
    );
    expect((await outline(html)).scripts).toBe(0);
  });
});
