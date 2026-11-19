/**
 * Server tile: one Discord server to choose, as a single link to its page
 * with the server's icon (or its initials) and its name. The whole tile is
 * the link, with one focus ring; its accessible name is the server's name,
 * since the icon is decorative. `ServerTileList` lays tiles out in one
 * column on a phone and a grid from the breakpoint.
 */
import { Avatar, serverIconUrl } from "./avatar";
import type { Preview } from "./button";
import { ChevronRightIcon } from "./icons";

export interface ServerTileServer {
  id: string;
  name: string;
  /** The icon hash Discord gives, or null for a server without an icon. */
  icon: string | null;
}

export interface ServerTileProps {
  server: ServerTileServer;
  /** Where the tile leads; defaults to the server's page, `/g/<id>`. */
  href?: string;
  preview?: Preview;
}

export function ServerTile({ server, href, preview }: ServerTileProps) {
  return (
    <a
      class="server-tile"
      href={href ?? `/g/${server.id}`}
      data-preview={preview}
    >
      <Avatar
        class="server-tile__icon"
        name={server.name}
        src={serverIconUrl(server.id, server.icon)}
        shape="square"
      />
      <span class="server-tile__name">{server.name}</span>
      <ChevronRightIcon class="server-tile__chevron" />
    </a>
  );
}

export function ServerTileList({ servers }: { servers: ServerTileServer[] }) {
  return (
    <ul class="server-tile-list list-reset">
      {servers.map((server) => (
        <li key={server.id}>
          <ServerTile server={server} />
        </li>
      ))}
    </ul>
  );
}
