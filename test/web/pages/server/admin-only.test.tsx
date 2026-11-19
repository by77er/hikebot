import { describe, expect, it } from "vitest";
import { ADMIN_ONLY_MESSAGE } from "../../../../src/guild/permissions";
import { AdminOnlyPage } from "../../../../src/web/pages/server/admin-only";
import { htmlResponse } from "../../../../src/web/response";
import { outline } from "../../helpers";
import { GUILD } from "./view";

const USER = { name: "Ana", avatar: null, csrf: "token" };

describe("AdminOnlyPage", () => {
  it("says only admins can do this, in the panel's words, with the way back", async () => {
    const html = await htmlResponse(
      <AdminOnlyPage user={USER} guildId={GUILD} />,
    ).text();
    const shown = await outline(html);
    expect(shown.title).toBe("Only admins can do this · hikebot");
    expect(html).toContain("<h1>Only admins can do this</h1>");
    const lead = /<p class="page-heading__lead">([^<]*)<\/p>/.exec(html)?.[1];
    expect(lead).toContain(ADMIN_ONLY_MESSAGE);
    expect(lead).toContain("Nothing was changed.");
    expect(html).toMatch(
      new RegExp(
        `<a class="button button--primary" href="/g/${GUILD}">[\\s\\S]*?<span>Back to the server</span></a>`,
      ),
    );
    expect(shown.scripts).toBe(0);
  });
});
