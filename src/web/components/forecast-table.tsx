/**
 * Forecast table: the hourly forecast of a hike, one row per hour, as the
 * hike thread shows it. Each row is headed by the hour with the conditions
 * in words and their weather icon under it, then the numbers a member
 * compares down the column: the temperature with what it feels like, the chance of
 * rain or snow, its amount, and the wind with its gusts. Each column's
 * unit is said once, in its head under its name ("Temp" over "°F"), and
 * the cells are bare figures in tabular digits, aligned right ("Layout
 * rules" in docs/design-system.md); a value Open-Meteo did not give is a
 * dash. On a phone a cell's second figure ("feels 47") sits under the
 * first, so five columns fit 390px, and from the breakpoint beside it. The
 * caption names the day and the time zone.
 */
import { WeatherIcon } from "./weather-icons";

/** One hour; each value is null when the forecast has none. */
export interface ForecastTableHour {
  /** The hour, in milliseconds since the epoch. */
  at: number;
  /** The hour in the server's time zone: `09:00`. */
  time: string;
  /** The WMO weather code, for the icon. */
  code: number | null;
  /** The conditions in words: `Light rain`. */
  conditions: string;
  temperature: number | null;
  feelsLike: number | null;
  /** In percent. */
  precipitationChance: number | null;
  precipitation: number | null;
  wind: number | null;
  gusts: number | null;
}

/** How the server's units are written: `°F`, `in` and `mph`, with 2 decimals. */
export interface ForecastUnits {
  temperature: string;
  precipitation: string;
  wind: string;
  /** Decimals of a precipitation amount. */
  decimals: number;
}

export interface ForecastTableProps {
  /** Names the table: "Hourly forecast for Sat, 15 Jun 2030". */
  caption: string;
  hours: ForecastTableHour[];
  units: ForecastUnits;
}

const NONE = "–";

function whole(value: number | null): string {
  return value === null ? NONE : String(Math.round(value));
}

function Figures({ first, second }: { first: string; second: string }) {
  return (
    <>
      {first} <span class="forecast-table__second">{second}</span>
    </>
  );
}

/**
 * A number column's head: its name, shortened to fit a phone and read out
 * in full, over its unit, read out as "Temperature, °F".
 */
function Head({
  shown,
  spoken,
  unit,
}: {
  shown: string;
  spoken: string;
  unit: string;
}) {
  return (
    <th scope="col" class="forecast-table__number">
      <span aria-hidden="true">
        {shown}
        <span class="forecast-table__unit">{unit}</span>
      </span>
      <span class="u-visually-hidden">{`${spoken}, ${unit}`}</span>
    </th>
  );
}

export function ForecastTable({ caption, hours, units }: ForecastTableProps) {
  return (
    <table class="forecast-table">
      <caption class="u-small u-muted">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <Head shown="Temp" spoken="Temperature" unit={units.temperature} />
          <Head shown="Chance" spoken="Chance of rain or snow" unit="%" />
          <Head shown="Rain" spoken="Rain or snow" unit={units.precipitation} />
          <Head shown="Wind" spoken="Wind" unit={units.wind} />
        </tr>
      </thead>
      <tbody>
        {hours.map((hour) => (
          <tr key={hour.at}>
            <th scope="row">
              <time datetime={new Date(hour.at).toISOString()}>
                {hour.time}
              </time>
              <span class="forecast-table__conditions">
                <WeatherIcon code={hour.code} size="small" />
                {hour.conditions}
              </span>
            </th>
            <td class="forecast-table__number">
              <Figures
                first={whole(hour.temperature)}
                second={`feels\u00a0${whole(hour.feelsLike)}`}
              />
            </td>
            <td class="forecast-table__number">
              {whole(hour.precipitationChance)}
            </td>
            <td class="forecast-table__number">
              {hour.precipitation === null
                ? NONE
                : hour.precipitation.toFixed(units.decimals)}
            </td>
            <td class="forecast-table__number">
              <Figures
                first={whole(hour.wind)}
                second={`gusts\u00a0${whole(hour.gusts)}`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
