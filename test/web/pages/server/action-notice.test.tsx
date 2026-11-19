import { describe, expect, it } from "vitest";
import { ActionNotice } from "../../../../src/web/pages/server/action-notice";
import { BotSentence } from "../../../../src/web/pages/server/bot-sentence";
import { render, spokenText } from "../../components/render";
import { baseView, FORMS, MARKUP, openVote, round } from "./view";

describe("ActionNotice", () => {
  it("shows nothing after no action", () => {
    expect(
      render(<ActionNotice view={baseView()} forms={FORMS} flash={null} />),
    ).toBe("");
  });

  it("shows the one-time banner and its note as a status", async () => {
    const html = render(
      <ActionNotice
        view={baseView()}
        forms={FORMS}
        flash={{ banner: `Added ${MARKUP}.`, note: "Looked up by its name." }}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<script");
    expect(await spokenText(html)).toContain(
      "Done Added &lt;script>alert(1)&lt;/script>&lt;b>Ridge&lt;/b>. Looked up by its name.",
    );
  });

  it("shows a refusal whose form is gone, such as a vote that closed", async () => {
    const html = render(
      <ActionNotice
        view={baseView({ round: round("location_decided", null, "Lake") })}
        forms={{
          csrf: "token",
          refusal: {
            form: "votes",
            pollId: 1,
            code: "poll_closed",
            message: "This vote has closed.",
            optionIds: [1],
          },
        }}
        flash={null}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(await spokenText(html)).toBe("Error This vote has closed.");
  });

  it("leaves a refusal whose form is on the page to that form", () => {
    const view = baseView({
      round: round(
        "location_vote_open",
        openVote("location", [{ label: "Lake", votes: 0 }]),
      ),
    });
    expect(
      render(
        <ActionNotice
          view={view}
          forms={{
            csrf: "token",
            refusal: {
              form: "votes",
              pollId: 1,
              code: "unknown_option",
              message: "That option is not in this poll.",
              optionIds: [9],
            },
          }}
          flash={null}
        />,
      ),
    ).toBe("");
  });
});

describe("BotSentence", () => {
  it("shows the bot's bold and code marks, and the rest as text", () => {
    expect(
      render(<BotSentence text={"**Lake** and `2030-06-08` <b>x</b> **"} />),
    ).toBe(
      "<strong>Lake</strong> and <code>2030-06-08</code> &lt;b>x&lt;/b> **",
    );
  });
});
