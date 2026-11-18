/** The landing page at `/`: what hikebot is, and where the project lives. */
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
        <a href={PROJECT_URL}>The hikebot project</a>
      </p>
    </Layout>
  );
}
