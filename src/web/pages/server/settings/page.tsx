/**
 * A server's settings at `/g/<guild id>/settings`, for its admins: every
 * setting of the admin panel's Settings view in Discord, in the panel's
 * groups, each group a card with its own form and Save button (one file
 * per group in this directory). After a save the page comes back with the
 * group's banner; a refused save comes back as itself, with the error
 * summary first and each refusal at its field, in the panel's words.
 */
import { listing } from "../../../../features/settings";
import type { WebSettingsForm } from "../../../../features/settings-form";
import {
  SETTING_GROUPS,
  type SettingGroupId,
} from "../../../../features/settings-catalogue";
import type { WebView } from "../../../../guild/web-view";
import { Banner } from "../../../components/banner";
import { BackLink } from "../../../components/back-link";
import { ErrorSummary } from "../../../components/error-summary";
import { Layout, type LayoutUser } from "../../../layout";
import { AdminRoleSettings } from "./admin-role";
import { ChannelSettings } from "./channels";
import { HomeAreaSettings } from "./home-area";
import { NoticeText } from "./notice-text";
import { ScheduleSettings } from "./schedule";
import { fieldId, type GroupOutcome, type GroupProps } from "./settings-group";
import { TimeZoneSettings } from "./time-zone";
import { UnitsSettings } from "./units";

/** A save's outcome, for the group it saved. */
export interface SettingsOutcome extends GroupOutcome {
  group: SettingGroupId;
}

/** The sections, one per group, in the panel's order. */
const SECTIONS: Record<
  SettingGroupId,
  (props: GroupProps) => preact.JSX.Element
> = {
  "admin-role": AdminRoleSettings,
  channels: ChannelSettings,
  "time-zone": TimeZoneSettings,
  "home-area": HomeAreaSettings,
  units: UnitsSettings,
  schedule: ScheduleSettings,
};

export function SettingsPage({
  user,
  view,
  form,
  csrf,
  outcome,
}: {
  user: LayoutUser;
  view: WebView;
  form: WebSettingsForm;
  csrf: string;
  outcome?: SettingsOutcome;
}) {
  const { server } = view;
  const errors = outcome?.errors ?? [];
  const refusedGroup = SETTING_GROUPS.find(
    (group) => group.id === outcome?.group,
  );
  return (
    <Layout
      title={`${errors.length > 0 ? "Error: " : ""}Settings · ${server.name} · hikebot`}
      user={user}
    >
      <div class="stack stack--section">
        {errors.length > 0 && refusedGroup !== undefined && (
          <ErrorSummary
            title={`The ${refusedGroup.name.toLowerCase()} settings were not saved.`}
            errors={errors.map((error) => ({
              field: fieldId(error.key),
              message: <NoticeText notice={error.refusal} form={form} />,
            }))}
          />
        )}
        <div class="stack">
          <BackLink href={`/g/${server.id}`}>Back to {server.name}</BackLink>
          <div class="page-heading">
            <p class="page-heading__eyebrow">{server.name}</p>
            <h1>Settings</h1>
            <p class="page-heading__lead">
              The settings of the admin panel in Discord. Each part is saved on
              its own.
            </p>
          </div>
        </div>
        {form.missingChannels.length > 0 && (
          <Banner
            tone="warning"
            title={`Setup is not complete: set the ${listing(form.missingChannels)} under Channels.`}
          />
        )}
        {SETTING_GROUPS.map((group) => {
          const Section = SECTIONS[group.id];
          return (
            <Section
              key={group.id}
              view={view}
              form={form}
              csrf={csrf}
              outcome={outcome?.group === group.id ? outcome : {}}
            />
          );
        })}
      </div>
    </Layout>
  );
}
