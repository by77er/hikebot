import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { ComponentType, InteractionResponseType } from "discord-api-types/v10";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ADMIN_PANEL_FIELDS,
  ADMIN_PANEL_IDS,
} from "../../src/features/admin-panel";
import { lookUpHomeArea } from "../../src/features/home-area";
import { noticeMarkdown } from "../../src/features/settings";
import { GuildConfig, type HomeArea } from "../../src/guild/config";
import {
  callWorker,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";

const OWNER = "400000000000000001";
const GEOCODER = "https://nominatim.test/search";
const PANEL = "/webhooks/100/interaction-token/messages/@original";

const SEATTLE = [
  {
    lat: "47.6038321",
    lon: "-122.330062",
    display_name: "Seattle, King County, Washington, United States",
  },
];

const STORED: HomeArea = {
  text: "Seattle, Washington",
  name: "Seattle, King County, Washington",
  lat: 47.6038321,
  lon: -122.330062,
};

let signer: Signer;
beforeAll(async () => {
  signer = await createSigner();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

function homeArea(guildId: string) {
  return runInDurableObject(
    stub(guildId),
    (_i, state) => new GuildConfig(state.storage).get().homeArea,
  );
}

function storeHomeArea(guildId: string, area: HomeArea) {
  return runInDurableObject(stub(guildId), (_i, state) => {
    new GuildConfig(state.storage).setHomeArea(area);
  });
}

interface Sent {
  method: string;
  path: string;
  body: string;
}

/**
 * Stubs Discord (the guild owner, then any edit) and the geocoder, which
 * `geocoder` answers; returns the geocoder requests and what Discord got.
 */
function stubFetch(guildId: string, geocoder: () => Response) {
  const asked: Request[] = [];
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(GEOCODER)) {
      asked.push(request);
      return geocoder();
    }
    const path = new URL(request.url).pathname.replace("/api/v10", "");
    if (request.method !== "GET") {
      sent.push({ method: request.method, path, body: await request.text() });
    }
    if (path.endsWith(`/guilds/${guildId}`)) {
      return Response.json({ id: guildId, owner_id: OWNER });
    }
    return Response.json({ id: "1" });
  });
  return { asked, sent };
}

function asAdmin<T extends object>(interaction: T): T {
  return Object.assign(interaction, {
    member: { user: { id: OWNER }, roles: [] },
    message: { id: "800000000000000009", components: [] },
  });
}

function submit(guildId: string, value: string) {
  const interaction = asAdmin(
    modalInteraction(ADMIN_PANEL_IDS.homeArea, guildId),
  );
  Object.assign(interaction.data, {
    components: [
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.TextInput,
          custom_id: ADMIN_PANEL_FIELDS.homeArea,
          value,
        },
      },
    ],
  });
  return interaction;
}

interface Reply {
  type: InteractionResponseType;
  data?: { custom_id?: string; components?: unknown[] };
}

/** Sends `interaction` and waits for its follow-up. */
async function send(interaction: unknown): Promise<Reply> {
  const ctx = createExecutionContext();
  const response = await callWorker(
    signer,
    await signedRequest(signer, interaction),
    ctx,
  );
  expect(response.status).toBe(200);
  const reply = await response.json<Reply>();
  await waitOnExecutionContext(ctx);
  return reply;
}

describe("Set home area's modal", () => {
  it("opens prefilled with the current home area", async () => {
    const guild = "200000000000000901";
    await storeHomeArea(guild, STORED);
    stubFetch(guild, () => Response.json([]));
    const reply = await send(
      asAdmin(componentInteraction(ADMIN_PANEL_IDS.homeArea, guild)),
    );
    expect(reply.type).toBe(InteractionResponseType.Modal);
    expect(reply.data?.custom_id).toBe(ADMIN_PANEL_IDS.homeArea);
    expect(JSON.stringify(reply.data?.components)).toContain(
      `"value":"Seattle, Washington"`,
    );
  });
});

