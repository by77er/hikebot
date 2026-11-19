import { describe, expect, it } from "vitest";
import { ErrorSummary } from "../../../src/web/components/error-summary";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

const ERRORS = [
  {
    field: "proposal-name",
    message: "Mailbox Peak is already on the list. Vote for it instead.",
  },
  { field: "proposal-map", message: "No coordinates could be read from that." },
];

describe("ErrorSummary", () => {
  it("is an alert named by its title that takes focus when the page loads", () => {
    const html = render(
      <ErrorSummary title="Your location was not added." errors={ERRORS} />,
    );
    const titleId = /aria-labelledby="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(titleId).not.toBe("");
    expect(html).toMatch(
      /^<div class="error-summary" role="alert" aria-labelledby="[^"]+" tabindex="-1" autofocus>/,
    );
    expect(html).toContain(
      `<p class="error-summary__title" id="${titleId}">Your location was not added.</p>`,
    );
  });

  it("links to each field in error, in the field's words", async () => {
    const html = render(
      <ErrorSummary title="Your location was not added." errors={ERRORS} />,
    );
    expect(
      [...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(
        ([, href, text]) => [href, text],
      ),
    ).toEqual([
      ["#proposal-name", ERRORS[0]?.message],
      ["#proposal-map", ERRORS[1]?.message],
    ]);
    expect(await spokenText(html)).toBe(
      `Error Your location was not added. ${ERRORS.map(({ message }) => message).join(" ")}`,
    );
  });

  it("leaves focus alone when asked, and has no heading before the page's h1", () => {
    const html = render(
      <ErrorSummary title="Not added." errors={ERRORS} autoFocus={false} />,
    );
    expect(html).not.toContain("autofocus");
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("shows a member's words as text", async () => {
    const html = render(
      <ErrorSummary
        title="Not added."
        errors={[
          {
            field: "n",
            message: "<script>alert(1)</script> is already on the list.",
          },
        ]}
      />,
    );
    expect((await outline(html)).scripts).toBe(0);
  });
});
