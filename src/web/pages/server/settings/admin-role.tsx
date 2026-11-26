/**
 * The settings page, first group: the admin role, a select of the server's
 * roles by name, highest first as Discord lists them, with "No admin role"
 * to leave the panel to the owner. A role deleted in Discord stays chosen
 * as "deleted role" until another is saved.
 */
import { Select, type SelectOption } from "../../../components/select";
import { DELETED_ROLE } from "./notice-text";
import { settingGroup, settingHelp } from "./groups";
import {
  fieldError,
  fieldId,
  SettingsGroup,
  shownValue,
  type GroupProps,
} from "./settings-group";

export function AdminRoleSettings({ view, form, csrf, outcome }: GroupProps) {
  const current = form.values.adminRoleId;
  const deleted =
    current !== null && !form.roles.some((role) => role.id === current);
  const options: SelectOption[] = [
    { value: "", label: "No admin role" },
    ...(deleted ? [{ value: current, label: DELETED_ROLE }] : []),
    ...form.roles.map((role) => ({ value: role.id, label: role.name })),
  ];
  return (
    <SettingsGroup
      group={settingGroup("admin-role")}
      view={view}
      form={form}
      csrf={csrf}
      outcome={outcome}
    >
      <Select
        id={fieldId("adminRoleId")}
        name="adminRoleId"
        label="Role"
        hint={
          deleted
            ? `${settingHelp("adminRoleId")} The role set now was deleted in Discord; pick another.`
            : settingHelp("adminRoleId")
        }
        error={fieldError(outcome, "adminRoleId", form)}
        options={options}
        value={shownValue(outcome, "adminRoleId", current ?? "")}
      />
    </SettingsGroup>
  );
}
