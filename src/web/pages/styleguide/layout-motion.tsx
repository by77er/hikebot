/** Style guide: content widths, the breakpoint, targets and motion. */
import { Section, type SectionProps, type StyleguideSection } from "./section";

function LayoutMotion({ tokens }: SectionProps) {
  const values = tokens.light;
  const rows = [
    ["--width-task", values["width-task"], "A page that does one job"],
    ["--width-overview", values["width-overview"], "Lists and dashboards"],
    ["--measure", values.measure, "Longest line of running text"],
    ["--target-min", values["target-min"], "Smallest tap target"],
    ["Breakpoint", "48rem", "Wider gutters and more space above"],
    [
      "--duration-quick",
      values["duration-quick"],
      "A short movement, never a colour",
    ],
    ["--duration-moderate", values["duration-moderate"], "Things that appear"],
    ["--easing-standard", values["easing-standard"], "All motion"],
  ];
  return (
    <Section
      id="layout-and-motion"
      title="Layout and motion"
      intro="One readable column on a phone, two widths on a desktop, and motion that stops when the device asks for less."
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Value</th>
            <th scope="col">Use</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, value, use]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{value}</td>
              <td>{use}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

export const layoutMotionSection: StyleguideSection = {
  id: "layout-and-motion",
  title: "Layout and motion",
  render: LayoutMotion,
};
