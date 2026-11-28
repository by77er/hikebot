/**
 * The style guide's example forms, sent the way a browser without
 * JavaScript sends them: the error summary's "Propose a location" form
 * (a GET form) comes back with its errors linked and what was typed kept,
 * and a confirmation page's form posts and is answered with a redirect.
 */
import { describe, expect, it } from "vitest";
import { formFields, PageClient, withoutCairnScripts } from "./harness/web";
import { useE2E } from "./harness/worker";

const e2e = useE2E();

const PROPOSE = "/styleguide/error-summary#error-summary";

/** A GET form's submission: its action with the fields as the query. */
function submitted(action: string, fields: Record<string, string>): string {
  const url = new URL(action, "https://hikebot.example");
  return `${url.pathname}?${new URLSearchParams(fields).toString()}`;
}

describe("the style guide's forms without JavaScript", () => {
  it("bring the proposal form back with its errors and what was typed", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get("/styleguide/error-summary");
    expect(page.status).toBe(200);
    const fields = formFields(page.body, PROPOSE);
    expect(Object.keys(fields ?? {})).toEqual(["name", "map"]);
    const back = await client.get(
      submitted(PROPOSE, {
        ...fields,
        name: "Lake Serene",
        details: "Bring a <b>headlamp</b>",
        map: "https://maps.app.goo.gl/abc",
      }),
    );
    expect(back.status).toBe(200);
    expect(back.body).toContain("Your location was not added.");
    expect(back.body).toContain(
      '<a href="#proposal-name">Lake Serene is already on the list. Vote for it instead.</a>',
    );
    expect(back.body).toContain('<a href="#proposal-map">No coordinates');
    expect(back.body).toContain('value="Lake Serene"');
    expect(back.body).toContain(">Bring a &lt;b>headlamp&lt;/b></textarea>");
    expect(back.body).toContain('value="https://maps.app.goo.gl/abc"');
    expect(withoutCairnScripts(back.body)).not.toMatch(/<script/i);
  });

  it("add a good proposal and say so", async () => {
    const client = new PageClient(e2e.url);
    const back = await client.get(
      submitted(PROPOSE, {
        name: "Ridge Trail",
        details: "",
        map: "47.4875, -121.7234",
      }),
    );
    expect(back.status).toBe(200);
    expect(back.body).toContain(
      "Added <strong>Ridge Trail</strong> to the location vote.",
    );
    expect(back.body).not.toContain("Your location was not added.");
  });

  it("post a confirmation and land back on the page, nothing changed", async () => {
    const client = new PageClient(e2e.url);
    const page = await client.get("/styleguide/confirmation");
    const posted = await client.submitForm(page, "/styleguide/confirmation");
    expect(posted.status).toBe(303);
    expect(posted.location?.pathname).toBe("/styleguide/confirmation");
    const landed = await client.get(
      `${posted.location?.pathname ?? ""}${posted.location?.search ?? ""}`,
    );
    expect(landed.body).toContain("The form was posted.");
  });
});
