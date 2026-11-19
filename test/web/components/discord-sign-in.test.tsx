import { describe, expect, it } from "vitest";
import { DiscordSignIn } from "../../../src/web/components/discord-sign-in";
import { render, spokenText } from "./render";

describe("DiscordSignIn", () => {
  it("is the primary button to /login with Discord's mark before its label", async () => {
    const html = render(<DiscordSignIn />);
    expect(html).toMatch(
      /^<a class="button button--primary" href="\/login"><svg class="icon button__icon discord-sign-in__mark" viewBox="0 0 24 24"[^>]*aria-hidden="true"><path fill="currentColor" stroke="none" d="M20\.317 /,
    );
    expect(html).toContain("<span>Sign in with Discord</span></a>");
    expect(await spokenText(html)).toBe("Sign in with Discord");
  });

  it("comes back to `next` after signing in", () => {
    expect(render(<DiscordSignIn next="/g/1?tab=hikes" />)).toContain(
      'href="/login?next=%2Fg%2F1%3Ftab%3Dhikes"',
    );
  });

  it("takes another label, the full width and a previewed state", async () => {
    const html = render(
      <DiscordSignIn block preview="active">
        Try again
      </DiscordSignIn>,
    );
    expect(html).toMatch(
      /^<a class="button button--primary button--block" href="\/login" data-preview="active">/,
    );
    expect(await spokenText(html)).toBe("Try again");
  });
});
