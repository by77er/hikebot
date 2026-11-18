/**
 * The Worker's web routes: every request except `/interactions` comes here.
 * Static files under `public/` never reach this router; Workers Static Assets
 * answers them first.
 */
import { MethodNotAllowedPage, NotFoundPage } from "./pages/errors";
import { HomePage } from "./pages/home";
import { htmlResponse } from "./response";
import { WebRouter } from "./router";

export const HEALTH_LINE = "hikebot is running";

export const webRouter = new WebRouter({
  notFound: () => htmlResponse(<NotFoundPage />, { status: 404 }),
  methodNotAllowed: () =>
    htmlResponse(<MethodNotAllowedPage />, { status: 405 }),
})
  .get("/", () => htmlResponse(<HomePage />))
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
