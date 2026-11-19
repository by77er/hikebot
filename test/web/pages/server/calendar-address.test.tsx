import { describe, expect, it } from "vitest";
import { CalendarAddress } from "../../../../src/web/pages/server/calendar-address";
import { render, spokenText } from "../../components/render";
import { baseView, GUILD } from "./view";

describe("CalendarAddress", () => {
  it("shows the address in a read-only field, with Subscribe as a webcal link", async () => {
    const html = render(<CalendarAddress view={baseView()} />);
    expect(html).toMatch(
      new RegExp(
        `<input[^>]*value="https://hikebot.example/calendar/${GUILD}/sig.ics"[^>]*readonly`,
      ),
    );
    expect(html).toContain(
      '<label class="form-row__label" for="calendar-address"',
    );
    expect(html).toContain(
      `href="webcal://hikebot.example/calendar/${GUILD}/sig.ics"`,
    );
    expect(html).not.toContain("<script");
    const text = await spokenText(html);
    expect(text).toContain("Calendar address");
    expect(text).toContain("Calendar apps can subscribe to this address");
    expect(text).toContain("Subscribe");
  });
});
