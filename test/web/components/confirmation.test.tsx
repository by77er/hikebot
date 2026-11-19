import { describe, expect, it } from "vitest";
import { Confirmation } from "../../../src/web/components/confirmation";
import { XIcon } from "../../../src/web/components/icons";
import { outline } from "../helpers";
import { render, spokenText } from "./render";

function cancelRound(props: { headingLevel?: 1 | 2 | 3 } = {}) {
  return render(
    <Confirmation
      {...props}
      eyebrow="Location vote · open"
      title="Cancel this round?"
      formAction="/g/1/round/cancel"
      fields={<input type="hidden" name="round" value="7" />}
      action={{ label: "Cancel round", variant: "danger", icon: XIcon }}
      back={{ href: "/g/1", label: "Back" }}
    >
      <p>
        Any open vote closes without a result and its votes are discarded. You
        can start a new round afterwards.
      </p>
    </Confirmation>,
  );
}

describe("Confirmation", () => {
  it("asks the bot's question as the page's h1 and restates what will happen", async () => {
    const html = cancelRound();
    expect(html).toContain(
      '<h1 class="confirmation__title">Cancel this round?</h1>',
    );
    expect(await spokenText(html)).toBe(
      "Location vote · open Cancel this round? Any open vote closes without a result and its votes are discarded. You can start a new round afterwards. This cannot be undone. Cancel round Back",
    );
  });

  it("is a page with a form that posts, not a dialog", () => {
    const html = cancelRound();
    expect(html).not.toMatch(/<dialog|role="dialog"|role="alertdialog"/);
    expect(html).toContain(
      '<form class="confirmation__form" method="post" action="/g/1/round/cancel"><input type="hidden" name="round" value="7"/>',
    );
  });

  it("has the action, danger where it destroys, then the way back", () => {
    const html = cancelRound();
    const action = html.indexOf(
      '<button class="button button--danger" type="submit">',
    );
    const back = html.indexOf(
      '<a class="button button--secondary" href="/g/1">',
    );
    expect(action).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(action);
  });

  it("uses a lower heading when shown inside another page", () => {
    expect(cancelRound({ headingLevel: 3 })).toContain(
      '<h3 class="confirmation__title">',
    );
  });

  it("offers a primary action for one that destroys nothing", () => {
    const html = render(
      <Confirmation
        title="Close the location vote now?"
        formAction="/close"
        action={{ label: "Close location vote", variant: "primary" }}
        back={{ href: "/", label: "Back" }}
      >
        <p>The location with the most votes wins.</p>
      </Confirmation>,
    );
    expect(html).toContain(
      '<button class="button button--primary" type="submit">',
    );
    expect(html).not.toContain("page-heading__eyebrow");
  });

  it("shows a member's words as text", async () => {
    const html = render(
      <Confirmation
        title="Cancel this round?"
        formAction="/c"
        action={{ label: "Cancel round", variant: "danger" }}
        back={{ href: "/", label: "Back" }}
      >
        <p>{"<script>alert(1)</script> leads with 3 votes."}</p>
      </Confirmation>,
    );
    expect((await outline(html)).scripts).toBe(0);
  });
});
