/**
 * The design system's files, for the tests that check what is in them:
 * the paths of every stylesheet under `public/assets/cairn/` (listed by
 * Vite at build time; Vitest turns imported CSS into empty strings, so the
 * text comes from the assets binding), and the text of every TSX file
 * under `src/web/`. Paths are from the repository root, such as
 * `public/assets/cairn/tokens.css`.
 */
import { env } from "cloudflare:workers";

declare global {
  interface ImportMeta {
    /** Vite's build-time file listing; only the shape these tests use. */
    glob<T = unknown>(
      pattern: string,
      options?: { query?: string; import?: string; eager?: boolean },
    ): Record<string, T>;
  }
}

function fromRoot(path: string): string {
  return path.replace(/^(\.\.\/)+/, "");
}

export const STYLESHEET_PATHS = Object.keys(
  import.meta.glob("../../public/assets/cairn/**/*.css"),
).map(fromRoot);

export const WEB_SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../src/web/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, text]) => [fromRoot(path), text]),
);

export const TOKENS_FILE = "public/assets/cairn/tokens.css";

/** The bytes of a file under `public/`, as the Worker serves it. */
export async function publicFile(path: string): Promise<Uint8Array> {
  const response = await env.ASSETS.fetch(
    `https://hikebot.example/${path.replace(/^public\//, "")}`,
  );
  if (response.status !== 200) {
    throw new Error(`${path} answered ${String(response.status)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function publicText(path: string): Promise<string> {
  return new TextDecoder().decode(await publicFile(path));
}
