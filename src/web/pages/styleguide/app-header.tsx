/**
 * Style guide: the app header, signed out and signed in, with the user
 * menu closed, in each state of its button, and open.
 */
import { AppHeader, type HeaderUser } from "../../components/app-header";
import type { Preview } from "../../components/button";
import { Section, type StyleguideSection } from "./section";

const ANA: HeaderUser = {
  name: "Ana Hiker",
  avatar: "/assets/cairn/samples/picture.svg",
  csrf: "",
};

const LONG: HeaderUser = {
  name: "Alexandria Montgomery-Whitfield",
  avatar: null,
  csrf: "",
};

const STATES: { state: string; preview: Preview }[] = [
  { state: "Hover", preview: "hover" },
  { state: "Focus visible", preview: "focus" },
  { state: "Active", preview: "active" },
];

function AppHeaderSection() {
  return (
    <Section
      id="app-header"
      title="App header"
      intro="The band at the top of every page: the brand mark linking home, the server a page is about, and for a signed-in member their avatar and name, which open a menu with Sign out."
    >
      <h3>Signed out</h3>
      <div class="styleguide-frame">
        <AppHeader />
      </div>
      <h3>Signed in</h3>
      <div class="styleguide-frame">
        <AppHeader user={ANA} />
      </div>
      <h3>Signed in, no picture and a long name</h3>
      <div class="styleguide-frame">
        <AppHeader user={LONG} />
      </div>
      <h3>On a server's page</h3>
      <div class="styleguide-frame">
        <AppHeader user={ANA} context="Ridge Walkers" />
      </div>
      {STATES.map(({ state, preview }) => (
        <div class="stack stack--tight" key={state}>
          <h3>Menu button, {state.toLowerCase()}</h3>
          <div class="styleguide-frame">
            <AppHeader user={ANA} preview={preview} />
          </div>
        </div>
      ))}
      <h3>Menu open</h3>
      <div class="styleguide-frame styleguide-frame--menu">
        <AppHeader user={ANA} open />
      </div>
    </Section>
  );
}

export const appHeaderSection: StyleguideSection = {
  id: "app-header",
  title: "App header",
  render: AppHeaderSection,
  ownPage: true,
};
