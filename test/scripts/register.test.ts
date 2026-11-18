import { describe, expect, it, vi } from "vitest";
import { register } from "../../scripts/register";
import { commands } from "../../src/discord/commands";

const TOKEN = "bot-token-that-must-not-leak";
const ENV = {
  DISCORD_APPLICATION_ID: "123456789012345678",
  DISCORD_BOT_TOKEN: TOKEN,
};

/** Collects what the script prints, both streams in order. */
function capture() {
  const lines: string[] = [];
  return {
    lines,
    output: {
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    },
  };
}

/** A fetch that answers every request like Discord's bulk overwrite. */
function discord(answer: () => Response | Promise<Response> = registered) {
  return vi.fn<typeof fetch>(() => Promise.resolve(answer()));
}

function registered(): Response {
  return Response.json(
    commands.map((command, i) => ({
      ...command,
      id: String(900 + i),
      application_id: ENV.DISCORD_APPLICATION_ID,
      version: "1",
    })),
  );
}

function requestOf(fetch: ReturnType<typeof discord>, call = 0): Request {
  const [input, init] = fetch.mock.calls[call] ?? [""];
  return new Request(input, init);
}

const noSleep = () => Promise.resolve();

describe("register", () => {
  it("sends the command definitions and prints what Discord registered", async () => {
    const fetch = discord();
    const { lines, output } = capture();

    expect(await register(ENV, output, { fetch })).toBe(0);

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = requestOf(fetch);
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      `https://discord.com/api/v10/applications/${ENV.DISCORD_APPLICATION_ID}/commands`,
    );
    expect(request.headers.get("Authorization")).toBe(`Bot ${TOKEN}`);
    expect(await request.json()).toEqual(commands);
    expect(lines).toEqual([
      `Registered 1 global command(s) for application ${ENV.DISCORD_APPLICATION_ID}:`,
      "  /hike (admin)",
    ]);
  });

  it("sends the same body on every run", async () => {
    const fetch = discord();
    expect(await register(ENV, capture().output, { fetch })).toBe(0);
    expect(await register(ENV, capture().output, { fetch })).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await requestOf(fetch, 1).text()).toBe(
      await requestOf(fetch, 0).text(),
    );
  });

  it("sends its request to DISCORD_API_BASE when it is set", async () => {
    const fetch = discord();
    await register(
      { ...ENV, DISCORD_API_BASE: "http://127.0.0.1:9999/api/v10/" },
      capture().output,
      { fetch },
    );
    expect(requestOf(fetch).url).toBe(
      `http://127.0.0.1:9999/api/v10/applications/${ENV.DISCORD_APPLICATION_ID}/commands`,
    );
  });

  it("fails when Discord refuses the token, without printing it", async () => {
    const fetch = discord(() =>
      Response.json({ message: "401: Unauthorized", code: 0 }, { status: 401 }),
    );
    const { lines, output } = capture();

    expect(await register(ENV, output, { fetch, sleep: noSleep })).not.toBe(0);

    expect(lines.join("\n")).toContain("Registering the slash commands failed");
    expect(lines.join("\n")).toContain("401");
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("fails when Discord cannot be reached, without printing the token", async () => {
    const fetch = vi.fn<typeof fetch>(() =>
      Promise.reject(
        new TypeError("fetch failed", {
          cause: new Error(`connect ECONNREFUSED with Bot ${TOKEN}`),
        }),
      ),
    );
    const { lines, output } = capture();

    expect(await register(ENV, output, { fetch, sleep: noSleep })).not.toBe(0);

    const printed = lines.join("\n");
    expect(printed).toContain("Registering the slash commands failed");
    expect(printed).toContain("ECONNREFUSED");
    expect(printed).not.toContain(TOKEN);
  });

  it("names every missing variable and sends nothing", async () => {
    const fetch = discord();
    const { lines, output } = capture();

    expect(
      await register({ DISCORD_BOT_TOKEN: " " }, output, { fetch }),
    ).not.toBe(0);

    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual([
      "Cannot register the slash commands: set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in the environment.",
    ]);
  });

  it("names the one variable that is missing", async () => {
    const { lines, output } = capture();
    expect(
      await register({ DISCORD_BOT_TOKEN: TOKEN }, output, {
        fetch: discord(),
      }),
    ).not.toBe(0);
    expect(lines.join("\n")).toContain("set DISCORD_APPLICATION_ID in");
    expect(lines.join("\n")).not.toContain(TOKEN);
  });
});
