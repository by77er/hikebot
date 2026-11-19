import { describe, expect, it } from "vitest";
import { Button } from "../../../src/web/components/button";
import { FormActions } from "../../../src/web/components/form-actions";
import { render, spokenText } from "./render";

describe("FormActions", () => {
  it("holds the primary action first, then the way back", async () => {
    const html = render(
      <FormActions>
        <Button variant="primary">Propose a location</Button>
        <Button href="/servers">Back</Button>
      </FormActions>,
    );
    expect(html).toMatch(
      /^<div class="form-actions"><button class="button button--primary" type="submit">/,
    );
    expect(html.indexOf("button--primary")).toBeLessThan(
      html.indexOf('href="/servers"'),
    );
    expect(await spokenText(html)).toBe("Propose a location Back");
  });
});
