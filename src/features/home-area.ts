/**
 * The guild's home area, set under Settings: free text such as `Seattle,
 * Washington`, looked up once on OpenStreetMap's geocoder when it is set,
 * and stored with the point found. Lookups of proposed locations then focus
 * on a box around that point, so the nearby match comes first. The lookup
 * runs in the follow-up, after the answer, in its turn among the guild's
 * requests to the geocoder; a place the geocoder does not know is refused.
 */
import type { APIModalSubmitInteraction } from "discord-api-types/v10";
import { discordApi } from "../discord/api";
import {
  ephemeralReply,
  label,
  messageBody,
  modal,
  textInput,
  textInputValue,
  update,
} from "../discord/components";
import { GuildConfig } from "../guild/config";
import { adminOnly } from "../guild/permissions";
import type {
  ComponentHandler,
  HandlerContext,
  ModalHandler,
  Router,
} from "../guild/router";
import { GeocodeError, nominatim } from "../geo/nominatim";
import { PollStore } from "../polls/store";
import {
  ADMIN_PANEL_FIELDS,
  ADMIN_PANEL_IDS,
  loadAdminPanelState,
  renderAdminSettings,
} from "./admin-panel";
import { reserveLookupSlot } from "./locate";
import { deferPanel, errorText } from "./poll-ui";

/** The longest home area the modal takes. */
export const MAX_HOME_AREA = 100;

/** Set home area: the modal, prefilled with the current home area. */
const openHomeAreaModal: ComponentHandler = adminOnly(
  (_interaction, _context, settings) => ({
    response: modal(ADMIN_PANEL_IDS.homeArea, "Set home area", [
      label(
        "Home area",
        textInput({
          custom_id: ADMIN_PANEL_FIELDS.homeArea,
          required: false,
          max_length: MAX_HOME_AREA,
          placeholder: "Seattle, Washington",
          ...(settings.homeArea === null
            ? {}
            : { value: settings.homeArea.text }),
        }),
        "A city or region. Leave it empty to look locations up worldwide.",
      ),
    ]),
  }),
);

/** Waits `ms` milliseconds, for a turn among the geocoder requests. */
function wait(ms: number): Promise<void> {
  return ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Looks `text` up on the geocoder in the guild's next free slot, and stores
 * it as the home area when found. Returns the note for the settings view.
 */
export async function lookUpHomeArea(
  context: HandlerContext,
  text: string,
): Promise<string> {
  const { storage } = context;
  const store = new PollStore(storage);
  const now = store.now();
  await wait((await reserveLookupSlot(storage, now)) - now);
  let found;
  try {
    found = await nominatim(context.env).search(text);
  } catch (error) {
    const why =
      error instanceof GeocodeError
        ? `OpenStreetMap's geocoder ${error.message}`
        : "OpenStreetMap's geocoder could not be reached";
    return `${why}, so the home area is unchanged. Try again in a minute.`;
  }
  if (found === null) {
    return `**${text}** was not found on OpenStreetMap, so the home area is unchanged. Enter a city and region, such as Seattle, Washington.`;
  }
  new GuildConfig(storage).setHomeArea({
    text,
    name: found.name,
    lat: found.point.lat,
    lon: found.point.lon,
  });
  return `Home area set to **${text}**, found as ${found.name}.`;
}

/**
 * The home area modal: empty clears it at once; the same text as before
 * keeps the stored place; other text is looked up in the follow-up, which
 * replaces the settings view with the result.
 */
const saveHomeArea: ModalHandler = adminOnly(
  (interaction: APIModalSubmitInteraction, context, settings) => {
    const text = (
      textInputValue(interaction.data, ADMIN_PANEL_FIELDS.homeArea) ?? ""
    )
      .trim()
      .replace(/\s+/g, " ");
    const answer = (notice: string) => {
      const components = renderAdminSettings(
        loadAdminPanelState(context.storage),
        notice,
      );
      return {
        response:
          interaction.message === undefined
            ? ephemeralReply(components)
            : update(components),
      };
    };
    if (text === "") {
      new GuildConfig(context.storage).setHomeArea(null);
      return answer("Home area cleared: locations are looked up worldwide.");
    }
    if (settings.homeArea?.text === text) {
      return answer(`The home area is already **${text}**.`);
    }
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        const notice = await lookUpHomeArea(context, text);
        try {
          await discordApi(context.env).editOriginalInteractionResponse(
            interaction.application_id,
            interaction.token,
            messageBody(
              renderAdminSettings(loadAdminPanelState(context.storage), notice),
            ),
          );
        } catch (error) {
          console.error(
            `redrawing the settings for interaction ${interaction.id} failed: ${errorText(error)}`,
          );
        }
      },
    };
  },
);

/** Registers Set home area and its modal. */
export function registerHomeArea(router: Router): Router {
  router.component(ADMIN_PANEL_IDS.homeArea, openHomeAreaModal);
  router.modal(ADMIN_PANEL_IDS.homeArea, saveHomeArea);
  return router;
}
