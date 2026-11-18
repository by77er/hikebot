/**
 * Banner: a message about the whole page or about what just happened, in
 * one of four tones. The tone is said three ways, so it never rests on
 * colour alone: the icon's shape, the icon's accessible name ("Warning")
 * and the title's words. Warnings and errors are alerts; information and
 * success are status messages. The title is the banner's accessible name.
 */
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import type { IconComponent } from "./icon";
import {
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "./icons";

export type BannerTone = "info" | "success" | "warning" | "danger";

const TONES: Record<
  BannerTone,
  { icon: IconComponent; label: string; role: "status" | "alert" }
> = {
  info: { icon: InfoIcon, label: "Information", role: "status" },
  success: { icon: CircleCheckIcon, label: "Done", role: "status" },
  warning: { icon: TriangleAlertIcon, label: "Warning", role: "alert" },
  danger: { icon: CircleXIcon, label: "Error", role: "alert" },
};

export interface BannerProps {
  tone: BannerTone;
  /** One short sentence that says what happened or what to know. */
  title: ComponentChildren;
  /** More detail or a link, if the title is not enough. */
  children?: ComponentChildren;
}

export function Banner({ tone, title, children }: BannerProps) {
  const titleId = useId();
  const { icon: ToneIcon, label, role } = TONES[tone];
  return (
    <div class={`banner banner--${tone}`} role={role} aria-labelledby={titleId}>
      <ToneIcon class="banner__icon" label={label} />
      <div class="banner__body">
        <p class="banner__title" id={titleId}>
          {title}
        </p>
        {children !== undefined && <div>{children}</div>}
      </div>
    </div>
  );
}
