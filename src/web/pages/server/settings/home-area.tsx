/**
 * The settings page, fourth group: the home area, a text field holding
 * what an admin typed, with where OpenStreetMap found it. Saving other
 * text looks it up; saving it empty clears it.
 */
import { TextField } from "../../../components/text-field";
import { settingGroup, settingHelp } from "./groups";
import {
  fieldError,
  fieldId,
  SettingsGroup,
  shownValue,
  type GroupProps,
} from "./settings-group";

export function HomeAreaSettings({ view, form, csrf, outcome }: GroupProps) {
  const area = form.values.homeArea;
  const where =
    area === null
      ? "Not set: locations are looked up worldwide."
      : `${area.name === area.text ? "" : `Found on OpenStreetMap as ${area.name}. `}Leave it empty to look locations up worldwide.`;
  return (
    <SettingsGroup
      group={settingGroup("home-area")}
      view={view}
      form={form}
      csrf={csrf}
      outcome={outcome}
    >
      <TextField
        id={fieldId("homeArea")}
        name="homeArea"
        label="City or region"
        hint={`${settingHelp("homeArea")} ${where}`}
        error={fieldError(outcome, "homeArea", form)}
        value={shownValue(outcome, "homeArea", area?.text ?? "")}
        maxLength={form.maxHomeArea}
        autoComplete="off"
      />
    </SettingsGroup>
  );
}
