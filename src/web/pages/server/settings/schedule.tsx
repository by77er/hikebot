/**
 * The settings page, last group: the weekly schedule, on or off, its
 * weekday, its time of day in the server's time zone, and how long the
 * date vote stays open. Turning it on is refused, naming the channels it
 * needs, until the three channels are set.
 */
import { DATE_VOTE_DAY_CHOICES } from "../../../../features/settings-catalogue";
import { WEEKDAY_NAMES } from "../../../../polls/dates";
import { ChoiceGroup } from "../../../components/choice-group";
import { Select } from "../../../components/select";
import { TextField } from "../../../components/text-field";
import { settingGroup, settingHelp } from "./groups";
import {
  fieldError,
  fieldId,
  SettingsGroup,
  shownValue,
  type GroupProps,
} from "./settings-group";

export function ScheduleSettings({ view, form, csrf, outcome }: GroupProps) {
  const { cadence, timezone } = form.values;
  return (
    <SettingsGroup
      group={settingGroup("schedule")}
      view={view}
      form={form}
      csrf={csrf}
      outcome={outcome}
    >
      <ChoiceGroup
        type="radio"
        id={fieldId("cadence.enabled")}
        name="cadence.enabled"
        legend="Weekly schedule"
        hint={settingHelp("cadence.enabled")}
        error={fieldError(outcome, "cadence.enabled", form)}
        choices={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
        value={shownValue(
          outcome,
          "cadence.enabled",
          cadence.enabled ? "on" : "off",
        )}
      />
      <Select
        id={fieldId("cadence.weekday")}
        name="cadence.weekday"
        label="Weekday"
        hint={settingHelp("cadence.weekday")}
        error={fieldError(outcome, "cadence.weekday", form)}
        options={WEEKDAY_NAMES.map((name, day) => ({
          value: String(day),
          label: name,
        }))}
        value={shownValue(outcome, "cadence.weekday", String(cadence.weekday))}
      />
      <TextField
        id={fieldId("cadence.time")}
        name="cadence.time"
        label="Time of day"
        hint={`${settingHelp("cadence.time")} HH:MM, 24-hour, in ${timezone}.`}
        error={fieldError(outcome, "cadence.time", form)}
        value={shownValue(outcome, "cadence.time", cadence.time)}
        width="short"
        autoComplete="off"
        spellCheck={false}
      />
      <ChoiceGroup
        type="radio"
        id={fieldId("cadence.dateVoteDays")}
        name="cadence.dateVoteDays"
        legend="Date vote length"
        hint={settingHelp("cadence.dateVoteDays")}
        error={fieldError(outcome, "cadence.dateVoteDays", form)}
        choices={DATE_VOTE_DAY_CHOICES.map((days) => ({
          value: String(days),
          label: days === 1 ? "1 day" : `${String(days)} days`,
        }))}
        value={shownValue(
          outcome,
          "cadence.dateVoteDays",
          String(cadence.dateVoteDays),
        )}
      />
    </SettingsGroup>
  );
}
