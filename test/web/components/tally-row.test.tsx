import { describe, expect, it } from "vitest";
import { outline } from "../helpers";
import { TallyRow } from "../../../src/web/components/tally-row";
import { render, spokenText } from "./render";

const MAILBOX = {
  id: "7",
  label: "Mailbox Peak",
  details: "Old trail up, new trail down.",
  proposer: "Ana",
  votes: 11,
};

describe("TallyRow", () => {
  it("shows the label, the count, a bar of the voters, the details and the proposer", async () => {
    const html = render(<TallyRow option={MAILBOX} voterCount={14} />);
    expect(html).toMatch(/^<div class="tally-row">/);
    expect(html).toContain('<p class="tally-row__label">Mailbox Peak</p>');
    expect(html).toMatch(
      /<p class="tally-row__count" id="[^"]+"><span class="tally-row__number">11<\/span> votes<\/p>/,
    );
    expect(html).toContain(
      '<meter class="tally-row__bar" min="0" max="14" value="11" aria-hidden="true"></meter>',
    );
    expect(html).toContain(
      '<p class="tally-row__details">Old trail up, new trail down.</p>',
    );
    expect(html).toContain(
      '<p class="tally-row__proposer">Proposed by Ana</p>',
    );
    expect(html).not.toContain("tally-row__marks");
    expect(await spokenText(html)).toBe(
      "Mailbox Peak 11 votes Old trail up, new trail down. Proposed by Ana",
    );
  });

  it("says one vote in the singular, and draws no votes as an empty bar", () => {
    expect(
      render(<TallyRow option={{ ...MAILBOX, votes: 1 }} voterCount={1} />),
    ).toContain('<span class="tally-row__number">1</span> vote</p>');
    expect(
      render(<TallyRow option={{ ...MAILBOX, votes: 0 }} voterCount={0} />),
    ).toContain('max="1" value="0"');
  });

  it("leaves out the proposer of a date and details that are blank", async () => {
    const html = render(
      <TallyRow
        option={{
          id: "d1",
          label: "Sat, 5 Dec 2026 · 11:00",
          votes: 3,
          details: null,
        }}
        voterCount={5}
      />,
    );
    expect(html).not.toContain("Proposed by");
    expect(html).not.toContain("tally-row__details");
    expect(await spokenText(html)).toBe("Sat, 5 Dec 2026 · 11:00 3 votes");
  });

  it("marks the viewer's vote and the winner in words", async () => {
    const html = render(
      <TallyRow
        option={{ ...MAILBOX, yourVote: true }}
        voterCount={14}
        winner
      />,
    );
    expect(html).toMatch(/^<div class="tally-row tally-row--winner">/);
    expect(html).toContain(
      '<span class="tally-row__winner"><span class="blaze" aria-hidden="true"></span> Winner</span>',
    );
    expect(await spokenText(html)).toContain("11 votes Winner Your vote");
  });

  it("says when the winner was drawn from a tie, in the bot's words", async () => {
    const html = render(
      <TallyRow
        option={{ ...MAILBOX, votes: 4 }}
        voterCount={9}
        winner
        tiedOptions={3}
      />,
    );
    expect(html).toContain(
      '<p class="tally-row__tie">3 options tied with 4 votes each; the winner was drawn at random.</p>',
    );
    expect(
      render(
        <TallyRow option={MAILBOX} voterCount={9} winner tiedOptions={1} />,
      ),
    ).not.toContain("tally-row__tie");
    expect(
      render(<TallyRow option={MAILBOX} voterCount={9} tiedOptions={3} />),
    ).not.toContain("tally-row__tie");
  });

  it("folds the details behind a disclosure named after the option", async () => {
    const html = render(
      <TallyRow option={MAILBOX} voterCount={14} collapseDetails />,
    );
    expect(html).toContain(
      '<div class="tally-row__foot"><p class="tally-row__proposer">',
    );
    expect(html).toMatch(
      /<details class="tally-row__more"><summary class="tally-row__summary"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>Details<span class="u-visually-hidden"> of Mailbox Peak<\/span><\/summary><p class="tally-row__details">Old trail up, new trail down.<\/p><\/details>/,
    );
    expect(await spokenText(html)).toContain("Details of Mailbox Peak");
  });

  it("renders text from members as text, never as markup or Markdown", async () => {
    const html = render(
      <TallyRow
        option={{
          id: "x",
          label: "<script>alert(1)</script> **Ridge**",
          details: '<img src=x onerror="alert(2)"> [map](https://evil.example)',
          proposer: "<b>Eve</b>",
          votes: 2,
        }}
        voterCount={2}
        winner
        tiedOptions={2}
        collapseDetails
        choice={{ name: "option" }}
      />,
    );
    const page = await outline(html);
    expect(page.scripts).toBe(0);
    expect(page.eventAttributes).toBe(0);
    expect(page.elements).not.toContain("img");
    expect(page.elements).not.toContain("b");
    expect(html).toContain("&lt;script>alert(1)&lt;/script> **Ridge**");
    expect(html).toContain("[map](https://evil.example)");
    expect(html).toContain("Proposed by &lt;b>Eve&lt;/b>");
  });

  describe("votable", () => {
    it("labels a real checkbox with the option, described by its count", async () => {
      const html = render(
        <TallyRow
          option={{ ...MAILBOX, yourVote: true }}
          voterCount={14}
          choice={{ name: "option" }}
        />,
      );
      expect(html).toMatch(/^<div class="tally-row tally-row--votable">/);
      const checkId = /<input[^>]* id="([^"]+)"/.exec(html)?.[1] ?? "";
      const countId =
        /<p class="tally-row__count" id="([^"]+)"/.exec(html)?.[1] ?? "";
      expect(checkId).toBeTruthy();
      expect(html).toContain(
        `<label class="tally-row__label tally-row__choice" for="${checkId}"><input class="tally-row__check" type="checkbox" id="${checkId}" name="option" value="7" checked aria-describedby="${countId}"/><span>Mailbox Peak</span></label>`,
      );
      expect(html).not.toContain("Your vote");
      expect(await spokenText(html)).toBe(
        "Mailbox Peak 11 votes Old trail up, new trail down. Proposed by Ana",
      );
    });

    it("leaves the checkbox unchecked when the viewer has not voted for it", () => {
      const html = render(
        <TallyRow
          option={MAILBOX}
          voterCount={14}
          choice={{ name: "option" }}
        />,
      );
      expect(html).toMatch(
        /<input class="tally-row__check" type="checkbox" id="[^"]+" name="option" value="7" aria-describedby/,
      );
    });

    it("previews focus on the checkbox and hover on the label", () => {
      const focus = render(
        <TallyRow
          option={MAILBOX}
          voterCount={14}
          choice={{ name: "o" }}
          preview="focus"
        />,
      );
      expect(focus).toMatch(/<input [^>]*data-preview="focus"/);
      expect(focus).toMatch(
        /<label class="tally-row__label tally-row__choice" for="[^"]+">/,
      );
      const hover = render(
        <TallyRow
          option={MAILBOX}
          voterCount={14}
          choice={{ name: "o" }}
          preview="hover"
        />,
      );
      expect(hover).toMatch(/<label [^>]*data-preview="hover"/);
    });
  });
});