describe("saving the home area", () => {
  it("looks the text up in the follow-up, stores what was found and shows it in the settings", async () => {
    const guild = "200000000000000911";
    const { asked, sent } = stubFetch(guild, () => Response.json(SEATTLE));
    const reply = await send(submit(guild, "  Seattle,   Washington "));
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(asked).toHaveLength(1);
    expect(await homeArea(guild)).toEqual(STORED);
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH ${PANEL}`,
    ]);
    expect(sent[0]?.body).toContain(
      "Home area set to **Seattle, Washington**, found as Seattle, King County, Washington.",
    );
    expect(sent[0]?.body).toContain(
      "**Home area:** Seattle, Washington (found as Seattle, King County, Washington)",
    );
  });

  it("asks the geocoder for the text alone, without a viewbox, as hikebot", async () => {
    const guild = "200000000000000912";
    await storeHomeArea(guild, STORED);
    const { asked } = stubFetch(guild, () => Response.json(SEATTLE));
    await send(submit(guild, "Tacoma"));
    expect(asked).toHaveLength(1);
    const url = new URL(asked[0]?.url ?? "");
    expect(url.searchParams.get("q")).toBe("Tacoma");
    expect(url.searchParams.has("viewbox")).toBe(false);
    expect(url.searchParams.has("bounded")).toBe(false);
    expect(asked[0]?.headers.get("User-Agent")).toContain("hikebot");
  });

  it("refuses a place the geocoder does not know, and keeps the home area", async () => {
    const guild = "200000000000000913";
    await storeHomeArea(guild, STORED);
    const { sent } = stubFetch(guild, () => Response.json([]));
    const reply = await send(submit(guild, "Nowhere Special"));
    expect(reply.type).toBe(InteractionResponseType.DeferredMessageUpdate);
    expect(await homeArea(guild)).toEqual(STORED);
    expect(sent.at(-1)?.body).toContain(
      "**Nowhere Special** was not found on OpenStreetMap, so the home area is unchanged.",
    );
  });

  it("stores nothing when nothing was set and the place is unknown", async () => {
    const guild = "200000000000000914";
    stubFetch(guild, () => Response.json([]));
    await send(submit(guild, "Nowhere Special"));
    expect(await homeArea(guild)).toBeNull();
  });

  it("refuses when the geocoder answers with an error, and says so", async () => {
    const guild = "200000000000000915";
    const { sent } = stubFetch(
      guild,
      () => new Response("busy", { status: 503 }),
    );
    await send(submit(guild, "Seattle, Washington"));
    expect(await homeArea(guild)).toBeNull();
    expect(sent.at(-1)?.path).toBe(PANEL);
    expect(sent.at(-1)?.body).toContain(
      "OpenStreetMap's geocoder answered HTTP 503, so the home area is unchanged. Try again in a minute.",
    );
  });

  it("clears the home area at once when the field is empty", async () => {
    const guild = "200000000000000916";
    await storeHomeArea(guild, STORED);
    const { asked, sent } = stubFetch(guild, () => Response.json(SEATTLE));
    const reply = await send(submit(guild, "   "));
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(JSON.stringify(reply.data)).toContain(
      "Home area cleared: locations are looked up worldwide.",
    );
    expect(await homeArea(guild)).toBeNull();
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("keeps the same text as it is, without asking the geocoder", async () => {
    const guild = "200000000000000917";
    await storeHomeArea(guild, STORED);
    const { asked, sent } = stubFetch(guild, () => Response.json([]));
    const reply = await send(submit(guild, "Seattle,  Washington"));
    expect(reply.type).toBe(InteractionResponseType.UpdateMessage);
    expect(JSON.stringify(reply.data)).toContain(
      "The home area is already **Seattle, Washington**.",
    );
    expect(await homeArea(guild)).toEqual(STORED);
    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("lookUpHomeArea", () => {
  it("returns the note and stores the place found", async () => {
    const guild = "200000000000000921";
    stubFetch(guild, () => Response.json(SEATTLE));
    const result = await runInDurableObject(stub(guild), (_i, state) =>
      lookUpHomeArea({ env, storage: state.storage }, "Seattle, Washington"),
    );
    expect(result.ok && noticeMarkdown(result.value)).toBe(
      "Home area set to **Seattle, Washington**, found as Seattle, King County, Washington.",
    );
    expect(await homeArea(guild)).toEqual(STORED);
  });
});
