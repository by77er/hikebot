/**
 * The landing page at `/` for someone signed out: what hikebot is, where
 * the project lives, and the link to sign in with Discord. A signed-in
 * visitor is sent to `/servers` instead.
 */
import { Layout, PROJECT_URL } from "../layout";

export function HomePage() {
  return (
    <Layout title="hikebot">
      <h1>hikebot</h1>
      <p>
        hikebot is a Discord bot that runs a hiking group's votes on where and
        when to hike, then announces the plan and opens a thread for the hike.
      </p>
      <p>
        <a href="/login">Sign in with Discord</a>
      </p>
      <p>
        Signing in tells hikebot your Discord name and avatar, and which of your
        servers hikebot is in.
      </p>
      <p>
        <a href={PROJECT_URL}>The hikebot project</a>
      </p>
    </Layout>
  );
}
