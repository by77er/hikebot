import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import ICAL from "ical.js";
import { describe, expect, it, vi } from "vitest";
import { calendarPath } from "../../src/calendar/address";
import { PollStore } from "../../src/polls/store";
import { sign } from "../../src/signing";
import { webRouter } from "../../src/web/routes";
import { completeRound } from "../polls/helpers";

let counter = 0;

/** A guild id no other test uses, so it gets a fresh object. */
function freshGuild(): string {
  counter++;
  return `2300000000000${String(counter).padStart(5, "0")}`;
}

function call(
  path: string,
  init: RequestInit = {},
  bindings: Env = env,
): Promise<Response> {
  return webRouter.handle(
    new Request(`https://hikebot.example${path}`, init),
    bindings,
    createExecutionContext(),
  );
}

/** Completes a round with `label` on `date` in `guildId`'s object. */
function addHike(guildId: string, label: string, date: string) {
  const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName(guildId));
  return runInDurableObject(stub, (_instance, state) =>
    completeRound(new PollStore(state.storage), label, date),
  );
}

/** A GUILD_HIKE binding that records every use and fails the test on one. */
function spyNamespace() {
  const idFromName = vi.fn(() => {
    throw new Error("the namespace was reached");
  });
  const get = vi.fn(() => {
    throw new Error("the namespace was reached");
  });
  const bindings = {
    ...env,
    GUILD_HIKE: { ...env.GUILD_HIKE, idFromName, get, idFromString: get },
  } as unknown as Env;
  return { bindings, idFromName, get };
}

describe("GET /calendar/<guild id>/<signature>.ics", () => {
  it("answers the guild's hikes as text/calendar", async () => {
    const guild = freshGuild();
    await addHike(guild, "Ridge", "2030-06-15 09:00");
    await addHike(guild, "Lake", "2030-01-05");
    const response = await call(await calendarPath(env, guild));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="hikes.ics"',
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("ETag")).toMatch(/^W\/"[0-9a-f]{32}"$/);
    const calendar = new ICAL.Component(ICAL.parse(await response.text()));
    const events = calendar
      .getAllSubcomponents("vevent")
      .map((vevent) => new ICAL.Event(vevent));
    expect(
      events.map((event) => [
        event.summary,
        event.startDate.toJSDate().toISOString(),
      ]),
    ).toEqual([
      ["Hike: Ridge", "2030-06-15T16:00:00.000Z"],
      ["Hike: Lake", "2030-01-05T19:00:00.000Z"],
    ]);
  });

  it("answers a guild without hikes with a calendar of no events", async () => {
    const response = await call(await calendarPath(env, freshGuild()));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("BEGIN:VCALENDAR\r\n");
    expect(text).not.toContain("BEGIN:VEVENT");
  });

  it("answers 404 without reaching the namespace for a bad address", async () => {
    const guild = "230000000000099999";
    const other = "230000000000099998";
    const signature = await sign(env.SIGNING_SECRET, "calendar", guild);
    const changed = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const notSnowflake = await sign(env.SIGNING_SECRET, "calendar", "abc");
    const paths = [
      `/calendar/${guild}/${changed}.ics`,
      `/calendar/${guild}/${signature.slice(0, 20)}.ics`,
      `/calendar/${guild}/.ics`,
      `/calendar/${guild}`,
      `/calendar/`,
      `/calendar/${other}/${signature}.ics`,
      `/calendar/abc/${notSnowflake}.ics`,
    ];
    const spy = spyNamespace();
    for (const path of paths) {
      const response = await call(path, {}, spy.bindings);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=utf-8",
      );
    }
    expect(spy.idFromName).not.toHaveBeenCalled();
    expect(spy.get).not.toHaveBeenCalled();
  });

  it("answers 304 with no body for a matching If-None-Match, and a new ETag once a hike is added", async () => {
    const guild = freshGuild();
    await addHike(guild, "Ridge", "2030-06-15");
    const path = await calendarPath(env, guild);
    const first = await call(path);
    const etag = first.headers.get("ETag") ?? "";
    expect(etag).not.toBe("");

    const again = await call(path);
    expect(again.headers.get("ETag")).toBe(etag);

    for (const header of [
      etag,
      etag.replace(/^W\//, ""),
      `"x", ${etag}`,
      "*",
    ]) {
      const cached = await call(path, { headers: { "If-None-Match": header } });
      expect(cached.status, header).toBe(304);
      expect(await cached.text()).toBe("");
      expect(cached.headers.get("ETag")).toBe(etag);
      expect(cached.headers.get("Cache-Control")).toBe("public, max-age=300");
    }
    const stale = await call(path, { headers: { "If-None-Match": '"x"' } });
    expect(stale.status).toBe(200);

    await addHike(guild, "Lake", "2030-07-01");
    const changed = await call(path, { headers: { "If-None-Match": etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
    expect(await changed.text()).toContain("SUMMARY:Hike: Lake");
  });

  it("answers HEAD with the headers and no body", async () => {
    const guild = freshGuild();
    await addHike(guild, "Ridge", "2030-06-15");
    const path = await calendarPath(env, guild);
    const get = await call(path);
    const head = await call(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(head.headers.get("ETag")).toBe(get.headers.get("ETag"));
  });

  it("answers another method with 405", async () => {
    const response = await call(await calendarPath(env, freshGuild()), {
      method: "POST",
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});
