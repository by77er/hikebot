/**
 * The Set map pin form of a server's planned hike, as the admin panel's
 * modal asks it: a map link or coordinates, empty to remove the pin. It
 * posts the admin control `set-map-pin` (`/g/<guild id>/admin/set-map-pin`)
 * with the CSRF token, the hike's round as its target, so a pin set for a
 * hike that is no longer the one shown is refused, and what was typed as
 * its text. On the server's page and on the Set map pin page.
 */
import { MAX_PIN_INPUT } from "../../../features/map-pin";
import { TARGET_FIELD, TEXT_FIELD } from "../../admin/fields";
import { CsrfField } from "../../auth/csrf";
import { Button, type ButtonVariant } from "../../components/button";
import { FormActions } from "../../components/form-actions";
import { MapPinIcon } from "../../components/icons";
import { TextField } from "../../components/text-field";
import { adminPath } from "./admin-retry";

/** The field's id, for the error summary's link. */
export const MAP_PIN_FIELD = "map-pin-point";

/** The hint, in the words of the panel's modal. */
export const MAP_PIN_HINT =
  "Coordinates such as 47.4875, -121.7234, or a Google Maps, OpenStreetMap or Apple Maps link that shows them. Leave it empty to remove the pin.";

export function MapPinForm({
  guildId,
  roundId,
  csrf,
  value,
  error,
  variant = "primary",
  back,
}: {
  guildId: string;
  roundId: number;
  csrf: string;
  /** What is in the field: the current pin, or what was typed. */
  value?: string;
  error?: string;
  /** `secondary` where the page already has its primary action. */
  variant?: ButtonVariant;
  /** Where Back goes; no Back without it. */
  back?: string;
}) {
  return (
    <form
      method="post"
      action={adminPath(guildId, "set-map-pin")}
      novalidate
      class="stack stack--loose"
    >
      <CsrfField token={csrf} />
      <input type="hidden" name={TARGET_FIELD} value={String(roundId)} />
      <TextField
        id={MAP_PIN_FIELD}
        name={TEXT_FIELD}
        label="Map link or coordinates"
        hint={MAP_PIN_HINT}
        maxLength={MAX_PIN_INPUT}
        autoComplete="off"
        spellCheck={false}
        value={value}
        error={error}
      />
      <FormActions>
        <Button variant={variant} icon={MapPinIcon}>
          Set map pin
        </Button>
        {back !== undefined && <Button href={back}>Back</Button>}
      </FormActions>
    </form>
  );
}
