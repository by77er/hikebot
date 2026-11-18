import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  ApplicationCommandType,
  ComponentType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import worker from "../src";

export interface Signer {
  publicKeyHex: string;
  sign(timestamp: string, body: string): Promise<string>;
}

export async function createSigner(): Promise<Signer> {
  const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = (await crypto.subtle.exportKey(
    "raw",
    keys.publicKey,
  )) as ArrayBuffer;
  return {
    publicKeyHex: toHex(publicKey),
    async sign(timestamp, body) {
      const signature = await crypto.subtle.sign(
        "Ed25519",
        keys.privateKey,
        new TextEncoder().encode(timestamp + body),
      );
      return toHex(signature);
    },
  };
}

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A Request typed as the Worker receives it. */
export const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export const TIMESTAMP = "1700000000";

export async function signedRequest(
  signer: Signer,
  payload: unknown,
): Promise<Request<unknown, IncomingRequestCfProperties>> {
  const body = JSON.stringify(payload);
  return interactionRequest(body, {
    "X-Signature-Ed25519": await signer.sign(TIMESTAMP, body),
    "X-Signature-Timestamp": TIMESTAMP,
  });
}

export function interactionRequest(
  body: string,
  headers: Record<string, string>,
): Request<unknown, IncomingRequestCfProperties> {
  return new IncomingRequest("https://hikebot.example/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

/** Calls the Worker with `signer`'s public key bound as DISCORD_PUBLIC_KEY. */
export async function callWorker(
  signer: Signer,
  request: Request<unknown, IncomingRequestCfProperties>,
  ctx: ExecutionContext = createExecutionContext(),
): Promise<Response> {
  return worker.fetch(
    request,
    { ...env, DISCORD_PUBLIC_KEY: signer.publicKeyHex },
    ctx,
  );
}

let nextId = 1;
function snowflake(): string {
  return String(1_000_000_000_000_000 + nextId++);
}

// Test payloads carry only the fields the code under test reads.
const base = {
  application_id: "100",
  token: "interaction-token",
  version: 1,
  app_permissions: "0",
  locale: "en-US",
  entitlements: [],
  authorizing_integration_owners: {},
  attachment_size_limit: 10_000_000,
};

export function commandInteraction(
  name: string,
  guildId: string | null = "1",
): APIChatInputApplicationCommandInteraction {
  return {
    ...base,
    id: snowflake(),
    type: InteractionType.ApplicationCommand,
    ...(guildId === null ? {} : { guild_id: guildId }),
    data: { id: "200", name, type: ApplicationCommandType.ChatInput },
  } as unknown as APIChatInputApplicationCommandInteraction;
}

export function componentInteraction(
  customId: string,
  guildId = "1",
): APIMessageComponentInteraction {
  return {
    ...base,
    id: snowflake(),
    type: InteractionType.MessageComponent,
    guild_id: guildId,
    data: { custom_id: customId, component_type: ComponentType.Button },
  } as unknown as APIMessageComponentInteraction;
}

export function modalInteraction(
  customId: string,
  guildId = "1",
): APIModalSubmitInteraction {
  return {
    ...base,
    id: snowflake(),
    type: InteractionType.ModalSubmit,
    guild_id: guildId,
    data: { custom_id: customId, components: [] },
  } as unknown as APIModalSubmitInteraction;
}
// ci probe: temporary, reverted before merge
