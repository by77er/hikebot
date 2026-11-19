import { describe, expect, it } from "vitest";
import { Select } from "../../../src/web/components/select";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

const CHANNELS = [
  {
    group: "Hiking",
    options: [
      { value: "1", label: "#hike-votes" },
      { value: "2", label: "#announcements" },
    ],
  },
  { value: "3", label: "#general" },
];

describe("Select", () => {
  it("is the browser's select, named by its label, with groups", async () => {
    const html = render(
      <Select
        id="voting"
        name="voting"
        label="Voting channel"
        options={CHANNELS}
      />,
    );
    expect(html).toBe(
      '<div class="form-row"><label class="form-row__label" for="voting">Voting channel</label><span class="select"><select class="input select__input" id="voting" name="voting"><optgroup label="Hiking"><option value="1">#hike-votes</option><option value="2">#announcements</option></optgroup><option value="3">#general</option></select></span></div>',
    );
    expect(await spokenText(html.replace(/<option[^]*<\/select>/, ""))).toBe(
      "Voting channel",
    );
  });

  it("starts on the placeholder until something is chosen", () => {
    const html = render(
      <Select
        id="v"
        name="v"
        label="Voting channel"
        placeholder="Pick the voting channel"
        options={CHANNELS}
      />,
    );
    expect(html).toContain(
      "<option value selected>Pick the voting channel</option>",
    );
  });

  it("keeps what was chosen before", () => {
    const html = render(
      <Select
        id="v"
        name="v"
        label="Voting channel"
        placeholder="Pick the voting channel"
        options={CHANNELS}
        value="2"
      />,
    );
    expect(html).toContain("<option value>Pick the voting channel</option>");
    expect(html).toContain(
      '<option value="2" selected>#announcements</option>',
    );
    expect(html.match(/selected/g)).toHaveLength(1);
  });

  it("ties its hint and error to it and marks it invalid", () => {
    const html = render(
      <Select
        id="threads"
        name="threads"
        label="Hike threads channel"
        required
        hint="Forum channels only."
        error="That channel cannot be the hike threads channel."
        options={CHANNELS}
      />,
    );
    expect(html).toContain(
      'required aria-invalid="true" aria-describedby="threads-hint threads-error"',
    );
    expect(html).toContain('<p class="form-row__error" id="threads-error">');
  });

  it("shows a channel's name as text", async () => {
    const html = render(
      <Select
        id="v"
        name="v"
        label="Channel"
        options={[{ value: "x", label: "<script>alert(1)</script>" }]}
      />,
    );
    expect(html).toContain("&lt;script>alert(1)&lt;/script>");
    expect((await outline(html)).scripts).toBe(0);
  });

  it("is disabled and previewed as asked", () => {
    const html = render(
      <Select
        id="v"
        name="v"
        label="Channel"
        options={CHANNELS}
        disabled
        preview="focus"
      />,
    );
    expect(html).toContain(' disabled data-preview="focus"');
  });
});
