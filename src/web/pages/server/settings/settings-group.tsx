/**
 * One group of the settings page (Admin role, Channels, Time zone, Home
 * area, Units, Schedule): a card headed by the group's name, holding its
 * own form, which posts the group's fields with the CSRF token and the
 * group's id to `/g/<guild id>/settings`, and ends with its one action,
 * Save <group> (the primary action only while it is the next step of
 * setup). After a save the card says what the save did, in a banner
 * at its top ("Nothing changed." when no field did); a refused save shows
 * each refusal at its field.
 */
import type { ComponentChildren } from "preact";
import type { Notice } from "../../../../features/settings";
import type {
  SettingRefusal,
  SettingsFields,
  WebSettingsForm,
} from "../../../../features/settings-form";
import type {
  SettingGroup,
  SettingKey,
} from "../../../../features/settings-catalogue";
import type { WebView } from "../../../../guild/web-view";
import { CsrfField } from "../../../auth/csrf";
import { Banner } from "../../../components/banner";
import { Button } from "../../../components/button";
import { Card } from "../../../components/card";
import { FormActions } from "../../../components/form-actions";
import { NoticeText } from "./notice-text";

/** What the page shows of one group after a save of it. */
export interface GroupOutcome {
  /** What the save did, for the group's banner. */
  saved?: Notice[];
  /** The fields as posted, when the save was refused. */
  fields?: SettingsFields;
  /** Why, field by field, when the save was refused. */
  errors?: SettingRefusal[];
}

/** What every group's section gets. */
export interface GroupProps {
  view: WebView;
  form: WebSettingsForm;
  csrf: string;
  outcome: GroupOutcome;
}

/** The id of a setting's control: `setting-cadence-time`. */
export function fieldId(key: SettingKey): string {
  return `setting-${key.replace(".", "-")}`;
}

/** The value to show: what was posted, if the save came back, else `stored`. */
export function shownValue(
  outcome: GroupOutcome,
  key: SettingKey,
  stored: string,
): string {
  return outcome.fields?.[key] ?? stored;
}

/** A setting's refusal, as its field shows it, or undefined. */
export function fieldError(
  outcome: GroupOutcome,
  key: SettingKey,
  form: WebSettingsForm,
): ComponentChildren | undefined {
  const refused = outcome.errors?.find((error) => error.key === key);
  return refused === undefined ? undefined : (
    <NoticeText notice={refused.refusal} form={form} />
  );
}

export function SettingsGroup({
  group,
  view,
  form,
  csrf,
  outcome,
  primary = false,
  children,
}: {
  group: SettingGroup;
  view: WebView;
  form: WebSettingsForm;
  csrf: string;
  outcome: GroupOutcome;
  /** Draws Save as the primary action: the next step, while setup is not complete. */
  primary?: boolean;
  children: ComponentChildren;
}) {
  const saved = outcome.saved;
  const unchanged = saved?.length === 0;
  return (
    <div id={group.id}>
      <Card title={group.name}>
        <div class="stack stack--loose">
          {saved !== undefined && (
            <Banner
              tone={unchanged ? "info" : "success"}
              title={unchanged ? "Nothing changed." : `${group.name} saved.`}
            >
              {!unchanged && (
                <ul class="list-reset stack stack--tight">
                  {saved.map((notice, index) => (
                    <li key={index}>
                      <NoticeText notice={notice} form={form} />
                    </li>
                  ))}
                </ul>
              )}
            </Banner>
          )}
          <form
            method="post"
            action={`/g/${view.server.id}/settings`}
            class="stack stack--loose"
            novalidate
          >
            <CsrfField token={csrf} />
            <input type="hidden" name="group" value={group.id} />
            {children}
            <FormActions>
              <Button variant={primary ? "primary" : "secondary"}>
                Save {group.name.toLowerCase()}
              </Button>
            </FormActions>
          </form>
        </div>
      </Card>
    </div>
  );
}
