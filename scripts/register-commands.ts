/**
 * `npm run register`: replaces the application's global slash commands with
 * the definitions in src/discord/commands.ts, through Discord's bulk
 * overwrite, so running it again changes nothing. Reads
 * DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN (and, for tests,
 * DISCORD_API_BASE) from the environment. Prints what Discord registered and
 * exits non-zero on a missing variable or a failed request. Never prints the
 * token.
 */
import { DiscordApi, DiscordApiError } from "../src/discord/api";
import { commands } from "../src/discord/commands";

interface Output {
  log: (line: string) => void;
  error: (line: string) => void;
}

export async function register(
  env: Record<string, string | undefined>,
  output: Output,
): Promise<number> {
  const applicationId = env.DISCORD_APPLICATION_ID?.trim() ?? "";
  const token = env.DISCORD_BOT_TOKEN?.trim() ?? "";
  const missing = [
    ...(applicationId === "" ? ["DISCORD_APPLICATION_ID"] : []),
    ...(token === "" ? ["DISCORD_BOT_TOKEN"] : []),
  ];
  if (missing.length > 0) {
    output.error(
      `Cannot register the slash commands: set ${missing.join(" and ")} in the environment.`,
    );
    return 1;
  }

  const api = new DiscordApi({
    token,
    baseUrl: env.DISCORD_API_BASE || undefined,
  });
  try {
    const registered = await api.bulkOverwriteGlobalCommands(
      applicationId,
      commands,
    );
    output.log(
      `Registered ${String(registered.length)} global command(s) for application ${applicationId}:`,
    );
    for (const command of registered) {
      const subcommands = (command.options ?? []).map((o) => o.name);
      output.log(
        `  /${command.name}${subcommands.length > 0 ? ` (${subcommands.join(", ")})` : ""}`,
      );
    }
    return 0;
  } catch (error) {
    const reason =
      error instanceof DiscordApiError
        ? error.message
        : error instanceof Error
          ? `${error.name}: ${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ""}`
          : String(error);
    output.error(
      `Registering the slash commands failed: ${reason.replaceAll(token, "[bot token]")}`,
    );
    return 1;
  }
}

process.exitCode = await register(process.env, {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
});
