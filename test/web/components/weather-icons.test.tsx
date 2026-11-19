import { describe, expect, it } from "vitest";
import {
  CircleHelpIcon,
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudHailIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  SunIcon,
  WEATHER_ICONS,
  WeatherIcon,
  weatherIconFor,
} from "../../../src/web/components/weather-icons";
import { render, spokenText } from "./render";

describe("weather icons", () => {
  it.each(Object.entries(WEATHER_ICONS))(
    "%s is a decorative 24-unit stroke icon",
    async (_name, Glyph) => {
      const html = render(<Glyph />);
      expect(html).toMatch(
        /^<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">/,
      );
      expect(await spokenText(html)).toBe("");
    },
  );

  it.each([
    [0, SunIcon],
    [1, CloudSunIcon],
    [2, CloudSunIcon],
    [3, CloudIcon],
    [45, CloudFogIcon],
    [48, CloudFogIcon],
    [51, CloudDrizzleIcon],
    [57, CloudDrizzleIcon],
    [61, CloudRainIcon],
    [67, CloudRainIcon],
    [80, CloudRainIcon],
    [82, CloudRainIcon],
    [71, CloudSnowIcon],
    [77, CloudSnowIcon],
    [85, CloudSnowIcon],
    [86, CloudSnowIcon],
    [95, CloudLightningIcon],
    [97, CloudLightningIcon],
    [96, CloudHailIcon],
    [99, CloudHailIcon],
    [null, CircleHelpIcon],
    [42, CircleHelpIcon],
  ] as const)("draws WMO code %s with its icon", (code, Glyph) => {
    expect(weatherIconFor(code)).toBe(Glyph);
    expect(render(<WeatherIcon code={code} size="small" />)).toBe(
      render(<Glyph size="small" />),
    );
  });
});
