/**
 * The server's page, after where the planned hike is: its weather. The
 * hourly forecast the bot stored for the hike, as the hike thread shows
 * it, in the server's units and time zone: a row per hour, then sunrise and
 * sunset, the thread's notes (freezing level, UV index, snowfall), when it
 * was updated and Open-Meteo's credit. Without a forecast, why, in the
 * thread's words. Nothing while no hike is planned.
 */
import type { WebView } from "../../../guild/web-view";
import { ForecastTable } from "../../components/forecast-table";
import { SunriseIcon, SunsetIcon } from "../../components/weather-icons";

/** Where Open-Meteo's licence asks its credit to link. */
export const OPEN_METEO_URL = "https://open-meteo.com/";

export function HikeForecast({ view }: { view: WebView }) {
  const forecast = view.hikeForecast;
  if (forecast === null) return null;
  const day = view.plannedHike?.start.label.split(" · ")[0];
  return (
    <section class="stack" aria-labelledby="hike-forecast">
      <h2 id="hike-forecast">Weather</h2>
      {forecast.kind === "none" ? (
        <p>{forecast.text}</p>
      ) : (
        <>
          <ForecastTable
            caption={`Hourly forecast${day ? ` for ${day}` : ""}, times in ${forecast.timeZone}`}
            hours={forecast.hours}
            units={forecast.labels}
          />
          {(forecast.sunrise !== null || forecast.sunset !== null) && (
            <p class="cluster">
              {forecast.sunrise !== null && (
                <span class="cluster cluster--tight">
                  <SunriseIcon /> Sunrise {forecast.sunrise}
                </span>
              )}
              {forecast.sunset !== null && (
                <span class="cluster cluster--tight">
                  <SunsetIcon /> Sunset {forecast.sunset}
                </span>
              )}
            </p>
          )}
          {forecast.notes.length > 0 && (
            <ul>
              {forecast.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <p class="u-small u-muted">
            Updated {forecast.updatedLabel} ({forecast.timeZone}) · checked
            every hour ·{" "}
            <a href={OPEN_METEO_URL}>Weather data by Open-Meteo.com</a>
          </p>
        </>
      )}
    </section>
  );
}
