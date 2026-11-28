import { describe, expect, it } from "vitest";
import { Age } from "../../../src/web/components/age";
import { render, spokenText } from "./render";

const AT = Date.UTC(2030, 5, 1, 8, 46);

describe("Age", () => {
  it("says the age in words, holds the instant, and loads the script that keeps it true", async () => {
    const html = render(
      <Age at={AT} now={AT + 14 * 60_000} timeZone="America/Los_Angeles" />,
    );
    expect(html).toBe(
      '<script type="module" src="/assets/v/dev/cairn/ages.mjs"></script><time datetime="2030-06-01T08:46:00.000Z" data-age data-zone="America/Los_Angeles">14 min ago</time>',
    );
    expect(await spokenText(html)).toBe("14 min ago");
  });

  it("marks an age of the page's own clock reading for the screenshots' frozen clock", () => {
    expect(render(<Age at={AT} now={AT} timeZone="Europe/Berlin" />)).toContain(
      'data-zone="Europe/Berlin" data-clock>just now</time>',
    );
  });
});
