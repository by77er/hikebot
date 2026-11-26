/**
 * Starts every map view on the page (`MapView` in
 * src/web/components/map-view.tsx): reads its settings from `data-map`,
 * loads the style from this site, and draws the map with MapLibre GL JS
 * (./maplibre/, which starts its worker from its own folder here) over the
 * stored picture (or the line saying the map needs JavaScript), which it
 * removes once the map has drawn. Markers, the zoom buttons and the
 * attribution are added. Without map data (no style, or no place inside
 * the data) a map keeps its picture; without a picture it is hidden, with
 * the section round it when it has one (`data-map-section`).
 *
 * `data-map-state` on the figure says where it is: `loading` until it has
 * first drawn, `idle` once it has drawn everything it shows (screenshots
 * wait for it), `drawing` while it draws again after its frame was
 * resized, `none` without map data, or `failed` on any other error;
 * `data-map-zoom` is the zoom it shows. Loaded as a module, so a page with
 * two maps runs it once.
 */
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  Popup,
} from "./maplibre/maplibre-gl.mjs";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Room round fitted markers, in pixels, so none sits on the edge. */
const FIT_PADDING = 48;

/** The closest a fitted map zooms in, as close as the data goes. */
const FIT_MAX_ZOOM = 14;

for (const figure of document.querySelectorAll("figure[data-map]")) {
  if (figure.dataset.mapState) continue;
  figure.dataset.mapState = "loading";
  start(figure).catch((error) => {
    const none = error instanceof NoMapData;
    figure.dataset.mapState = none ? "none" : "failed";
    if (!figure.querySelector("img.map-view__picture")) {
      (figure.closest("[data-map-section]") ?? figure).hidden = true;
    }
    if (!none) console.warn(`The map could not be shown: ${String(error)}`);
  });
}

/** The map data does not cover the map's places, or there is none. */
class NoMapData extends Error {}

async function start(figure) {
  const config = JSON.parse(figure.dataset.map);
  const response = await fetch(config.style);
  if (response.status === 404) throw new NoMapData();
  if (!response.ok) throw new Error(`style answered ${response.status}`);
  const style = await response.json();
  const markers = config.markers.filter((marker) =>
    inside(style.sources.hikebot.bounds, marker),
  );
  if (markers.length === 0) throw new NoMapData();

  const frame = figure.querySelector(".map-view__frame");
  const picture = frame.querySelector(".map-view__picture");
  const zoom = frame.querySelector(".map-view__zoom");

  const single = markers.length === 1 ? markers[0] : null;
  const map = new MapLibreMap({
    container: frame,
    style,
    attributionControl: false,
    ...(single
      ? { center: [single.lon, single.lat], zoom: config.zoom }
      : {
          bounds: boundsOf(markers),
          fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
        }),
    minZoom: style.sources.hikebot.minzoom,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: reducedMotion ? 0 : 300,
    locale: { "Map.Title": config.title },
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new AttributionControl({ compact: false }), "bottom-left");
  // Tiles outside the archives answer 404; the map shows paper there.
  map.on("error", () => undefined);
  // The peaks' triangle is there before any tile is laid out, so every
  // peak gets it whichever tile arrives first.
  const peak = style.metadata?.["hikebot:peak"];
  if (peak) map.once("style.load", () => addPeakImage(map, peak));

  // The hike's pin has no number; a vote's places do, even when only one
  // of them lies inside the map data.
  for (const marker of markers) {
    addMarker(map, marker, marker.number === undefined);
  }

  for (const button of zoom.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      const options = { animate: !reducedMotion };
      if (button.dataset.zoom === "in") map.zoomIn(options);
      else map.zoomOut(options);
    });
  }

  const showZoom = () => {
    figure.dataset.mapZoom = map.getZoom().toFixed(2);
  };
  map.on("zoomend", showZoom);
  map.once("idle", () => {
    picture?.remove();
    zoom.hidden = false;
    showZoom();
    figure.dataset.mapState = "idle";
  });
  map.on("resize", () => {
    if (figure.dataset.mapState !== "idle") return;
    figure.dataset.mapState = "drawing";
    map.once("idle", () => {
      figure.dataset.mapState = "idle";
    });
  });
}

function addMarker(map, marker, pin) {
  const element = document.createElement("div");
  element.className = pin ? "map-view__pin" : "map-view__marker";
  element.setAttribute("role", "img");
  if (pin) {
    element.setAttribute("aria-label", marker.label);
  } else {
    element.textContent = String(marker.number);
    element.setAttribute("aria-label", `${marker.number}. ${marker.label}`);
  }
  const popup = new Popup({
    anchor: "bottom",
    closeButton: false,
    closeOnClick: !pin,
    focusAfterOpen: false,
    offset: pin ? [0, -40] : [0, -20],
    maxWidth: "none",
  }).setText(pin ? marker.label : `${marker.number}. ${marker.label}`);
  const placed = new Marker({ element, anchor: pin ? "bottom" : "center" })
    .setLngLat([marker.lon, marker.lat])
    .setPopup(popup)
    .addTo(map);
  if (pin) placed.togglePopup();
}

/**
 * Draws the peaks' triangle, the colours and size from the style's
 * metadata (`src/maps/browser-style.ts`), at the screen's pixel ratio.
 */
function addPeakImage(map, peak) {
  const ratio = Math.max(1, Math.round(devicePixelRatio));
  const size = peak.size * ratio;
  const pad = ratio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size + 2 * pad;
  const context = canvas.getContext("2d");
  const r = size / 2;
  const c = pad + r;
  context.beginPath();
  context.moveTo(c, c - r);
  context.lineTo(c + r, c + r * 0.8);
  context.lineTo(c - r, c + r * 0.8);
  context.closePath();
  context.lineWidth = 2 * ratio;
  context.lineJoin = "round";
  context.strokeStyle = peak.halo;
  context.stroke();
  context.fillStyle = peak.fill;
  context.fill();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  if (!map.hasImage(peak.image)) {
    map.addImage(peak.image, image, { pixelRatio: ratio });
  }
}

function boundsOf(markers) {
  const bounds = new LngLatBounds();
  for (const marker of markers) bounds.extend([marker.lon, marker.lat]);
  return bounds;
}

function inside([west, south, east, north], { lon, lat }) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}
