/**
 * The Durable Object that draws map pictures. Drawing takes more CPU time
 * than a Worker request gets on the Free plan, and a Durable Object request
 * gets far more, so the Worker and the guild objects ask this object; it is
 * a class of its own so the rasterizer's WebAssembly memory lives only here,
 * not in every guild's object. Reach it through `mapPainter(env)`.
 */
import { DurableObject } from "cloudflare:workers";
import { systemNow } from "../clock";
import { mapPicture, type MapPicture, type MapPictureRequest } from "./picture";
import { MapReader } from "./reader";

export class MapPainter extends DurableObject<Env> {
  private readonly reader: MapReader;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.reader = new MapReader(env.MAPS, { now: systemNow });
  }

  /**
   * The picture of the map round a point, drawn once and then read from the
   * bucket, or undefined when there is no map data there.
   */
  async picture(request: MapPictureRequest): Promise<MapPicture | undefined> {
    return mapPicture({ reader: this.reader, bucket: this.env.MAPS }, request);
  }
}

/** The one `MapPainter` every caller uses. */
export function mapPainter(env: Env): DurableObjectStub<MapPainter> {
  return env.MAP_PAINTER.get(env.MAP_PAINTER.idFromName("maps"));
}
