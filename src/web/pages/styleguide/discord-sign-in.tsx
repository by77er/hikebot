/** Style guide: the Sign in with Discord button in each state. */
import type { Preview } from "../../components/button";
import { DiscordSignIn } from "../../components/discord-sign-in";
import { Section, StateList, type StyleguideSection } from "./section";

const STATES: { state: string; preview?: Preview }[] = [
  { state: "Default" },
  { state: "Hover", preview: "hover" },
  { state: "Focus visible", preview: "focus" },
  { state: "Active", preview: "active" },
];

function DiscordSignInSection() {
  return (
    <Section
      id="discord-sign-in"
      title="Sign in with Discord"
      intro="The primary button that starts signing in, with Discord's mark in white, or black on the dark scheme, as Discord's brand guidelines allow. One per page, as its primary action."
    >
      <StateList
        examples={STATES.map(({ state, preview }) => ({
          state,
          example: <DiscordSignIn preview={preview} />,
        }))}
      />
      <h3>Full width</h3>
      <DiscordSignIn block />
    </Section>
  );
}

export const discordSignInSection: StyleguideSection = {
  id: "discord-sign-in",
  title: "Sign in with Discord",
  render: DiscordSignInSection,
  ownPage: true,
};
