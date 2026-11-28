/** Style guide: Server tile in each state, and a list of tiles. */
import type { Preview } from "../../components/button";
import { ServerTile, ServerTileList } from "../../components/server-tile";
import { Section, type StyleguideSection } from "./section";

const HREF = "/styleguide#server-tile";

const STATES: { state: string; preview?: Preview }[] = [
  { state: "Default" },
  { state: "Hover", preview: "hover" },
  { state: "Focus visible", preview: "focus" },
  { state: "Active", preview: "active" },
];

const LONG_NAME =
  "Hiking club of the long and winding mountain trails of the long and winding mountain trails of the lo";

function ServerTileSection() {
  return (
    <Section
      id="server-tile"
      title="Server tile"
      intro="One server to choose: its icon or initials and its name, the whole tile one link. A long name wraps onto as many lines as it needs."
    >
      <ul class="server-tile-list list-reset">
        {STATES.map(({ state, preview }) => (
          <li class="stack stack--tight" key={state}>
            <ServerTile
              server={{ id: "1", name: "Ridge Walkers", icon: null }}
              href={HREF}
              preview={preview}
            />
            <span class="styleguide-states__label">{state}</span>
          </li>
        ))}
      </ul>
      <h3>A list of servers</h3>
      <p>
        One column on a phone, a grid from the breakpoint; tiles in a row are as
        tall as the tallest.
      </p>
      <ServerTileList
        servers={[
          { id: "1", name: "Ridge Walkers", icon: null },
          { id: "2", name: LONG_NAME, icon: null },
          { id: "3", name: "Lake Loop Trail Runners", icon: null },
        ]}
      />
    </Section>
  );
}

export const serverTileSection: StyleguideSection = {
  id: "server-tile",
  title: "Server tile",
  render: ServerTileSection,
  ownPage: true,
};
