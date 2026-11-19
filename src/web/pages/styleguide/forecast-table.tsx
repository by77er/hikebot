/**
 * Style guide: Forecast table, a dry morning in °F and a wet, windy one in
 * °C, a row without data, and every weather icon with the conditions it
 * stands for.
 */
import {
  ForecastTable,
  type ForecastTableHour,
} from "../../components/forecast-table";
import { WEATHER_ICONS } from "../../components/weather-icons";
import { Section, type StyleguideSection } from "./section";

const HOUR = 60 * 60 * 1000;
const NINE = Date.UTC(2026, 11, 5, 17);

function hour(
  index: number,
  conditions: string,
  code: number | null,
  values: [number, number, number, number, number, number] | null,
): ForecastTableHour {
  const [temperature, feelsLike, chance, amount, wind, gusts] = values ?? [];
  return {
    at: NINE + index * HOUR,
    time: `${String(9 + index).padStart(2, "0")}:00`,
    code,
    conditions,
    temperature: temperature ?? null,
    feelsLike: feelsLike ?? null,
    precipitationChance: chance ?? null,
    precipitation: amount ?? null,
    wind: wind ?? null,
    gusts: gusts ?? null,
  };
}

const DRY = [
  hour(0, "Clear", 0, [47, 41, 0, 0, 2, 4]),
  hour(1, "Mainly clear", 1, [52, 45, 0, 0, 3, 6]),
  hour(2, "Partly cloudy", 2, [55, 49, 5, 0, 4, 9]),
  hour(3, "?", null, null),
];

const WET = [
  hour(0, "Rain", 63, [8, 5, 90, 3.1, 31, 68]),
  hour(1, "Heavy rain", 65, [9, 7, 100, 14.6, 35, 74]),
  hour(2, "Hvy freezing rain", 67, [-1, -6, 95, 5.2, 38, 85]),
  hour(3, "T-storm, big hail", 99, [10, 8, 85, 12.4, 41, 102]),
];

const CONDITIONS: Record<keyof typeof WEATHER_ICONS, string> = {
  CircleHelpIcon: "No data (?)",
  CloudDrizzleIcon: "Drizzle",
  CloudFogIcon: "Fog",
  CloudHailIcon: "Thunderstorm with hail",
  CloudIcon: "Overcast",
  CloudLightningIcon: "Thunderstorm",
  CloudRainIcon: "Rain and showers",
  CloudSnowIcon: "Snow",
  CloudSunIcon: "Mainly clear, partly cloudy",
  SunIcon: "Clear",
  SunriseIcon: "Sunrise",
  SunsetIcon: "Sunset",
};

function ForecastTableSection() {
  return (
    <Section
      id="forecast-table"
      title="Forecast table"
      intro="A hike's hourly forecast, as the hike thread gives it: the hour, the conditions in words with their icon, the temperature and what it feels like, the chance and amount of rain or snow, and the wind with its gusts. On a phone each second figure sits under the first."
    >
      <h3>A dry morning, in °F, inches and mph, with an hour without data</h3>
      <ForecastTable
        caption="Hourly forecast for Sat, 5 Dec 2026, times in America/Los_Angeles"
        hours={DRY}
        units={{
          temperature: "°F",
          precipitation: "in",
          wind: "mph",
          decimals: 2,
        }}
      />
      <h3>A wet and windy one, in °C, mm and km/h, at the widest figures</h3>
      <ForecastTable
        caption="Hourly forecast for Tue, 24 Nov 2026, times in Europe/Berlin"
        hours={WET}
        units={{
          temperature: "°C",
          precipitation: "mm",
          wind: "km/h",
          decimals: 1,
        }}
      />
      <h3>Weather icons</h3>
      <ul class="styleguide-icons">
        {Object.entries(WEATHER_ICONS).map(([name, Glyph]) => (
          <li key={name}>
            <Glyph />
            <Glyph size="small" />
            {CONDITIONS[name as keyof typeof WEATHER_ICONS]}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export const forecastTableSection: StyleguideSection = {
  id: "forecast-table",
  title: "Forecast table",
  render: ForecastTableSection,
  ownPage: true,
};
