/** The settings catalogue's groups and help sentences, by id and key. */
import {
  SETTING_GROUPS,
  type SettingGroup,
  type SettingGroupId,
  type SettingKey,
} from "../../../../features/settings-catalogue";

export function settingGroup(id: SettingGroupId): SettingGroup {
  const group = SETTING_GROUPS.find((entry) => entry.id === id);
  if (group === undefined) throw new Error(`no settings group ${id}`);
  return group;
}

/** The one sentence that says what the setting does. */
export function settingHelp(key: SettingKey): string {
  for (const group of SETTING_GROUPS) {
    const entry = group.settings.find((setting) => setting.key === key);
    if (entry !== undefined) return entry.help;
  }
  throw new Error(`no setting ${key}`);
}
