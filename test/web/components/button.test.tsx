import { describe, expect, it } from "vitest";
import { Button } from "../../../src/web/components/button";
import { VoteIcon } from "../../../src/web/components/icons";
import { render, spokenText } from "./render";

describe("Button", () => {
  it("is a submit button in the secondary variant by default", () => {
    expect(render(<Button>Propose a location</Button>)).toBe(
      '<button class="button button--secondary" type="submit"><span>Propose a location</span></button>',
    );
  });

  it.each(["primary", "secondary", "quiet", "danger"] as const)(
    "renders the %s variant as a button and as a link",
    (variant) => {
      expect(render(<Button variant={variant}>Vote</Button>)).toContain(
        `<button class="button button--${variant}"`,
      );
      expect(
        render(
          <Button variant={variant} href="/hikes">
            Vote
          </Button>,
        ),
      ).toMatch(
        new RegExp(`^<a class="button button--${variant}" href="/hikes">`),
      );
    },
  );

  it("is named by its label, not its icon", async () => {
    const html = render(
      <Button variant="primary" icon={VoteIcon} name="choice" value="3">
        Vote
      </Button>,
    );
    expect(html).toContain('name="choice" value="3"');
    expect(html).toContain('<svg class="icon button__icon"');
    expect(html).toContain('aria-hidden="true"');
    expect(await spokenText(html)).toBe("Vote");
  });

  it("draws busy for the style guide with aria-busy, as the press script sets it", () => {
    expect(
      render(
        <Button variant="primary" type="button" busy>
          Save votes
        </Button>,
      ),
    ).toBe(
      '<button class="button button--primary" type="button" aria-busy="true"><span>Save votes</span></button>',
    );
    expect(render(<Button>Vote</Button>)).not.toContain("aria-busy");
  });

  it("is disabled as a button with the disabled attribute", () => {
    const html = render(
      <Button type="button" disabled>
        Vote
      </Button>,
    );
    expect(html).toBe(
      '<button class="button button--secondary" type="button" disabled><span>Vote</span></button>',
    );
  });

  it("is disabled as a link by dropping the href", async () => {
    const html = render(
      <Button href="/hikes" disabled>
        See past hikes
      </Button>,
    );
    expect(html).not.toContain("href=");
    expect(html).toContain('role="link" aria-disabled="true"');
    expect(await spokenText(html)).toBe("See past hikes");
  });

  it("fills the width when block, and previews a state for the style guide", () => {
    const html = render(
      <Button variant="primary" block preview="hover">
        Vote
      </Button>,
    );
    expect(html).toContain(
      'class="button button--primary button--block" type="submit" data-preview="hover"',
    );
  });
});
