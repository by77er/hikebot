import { describe, expect, it } from "vitest";
import { Textarea } from "../../../src/web/components/textarea";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

describe("Textarea", () => {
  it("is a textarea named by its label, four lines by default", async () => {
    const html = render(
      <Textarea id="details" name="details" label="Details" />,
    );
    expect(html).toBe(
      '<div class="form-row"><label class="form-row__label" for="details">Details</label><textarea class="input textarea" id="details" name="details" rows="4"></textarea></div>',
    );
    expect(await spokenText(html)).toBe("Details");
  });

  it("ties its hint, error and limit to it and enforces the limit", () => {
    const html = render(
      <Textarea
        id="dates"
        name="dates"
        label="Candidate dates (one per line)"
        required
        hint="2 to 25 dates."
        error="Line 2: 2026-02-30 is not a date."
        maxLength={1000}
        rows={6}
      />,
    );
    expect(html).toContain(
      'rows="6" maxlength="1000" required aria-invalid="true" aria-describedby="dates-hint dates-error dates-limit"',
    );
    expect(html).toContain('id="dates-error"');
    expect(html).toContain("Up to 1,000 characters.");
  });

  it("keeps what was typed, line by line, as text", async () => {
    const typed = "2026-12-05\n<script>alert(1)</script>";
    const html = render(
      <Textarea id="d" name="dates" label="Dates" value={typed} error="No." />,
    );
    expect(html).toContain(
      ">2026-12-05\n&lt;script>alert(1)&lt;/script></textarea>",
    );
    expect((await outline(html)).scripts).toBe(0);
  });

  it("is disabled, read-only or previewed as asked", () => {
    expect(render(<Textarea id="d" name="d" label="D" disabled />)).toContain(
      " disabled",
    );
    expect(render(<Textarea id="d" name="d" label="D" readOnly />)).toContain(
      " readonly",
    );
    expect(
      render(<Textarea id="d" name="d" label="D" preview="hover" />),
    ).toContain('data-preview="hover"');
  });
});
