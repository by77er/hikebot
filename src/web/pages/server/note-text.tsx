/**
 * One of the admin panel's notes or sentences, written for Discord, as
 * text on a web page: `**bold**` is strong, a channel mention `<#id>` is a
 * link to the channel in Discord named `#name` when the server's settings
 * know it, a timestamp `<t:seconds:style>` is the date and time in the
 * server's time zone, and a link (`[text](url)` or a bare `https://` one)
 * is a link. Everything else is text, escaped by JSX.
 */
import type { ComponentChildren } from "preact";
import type { WebView } from "../../../guild/web-view";

const TOKENS =
  /\*\*(.+?)\*\*|<#(\d{17,20})>|<t:(\d{1,12})(?::[a-zA-Z])?>|\[([^\]\n]+)\]\((https:\/\/[^\s()]+)\)|(https:\/\/[^\s<>()]+)/g;

/** The channels the view names: the vote, announcement and forum ones. */
function channelNames(view: WebView): Map<string, string> {
  const names = new Map<string, string>();
  const { voteChannel, announceChannel, forumChannel } = view.settings;
  for (const channel of [voteChannel, announceChannel, forumChannel]) {
    if (channel?.name != null) names.set(channel.id, channel.name);
  }
  return names;
}

function when(seconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(seconds * 1000));
}

/** What a bare link's text says: a Discord event or the address itself. */
function linkText(url: string): string {
  return url.startsWith("https://discord.com/events/")
    ? "the event in Discord"
    : url;
}

export function NoteText({ text, view }: { text: string; view: WebView }) {
  const names = channelNames(view);
  const parts: ComponentChildren[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKENS)) {
    const [whole, bold, channel, seconds, label, href, bare] = match;
    const start = match.index;
    if (start > at) parts.push(text.slice(at, start));
    at = start + whole.length;
    if (bold !== undefined) {
      parts.push(<strong>{bold}</strong>);
    } else if (channel !== undefined) {
      const name = names.get(channel);
      parts.push(
        <a href={`https://discord.com/channels/${view.server.id}/${channel}`}>
          {name === undefined ? "the channel in Discord" : `#${name}`}
        </a>,
      );
    } else if (seconds !== undefined) {
      parts.push(when(Number(seconds), view.settings.timeZone));
    } else if (label !== undefined && href !== undefined) {
      parts.push(<a href={href}>{label}</a>);
    } else if (bare !== undefined) {
      // A sentence's full stop is not part of the address.
      const url = bare.replace(/[.,;:]+$/, "");
      parts.push(<a href={url}>{linkText(url)}</a>);
      at = start + url.length;
    }
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
