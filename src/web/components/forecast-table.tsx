/**
 * Forecast table: the hourly forecast of a hike, one row per hour, as the
 * hike thread shows it. Each row is the hour (its header), the conditions
 * in words with their weather icon, the temperature with what it feels
 * like, the chance and amount of rain or snow, and the wind with its
 * gusts; a value Open-Meteo did not give is a dash. Each cell carries its
 * units and says what its second figure is ("feels 47°", "gusts 12"), so
 * the headers stay one short word and a cell reads on its own; on a phone
 * the second figure sits under the first, so five columns fit 390px, and
 * from the breakpoint beside it. The caption names the day and the time
 * zone.
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

function degrees(value: number | null): string {
  return value === null ? NONE : `${whole(value)}°`;
}

function Figures({ first, second }: { first: string; second: string }) {
  return (
    <>
      {first} <span class="forecast-table__second">{second}</span>
    </>
  );
}

/** A header shortened to fit a phone, read out in full. */
function Short({ shown, spoken }: { shown: string; spoken: string }) {
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span class="u-visually-hidden">{spoken}</span>
    </>
  );
}

export function ForecastTable({ caption, hours, units }: ForecastTableProps) {
  return (
    <table class="forecast-table">
      <caption class="u-small u-muted">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Conditions</th>
          <th scope="col">
            <Short shown="Temp" spoken="Temperature" />
          </th>
          <th scope="col">
            <Short shown="Rain" spoken="Rain or snow" />
          </th>
          <th scope="col">Wind</th>
        </tr>
      </thead>
      <tbody>
        {hours.map((hour) => (
          <tr key={hour.at}>
            <th scope="row">
              <time datetime={new Date(hour.at).toISOString()}>
                {hour.time}
              </time>
            </th>
            <td>
              <span class="cluster cluster--tight cluster--nowrap">
                <WeatherIcon code={hour.code} size="small" />
                {hour.conditions}
              </span>
            </td>
            <td>
              <Figures
                first={`${degrees(hour.temperature)}${hour.temperature === null ? "" : units.temperature.replace("°", "")}`}
                second={`feels\u00a0${degrees(hour.feelsLike)}`}
              />
            </td>
            <td>
              <Figures
                first={
                  hour.precipitationChance === null
                    ? NONE
                    : `${whole(hour.precipitationChance)}%`
                }
                second={
                  hour.precipitation === null
                    ? NONE
                    : `${hour.precipitation.toFixed(units.decimals)}\u00a0${units.precipitation}`
                }
              />
            </td>
            <td>
              <Figures
                first={
                  hour.wind === null
                    ? NONE
                    : `${whole(hour.wind)}\u00a0${units.wind}`
                }
                second={`gusts\u00a0${whole(hour.gusts)}`}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
