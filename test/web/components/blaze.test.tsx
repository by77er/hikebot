import { describe, expect, it } from "vitest";
import { Blaze } from "../../../src/web/components/blaze";
import { render, spokenText } from "./render";

describe("Blaze", () => {
  it("is decorative by default", async () => {
    const html = render(<Blaze />);
    expect(html).toBe('<span class="blaze" aria-hidden="true"></span>');
    expect(await spokenText(html)).toBe("");
  });

  it("is an image named by its label when it marks something", async () => {
    const html = render(<Blaze label="Winner" />);
    expect(html).toBe(
      '<span class="blaze" role="img" aria-label="Winner"></span>',
    );
    expect(await spokenText(html)).toBe("Winner");
  });
});
