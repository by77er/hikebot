/**
 * Conditions in words for the WMO weather codes Open-Meteo reports, from
 * the "WMO Weather interpretation codes (WW)" table of its documentation
 * (https://open-meteo.com/en/docs), shortened to end a row of the hourly
 * forecast.
 */
const WORDS: Readonly<Record<number, string>> = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Dense frz drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Hvy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "T-storm, hail",
  97: "Heavy t-storm",
  99: "T-storm, big hail",
};

/** The longest words `conditions` returns. */
export const MAX_CONDITIONS = Math.max(
  ...Object.values(WORDS).map((words) => words.length),
);

/** The conditions of WMO code `code` in words; `?` for none or an unknown code. */
export function conditions(code: number | null): string {
  return (code === null ? undefined : WORDS[code]) ?? "?";
}
