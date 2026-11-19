import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ApplicationCommandOptionType,
  ChannelType,
  ComponentType,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ADMIN_PANEL_FIELDS,
  ADMIN_PANEL_IDS,
} from "../../src/features/admin-panel";
import { CADENCE_JOB } from "../../src/features/cadence-state";
import { noticeMarkdown, type Notice } from "../../src/features/settings";
import {
  channelChoices,
  roleChoices,
  saveSettingsGroup,
  settingsFormSection,
  type SettingsDirectory,
  type SettingsFields,
  type SettingsSave,
} from "../../src/features/settings-form";
import {
  CHANNEL_SETTINGS,
  type SettingGroupId,
} from "../../src/features/settings-catalogue";
import { WEATHER_JOB } from "../../src/features/weather-state";
import { GuildConfig, type GuildSettings } from "../../src/guild/config";
import { scheduledJobs } from "../../src/guild/schedule";
import type { WebViewSource } from "../../src/guild/web-view";
import {
  callWorker,
  commandInteraction,
  componentInteraction,
  createSigner,
  modalInteraction,
  signedRequest,
  type Signer,
} from "../helpers";

const OWNER = "400000000000009001";
const ROLE_HIGH = "500000000000009001";
const ROLE_LOW = "500000000000009002";
const CAT_HIKING = "300000000000009001";
const CAT_OUTDOORS = "300000000000009002";
const GENERAL = "300000000000009003";
const VOTES = "300000000000009004";
const NEWS = "300000000000009005";
const FORUM = "300000000000009006";
const VOICE = "300000000000009007";
const GEOCODER = "https://nominatim.test/search";

let counter = 0;

/** A guild id no other test uses, so it gets a fresh object. */
function freshGuild(): string {
  counter++;
  return `2000000000000090${String(counter).padStart(2, "0")}`;
}

/** The roles and channels Discord lists for `guildId`, out of order. */
function directory(guildId: string): SettingsDirectory {
  return {
    roles: [
      { id: guildId, name: "@everyone", position: 0 },
      { id: ROLE_LOW, name: "Members", position: 1 },
      { id: ROLE_HIGH, name: "Hike leads", position: 2 },
    ],
    channels: [
      {
        id: CAT_OUTDOORS,
        name: "Outdoors",
        type: ChannelType.GuildCategory,
        parentId: null,
        position: 2,
      },
      {
        id: FORUM,
        name: "hikes",
        type: ChannelType.GuildForum,
        parentId: CAT_HIKING,
        position: 4,
      },
      {
        id: NEWS,
        name: "news",
        type: ChannelType.GuildAnnouncement,
        parentId: CAT_OUTDOORS,
        position: 1,
      },
      {
        id: VOTES,
        name: "votes",
        type: ChannelType.GuildText,
        parentId: CAT_HIKING,
        position: 3,
      },
      {
        id: CAT_HIKING,
        name: "Hiking",
        type: ChannelType.GuildCategory,
        parentId: null,
        position: 1,
      },
      {
        id: VOICE,
        name: "voice",
        type: ChannelType.GuildVoice,
        parentId: null,
        position: 5,
      },
      {
        id: GENERAL,
        name: "general",
        type: ChannelType.GuildText,
        parentId: null,
        position: 0,
      },
    ],
  };
}

function stub(guildId: string) {
  return env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
}

function settingsOf(guildId: string): Promise<GuildSettings> {
  return runInDurableObject(stub(guildId), (_i, state) =>
    new GuildConfig(state.storage).get(),
  );
}

function jobsOf(guildId: string): Promise<Map<string, number>> {
  return runInDurableObject(stub(guildId), (_i, state) =>
    scheduledJobs(state.storage),
  );
}

/** Saves `group` from `fields` in the guild's object, as the web save does. */
function save(
  guildId: string,
  group: SettingGroupId,
  fields: SettingsFields,
): Promise<SettingsSave> {
  return runInDurableObject(stub(guildId), (_i, state) =>
    saveSettingsGroup(
      { env, storage: state.storage },
      guildId,
      new GuildConfig(state.storage).get(),
      directory(guildId),
      group,
      fields,
    ),
  );
}

