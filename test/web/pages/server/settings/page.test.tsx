import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  INTERNAL_SETTINGS,
  SETTING_GROUPS,
} from "../../../../../src/features/settings-catalogue";
import type { WebSettingsForm } from "../../../../../src/features/settings-form";
import { GuildConfig } from "../../../../../src/guild/config";
import {
  SettingsPage,
  type SettingsOutcome,
} from "../../../../../src/web/pages/server/settings/page";
import { outline } from "../../../helpers";
import { render, spokenText } from "../../../components/render";
import { MARKUP } from "../view";
import {
  adminView,
  emptyForm,
  FORUM,
  fullForm,
  GENERAL,
  NEWS,
  ROLE,
  VOTES,
} from "./form";

const USER = { name: "Ana", avatar: null, csrf: "layout-token" };

function page(form: WebSettingsForm, outcome?: SettingsOutcome): string {
  return render(
    <SettingsPage
      user={USER}
      view={adminView(form)}
      form={form}
      csrf="form-token"
      outcome={outcome}
    />,
  );
}

/** The HTML of the `<select>` named `name`. */
function select(html: string, name: string): string {
  const start = html.indexOf(`name="${name}"`);
  expect(start, name).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</select>", start));
}

/** The values of a select's options, in order. */
function optionValues(selectHtml: string): string[] {
  return [...selectHtml.matchAll(/<option value(?:="([^"]*)")?/g)].map(
    (match) => match[1] ?? "",
  );
}

/** The value of the chosen option of a select. */
function chosen(selectHtml: string): string | undefined {
  const match = /<option value(?:="([^"]*)")? selected/.exec(selectHtml);
  return match === null ? undefined : (match[1] ?? "");
}

/** Every key of the guild's settings, `cadence.<key>` for the schedule's. */
async function configKeys(): Promise<string[]> {
  const stub = env.GUILD_HIKE.get(
    env.GUILD_HIKE.idFromName("200000000000007901"),
  );
  const settings = await runInDurableObject(stub, (_i, state) =>
    new GuildConfig(state.storage).get(),
  );
  return Object.entries(settings).flatMap(([key, value]) =>
    key === "cadence"
      ? Object.keys(value as object).map((inner) => `cadence.${inner}`)
      : [key],
  );
}

