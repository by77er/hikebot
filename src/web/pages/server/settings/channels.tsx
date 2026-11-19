/**
 * The settings page, second group: the voting, announcements and hike
 * threads channels, each a select of the server's channels of the types
 * the setting takes (as the panel's channel selects are), by name, grouped
 * by category, with "Not set" first. A channel deleted in Discord stays
 * chosen as "deleted channel" until another is saved.
 */
import type {
  WebChannelChoice,
  WebSettingsForm,
} from "../../../../features/settings-form";
import { CHANNEL_SETTINGS } from "../../../../features/settings-catalogue";
import {
  Select,
  type SelectGroup,
  type SelectOption,
} from "../../../components/select";
import { settingGroup } from "./groups";
import { DELETED_CHANNEL } from "./notice-text";
import {
  fieldError,
  fieldId,
  SettingsGroup,
  shownValue,
  type GroupProps,
} from "./settings-group";

/**
 * The select's options: "Not set", the stored channel as "deleted channel"
 * when Discord no longer lists it, the channels in no category, then one
 * group per category, in the order given.
 */
export function channelOptions(
  choices: WebChannelChoice[],
  current: string | null,
): (SelectOption | SelectGroup)[] {
  const deleted =
    current !== null && !choices.some((channel) => channel.id === current);
  const options: (SelectOption | SelectGroup)[] = [
    { value: "", label: "Not set" },
    ...(deleted ? [{ value: current, label: DELETED_CHANNEL }] : []),
  ];
  const groups = new Map<string, SelectGroup>();
  for (const channel of choices) {
    const option = { value: channel.id, label: `#${channel.name}` };
    if (channel.category === null) {
      options.push(option);
      continue;
    }
    let group = groups.get(channel.category);
    if (group === undefined) {
      group = { group: channel.category, options: [] };
      groups.set(channel.category, group);
      options.push(group);
    }
    group.options.push(option);
  }
  return options;
}

/** Whether the stored channel of `field` is gone from Discord. */
function isDeleted(
  form: WebSettingsForm,
  field: (typeof CHANNEL_SETTINGS)[number]["field"],
): boolean {
  const current = form.values[field];
  return (
    current !== null &&
    !form.channels[field].some((channel) => channel.id === current)
  );
}

export function ChannelSettings({ view, form, csrf, outcome }: GroupProps) {
  return (
    <SettingsGroup
      group={settingGroup("channels")}
      view={view}
      form={form}
      csrf={csrf}
      outcome={outcome}
      primary={form.missingChannels.length > 0}
    >
      {CHANNEL_SETTINGS.map((channel) => (
        <Select
          key={channel.field}
          id={fieldId(channel.field)}
          name={channel.field}
          label={channel.name}
          hint={
            isDeleted(form, channel.field)
              ? `${channel.help} The channel set now was deleted in Discord; pick another.`
              : channel.help
          }
          error={fieldError(outcome, channel.field, form)}
          options={channelOptions(
            form.channels[channel.field],
            form.values[channel.field],
          )}
          value={shownValue(
            outcome,
            channel.field,
            form.values[channel.field] ?? "",
          )}
        />
      ))}
    </SettingsGroup>
  );
}
