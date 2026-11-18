/** Style guide: every allowed colour pairing and its contrast ratio. */
import {
  checkPairings,
  MINIMUM,
  PAIRINGS,
  type Pairing,
  type PairingResult,
} from "../../tokens";
import { Section, type SectionProps, type StyleguideSection } from "./section";

/** The pairings grouped by what they are for, in the order of PAIRINGS. */
function groups(): { key: string; pairings: [Pairing, number][] }[] {
  const byKey = new Map<string, [Pairing, number][]>();
  PAIRINGS.forEach((pairing, index) => {
    const key = `${pairing.use}|${pairing.foreground}|${pairing.kind}`;
    byKey.set(key, [...(byKey.get(key) ?? []), [pairing, index]]);
  });
  return [...byKey].map(([key, pairings]) => ({ key, pairings }));
}

function Ratio({ scheme, result }: { scheme: string; result?: PairingResult }) {
  if (!result) return null;
  return (
    <span>
      {result.ratio.toFixed(2)} {scheme}
      {result.passes ? null : <strong> fails</strong>}
    </span>
  );
}

function Contrast({ tokens }: SectionProps) {
  const results = checkPairings(tokens);
  return (
    <Section
      id="contrast"
      title="Contrast"
      intro="Every pairing the system allows, with its WCAG 2.2 contrast ratio in the light scheme, then the dark: at least 4.5:1 for text, 3:1 for large text, control boundaries, the focus ring and the blaze. Each sample names its background and shows the scheme you are viewing in."
    >
      <ul class="stack list-reset">
        {groups().map(({ key, pairings }) => {
          const [first] = pairings[0] ?? [];
          if (!first) return null;
          return (
            <li key={key} class="stack stack--tight">
              <p>
                <strong>{first.use}</strong>{" "}
                <small class="u-muted">
                  --{first.foreground}, at least {MINIMUM[first.kind]}:1
                </small>
              </p>
              <ul class="styleguide-pairs">
                {pairings.map(([pairing, index]) => (
                  <li key={pairing.background} class="styleguide-pair">
                    <span
                      class={`styleguide-sample styleguide-sample--${first.kind === "non-text" ? "non-text" : "text"}`}
                      data-fg={pairing.foreground}
                      data-bg={pairing.background}
                    >
                      <span class="styleguide-sample__label">
                        {pairing.background.replace(/^color-/, "")}
                      </span>
                    </span>
                    <span class="styleguide-pair__ratios">
                      <Ratio scheme="light" result={results[index]} />
                      <Ratio
                        scheme="dark"
                        result={results[PAIRINGS.length + index]}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export const contrastSection: StyleguideSection = {
  id: "contrast",
  title: "Contrast",
  render: Contrast,
};
