import { describe, expect, it } from "vitest";
import { TextField } from "../../../src/web/components/text-field";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

describe("TextField", () => {
  it("is a text input named by its label", async () => {
    const html = render(<TextField id="name" name="name" label="Name" />);
    expect(html).toBe(
      '<div class="form-row"><label class="form-row__label" for="name">Name</label><input class="input" id="name" name="name" type="text"/></div>',
    );
    expect(await spokenText(html)).toBe("Name");
  });

  it("gives the hint, error and limit ids to aria-describedby, in their order", async () => {
    const html = render(
      <TextField
        id="date"
        name="date"
        label="Date"
        required
        hint="As YYYY-MM-DD."
        error="2026-02-30 is not a date."
        maxLength={16}
        value="2026-02-30"
      />,
    );
    expect(html).toContain(
      'maxlength="16" required aria-invalid="true" aria-describedby="date-hint date-error date-limit"',
    );
    expect(html).toContain('<p class="form-row__hint" id="date-hint">');
    expect(html).toContain('<p class="form-row__error" id="date-error">');
    expect(html).toContain(
      '<p class="form-row__limit" id="date-limit">Up to 16 characters.</p>',
    );
    // Label, hint, error, control, limit: the error comes before the field.
    expect(html.indexOf("date-hint")).toBeLessThan(html.indexOf("date-error"));
    expect(html.indexOf('id="date-error"')).toBeLessThan(
      html.indexOf("<input"),
    );
    expect(await spokenText(html)).toBe(
      "Date As YYYY-MM-DD. Error: 2026-02-30 is not a date. Up to 16 characters.",
    );
  });

  it("says the error in words with an Error: prefix, not by colour alone", async () => {
    const html = render(
      <TextField
        id="name"
        name="name"
        label="Name"
        error="Mailbox Peak is already on the list. Vote for it instead."
      />,
    );
    const error = /<p class="form-row__error"[^]*?<\/p>/.exec(html)?.[0] ?? "";
    expect(error).toContain('<svg class="icon form-row__error-icon"');
    expect(await spokenText(error)).toBe(
      "Error: Mailbox Peak is already on the list. Vote for it instead.",
    );
  });

  it("has no aria-invalid or aria-describedby without an error or hint", () => {
    const html = render(<TextField id="n" name="n" label="Name" />);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("keeps what was typed, as text", async () => {
    const typed = '<script>alert(1)</script> "Peak"';
    const html = render(
      <TextField id="n" name="name" label="Name" value={typed} error="No." />,
    );
    expect(html).toContain(
      'value="&lt;script>alert(1)&lt;/script> &quot;Peak&quot;"',
    );
    expect((await outline(html)).scripts).toBe(0);
  });

  it("sets the type, input mode, autofill and spell check it is given", () => {
    const html = render(
      <TextField
        id="map"
        name="map"
        label="Map link"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
      />,
    );
    expect(html).toContain(
      'type="url" inputmode="url" autocomplete="off" spellcheck="false" autocapitalize="none"',
    );
    expect(
      render(
        <TextField
          id="home"
          name="home"
          label="Home area"
          autoComplete="address-level2"
        />,
      ),
    ).toContain('autocomplete="address-level2"');
  });

  it("marks required in the label for the eye and with required for assistive technology", () => {
    const html = render(<TextField id="n" name="n" label="Name" required />);
    expect(html).toContain(
      '<span class="form-row__required" aria-hidden="true"> (required)</span>',
    );
    expect(html).toContain(" required");
  });

  it("is disabled, read-only, short or previewed as asked", () => {
    expect(
      render(<TextField id="n" name="n" label="Name" disabled />),
    ).toContain(" disabled");
    expect(
      render(<TextField id="n" name="n" label="Name" readOnly value="UTC" />),
    ).toContain(" readonly");
    expect(
      render(<TextField id="n" name="n" label="Date" width="short" />),
    ).toContain('class="input input--short"');
    expect(
      render(<TextField id="n" name="n" label="Name" preview="focus" />),
    ).toContain('data-preview="focus"');
  });

  it("writes a limit of thousands with a separator", () => {
    expect(
      render(<TextField id="m" name="m" label="Map link" maxLength={1000} />),
    ).toContain("Up to 1,000 characters.");
  });
});
