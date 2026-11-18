/**
 * The Worker's web routes: every request except `/interactions` comes here.
 * In production Workers Static Assets answers a request for a file under
 * `public/` before the Worker runs; `/assets/*` here serves the same files
 * when a request does reach the Worker (as in the unit tests), and turns a
 * missing one into the HTML 404 page.
 */
import { MethodNotAllowedPage, NotFoundPage } from "./pages/errors";
import { HomePage } from "./pages/home";
import { htmlResponse } from "./response";
import { WebRouter } from "./router";

export const HEALTH_LINE = "hikebot is running";

const notFound = () => htmlResponse(<NotFoundPage />, { status: 404 });

export const webRouter = new WebRouter({
  notFound,
  methodNotAllowed: () =>
    htmlResponse(<MethodNotAllowedPage />, { status: 405 }),
})
  .get("/", () => htmlResponse(<HomePage />))
  .get("/assets/*", async (request, env) => {
    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404 ? notFound() : asset;
  })
  .get(
    "/healthz",
    () =>
      new Response(`${HEALTH_LINE}\n`, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }),
  );
