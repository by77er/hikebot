/**
 * Cairn's weather icons, one component each, in alphabetical order, and
 * `WeatherIcon`, which picks the one for a WMO weather code as Open-Meteo
 * reports it. Drawn by `Icon` like every Cairn icon, from the shapes of
 * Lucide 1.75.0 under the ISC licence, whose notice is at the top of
 * `icons.tsx`. They sit beside the conditions in words, which carry the
 * meaning, so they are decorative.
 */
import { Icon, type IconProps } from "./icon";

export function CircleHelpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

export function CloudDrizzleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M8 19v1" />
      <path d="M8 14v1" />
      <path d="M16 19v1" />
      <path d="M16 14v1" />
      <path d="M12 21v1" />
      <path d="M12 16v1" />
    </Icon>
  );
}

export function CloudFogIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 17H7" />
      <path d="M17 21H9" />
    </Icon>
  );
}

export function CloudHailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v2" />
      <path d="M8 14v2" />
      <path d="M16 20h.01" />
      <path d="M8 20h.01" />
      <path d="M12 16v2" />
      <path d="M12 22h.01" />
    </Icon>
  );
}

export function CloudIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </Icon>
  );
}

export function CloudLightningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" />
      <path d="m13 12-3 5h4l-3 5" />
    </Icon>
  );
}

export function CloudRainIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M16 14v6" />
      <path d="M8 14v6" />
      <path d="M12 16v6" />
    </Icon>
  );
}

export function CloudSnowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="M8 15h.01" />
      <path d="M8 19h.01" />
      <path d="M12 17h.01" />
      <path d="M12 21h.01" />
      <path d="M16 15h.01" />
      <path d="M16 19h.01" />
    </Icon>
  );
}

export function CloudSunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="M20 12h2" />
      <path d="m19.07 4.93-1.41 1.41" />
      <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" />
      <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  );
}

export function SunriseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2v8" />
      <path d="m4.93 10.93 1.41 1.41" />
      <path d="M2 18h2" />
      <path d="M20 18h2" />
      <path d="m19.07 10.93-1.41 1.41" />
      <path d="M22 22H2" />
      <path d="m8 6 4-4 4 4" />
      <path d="M16 18a4 4 0 0 0-8 0" />
    </Icon>
  );
}

export function SunsetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 10V2" />
      <path d="m4.93 10.93 1.41 1.41" />
      <path d="M2 18h2" />
      <path d="M20 18h2" />
      <path d="m19.07 10.93-1.41 1.41" />
      <path d="M22 22H2" />
      <path d="m16 6-4 4-4-4" />
      <path d="M16 18a4 4 0 0 0-8 0" />
    </Icon>
  );
}

/** Every weather icon by name, in the order above, for the style guide. */
export const WEATHER_ICONS = {
  CircleHelpIcon,
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudHailIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudRainIcon,
  CloudSnowIcon,
  CloudSunIcon,
  SunIcon,
  SunriseIcon,
  SunsetIcon,
};

/** The icon of WMO weather code `code`; a question mark for none or an unknown one. */
export function weatherIconFor(code: number | null) {
  if (code === null) return CircleHelpIcon;
  if (code === 0) return SunIcon;
  if (code === 1 || code === 2) return CloudSunIcon;
  if (code === 3) return CloudIcon;
  if (code === 45 || code === 48) return CloudFogIcon;
  if (code >= 51 && code <= 57) return CloudDrizzleIcon;
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return CloudRainIcon;
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return CloudSnowIcon;
  }
  if (code === 96 || code === 99) return CloudHailIcon;
  if (code === 95 || code === 97) return CloudLightningIcon;
  return CircleHelpIcon;
}

/** The icon of WMO weather code `code`, decorative, beside its words. */
export function WeatherIcon({
  code,
  ...props
}: { code: number | null } & IconProps) {
  const Glyph = weatherIconFor(code);
  return <Glyph {...props} />;
}
