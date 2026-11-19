import { describe, expect, it } from "vitest";
import { RoundStepper } from "../../../src/web/components/round-stepper";
import { render, spokenText } from "./render";

/** Each step's class modifier and whether it is the current step. */
function steps(html: string): string[] {
  return [
    ...html.matchAll(
      /<li class="round-stepper__step round-stepper__step--(\w+)"( aria-current="step")?/g,
    ),
  ].map(([, state = "", current]) => (current ? `${state}*` : state));
}

describe("RoundStepper", () => {
  it("is an ordered list named Hike round, with three steps", () => {
    const html = render(<RoundStepper step="location" />);
    expect(html).toMatch(/^<ol class="round-stepper" aria-label="Hike round">/);
    expect(html.match(/<li /g)).toHaveLength(3);
  });

  it("marks the location vote as now, with the blaze and aria-current", async () => {
    const html = render(<RoundStepper step="location" />);
    expect(steps(html)).toEqual(["current*", "upcoming", "upcoming"]);
    expect(html).toContain(
      '<span class="round-stepper__marker"><span class="blaze" aria-hidden="true"></span></span>',
    );
    expect(await spokenText(html)).toBe(
      "Hike round Location vote Now Date vote To come Hike planned To come",
    );
  });

  it("marks the steps before the current one done", async () => {
    const html = render(<RoundStepper step="date" />);
    expect(steps(html)).toEqual(["done", "current*", "upcoming"]);
    expect(await spokenText(html)).toBe(
      "Hike round Location vote Done Date vote Now Hike planned To come",
    );
  });

  it("marks every step done once the hike is planned, with the blaze on the last", async () => {
    const html = render(<RoundStepper step="planned" />);
    expect(steps(html)).toEqual(["done", "done", "done*"]);
    expect(html.match(/class="blaze"/g)).toHaveLength(1);
    expect(await spokenText(html)).toBe(
      "Hike round Location vote Done Date vote Done Hike planned Done",
    );
  });

  it("says where a cancelled round stopped, and that the rest was not reached", async () => {
    const html = render(<RoundStepper step="date" cancelled />);
    expect(html).toMatch(/^<ol class="round-stepper round-stepper--cancelled"/);
    expect(steps(html)).toEqual(["done", "cancelled*", "skipped"]);
    expect(html).not.toContain('class="blaze"');
    expect(await spokenText(html)).toBe(
      "Hike round Location vote Done Date vote Cancelled Hike planned Not reached",
    );
  });

  it("can be cancelled at the location vote", async () => {
    const html = render(<RoundStepper step="location" cancelled />);
    expect(steps(html)).toEqual(["cancelled*", "skipped", "skipped"]);
    expect(await spokenText(html)).toBe(
      "Hike round Location vote Cancelled Date vote Not reached Hike planned Not reached",
    );
  });
});
