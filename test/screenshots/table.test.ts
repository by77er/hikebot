import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedScreenshots,
  gitIn,
  imageUrl,
  screenshotsSection,
  tableForCheckout,
  type Git,
} from "./table";

let dir: string;
let git: Git;

function png(name: string, content: string): void {
  writeFileSync(join(dir, "docs/screenshots", name), content);
}

function commit(message: string): string {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hikebot-table-"));
  git = gitIn(dir);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  mkdirSync(join(dir, "docs/screenshots"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * main has a, b and c; the branch changes a, removes b, keeps c and adds d,
 * and changes a file outside docs/screenshots. Returns the two commits.
 */
function branchWithChanges(): { base: string; head: string } {
  png("a--phone--light.png", "a1");
  png("b--phone--light.png", "b1");
  png("c--phone--light.png", "c1");
  writeFileSync(join(dir, "README.md"), "one");
  const base = commit("main");
  git(["update-ref", "refs/remotes/origin/main", base]);
  git(["checkout", "-q", "-b", "topic"]);
  png("a--phone--light.png", "a2");
  rmSync(join(dir, "docs/screenshots/b--phone--light.png"));
  png("d--phone--light.png", "d1");
  writeFileSync(join(dir, "README.md"), "two");
  const head = commit("topic");
  return { base, head };
}

describe("changedScreenshots", () => {
  it("lists changed, new and removed PNGs, and leaves out unchanged ones", () => {
    const { base, head } = branchWithChanges();
    expect(changedScreenshots(git, base, head)).toEqual([
      { file: "a--phone--light.png", change: "changed" },
      { file: "b--phone--light.png", change: "removed" },
      { file: "d--phone--light.png", change: "new" },
    ]);
  });

  it("finds nothing when no PNG differs", () => {
    png("a--phone--light.png", "a1");
    const base = commit("main");
    writeFileSync(join(dir, "README.md"), "changed");
    const head = commit("text only");
    expect(changedScreenshots(git, base, head)).toEqual([]);
  });
});

describe("screenshotsSection", () => {
  const base = "a".repeat(40);
  const head = "b".repeat(40);

  it("pins each image to the merge base or the head commit", () => {
    expect(imageUrl(head, "home--phone--light.png")).toBe(
      `https://raw.githubusercontent.com/by77er/hikebot/${head}/docs/screenshots/home--phone--light.png`,
    );
    const section = screenshotsSection(
      [
        { file: "a--phone--light.png", change: "changed" },
        { file: "b--phone--light.png", change: "removed" },
        { file: "d--phone--light.png", change: "new" },
      ],
      base,
      head,
    );
    expect(section.split("\n")).toEqual([
      "## Screenshots",
      "",
      "Before is aaaaaaa (the merge base with main), after is bbbbbbb.",
      "",
      "| Screenshot | Before | After |",
      "| --- | --- | --- |",
      `| \`a--phone--light.png\` | ![before](${imageUrl(base, "a--phone--light.png")}) | ![after](${imageUrl(head, "a--phone--light.png")}) |`,
      `| \`b--phone--light.png\` | ![before](${imageUrl(base, "b--phone--light.png")}) | removed |`,
      `| \`d--phone--light.png\` | new | ![after](${imageUrl(head, "d--phone--light.png")}) |`,
      "",
    ]);
  });

  it('says only "No visual change." when nothing differs', () => {
    expect(screenshotsSection([], base, head)).toBe(
      "## Screenshots\n\nNo visual change.\n",
    );
  });
});

describe("tableForCheckout", () => {
  it("compares the merge base with origin/main to the pushed HEAD", () => {
    const { base, head } = branchWithChanges();
    git(["update-ref", "refs/remotes/origin/topic", head]);
    // main moving on after the branch started does not change the base.
    git(["checkout", "-q", "main"]);
    png("c--phone--light.png", "c2");
    git(["update-ref", "refs/remotes/origin/main", commit("main moves on")]);
    git(["checkout", "-q", "topic"]);
    const section = tableForCheckout(dir);
    expect(section).toContain(imageUrl(base, "a--phone--light.png"));
    expect(section).toContain(imageUrl(head, "d--phone--light.png"));
    expect(section).not.toContain("c--phone--light.png");
  });

  it("refuses an unpushed HEAD", () => {
    branchWithChanges();
    expect(() => tableForCheckout(dir)).toThrow(/on no remote branch/);
  });

  it("refuses uncommitted screenshots", () => {
    const { head } = branchWithChanges();
    git(["update-ref", "refs/remotes/origin/topic", head]);
    png("c--phone--light.png", "c2");
    expect(() => tableForCheckout(dir)).toThrow(/uncommitted changes/);
  });
});
