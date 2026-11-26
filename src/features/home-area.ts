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
  label,
  messageBody,
  modal,
  textInput,
  textInputValue,
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
  settingsAnswer,
} from "./admin-panel";
import { reserveLookupSlot } from "./locate";
import { deferPanel, errorText } from "./poll-ui";
import {
  clearHomeArea,
  homeAreaText,
  MAX_HOME_AREA,
  noticeMarkdown,
  sameHomeArea,
  type Checked,
  type Notice,
} from "./settings";

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
 * it as the home area when found; a place the geocoder does not know, or
 * a geocoder that fails, is refused and changes nothing.
 */
export async function lookUpHomeArea(
  context: HandlerContext,
  text: string,
): Promise<Checked<Notice>> {
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
    return {
      ok: false,
      refusal: [
        `${why}, so the home area is unchanged. Try again in a minute.`,
      ],
    };
  }
  if (found === null) {
    return {
      ok: false,
      refusal: [
        { strong: text },
        " was not found on OpenStreetMap, so the home area is unchanged. Enter a city and region, such as Seattle, Washington.",
      ],
    };
  }
  new GuildConfig(storage).setHomeArea({
    text,
    name: found.name,
    lat: found.point.lat,
    lon: found.point.lon,
  });
  return {
    ok: true,
    value: ["Home area set to ", { strong: text }, `, found as ${found.name}.`],
  };
}

/**
 * The home area modal: empty clears it at once; the same text as before
 * keeps the stored place; other text is looked up in the follow-up, which
 * replaces the settings view with the result.
 */
const saveHomeArea: ModalHandler = adminOnly(
  (interaction: APIModalSubmitInteraction, context, settings) => {
    const text = homeAreaText(
      textInputValue(interaction.data, ADMIN_PANEL_FIELDS.homeArea) ?? "",
    );
    if (text === "") {
      return settingsAnswer(
        interaction,
        context,
        clearHomeArea(context.storage),
      );
    }
    if (settings.homeArea?.text === text) {
      return settingsAnswer(interaction, context, sameHomeArea(text));
    }
    return {
      response: deferPanel(interaction),
      followUp: async () => {
        const result = await lookUpHomeArea(context, text);
        const notice = result.ok ? result.value : result.refusal;
        try {
          await discordApi(context.env).editOriginalInteractionResponse(
            interaction.application_id,
            interaction.token,
            messageBody(
              renderAdminSettings(
                loadAdminPanelState(context.storage),
                noticeMarkdown(notice),
              ),
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
