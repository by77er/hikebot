/**
 * A small router for the Worker's web routes: one handler per method and
 * path. A path is matched exactly, except one ending in `/*`, which matches
 * every path under it (`/assets/*` matches `/assets/app.css`); an exact path
 * wins over a prefix, and a longer prefix over a shorter one. A `GET` route
 * also answers `HEAD`, with the same status and headers and no body. A path
 * with no route gets the `notFound` response; a path whose route lacks the
 * method gets the `methodNotAllowed` response, with `Allow` listing the
 * methods it has.
 */

export type WebHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

export type WebMethod = "GET" | "POST";

export interface WebRouterOptions {
  notFound: WebHandler;
  /** Called with the `Allow` value; the router sets the header itself. */
  methodNotAllowed: (allow: string) => Response;
}

export class WebRouter {
  private readonly routes = new Map<string, Map<string, WebHandler>>();

  constructor(private readonly options: WebRouterOptions) {}

  get(path: string, handler: WebHandler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: WebHandler): this {
    return this.add("POST", path, handler);
  }

  add(method: WebMethod, path: string, handler: WebHandler): this {
    if (!path.startsWith("/")) {
      throw new Error(`web route ${path} does not start with /`);
    }
    const methods = this.routes.get(path) ?? new Map<string, WebHandler>();
    if (methods.has(method)) {
      throw new Error(`web route ${method} ${path} is registered twice`);
    }
    methods.set(method, handler);
    this.routes.set(path, methods);
    return this;
  }

  async handle(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const response = await this.dispatch(request, env, ctx);
    if (request.method !== "HEAD") return response;
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private async dispatch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);
    const methods = this.match(pathname);
    if (!methods) return this.options.notFound(request, env, ctx);
    const method = request.method === "HEAD" ? "GET" : request.method;
    const handler = methods.get(method);
    if (handler) return handler(request, env, ctx);
    const allow = allowed(methods);
    const response = this.options.methodNotAllowed(allow);
    response.headers.set("Allow", allow);
    return response;
  }

  private match(pathname: string): Map<string, WebHandler> | undefined {
    const exact = this.routes.get(pathname);
    if (exact) return exact;
    let best: { prefix: string; methods: Map<string, WebHandler> } | undefined;
    for (const [path, methods] of this.routes) {
      if (!path.endsWith("/*")) continue;
      const prefix = path.slice(0, -1);
      if (!pathname.startsWith(prefix)) continue;
      if (!best || prefix.length > best.prefix.length) {
        best = { prefix, methods };
      }
    }
    return best?.methods;
  }
}

function allowed(methods: Map<string, WebHandler>): string {
  const names = [...methods.keys()];
  if (methods.has("GET")) names.push("HEAD");
  return names.join(", ");
}
