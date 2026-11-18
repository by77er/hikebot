/** Style guide: every allowed colour pairing and its contrast ratio. */
import { CheckIcon, XIcon } from "../../components/icons";
import { checkPairings, PAIRINGS, type PairingResult } from "../../tokens";
import { Section, type SectionProps, type StyleguideSection } from "./section";

function Ratio({ result }: { result: PairingResult | undefined }) {
  if (!result) return <td>none</td>;
  const Mark = result.passes ? CheckIcon : XIcon;
  return (
    <td>
      <span class="styleguide-pass">
        <Mark size="small" />
        {result.ratio.toFixed(2)}:1 {result.passes ? "passes" : "fails"}
      </span>
    </td>
  );
}

function Contrast({ tokens }: SectionProps) {
  const results = checkPairings(tokens);
  const find = (scheme: "light" | "dark", index: number) =>
    results[(scheme === "light" ? 0 : PAIRINGS.length) + index];
  return (
    <Section
      id="contrast"
      title="Contrast"
      intro="Every pairing the system allows, with its WCAG 2.2 contrast ratio in each scheme: at least 4.5:1 for text, 3:1 for large text, control boundaries, the focus ring and the blaze."
    >
      <table class="styleguide-table">
        <thead>
          <tr>
            <th scope="col">Sample</th>
            <th scope="col">Pairing</th>
            <th scope="col">Minimum</th>
            <th scope="col">Light</th>
            <th scope="col">Dark</th>
          </tr>
        </thead>
        <tbody>
          {PAIRINGS.map((pairing, index) => (
            <tr
              key={`${pairing.foreground} ${pairing.background} ${pairing.kind}`}
            >
              <td>
                <span
                  class={`styleguide-sample styleguide-sample--${pairing.kind === "non-text" ? "non-text" : "text"}`}
                  data-fg={pairing.foreground}
                  data-bg={pairing.background}
                >
                  {pairing.kind === "non-text" ? null : "Aa"}
                </span>
              </td>
              <td>
                {pairing.use}
                <br />
                <small class="u-muted">
                  {pairing.foreground} on {pairing.background}
                </small>
              </td>
              <td class="u-numeric">{find("light", index)?.minimum}:1</td>
              <Ratio result={find("light", index)} />
              <Ratio result={find("dark", index)} />
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export const contrastSection: StyleguideSection = {
  id: "contrast",
  title: "Contrast",
  render: Contrast,
};
