/** The settings page, fifth group: the units of the weather forecast. */
import { UNIT_NAMES } from "../../../../features/settings-catalogue";
import { ChoiceGroup } from "../../../components/choice-group";
import { settingGroup, settingHelp } from "./groups";
import {
  fieldError,
  fieldId,
  SettingsGroup,
  shownValue,
  type GroupProps,
} from "./settings-group";

export function UnitsSettings({ view, form, csrf, outcome }: GroupProps) {
  return (
    <SettingsGroup
      group={settingGroup("units")}
      view={view}
      form={form}
      csrf={csrf}
      outcome={outcome}
    >
      <ChoiceGroup
        type="radio"
        id={fieldId("units")}
        name="units"
        legend="Forecast units"
        hint={settingHelp("units")}
        error={fieldError(outcome, "units", form)}
        choices={[
          { value: "imperial", label: UNIT_NAMES.imperial },
          { value: "metric", label: UNIT_NAMES.metric },
        ]}
        value={shownValue(outcome, "units", form.values.units)}
      />
    </SettingsGroup>
  );
}
