/**
 * The Cairn map at `/styleguide/map`: the committed sample pictures the map
 * style is reviewed on, shown about as wide as Discord shows them, and each
 * colour role of `src/maps/style.ts` as a swatch with its token and the
 * recipe that makes it from Cairn's colours. "Cairn map" in
 * docs/design-system.md explains the roles and the hierarchy.
 */
import { RECIPES, type ColourRecipe, type ColourRole } from "../../maps/style";
import { assetPath } from "../assets";
import { Layout } from "../layout";
import type { SchemeTokens } from "../tokens";
import { Section } from "./styleguide/section";

/** Where `npm run maps:samples` writes the samples, under `public/assets/`. */
export const MAP_SAMPLES_DIR = "maps/samples";

/** The committed samples, in the order the page shows them. */
export const MAP_SAMPLES: { file: string; caption: string; alt: string }[] = [
  {
    file: "trailhead-z11.png",
    caption: "The trailhead, zoom 11",
    alt: "Zoom 11: the pin at the Mount Si trailhead, North Bend to the west, the river below and Mount Si to the north.",
  },
  {
    file: "trailhead-z12.png",
    caption: "The trailhead, zoom 12 (the default)",
    alt: "Zoom 12, the default: the pin at the trailhead with the trails up Mount Si, Little Si and Mount Teneriffe.",
  },
  {
    file: "trailhead-z12-imperial.png",
    caption: "The trailhead, zoom 12, imperial units",
    alt: "Zoom 12 in imperial units: the same view with elevations in feet and a scale bar in miles.",
  },
  {
    file: "trailhead-z14.png",
    caption: "The trailhead, zoom 14",
    alt: "Zoom 14: the pin on the trailhead parking, the road below it and the trail leaving north.",
  },
  {
    file: "peak-z13.png",
    caption: "Mount Si's summit, zoom 13",
    alt: "Zoom 13: the pin on Mount Si's summit, its name and height beside it, the trails around it.",
  },
  {
    file: "lake-z14.png",
    caption: "Crater Lake's shore, zoom 14",
    alt: "Zoom 14: the pin on the shore of Crater Lake, between Crater Lake Peak and Dixie Peak.",
  },
  {
    file: "town-z14.png",
    caption: "North Bend's centre, zoom 14",
    alt: "Zoom 14: the pin in North Bend's centre, the densest view, with streets, buildings and the river.",
  },
  {
    file: "pin-on-forest.png",
    caption: "The pin on forest",
    alt: "The pin on forest: the orange blaze with its white outline and dark keyline.",
  },
  {
    file: "pin-on-water.png",
    caption: "The pin on water",
    alt: "The pin on water: the orange blaze with its white outline and dark keyline.",
  },
  {
    file: "pin-on-snow.png",
    caption: "The pin on snow",
    alt: "The pin on a glacier: the orange blaze with its white outline and dark keyline.",
  },
];

/** Each colour role with what it draws, in groups. */
export const MAP_ROLE_GROUPS: {
  title: string;
  roles: [ColourRole, string][];
}[] = [
  {
    title: "Land and water",
    roles: [
      ["land", "The paper: everything that is not another fill."],
      ["forest", "Forest and woods."],
      ["grass", "Grass, meadow, scrub and wetland."],
      ["bareRock", "Bare rock, scree and sand."],
      ["ice", "Glaciers and permanent snow."],
      ["settled", "Towns' built-up areas."],
      ["park", "Parks, gardens and pitches."],
      ["protectedArea", "Protected areas, at 8 % over the fills."],
      ["protectedAreaOutline", "Their dashed edge."],
      ["water", "Lakes, rivers and streams."],
      ["waterLabel", "Names of water."],
    ],
  },
  {
    title: "Roads and trails",
    roles: [
      ["path", "Trails and footpaths: the first thing a hiker looks for."],
      ["track", "Unpaved tracks and forest roads."],
      ["pathHalo", "The light line under trails and tracks."],
      ["roadMajor", "Major roads, such as the road to a trailhead."],
      ["roadMajorCasing", "Their edges."],
      ["roadMinor", "Minor roads and streets."],
      ["roadMinorCasing", "Their edges."],
      ["roadMotorway", "Motorways, kept quiet."],
      ["roadMotorwayCasing", "Their edges."],
      ["rail", "Railways."],
      ["building", "Buildings, at 40 %."],
    ],
  },
  {
    title: "Labels, the pin and the frame",
    roles: [
      ["label", "Names of places and peaks."],
      ["labelHalo", "The halo round every label."],
      ["peak", "Peaks' triangles."],
      ["pin", "The pin: the trail blaze."],
      ["pinOutline", "The pin's light outline."],
      ["pinKeyline", "The dark line round it, for snow and pale fills."],
      ["furniture", "The scale bar and the attribution."],
      ["furnitureBackground", "Their backing, at 80 %."],
      ["frame", "The line round the picture."],
    ],
  },
];

/** `--map-<role in kebab case>`, without the dashes. */
export function mapToken(role: ColourRole): string {
  return `map-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** A recipe in words: the token, or its share mixed into another. */
export function recipeText(recipe: ColourRecipe): string {
  if (recipe.amount === undefined) return `--${recipe.token}`;
  const share = String(Math.round(recipe.amount * 100));
  return `${share}% --${recipe.token} in --${recipe.into ?? "color-bg"}`;
}

export function StyleguideMapPage({ tokens }: { tokens: SchemeTokens }) {
  return (
    <Layout title="Cairn map · Style guide · hikebot" width="overview">
      <div class="stack stack--section">
        <div class="page-heading">
          <p class="page-heading__eyebrow">Cairn design system</p>
          <h1>Cairn map</h1>
          <p class="page-heading__lead">
            The map picture the bot posts with a hike: Cairn's colours and
            typeface on paper, with the trail blaze as the pin. It has one look
            in both colour schemes, because Discord shows the same image in
            both.
          </p>
          <p>
            <a href="/styleguide">Back to the style guide</a>
          </p>
        </div>
        <Section
          id="samples"
          title="Samples"
          intro="The pictures a change to the map style is reviewed on, about 400 pixels wide, as Discord shows them on a phone. The trail, the road to the trailhead, water and the summit's name and height come first; the pin stands out on forest, water and snow."
        >
          <ul class="styleguide-maps list-reset">
            {MAP_SAMPLES.map(({ file, caption, alt }) => (
              <li key={file}>
                <figure class="stack stack--tight">
                  <img
                    src={assetPath(`${MAP_SAMPLES_DIR}/${file}`)}
                    alt={alt}
                    width={1200}
                    height={800}
                    loading="lazy"
                  />
                  <figcaption class="u-small">
                    {caption} <code class="u-muted">{file}</code>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </Section>
        <Section
          id="roles"
          title="Colour roles"
          intro="Each role's token, its value, and how it is made from Cairn's light-scheme colours: a token itself, or a share of one mixed into another, as CSS color-mix in sRGB makes it."
        >
          {MAP_ROLE_GROUPS.map(({ title, roles }) => (
            <div key={title} class="stack stack--tight">
              <h3>{title}</h3>
              <ul class="styleguide-swatches styleguide-swatches--wide">
                {roles.map(([role, use]) => (
                  <li key={role} class="styleguide-swatch">
                    <span class="styleguide-sample" data-bg={mapToken(role)} />
                    <code>--{mapToken(role)}</code>
                    <span class="u-muted">
                      <span class="u-numeric">
                        {tokens.light[mapToken(role)]}
                      </span>
                      , {recipeText(RECIPES[role])}. {use}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
      </div>
    </Layout>
  );
}