describe("the settings page", () => {
  it("has a field for every setting in the guild's config, but the ones the bot keeps itself", async () => {
    const html = page(emptyForm());
    const keys = await configKeys();
    for (const key of keys) {
      if (key in INTERNAL_SETTINGS) continue;
      expect(html, `no field for the setting ${key}`).toContain(
        `name="${key}"`,
      );
    }
    for (const key of Object.keys(INTERNAL_SETTINGS)) {
      expect(keys, `${key} is no longer a setting`).toContain(key);
    }
  });

  it("shows the groups in the panel's order, each a form of its own with one sentence per setting", async () => {
    const html = page(emptyForm());
    const text = (await outline(html)).text;
    let at = -1;
    for (const group of SETTING_GROUPS) {
      const heading = html.indexOf(`>${group.name}</h2>`);
      expect(heading, group.name).toBeGreaterThan(at);
      at = heading;
      expect(html).toContain(`name="group" value="${group.id}"`);
      expect(text).toContain(`Save ${group.name.toLowerCase()}`);
      for (const setting of group.settings) {
        expect(text).toContain(setting.help);
      }
    }
    expect(
      html.match(/<form method="post" action="\/g\/[0-9]+\/settings"/g)?.length,
    ).toBe(SETTING_GROUPS.length);
    expect(html.match(/name="csrf" value="form-token"/g)?.length).toBe(
      SETTING_GROUPS.length,
    );
    expect(html).toContain(
      'action="/g/200000000000007001/settings" class="stack stack--loose" novalidate',
    );
  });

  it("makes Save channels the primary action only while setup is not complete", () => {
    expect(page(emptyForm())).toContain(
      '<button class="button button--primary" type="submit"><span>Save channels</span>',
    );
    expect(page(fullForm())).not.toContain("button--primary");
  });

  it("says setup is not complete, naming the missing channels, until they are set", async () => {
    expect((await outline(page(emptyForm()))).text).toContain(
      "Setup is not complete: set the voting channel, announcements channel and hike threads channel under Channels.",
    );
    expect((await outline(page(fullForm()))).text).not.toContain(
      "Setup is not complete",
    );
  });

  it("offers the roles by name, and no admin role, choosing the current one", () => {
    const empty = select(page(emptyForm()), "adminRoleId");
    expect(optionValues(empty)).toEqual(["", ROLE, "500000000000007002"]);
    expect(empty).toContain(">No admin role<");
    expect(empty).toContain(">Hike leads<");
    expect(chosen(empty)).toBe("");
    expect(chosen(select(page(fullForm()), "adminRoleId"))).toBe(ROLE);
  });

  it("offers each channel setting only the channels of its types, by name and category", () => {
    const html = page(fullForm());
    const vote = select(html, "voteChannelId");
    expect(optionValues(vote)).toEqual(["", GENERAL, VOTES]);
    expect(vote).toContain('<optgroup label="Hiking">');
    expect(vote).toContain(">#votes<");
    expect(chosen(vote)).toBe(VOTES);
    expect(optionValues(select(html, "announceChannelId"))).toEqual([
      "",
      GENERAL,
      VOTES,
      NEWS,
    ]);
    const forum = select(html, "forumChannelId");
    expect(optionValues(forum)).toEqual(["", FORUM]);
    expect(chosen(forum)).toBe(FORUM);
  });

  it("shows a channel or role deleted in Discord as deleted, chosen until another is saved", async () => {
    const form = fullForm();
    const gone = {
      ...form,
      roles: form.roles.filter((role) => role.id !== ROLE),
      channels: {
        ...form.channels,
        forumChannelId: [],
      },
    };
    const html = page(gone);
    const forum = select(html, "forumChannelId");
    expect(optionValues(forum)).toEqual(["", FORUM]);
    expect(forum).toContain(`value="${FORUM}" selected>deleted channel<`);
    const role = select(html, "adminRoleId");
    expect(role).toContain(`value="${ROLE}" selected>deleted role<`);
    const text = (await outline(html)).text;
    expect(text).toContain(
      "The channel set now was deleted in Discord; pick another.",
    );
    expect(text).toContain(
      "The role set now was deleted in Discord; pick another.",
    );
  });

  it("lists the time zones by region with the current one chosen and the time there now", async () => {
    const html = page(fullForm());
    const zones = select(html, "timezone");
    expect(zones).toContain('<optgroup label="America">');
    expect(zones).toContain('<optgroup label="Europe">');
    expect(zones).toContain(
      'value="America/Argentina/Buenos_Aires">Argentina/Buenos Aires<',
    );
    expect(chosen(zones)).toBe("Europe/Berlin");
    expect((await outline(html)).text).toContain(
      "It is now Wed 09:42 in Europe/Berlin.",
    );
    expect(html).toContain(
      '<time datetime="2030-06-05T07:42:00.000Z" data-clock data-zone="Europe/Berlin">Wed 09:42</time>',
    );
  });

  it("keeps a current zone the list lacks", () => {
    const form = emptyForm();
    const html = page({
      ...form,
      values: { ...form.values, timezone: "UTC" },
    });
    expect(chosen(select(html, "timezone"))).toBe("UTC");
  });

  it("shows every other value: home area, units and the schedule", () => {
    const html = page(fullForm());
    expect(html).toContain(
      'name="homeArea" type="text" value="Seattle, Washington"',
    );
    expect(html).toContain(
      "Found on OpenStreetMap as Seattle, King County, Washington.",
    );
    expect(html).toMatch(/value="metric" checked/);
    expect(html).toMatch(/name="cadence.enabled" value="on" checked/);
    expect(chosen(select(html, "cadence.weekday"))).toBe("5");
    expect(html).toContain('name="cadence.time" type="text" value="18:30"');
    expect(html).toMatch(/name="cadence.dateVoteDays" value="3" checked/);
  });

  it("comes back from a refused save as itself, with the refusal at its field and first on the page", async () => {
    const html = page(emptyForm(), {
      group: "schedule",
      fields: {
        "cadence.enabled": "on",
        "cadence.weekday": "1",
        "cadence.time": "09:00",
        "cadence.dateVoteDays": "2",
      },
      errors: [
        {
          key: "cadence.enabled",
          refusal: [
            "The schedule needs the voting channel. Set them above, then turn it on.",
          ],
        },
      ],
    });
    const outlined = await outline(html);
    expect(outlined.title).toBe("Error: Settings · Ridge Walkers · hikebot");
    expect(outlined.text).toContain("The schedule settings were not saved.");
    expect(html.indexOf("error-summary")).toBeLessThan(html.indexOf("<h1"));
    expect(html).toContain('href="#setting-cadence-enabled"');
    expect(html).toMatch(/name="cadence.enabled" value="on" checked/);
    expect(chosen(select(html, "cadence.weekday"))).toBe("1");
    expect(
      outlined.text.split(
        "The schedule needs the voting channel. Set them above, then turn it on.",
      ).length,
    ).toBe(3);
  });

  it("shows what a save did in its group's banner, naming channels and roles", async () => {
    const html = page(fullForm(), {
      group: "channels",
      saved: [
        ["Voting channel set to ", { channel: VOTES }, "."],
        ["Admin role set to ", { role: ROLE }, "."],
      ],
    });
    const text = await spokenText(html);
    expect(text).toContain("Done Channels saved.");
    expect(text).toContain("Voting channel set to #votes.");
    expect(text).toContain("Admin role set to @Hike leads.");
    expect(html.indexOf("Channels saved.")).toBeGreaterThan(
      html.indexOf(">Channels</h2>"),
    );
  });

  it("says nothing changed when a save changed nothing", async () => {
    const text = await spokenText(
      page(fullForm(), { group: "units", saved: [] }),
    );
    expect(text).toContain("Information Nothing changed.");
  });

  it("shows names from Discord and typed text as text, never as markup", async () => {
    const form = fullForm();
    const html = page(
      {
        ...form,
        roles: [{ id: ROLE, name: MARKUP }],
        values: {
          ...form.values,
          homeArea: { text: MARKUP, name: MARKUP },
        },
      },
      {
        group: "home-area",
        saved: [["Home area set to ", { strong: MARKUP }, "."]],
      },
    );
    expect((await outline(html)).scripts).toBe(0);
  });
});
