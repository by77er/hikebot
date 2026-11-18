import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkEvent,
  descriptionProblems,
  sections,
  type PullRequestEvent,
} from "./description";
import { gitIn, type Git } from "./table";

const EVENTS = fileURLToPath(new URL("./events/", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./description.ts", import.meta.url));

function savedBody(name: string): string {
  const event = JSON.parse(
    readFileSync(join(EVENTS, name), "utf8"),
  ) as PullRequestEvent;
  return event.pull_request?.body ?? "";
}

const TWO_PNGS = [
  "public/assets/app.css",
  "docs/screenshots/home--phone--light.png",
  "docs/screenshots/home--phone--dark.png",
];

describe("descriptionProblems on saved pull request events", () => {
  it("fails a description with no Design review section", () => {
    const problems = descriptionProblems(
      savedBody("missing-design-review.json"),
      TWO_PNGS,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no "## Design review" section/);
  });

  it("fails a Screenshots section that leaves out a changed PNG", () => {
    const problems = descriptionProblems(
      savedBody("missing-screenshot.json"),
      TWO_PNGS,
    );
    expect(problems).toEqual([
      expect.stringMatching(/does not show home--phone--dark\.png\./),
    ]);
  });

  it("passes a complete description", () => {
    expect(descriptionProblems(savedBody("complete.json"), TWO_PNGS)).toEqual(
      [],
    );
  });

  it('passes "No visual change." when no PNG changed', () => {
    const body = savedBody("no-visual-change.json");
    expect(descriptionProblems(body, ["src/web/layout.tsx"])).toEqual([]);
    expect(descriptionProblems(body, TWO_PNGS)).toEqual([
      expect.stringMatching(
        /does not show home--phone--light\.png, home--phone--dark\.png/,
      ),
    ]);
  });

  it('fails a Screenshots section without "No visual change." when none changed', () => {
    const body = savedBody("missing-screenshot.json");
    expect(descriptionProblems(body, ["public/assets/app.css"])).toEqual([
      expect.stringMatching(/must say "No visual change\."/),
    ]);
  });

  it("fails an empty or missing description", () => {
    for (const body of [null, ""]) {
      expect(descriptionProblems(body, ["src/web/layout.tsx"])).toEqual([
        expect.stringMatching(/no "## Design review" section/),
        expect.stringMatching(/no "## Screenshots" section/),
      ]);
    }
  });

  it("fails an empty Design review section", () => {
    const body = "## Design review\n\n## Screenshots\n\nNo visual change.\n";
    expect(descriptionProblems(body, ["src/web/layout.tsx"])).toEqual([
      expect.stringMatching(/"## Design review" section is empty/),
    ]);
  });

  it("asks nothing of a pull request that changes no web UI file", () => {
    expect(
      descriptionProblems("", ["src/polls/store.ts", "docs/design.md"]),
    ).toEqual([]);
  });
});

describe("sections", () => {
  it("reads level-two headings only, outside code fences", () => {
    const found = sections(
      "intro\n## Design review\n- **nit**: x\n### Detail\ny\n```md\n## Screenshots\n```\n## Screenshots ##\nNo visual change.\n",
    );
    expect([...found.keys()]).toEqual(["design review", "screenshots"]);
    expect(found.get("design review")).toBe(
      "- **nit**: x\n### Detail\ny\n```md\n## Screenshots\n```",
    );
    expect(found.get("screenshots")).toBe("No visual change.");
  });
});

describe("checkEvent", () => {
  let dir: string;
  let git: Git;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hikebot-description-"));
    git = gitIn(dir);
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.com"]);
    mkdirSync(join(dir, "docs/screenshots"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A pull request event whose head changes one screenshot. */
  function eventFile(body: string): string {
    writeFileSync(join(dir, "docs/screenshots/home--phone--light.png"), "1");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    const base = git(["rev-parse", "HEAD"]);
    writeFileSync(join(dir, "docs/screenshots/home--phone--light.png"), "2");
    git(["commit", "-q", "-am", "head"]);
    const head = git(["rev-parse", "HEAD"]);
    const path = join(dir, "event.json");
    const event = {
      pull_request: {
        number: 7,
        body,
        base: { sha: base },
        head: { sha: head },
      },
    };
    writeFileSync(path, JSON.stringify(event));
    return path;
  }

  it("passes with no event, and with an event that is not a pull request", () => {
    expect(checkEvent(undefined, dir).problems).toEqual([]);
    expect(checkEvent(join(EVENTS, "push.json"), dir)).toEqual({
      problems: [],
      summary: "The event is not a pull request: nothing to check.",
    });
  });

  it("checks the description against the files the pull request changes", () => {
    const failing = checkEvent(
      eventFile("## Screenshots\n\nNo visual change."),
      dir,
    );
    expect(failing.problems).toEqual([
      expect.stringMatching(/no "## Design review" section/),
      expect.stringMatching(/does not show home--phone--light\.png/),
    ]);
  });

  it("says how to fetch when the base commit is missing", () => {
    expect(() => checkEvent(join(EVENTS, "complete.json"), dir)).toThrow(
      /fetch-depth: 0/,
    );
  });

  it("exits 1 with the problems, and 0 with no event, from the command line", () => {
    const run = (env: Record<string, string>) =>
      spawnSync(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), SCRIPT],
        {
          cwd: dir,
          encoding: "utf8",
          env: { PATH: process.env.PATH ?? "", ...env },
        },
      );
    const none = run({});
    expect(none.status).toBe(0);
    expect(none.stdout).toContain("nothing to check");
    const path = eventFile("");
    const failing = run({ GITHUB_EVENT_PATH: path });
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain('no "## Design review" section');
    const event = JSON.parse(readFileSync(path, "utf8")) as PullRequestEvent;
    if (event.pull_request) {
      event.pull_request.body =
        "## Design review\n\n- **nit**: none found.\n\n## Screenshots\n\n| `home--phone--light.png` | ... |\n";
    }
    writeFileSync(path, JSON.stringify(event));
    const passing = run({ GITHUB_EVENT_PATH: path });
    expect(passing.stdout).toContain("the description has what it needs");
    expect(passing.status).toBe(0);
  });
});
