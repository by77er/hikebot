/**
 * The landing page at `/` for someone signed out: what hikebot does, its one
 * action, Sign in with Discord, with what signing in tells hikebot, how a
 * round goes, and, quietly, how a server admin adds the bot. A signed-in
 * visitor is sent to `/servers` instead.
 */
import { Button } from "../components/button";
import { Card } from "../components/card";
import { DiscordSignIn } from "../components/discord-sign-in";
import { ExternalLinkIcon } from "../components/icons";
import { Layout } from "../layout";

const STEPS = [
  {
    title: "Propose a location",
    text: "Members suggest where to go, right in the group's Discord channel.",
  },
  {
    title: "Vote",
    text: "Everyone picks every place they would go. The tally updates as votes come in.",
  },
  {
    title: "Go hiking",
    text: "When the organiser closes the vote, hikebot announces the winner, runs the date vote and opens a thread for the hike.",
  },
];

export function HomePage({ inviteUrl }: { inviteUrl: string }) {
  return (
    <Layout title="hikebot">
      <div class="stack stack--section">
        <div class="stack stack--loose">
          <div class="page-heading">
            <p class="page-heading__eyebrow">A Discord bot for hiking groups</p>
            <h1>Plan the next hike together</h1>
            <p class="page-heading__lead">
              hikebot is a Discord bot that runs a hiking group's votes on where
              and when to hike, then announces the plan and opens a thread for
              the hike.
            </p>
          </div>
          <div class="stack stack--tight">
            <div class="cluster">
              <DiscordSignIn />
            </div>
            <p class="u-small u-muted">
              Signing in tells hikebot your Discord name and avatar, and which
              of your servers hikebot is in.
            </p>
          </div>
        </div>
        <section class="stack" aria-labelledby="how-it-works">
          <h2 id="how-it-works">How it works</h2>
          <ol class="grid list-reset">
            {STEPS.map(({ title, text }) => (
              <li key={title}>
                <Card title={title} headingLevel={3}>
                  <p>{text}</p>
                </Card>
              </li>
            ))}
          </ol>
        </section>
        <section class="stack stack--tight" aria-labelledby="add-hikebot">
          <h2 id="add-hikebot">Add hikebot to your server</h2>
          <p>
            A server admin adds hikebot once; then members plan hikes with{" "}
            <code>/hike</code> in Discord and here.
          </p>
          <div class="cluster">
            <Button
              variant="quiet"
              href={inviteUrl}
              iconAfter={ExternalLinkIcon}
            >
              Add hikebot to a server
            </Button>
          </div>
        </section>
      </div>
    </Layout>
  );
}
