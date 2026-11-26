/**
 * The settings page, third group: the time zone, a select of every IANA
 * zone grouped by region (Africa, America, ...), the server's zone chosen,
 * with the time it is there now, so a wrong zone shows at a glance. The
 * time is a `time` element marked `data-clock` with its zone, which the
 * screenshots set to their frozen clock.
 */
import {
  Select,
  type SelectGroup,
  type SelectOption,
} from "../../../components/select";
import { settingGroup, settingHelp } from "./groups";
import {
  fieldError,
  fieldId,
  SettingsGroup,
  shownValue,
  type GroupProps,
} from "./settings-group";

/**
 * The zones as the select lists them: those with no region (`UTC`) first,
 * then one group per region, the part before the first `/`, each zone
 * named by the rest with spaces for underscores (`Los Angeles`,
 * `Argentina/Buenos Aires`). `current` is added if the list lacks it.
 */
export function timeZoneOptions(
  zones: string[],
  current: string,
): (SelectOption | SelectGroup)[] {
  const all = zones.includes(current) ? zones : [...zones, current].sort();
  const options: (SelectOption | SelectGroup)[] = [];
  const regions = new Map<string, SelectGroup>();
  for (const zone of all) {
    const slash = zone.indexOf("/");
    if (slash === -1) {
      options.push({ value: zone, label: zone });
      continue;
    }
    const region = zone.slice(0, slash);
    let group = regions.get(region);
    if (group === undefined) {
      group = { group: region, options: [] };
      regions.set(region, group);
    }
    group.options.push({
      value: zone,
      label: zone.slice(slash + 1).replaceAll("_", " "),
    });
  }
  return [...options, ...regions.values()];
}

export function TimeZoneSettings({ view, form, csrf, outcome }: GroupProps) {
  const zone = form.values.timezone;
  return (
    <SettingsGroup
      group={settingGroup("time-zone")}
      view={view}
      form={form}
      csrf={csrf}
      outcome={outcome}
    >
      <Select
        id={fieldId("timezone")}
        name="timezone"
        label="Zone"
        hint={
          <>
            {settingHelp("timezone")} It is now{" "}
            <time
              dateTime={new Date(form.now).toISOString()}
              data-clock=""
              data-zone={zone}
            >
              {form.localTime}
            </time>{" "}
            in {zone}.
          </>
        }
        error={fieldError(outcome, "timezone", form)}
        options={timeZoneOptions(form.timeZones, zone)}
        value={shownValue(outcome, "timezone", zone)}
      />
    </SettingsGroup>
  );
}
