import { describe, expect, it } from "vitest";
import { TallyList } from "../../../../src/web/components/tally-list";
import { TallyRow } from "../../../../src/web/components/tally-row";
import { CurrentStep } from "../../../../src/web/pages/server/current-step";
import { render, spokenText } from "../../components/render";
import { baseView, FORMS, mapPin, openVote, round } from "./view";

describe("an open location vote's located options", () => {
  it("show each located option's short place name and a map link, as the poll message does, with OpenStreetMap's credit once", async () => {
    const vote = openVote("location", [
      { label: "Mailbox Peak", votes: 3, place: mapPin() },
      { label: "Paradise", votes: 2, place: mapPin(null) },
      { label: "Somewhere", votes: 1 },
    ]);
    const html = render(
      <CurrentStep
        forms={FORMS}
        view={baseView({ round: round("location_vote_open", vote) })}
      />,
    );
    const text = await spokenText(html);
    expect(text).toContain(
      "Mailbox Peak 3 votes Mailbox Peak, King County · Map of Mailbox Peak",
    );
    expect(text).toContain("Paradise 2 votes Map of Paradise");
    expect(text).toContain("Map of Paradise Somewhere 1 vote");
    expect([
      ...html.matchAll(/href="https:\/\/www\.openstreetmap\.org\/\?mlat/g),
    ]).toHaveLength(2);
    expect([...html.matchAll(/OpenStreetMap contributors/g)]).toHaveLength(1);
  });

  it("carry no credit when no option is located", () => {
    const html = render(
      <TallyList
        label="Locations"
        options={[{ id: "1", label: "Lake", votes: 1 }]}
        voterCount={1}
      />,
    );
    expect(html).not.toContain("OpenStreetMap");
  });

  it("put the place line after the label and before the details", async () => {
    const text = await spokenText(
      render(
        <TallyRow
          option={{
            id: "1",
            label: "Mailbox Peak",
            details: "Old trail up.",
            proposer: "Ana",
            votes: 2,
            place: mapPin(),
          }}
          voterCount={2}
        />,
      ),
    );
    expect(text).toBe(
      "Mailbox Peak 2 votes Mailbox Peak, King County · Map of Mailbox Peak Old trail up. Proposed by Ana",
    );
  });
});