/** The refusals of a refused save, as Discord markdown by field. */
function refusals(result: SettingsSave): Record<string, string> {
  expect(result.kind).toBe("refused");
  return result.kind === "refused"
    ? Object.fromEntries(
        result.errors.map((error) => [
          error.key,
          noticeMarkdown(error.refusal),
        ]),
      )
    : {};
}

/** The notices of a save that went through, as Discord markdown. */
function notices(result: SettingsSave): string[] {
  expect(result.kind).toBe("saved");
  return result.kind === "saved"
    ? result.notices.map((notice: Notice) => noticeMarkdown(notice))
    : [];
}

const CHANNELS_SET: SettingsFields = {
  voteChannelId: VOTES,
  announceChannelId: NEWS,
  forumChannelId: FORUM,
};

const SCHEDULE_ON: SettingsFields = {
  "cadence.enabled": "on",
  "cadence.weekday": "3",
  "cadence.time": "09:00",
  "cadence.dateVoteDays": "2",
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = new Request(input).url;
    if (url.startsWith(GEOCODER)) {
      return Promise.resolve(
        Response.json(
          url.includes("Atlantis")
            ? []
            : [
                {
                  lat: "47.6038321",
                  lon: "-122.330062",
                  display_name:
                    "Seattle, King County, Washington, United States",
                },
              ],
        ),
      );
    }
    return Promise.resolve(Response.json({ id: "1", owner_id: OWNER }));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the choices the settings page offers", () => {
  it("lists the roles highest first, without @everyone", () => {
    const guild = freshGuild();
    expect(roleChoices(directory(guild), guild)).toEqual([
      { id: ROLE_HIGH, name: "Hike leads" },
      { id: ROLE_LOW, name: "Members" },
    ]);
  });

  it("limits each channel select to the types its setting takes, in Discord's order with the category", () => {
    const [vote, announce, forum] = CHANNEL_SETTINGS.map((setting) =>
      channelChoices(directory(freshGuild()), setting),
    );
    expect(vote).toEqual([
      { id: GENERAL, name: "general", category: null },
      { id: VOTES, name: "votes", category: "Hiking" },
    ]);
    expect(announce).toEqual([
      { id: GENERAL, name: "general", category: null },
      { id: VOTES, name: "votes", category: "Hiking" },
      { id: NEWS, name: "news", category: "Outdoors" },
    ]);
    expect(forum).toEqual([{ id: FORUM, name: "hikes", category: "Hiking" }]);
  });

  it("is only in an admin's view, and keeps a stored id Discord no longer lists", async () => {
    const guild = freshGuild();
    await save(guild, "channels", CHANNELS_SET);
    const settings = await settingsOf(guild);
    const listed = directory(guild);
    const source = {
      guildId: guild,
      isAdmin: true,
      settings,
      settingsDirectory: {
        ...listed,
        channels: listed.channels.filter((channel) => channel.id !== VOTES),
      },
      now: Date.UTC(2030, 5, 5, 16, 42),
    } as unknown as WebViewSource;
    const form = settingsFormSection(source);
    expect(form?.values.voteChannelId).toBe(VOTES);
    expect(form?.channels.voteChannelId.map((c) => c.id)).toEqual([GENERAL]);
    expect(form?.localTime).toBe("Wed 09:42");
    expect(form?.timeZones).toContain("America/Los_Angeles");
    expect(form?.timeZones).toContain("Asia/Kolkata");
    expect(form?.timeZones).not.toContain("Asia/Calcutta");
    expect(form?.missingChannels).toEqual([]);
    expect(settingsFormSection({ ...source, isAdmin: false })).toBeNull();
    expect(
      settingsFormSection({ ...source, settingsDirectory: null }),
    ).toBeNull();
  });
});

