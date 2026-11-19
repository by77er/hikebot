import { describe, expect, it } from "vitest";
import { STATUSES, StatusPill } from "../../../src/web/components/status-pill";
import { render, spokenText } from "./render";

describe("StatusPill", () => {
  it.each([
    ["open", "Open"],
    ["closed", "Closed"],
    ["decided", "Decided"],
    ["planned", "Planned"],
    ["cancelled", "Cancelled"],
  ] as const)(
    "says %s in a word, with a decorative icon",
    async (status, word) => {
      const html = render(<StatusPill status={status} />);
      expect(html).toMatch(
        new RegExp(
          `^<span class="status-pill status-pill--${status}"><svg class="icon icon--small status-pill__icon"[^>]*aria-hidden="true">`,
        ),
      );
      expect(html).toMatch(new RegExp(`</svg>${word}</span>$`));
      expect(await spokenText(html)).toBe(word);
    },
  );

  it("draws each status with an icon of its own", () => {
    const icons = STATUSES.map((status) =>
      render(<StatusPill status={status} />).replace(
        /^.*?<svg|<\/svg>.*$/g,
        "",
      ),
    );
    expect(new Set(icons).size).toBe(STATUSES.length);
  });
});
