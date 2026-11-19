/**
 * Fixed settings forms for the settings page's tests: an admin's view of
 * Ridge Walkers with nothing set, and one with everything set, with roles
 * and channels in categories as the read gives them.
 */
import type { WebSettingsForm } from "../../../../../src/features/settings-form";
import type { WebView } from "../../../../../src/guild/web-view";
import { baseView, VIEWER } from "../view";

export const ROLE = "500000000000007001";
export const VOTES = "300000000000007101";
export const GENERAL = "300000000000007102";
export const NEWS = "300000000000007103";
export const FORUM = "300000000000007104";

/** Nothing set, Discord listing two roles and four channels. */
export function emptyForm(
  overrides: Partial<WebSettingsForm> = {},
): WebSettingsForm {
  return {
    values: {
      adminRoleId: null,
      voteChannelId: null,
      announceChannelId: null,
      forumChannelId: null,
      timezone: "America/Los_Angeles",
      homeArea: null,
      units: "imperial",
      cadence: { enabled: false, weekday: 3, time: "09:00", dateVoteDays: 2 },
    },
    roles: [
      { id: ROLE, name: "Hike leads" },
      { id: "500000000000007002", name: "Members" },
    ],
    channels: {
      voteChannelId: [
        { id: GENERAL, name: "general", category: null },
        { id: VOTES, name: "votes", category: "Hiking" },
      ],
      announceChannelId: [
        { id: GENERAL, name: "general", category: null },
        { id: VOTES, name: "votes", category: "Hiking" },
        { id: NEWS, name: "news", category: "Hiking" },
      ],
      forumChannelId: [{ id: FORUM, name: "hikes", category: "Hiking" }],
    },
    timeZones: [
      "America/Argentina/Buenos_Aires",
      "America/Los_Angeles",
      "Asia/Kolkata",
      "Europe/Berlin",
    ],
    localTime: "Wed 09:42",
    now: Date.UTC(2030, 5, 5, 7, 42),
    maxHomeArea: 100,
    missingChannels: [
      "voting channel",
      "announcements channel",
      "hike threads channel",
    ],
    ...overrides,
  };
}

/** Everything set. */
export function fullForm(): WebSettingsForm {
  const form = emptyForm({ missingChannels: [] });
  return {
    ...form,
    values: {
      adminRoleId: ROLE,
      voteChannelId: VOTES,
      announceChannelId: NEWS,
      forumChannelId: FORUM,
      timezone: "Europe/Berlin",
      homeArea: {
        text: "Seattle, Washington",
        name: "Seattle, King County, Washington",
      },
      units: "metric",
      cadence: { enabled: true, weekday: 5, time: "18:30", dateVoteDays: 3 },
    },
  };
}

/** An admin's view of the server with `form`. */
export function adminView(form: WebSettingsForm): WebView {
  return baseView({
    viewer: { userId: VIEWER, isAdmin: true },
    settingsForm: form,
  });
}
