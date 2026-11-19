import { describe, expect, it } from "vitest";
import {
  describedBy,
  FieldError,
  fieldIds,
  FormRow,
  RequiredMark,
} from "../../../src/web/components/form-row";
import { render, spokenText } from "./render";

describe("FormRow", () => {
  it("puts label, hint, error, control and limit in that order", () => {
    const html = render(
      <FormRow
        id="rest"
        label="Hikes a location rests"
        hint="After this many hikes."
        error="Enter a number from 0 to 10."
        maxLength={2}
      >
        <input class="input" id="rest" />
      </FormRow>,
    );
    const order = [
      '<label class="form-row__label" for="rest">',
      'id="rest-hint"',
      'id="rest-error"',
      '<input class="input" id="rest"/>',
      'id="rest-limit"',
    ].map((part) => html.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/^<div class="form-row form-row--error">/);
  });

  it("leaves out the parts it is not given", () => {
    expect(
      render(
        <FormRow id="n" label="Name">
          <input id="n" />
        </FormRow>,
      ),
    ).toBe(
      '<div class="form-row"><label class="form-row__label" for="n">Name</label><input id="n"/></div>',
    );
  });

  it("names a control's hint, error and limit for aria-describedby", () => {
    expect(fieldIds("date")).toEqual({
      hint: "date-hint",
      error: "date-error",
      limit: "date-limit",
    });
    expect(describedBy("date", {})).toBeUndefined();
    expect(describedBy("date", { error: "No." })).toBe("date-error");
    expect(describedBy("date", { hint: "As YYYY-MM-DD.", limit: 16 })).toBe(
      "date-hint date-limit",
    );
  });

  it("hides the required mark from assistive technology unless spoken", async () => {
    expect(await spokenText(render(<RequiredMark />))).toBe("");
    expect(await spokenText(render(<RequiredMark spoken />))).toBe(
      "(required)",
    );
  });

  it("says an error with an icon and Error: before it", async () => {
    const html = render(<FieldError id="x-error">Not a date.</FieldError>);
    expect(html).toContain('aria-hidden="true"');
    expect(await spokenText(html)).toBe("Error: Not a date.");
  });
});
