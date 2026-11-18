/** Style guide: Banner in each tone. */
import { Banner } from "../../components/banner";
import { Section, type StyleguideSection } from "./section";

function BannerSection() {
  return (
    <Section
      id="banner"
      title="Banner"
      intro="A message about the whole page or what just happened. The icon and the words carry the tone; the colour repeats it."
    >
      <div class="stack">
        <Banner
          tone="info"
          title="The date vote opens when the location is decided."
        >
          Organisers start it from the admin panel in Discord.
        </Banner>
        <Banner tone="success" title="Your vote is saved." />
        <Banner tone="warning" title="Voting closes in 2 hours.">
          You can change your vote until then.
        </Banner>
        <Banner tone="danger" title="This round was cancelled.">
          The next one starts when an organiser opens a vote, or{" "}
          <a href="/styleguide#banner">see past hikes</a>.
        </Banner>
      </div>
    </Section>
  );
}

export const bannerSection: StyleguideSection = {
  id: "banner",
  title: "Banner",
  render: BannerSection,
};
