import { describe, expect, it } from "vitest";
import { ChoiceGroup } from "../../../src/web/components/choice-group";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

const ZONES = [
  { value: "America/Los_Angeles", label: "PT" },
  { value: "America/Denver", label: "MT" },
  { value: "UTC", label: "UTC" },
];

const DATES = [
  { value: "2026-12-05 11:00", label: "Sat, 5 Dec 2026 · 11:00" },
  { value: "2026-12-06 11:00", label: "Sun, 6 Dec 2026 · 11:00" },
  { value: "2026-12-12 11:00", label: "Sat, 12 Dec 2026 · 11:00" },
];

describe("ChoiceGroup", () => {
  it("is a fieldset whose legend asks the question", async () => {
    const html = render(
      <ChoiceGroup
        type="radio"
        id="zone"
        name="timezone"
        legend="Time zone"
        choices={ZONES}
      />,
    );
    expect(html).toMatch(
      /^<fieldset class="choice-group"><legend class="choice-group__legend">Time zone<\/legend>/,
    );
    expect(html).toMatch(/<\/fieldset>$/);
    expect(await spokenText(html)).toBe("Time zone PT MT UTC");
  });

  it("names the group's hint apart from the first choice's hint", () => {
    const html = render(
      <ChoiceGroup
        type="radio"
        id="zone"
        name="timezone"
        legend="Time zone"
        hint="Dates are planned in this time zone."
        choices={[
          { value: "UTC", label: "UTC", hint: "Coordinated Universal Time" },
        ]}
      />,
    );
    expect(html).toContain('aria-describedby="zone-group-hint"');
    expect(html).toContain('<p class="form-row__hint" id="zone-group-hint">');
    expect(html).toContain('<p class="choice__hint" id="zone-hint">');
  });

  it("gives the first choice the group's id and the others numbered ids", () => {
    const html = render(
      <ChoiceGroup
        type="radio"
        id="zone"
        name="timezone"
        legend="Time zone"
        choices={ZONES}
      />,
    );
    const ids = [...html.matchAll(/<input [^>]*id="([^"]+)"/g)].map(
      ([, id = ""]) => id,
    );
    expect(ids).toEqual(["zone", "zone-2", "zone-3"]);
    for (const id of ids)
      expect(html).toContain(`<label class="choice__label" for="${id}">`);
    expect(html.match(/name="timezone"/g)).toHaveLength(3);
  });

  it("ties the group's hint and error to the fieldset and marks every choice invalid", async () => {
    const html = render(
      <ChoiceGroup
        type="checkbox"
        id="dates"
        name="dates"
        legend="Candidate dates"
        hint="2 to 25 dates."
        error="You chose 1 date; a date vote needs 2 to 25 different dates."
        choices={DATES}
        value={["2026-12-12 11:00"]}
      />,
    );
    expect(html).toMatch(
      /^<fieldset class="choice-group choice-group--error" aria-describedby="dates-group-hint dates-group-error">/,
    );
    expect(html).toContain('<p class="form-row__hint" id="dates-group-hint">');
    expect(html).toContain(
      '<p class="form-row__error" id="dates-group-error">',
    );
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(3);
    expect(await spokenText(html)).toBe(
      "Candidate dates 2 to 25 dates. Error: You chose 1 date; a date vote needs 2 to 25 different dates. Sat, 5 Dec 2026 · 11:00 Sun, 6 Dec 2026 · 11:00 Sat, 12 Dec 2026 · 11:00",
    );
  });

  it("keeps the checkboxes that were chosen", () => {
    const html = render(
      <ChoiceGroup
        type="checkbox"
        id="dates"
        name="dates"
        legend="Candidate dates"
        choices={DATES}
        value={["2026-12-05 11:00", "2026-12-12 11:00"]}
      />,
    );
    const checked = [...html.matchAll(/<input [^>]*>/g)].map(([input]) =>
      input.includes(" checked"),
    );
    expect(checked).toEqual([true, false, true]);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  });

  it("keeps the radio that was chosen, and says required in the legend", async () => {
    const html = render(
      <ChoiceGroup
        type="radio"
        id="zone"
        name="timezone"
        legend="Time zone"
        required
        choices={ZONES}
        value="America/Denver"
      />,
    );
    expect(html).toContain('value="America/Denver" checked required');
    expect(html.match(/ checked/g)).toHaveLength(1);
    expect(html.match(/ required/g)).toHaveLength(3);
    expect(await spokenText(html)).toMatch(/^Time zone \(required\) PT/);
  });

  it("disables the whole group with the fieldset", () => {
    expect(
      render(
        <ChoiceGroup
          type="radio"
          id="z"
          name="z"
          legend="Time zone"
          choices={ZONES}
          disabled
        />,
      ),
    ).toMatch(/^<fieldset class="choice-group" disabled>/);
  });

  it("shows members' words as text", async () => {
    const html = render(
      <ChoiceGroup
        type="checkbox"
        id="l"
        name="l"
        legend="Locations"
        choices={[{ value: "<x>", label: "<script>alert(1)</script>" }]}
        value={["<x>"]}
      />,
    );
    expect(html).toContain('value="&lt;x>" checked');
    expect((await outline(html)).scripts).toBe(0);
  });
});
