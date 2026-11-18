/**
 * The Durable Object that draws map pictures. Drawing takes more CPU time than
 * a Worker request is given on the Free plan, so the Worker and the guild
 * objects ask this object instead; it is a class of its own so the renderer's
 * WebAssembly memory lives only here, not in every guild's object.
 */
import { DurableObject } from "cloudflare:workers";
import { rasterize } from "./rasterize";

export class MapPainter extends DurableObject<Env> {
  /** A blank PNG of the given size: proves the rasterizer loads here. */
  async blank(width: number, height: number): Promise<Uint8Array> {
    return rasterize(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}"/>`,
      [],
    );
  }
}