describe("saving a group of settings", () => {
  it("sets the admin role, refuses @everyone and a role Discord does not list, and clears it", async () => {
    const guild = freshGuild();
    expect(
      refusals(await save(guild, "admin-role", { adminRoleId: guild })),
    ).toEqual({
      adminRoleId:
        "The @everyone role cannot be the admin role. Pick another role.",
    });
    expect(
      refusals(
        await save(guild, "admin-role", { adminRoleId: "500000000000009999" }),
      ),
    ).toEqual({ adminRoleId: "This action is no longer available." });
    expect(
      notices(await save(guild, "admin-role", { adminRoleId: ROLE_HIGH })),
    ).toEqual([`Admin role set to <@&${ROLE_HIGH}>.`]);
    expect((await settingsOf(guild)).adminRoleId).toBe(ROLE_HIGH);
    expect(
      notices(await save(guild, "admin-role", { adminRoleId: "" })),
    ).toEqual(["Admin role cleared: only the server owner can use the panel."]);
    expect((await settingsOf(guild)).adminRoleId).toBeNull();
  });

  it("refuses a channel of a type the setting does not take, and then changes none of the group", async () => {
    const guild = freshGuild();
    const result = await save(guild, "channels", {
      ...CHANNELS_SET,
      voteChannelId: FORUM,
      forumChannelId: VOTES,
    });
    expect(refusals(result)).toEqual({
      voteChannelId:
        "That channel cannot be the voting channel. Where the location and date polls are posted. Text channels only.",
      forumChannelId:
        "That channel cannot be the hike threads channel. The forum that gets a thread for each hike. Forum channels only.",
    });
    expect(await settingsOf(guild)).toMatchObject({
      voteChannelId: null,
      announceChannelId: null,
      forumChannelId: null,
    });
  });

  it("sets the channels that changed, and says nothing changed when none did", async () => {
    const guild = freshGuild();
    expect(notices(await save(guild, "channels", CHANNELS_SET))).toEqual([
      `Voting channel set to <#${VOTES}>.`,
      `Announcements channel set to <#${NEWS}>.`,
      `Hike threads channel set to <#${FORUM}>.`,
    ]);
    expect(notices(await save(guild, "channels", CHANNELS_SET))).toEqual([]);
    expect(
      notices(
        await save(guild, "channels", {
          ...CHANNELS_SET,
          announceChannelId: "",
        }),
      ),
    ).toEqual(["Announcements channel cleared."]);
  });

  it("keeps a deleted channel when the form posts it back unchanged", async () => {
    const guild = freshGuild();
    await save(guild, "channels", CHANNELS_SET);
    const gone = await runInDurableObject(stub(guild), (_i, state) => {
      const listed = directory(guild);
      return saveSettingsGroup(
        { env, storage: state.storage },
        guild,
        new GuildConfig(state.storage).get(),
        {
          ...listed,
          channels: listed.channels.filter((c) => c.id !== VOTES),
        },
        "channels",
        CHANNELS_SET,
      );
    });
    expect(notices(gone)).toEqual([]);
    expect((await settingsOf(guild)).voteChannelId).toBe(VOTES);
  });

  it("refuses an unknown time zone, as a forged form would send, and stores a known one", async () => {
    const guild = freshGuild();
    expect(
      refusals(await save(guild, "time-zone", { timezone: "Mars/Olympus" })),
    ).toEqual({
      timezone:
        "`Mars/Olympus` is not a time zone, so it is still America/Los_Angeles. Enter an IANA name such as `America/Los_Angeles`, `Europe/Berlin` or `Asia/Kolkata`, or PT, MT, CT, ET or UTC.",
    });
    expect(
      notices(await save(guild, "time-zone", { timezone: "Europe/Berlin" })),
    ).toEqual(["Time zone set to Europe/Berlin."]);
    expect((await settingsOf(guild)).timezone).toBe("Europe/Berlin");
  });

  it("sets the units and fetches the forecast again at once", async () => {
    const guild = freshGuild();
    expect(refusals(await save(guild, "units", { units: "kelvin" }))).toEqual({
      units: "This action is no longer available.",
    });
    expect(notices(await save(guild, "units", { units: "metric" }))).toEqual([
      "Units set to metric.",
    ]);
    expect((await settingsOf(guild)).units).toBe("metric");
    expect((await jobsOf(guild)).has(WEATHER_JOB)).toBe(true);
  });

  it("looks the home area up, refuses a place the geocoder does not know, and clears it", async () => {
    const guild = freshGuild();
    expect(
      refusals(await save(guild, "home-area", { homeArea: "Atlantis" })),
    ).toEqual({
      homeArea:
        "**Atlantis** was not found on OpenStreetMap, so the home area is unchanged. Enter a city and region, such as Seattle, Washington.",
    });
    expect(
      notices(
        await save(guild, "home-area", {
          homeArea: "  Seattle,   Washington ",
        }),
      ),
    ).toEqual([
      "Home area set to **Seattle, Washington**, found as Seattle, King County, Washington.",
    ]);
    expect((await settingsOf(guild)).homeArea?.text).toBe(
      "Seattle, Washington",
    );
    expect(
      refusals(await save(guild, "home-area", { homeArea: "x".repeat(101) })),
    ).toEqual({ homeArea: "This action is no longer available." });
    expect(notices(await save(guild, "home-area", { homeArea: "" }))).toEqual([
      "Home area cleared: locations are looked up worldwide.",
    ]);
  });

  it("refuses to turn the schedule on while a channel is missing, naming it, then turns it on and schedules the job", async () => {
    const guild = freshGuild();
    await save(guild, "channels", { ...CHANNELS_SET, forumChannelId: "" });
    expect(refusals(await save(guild, "schedule", SCHEDULE_ON))).toEqual({
      "cadence.enabled":
        "The schedule needs the hike threads channel. Set them above, then turn it on.",
    });
    expect((await settingsOf(guild)).cadence.enabled).toBe(false);
    expect((await jobsOf(guild)).has(CADENCE_JOB)).toBe(false);

    await save(guild, "channels", CHANNELS_SET);
    expect(
      notices(
        await save(guild, "schedule", {
          ...SCHEDULE_ON,
          "cadence.weekday": "5",
          "cadence.time": "7:30",
          "cadence.dateVoteDays": "3",
        }),
      ),
    ).toEqual([
      "The schedule's day is Friday.",
      "On the schedule, the date vote stays open 3 days.",
      "The schedule's time is 07:30 (America/Los_Angeles).",
      "The schedule is on.",
    ]);
    expect((await settingsOf(guild)).cadence).toMatchObject({
      enabled: true,
      weekday: 5,
      time: "07:30",
      dateVoteDays: 3,
    });
    const first = (await jobsOf(guild)).get(CADENCE_JOB);
    expect(first).toBeDefined();

    // Moving the day reschedules the job.
    await save(guild, "schedule", {
      ...SCHEDULE_ON,
      "cadence.weekday": "6",
      "cadence.time": "07:30",
      "cadence.dateVoteDays": "3",
    });
    expect((await jobsOf(guild)).get(CADENCE_JOB)).not.toBe(first);
  });

  it("refuses a schedule time that is not HH:MM, and a forged weekday or length, changing nothing", async () => {
    const guild = freshGuild();
    expect(
      refusals(
        await save(guild, "schedule", {
          "cadence.enabled": "off",
          "cadence.weekday": "9",
          "cadence.time": "25:00",
          "cadence.dateVoteDays": "7",
        }),
      ),
    ).toEqual({
      "cadence.weekday": "This action is no longer available.",
      "cadence.time":
        "`25:00` is not a time, so the schedule's time is still 09:00. Enter it as HH:MM, 24-hour, for example 09:00 or 18:30.",
      "cadence.dateVoteDays": "This action is no longer available.",
    });
    expect((await settingsOf(guild)).cadence.time).toBe("09:00");
  });
});

