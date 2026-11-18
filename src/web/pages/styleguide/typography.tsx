/** Style guide: the typeface, the type scale and the weights. */
import { Section, type SectionProps, type StyleguideSection } from "./section";

const SCALE = [
  { step: "h1", use: "Page title, one per page" },
  { step: "h2", use: "Section heading" },
  { step: "h3", use: "Card title, sub-section" },
  { step: "lead", use: "The sentence under a page title" },
  { step: "body", use: "Everything else" },
  { step: "small", use: "Meta: dates, counts, captions" },
];

const WEIGHTS = ["regular", "semibold", "bold"];

function Typography({ tokens }: SectionProps) {
  const values = tokens.light;
  return (
    <Section
      id="typography"
      title="Typography"
      intro="Public Sans, one variable sans-serif, in six sizes and three weights. Body text is never smaller than 16px."
    >
      <ul class="styleguide-type">
        {SCALE.map(({ step, use }) => (
          <li key={step}>
            <span class="styleguide-type__meta">
              --font-size-{step}: {values[`font-size-${step}`]} / line height{" "}
              {values[`line-height-${step}`]} · {use}
            </span>
            <span class="styleguide-type__sample" data-type={step}>
              Where should we hike next?
            </span>
          </li>
        ))}
      </ul>
      <h3>Weights</h3>
      <ul class="styleguide-type">
        {WEIGHTS.map((weight) => (
          <li key={weight}>
            <span class="styleguide-type__meta">
              --font-weight-{weight}: {values[`font-weight-${weight}`]}
            </span>
            <span class="styleguide-type__sample" data-weight={weight}>
              Rattlesnake Ledge, 8 votes
            </span>
          </li>
        ))}
      </ul>
      <h3>Letterforms and numbers</h3>
      <p class="styleguide-glyphs">Il1 O0 rn m</p>
      <table>
        <caption>Tabular numbers line up in tallies and dates</caption>
        <thead>
          <tr>
            <th scope="col">Location</th>
            <th scope="col">Votes</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Mailbox Peak</td>
            <td>11</td>
            <td>2031-06-14 08:30</td>
          </tr>
          <tr>
            <td>Lake 22 via Mountain Loop</td>
            <td>8</td>
            <td>2031-06-21 09:00</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export const typographySection: StyleguideSection = {
  id: "typography",
  title: "Typography",
  render: Typography,
};
