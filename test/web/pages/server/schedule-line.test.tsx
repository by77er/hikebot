import { describe, expect, it } from "vitest";
import type { WebSchedule } from "../../../../src/features/schedule-section";
import { ScheduleLine } from "../../../../src/web/pages/server/schedule-line";
import { render, spokenText } from "../../components/render";
import { baseView, schedule, TIME_ZONE } from "./view";

async function line(value: WebSchedule, isAdmin = false): Promise<string> {
  const view = baseView({ schedule: value });
  return spokenText(
    render(
      <ScheduleLine view={{ ...view, viewer: { ...view.viewer, isAdmin } }} />,
    ),
  );
}

const AT = Date.UTC(2030, 5, 5, 7);

describe("ScheduleLine", () => {
  it.each([
    [
      "start-location-vote",
      "The next location vote opens Wed, 5 Jun 2030 · 09:00.",
    ],
    [
      "close-location-vote",
      "The location vote closes Wed, 5 Jun 2030 · 09:00, and the date vote opens.",
    ],
    [
      "hold-location-vote",
      "The location vote closes Wed, 5 Jun 2030 · 09:00 if anyone has voted, and the date vote opens.",
    ],
    ["start-date-vote", "The date vote opens Wed, 5 Jun 2030 · 09:00."],
    ["close-date-vote", "The date vote closes Wed, 5 Jun 2030 · 09:00."],
    [
      "hold-date-vote",
      "The date vote closes Wed, 5 Jun 2030 · 09:00 if anyone has voted.",
    ],
    [
      "cancel-quiet-round",
      "The date vote closes Wed, 5 Jun 2030 · 09:00 if anyone has voted; if nobody has, the round is cancelled.",
    ],
  ] as const)("says what happens next for %s", async (kind, words) => {
    const text = await line(
      schedule({ next: { kind, at: AT, when: "Wed, 5 Jun 2030 · 09:00" } }),
    );
    expect(text).toBe(
      `Schedule ${words} The bot opens and closes the votes on Wednesdays at 09:00 (${TIME_ZONE}); a date vote runs for 2 days.`,
    );
  });

  it("names the date of an action more than a week away", async () => {
    expect(
      await line(
        schedule({
          next: {
            kind: "start-location-vote",
            at: AT,
            when: "Wed, 19 Jun 2030 · 09:00",
          },
        }),
      ),
    ).toContain("The next location vote opens Wed, 19 Jun 2030 · 09:00.");
  });

  it("says why it does nothing yet", async () => {
    expect(
      await line(schedule({ next: null, waiting: "manual_date_vote" })),
    ).toContain(
      "Nothing until an admin closes the date vote, which was started before the schedule was turned on.",
    );
    expect(
      await line(schedule({ next: null, waiting: "planned_hike" })),
    ).toContain(
      "The next location vote opens on the schedule after the planned hike.",
    );
    expect(await line(schedule({ next: null, waiting: null }))).toContain(
      "Nothing in the coming weeks.",
    );
  });

  it("tells an admin where to change it", async () => {
    expect(await line(schedule(), true)).toContain(
      "You are an admin: change the schedule in Discord with /hike admin, then Settings.",
    );
    expect(await line(schedule())).not.toContain("You are an admin");
  });

  it("shows nothing while the schedule is off", () => {
    expect(render(<ScheduleLine view={baseView()} />)).toBe("");
  });
});
