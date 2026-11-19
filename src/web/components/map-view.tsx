/**
 * Map view: a map of one place or a few, drawn in the browser from
 * hikebot's own vector tiles by MapLibre GL JS (`/assets/maps/map-view.mjs`
 * starts it), in the Cairn map style. One marker is the hike's pin, the
 * blaze, with the place's name on it; several are numbered, to match a list
 * beside the map, and the map is fitted to them.
 *
 * Numbered markers come with their list under the map: the number, the
 * name and the coordinates of each, which is also their text alternative.
 *
 * Without JavaScript it shows `picture`, the stored map picture, at the
 * same size the map takes, or without one a line saying the map needs
 * JavaScript, in the same frame, so the map arrives without moving
 * anything. Where the script finds no map data for the places, it hides
 * the frame (the list still shows). The
 * frame keeps a 3:2 shape (the picture's), so nothing moves when the map
 * replaces the picture. The map is one look in both colour schemes, as the
 * picture is ("Cairn map" in docs/design-system.md); the frame sets it off
 * a dark page. `title` names it for assistive technology, and `caption`
 * (the place and its coordinates) is its text alternative.
 */
import type { ComponentChildren } from "preact";
import { assetPath } from "../assets";
import { MinusIcon, PlusIcon } from "./icons";

/** The browser script, under `public/assets/`. */
export const MAP_SCRIPT = "maps/map-view.mjs";

/** Where the map's style comes from (`styleRoute` in `src/web/maps.ts`). */
export const MAP_STYLE = "/maps/style.json";

/** The zoom a single place is shown at, as its picture is. */
export const PLACE_ZOOM = 12;

export interface MapMarker {
  lat: number;
  lon: number;
  /** The place's name: a popup on the pin, the marker's accessible name. */
  label: string;
  /** Numbers the marker, to match a numbered list. */
  number?: number;
}

export interface MapViewProps {
  /** The map's accessible name, such as "Map of Mailbox Peak". */
  title: string;
  /** One pin, or numbered markers; the map centres on or fits them. */
  markers: MapMarker[];
  /** The stored map picture's address, shown without JavaScript. */
  picture?: string | null;
  /** The text alternative, under the map. */
  caption?: ComponentChildren;
  /** `false` inside something that frames it already, such as a hike card. */
  framed?: boolean;
}

/** The browser script's settings, in `data-map`. */
export interface MapConfig {
  style: string;
  title: string;
  zoom: number;
  markers: MapMarker[];
}

/** `47.4881° N, 121.7232° W`. */
export function coordinates({ lat, lon }: { lat: number; lon: number }) {
  const part = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(4)}° ${value < 0 ? negative : positive}`;
  return `${part(lat, "N", "S")}, ${part(lon, "E", "W")}`;
}

export function MapView({
  title,
  markers,
  picture = null,
  caption,
  framed = true,
}: MapViewProps) {
  if (markers.length === 0) return null;
  const config: MapConfig = {
    style: MAP_STYLE,
    title,
    zoom: PLACE_ZOOM,
    markers,
  };
  const numbered = markers.filter((marker) => marker.number !== undefined);
  return (
    <div class={framed ? "map-view map-view--framed" : "map-view"}>
      <figure class="map-view__figure" data-map={JSON.stringify(config)}>
        <div class="map-view__frame">
          {picture !== null ? (
            <img
              class="map-view__picture"
              src={picture}
              alt={title}
              width={600}
              height={400}
            />
          ) : (
            <p class="map-view__picture map-view__fallback">
              Turn on JavaScript to see the map.
            </p>
          )}
          <div class="map-view__zoom" hidden>
            <button type="button" class="map-view__button" data-zoom="in">
              <PlusIcon label="Zoom in" />
            </button>
            <button type="button" class="map-view__button" data-zoom="out">
              <MinusIcon label="Zoom out" />
            </button>
          </div>
        </div>
        {caption !== undefined && (
          <figcaption class="map-view__caption">{caption}</figcaption>
        )}
        <script type="module" src={assetPath(MAP_SCRIPT)} />
      </figure>
      {numbered.length > 0 && (
        <ol class="map-view__legend list-reset" aria-label="Places on the map">
          {numbered.map((marker) => (
            <li key={marker.number} class="map-view__place">
              <span class="map-view__number" aria-hidden="true">
                {marker.number}
              </span>
              <span class="map-view__name">{marker.label}</span>
              <span class="map-view__coordinates">{coordinates(marker)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