describe("the web save refuses in the panel's words", () => {
  let signer: Signer;
  beforeAll(async () => {
    signer = await createSigner();
  });

  /** The text of the Worker's answer to `interaction` sent by the owner. */
  async function panelSays(interaction: object): Promise<string> {
    Object.assign(interaction, {
      member: { user: { id: OWNER }, roles: [] },
      message: { id: "800000000000009001", components: [] },
    });
    const response = await callWorker(
      signer,
      await signedRequest(signer, interaction),
    );
    const body: APIInteractionResponse = await response.json();
    return JSON.stringify(body);
  }

  /** `text` as it appears inside the JSON of an answer. */
  function inJson(text: string): string {
    return JSON.stringify(text).slice(1, -1);
  }

  function select(
    customId: string,
    guildId: string,
    type: ComponentType,
    values: string[],
    resolved: object,
  ) {
    const interaction = componentInteraction(customId, guildId);
    Object.assign(interaction.data, {
      component_type: type,
      values,
      resolved,
    });
    return interaction;
  }

  function modal(
    customId: string,
    field: string,
    guildId: string,
    value: string,
  ) {
    const interaction = modalInteraction(customId, guildId);
    Object.assign(interaction.data, {
      components: [
        {
          type: ComponentType.Label,
          component: { type: ComponentType.TextInput, custom_id: field, value },
        },
      ],
    });
    return interaction;
  }

  it("for @everyone as the admin role", async () => {
    const guild = freshGuild();
    const web = refusals(
      await save(guild, "admin-role", { adminRoleId: guild }),
    );
    const panel = await panelSays(
      select(ADMIN_PANEL_IDS.role, guild, ComponentType.RoleSelect, [guild], {
        roles: { [guild]: { id: guild, name: "@everyone" } },
      }),
    );
    expect(panel).toContain(inJson(web.adminRoleId ?? "missing"));
  });

  it("for a channel of the wrong type", async () => {
    const guild = freshGuild();
    const web = refusals(
      await save(guild, "channels", { ...CHANNELS_SET, forumChannelId: VOTES }),
    );
    const panel = await panelSays(
      select(
        ADMIN_PANEL_IDS.forumChannel,
        guild,
        ComponentType.ChannelSelect,
        [VOTES],
        { channels: { [VOTES]: { id: VOTES, type: ChannelType.GuildText } } },
      ),
    );
    expect(panel).toContain(inJson(web.forumChannelId ?? "missing"));
  });

  it("for an unknown time zone", async () => {
    const guild = freshGuild();
    const web = refusals(
      await save(guild, "time-zone", { timezone: "Mars/Olympus" }),
    );
    const panel = await panelSays(
      modal(
        ADMIN_PANEL_IDS.timezone,
        ADMIN_PANEL_FIELDS.timezone,
        guild,
        "Mars/Olympus",
      ),
    );
    expect(panel).toContain(inJson(web.timezone ?? "missing"));
  });

  it("for a schedule time that is not HH:MM", async () => {
    const guild = freshGuild();
    const web = refusals(
      await save(guild, "schedule", {
        ...SCHEDULE_ON,
        "cadence.enabled": "off",
        "cadence.time": "noon",
      }),
    );
    const panel = await panelSays(
      modal(
        ADMIN_PANEL_IDS.cadenceTime,
        ADMIN_PANEL_FIELDS.cadenceTime,
        guild,
        "noon",
      ),
    );
    expect(panel).toContain(inJson(web["cadence.time"] ?? "missing"));
  });

  it("for turning the schedule on with channels missing", async () => {
    const guild = freshGuild();
    const web = refusals(await save(guild, "schedule", SCHEDULE_ON));
    const panel = await panelSays(
      componentInteraction(ADMIN_PANEL_IDS.cadence, guild),
    );
    expect(web["cadence.enabled"]).toContain(
      "voting channel, announcements channel and hike threads channel",
    );
    expect(panel).toContain(inJson(web["cadence.enabled"] ?? "missing"));
  });
});

// `/hike admin` reads what the web saved: the panel and the page share the
// settings, as the end-to-end scenario checks through the Worker too.
describe("the panel after a web save", () => {
  it("shows the values the web saved", async () => {
    const guild = freshGuild();
    await save(guild, "channels", CHANNELS_SET);
    await save(guild, "admin-role", { adminRoleId: ROLE_HIGH });
    const signer = await createSigner();
    const interaction = commandInteraction("hike", guild);
    Object.assign(interaction, { member: { user: { id: OWNER }, roles: [] } });
    Object.assign(interaction.data, {
      options: [
        { type: ApplicationCommandOptionType.Subcommand, name: "admin" },
      ],
    });
    const response = await callWorker(
      signer,
      await signedRequest(signer, interaction),
    );
    const text = JSON.stringify(await response.json());
    expect(text).toContain(`**Admin role:** <@&${ROLE_HIGH}>`);
    expect(text).toContain(`**Voting channel:** <#${VOTES}>`);
    expect(text).toContain("Setup is complete.");
  });
});
