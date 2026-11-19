import { describe, expect, it } from "vitest";
import { DefinitionList } from "../../../src/web/components/definition-list";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

describe("DefinitionList", () => {
  it("pairs each name with its value in a dl", async () => {
    const html = render(
      <DefinitionList
        items={[{ name: "Time zone", value: "America/Los_Angeles" }]}
      />,
    );
    expect(html).toBe(
      '<dl class="definition-list"><div class="definition-list__row"><dt class="definition-list__name">Time zone</dt><dd class="definition-list__value">America/Los_Angeles</dd></div></dl>',
    );
    expect(await spokenText(html)).toBe("Time zone America/Los_Angeles");
  });

  it("says Not set in words for a value that is not set", async () => {
    const html = render(
      <DefinitionList
        items={[
          { name: "Hike threads channel" },
          { name: "Voting channel", value: null },
          {
            name: "Admin role",
            notSet: "Not set: only the server owner can use the panel.",
          },
        ]}
      />,
    );
    expect(html.match(/definition-list__value--not-set/g)).toHaveLength(3);
    expect(await spokenText(html)).toBe(
      "Hike threads channel Not set Voting channel Not set Admin role Not set: only the server owner can use the panel.",
    );
  });

  it("names each change link after its row", async () => {
    const html = render(
      <DefinitionList
        items={[
          {
            name: "Voting channel",
            value: "#hike-votes",
            change: { href: "/s/voting" },
          },
          { name: "Admin role", change: { href: "/s/role", label: "Set" } },
        ]}
      />,
    );
    expect(html).toContain(
      '<dd class="definition-list__action"><a class="button button--quiet" href="/s/voting">',
    );
    expect(await spokenText(html)).toBe(
      "Voting channel #hike-votes Change voting channel Admin role Not set Set admin role",
    );
  });

  it("shows a channel's name as text", async () => {
    const html = render(
      <DefinitionList
        items={[{ name: "Voting channel", value: "<script>alert(1)</script>" }]}
      />,
    );
    expect(html).toContain("&lt;script>");
    expect((await outline(html)).scripts).toBe(0);
  });
});
