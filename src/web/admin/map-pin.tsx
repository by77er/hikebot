/**
 * Set map pin's page and POST under `/g/<guild id>/admin/set-map-pin`: the
 * admin control `set-map-pin`, offered by the server page's Where section
 * rather than the Admin card. The page is the form, for a planned hike
 * whose pin can still be set; the POST runs through `adminAction`, and
 * input with no coordinates comes back as the form with the panel's
 * sentence.
 */
import { MapPinPage } from "../pages/server/map-pin";
import { htmlResponse } from "../response";
import { adminAction, requireAdmin } from "./action";
import { TEXT_FIELD } from "./fields";
import { notOffered } from "./routes";

export async function mapPinPage(
  request: Request,
  env: Env,
  guildId: string,
): Promise<Response> {
  const admin = await requireAdmin(request, env, guildId);
  if (admin instanceof Response) return admin;
  if (!admin.view.hikePlace?.pinnable) return notOffered(env, admin, guildId);
  return htmlResponse(<MapPinPage user={admin.user} view={admin.view} />);
}

export function mapPinAction(
  request: Request,
  env: Env,
  guildId: string,
): Promise<Response> {
  return adminAction(request, env, guildId, {
    action: "set-map-pin",
    refused: (refusal, admin, form) => {
      if (refusal.code !== "unreadable") return null;
      const typed = form.get(TEXT_FIELD);
      return htmlResponse(
        <MapPinPage
          user={admin.user}
          view={admin.view}
          typed={typeof typed === "string" ? typed : ""}
          error={refusal.message}
        />,
        { status: 400 },
      );
    },
  });
}
