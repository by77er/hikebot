import { describe, it } from "vitest";

describe("throwaway e2e failure", () => {
  it("throws an error", () => {
    throw new Error("deliberate e2e failure for the CI log");
  });
});
