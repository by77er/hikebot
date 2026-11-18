/**
 * `npm run description:check`: checks the description of the pull request
 * in `$GITHUB_EVENT_PATH`. A pull request that changes `src/web/`, `public/`
 * or `docs/screenshots/` must have a `## Design review` section with text in
 * it, and a `## Screenshots` section that names every PNG it changes under
 * `docs/screenshots/`, or says `No visual change.` when it changes none
 * (`npm run screenshots:table` writes that section). With no pull request
 * event, as on a push to main or a local run, there is nothing to check.
 *
 * The event holds the description as it was when the run started, so a
 * description edited later is checked by the next run, started by a push
 * or by marking the pull request ready again.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gitIn, NO_VISUAL_CHANGE, SCREENSHOTS_DIR, type Git } from "./table";

export const UI_PATHS = ["src/web/", "public/", `${SCREENSHOTS_DIR}/`];

export interface PullRequestEvent {
  pull_request?: {
    number?: number;
    body?: string | null;
    base: { sha: string };
    head: { sha: string };
  };
}

/** The text under each `## ` heading, by the heading's text. */
export function sections(body: string): Map<string, string> {
  const found = new Map<string, string>();
  let heading: string | undefined;
  let lines: string[] = [];
  let fence: string | undefined;
  const close = (): void => {
    if (heading !== undefined && !found.has(heading)) {
      found.set(heading, lines.join("\n").trim());
    }
  };
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === marker ? undefined : (fence ?? marker);
    const title = fence ? undefined : /^##\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (title === undefined) {
      lines.push(line);
      continue;
    }
    close();
    heading = title.toLowerCase();
    lines = [];
  }
  close();
  return found;
}

/**
 * What is wrong with `body` for a pull request that changes `files`, one
 * line per problem; empty when it passes.
 */
export function descriptionProblems(
  body: string | null | undefined,
  files: string[],
): string[] {
  const ui = files.filter((file) =>
    UI_PATHS.some((prefix) => file.startsWith(prefix)),
  );
  if (ui.length === 0) return [];
  const why =
    ui.length === 1
      ? `it changes ${ui.join("")}`
      : `it changes ${String(ui.length)} files under ${UI_PATHS.join(", ")}`;
  const found = sections(body ?? "");
  const problems: string[] = [];
  const review = found.get("design review");
  if (review === undefined) {
    problems.push(
      `The description has no "## Design review" section, which it needs because ${why}. Review the change as "Review your own UI change as a designer" in src/web/AGENTS.md says and write the findings there.`,
    );
  } else if (!review) {
    problems.push(
      `The "## Design review" section is empty. Write each finding with its severity and what was done about it ("Review your own UI change as a designer" in src/web/AGENTS.md).`,
    );
  }
  const screenshots = found.get("screenshots");
  const pngs = ui
    .filter((file) => file.startsWith(`${SCREENSHOTS_DIR}/`))
    .filter((file) => file.endsWith(".png"))
    .map((file) => file.slice(SCREENSHOTS_DIR.length + 1));
  if (screenshots === undefined) {
    problems.push(
      `The description has no "## Screenshots" section, which it needs because ${why}. Paste the output of \`npm run screenshots:table\` ("Describe a UI change in the pull request" in src/web/AGENTS.md).`,
    );
  } else if (pngs.length === 0) {
    if (!screenshots.includes(NO_VISUAL_CHANGE)) {
      problems.push(
        `No screenshot changed, so the "## Screenshots" section must say "${NO_VISUAL_CHANGE}". Paste the output of \`npm run screenshots:table\`.`,
      );
    }
  } else {
    const missing = pngs.filter((file) => !screenshots.includes(file));
    if (missing.length > 0) {
      problems.push(
        `The "## Screenshots" section does not show ${missing.join(", ")}. Run \`npm run screenshots:table\` after your last push and paste its output.`,
      );
    }
  }
  return problems;
}

/** The files a pull request changes, from the merge base to its head. */
export function changedFiles(git: Git, base: string, head: string): string[] {
  for (const commit of [base, head]) {
    try {
      git(["cat-file", "-e", `${commit}^{commit}`]);
    } catch {
      throw new Error(
        `commit ${commit} is not in the checkout; check out with fetch-depth: 0 so the pull request's base and head are both there`,
      );
    }
  }
  const output = git([
    "diff",
    "--name-only",
    "--no-renames",
    `${base}...${head}`,
  ]);
  return output ? output.split("\n") : [];
}

/** Checks the event at `eventPath` in the checkout at `cwd`. */
export function checkEvent(
  eventPath: string | undefined,
  cwd: string,
): { problems: string[]; summary: string } {
  if (!eventPath) {
    return {
      problems: [],
      summary:
        "No pull request event (GITHUB_EVENT_PATH is unset): nothing to check.",
    };
  }
  const event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
  const pr = event.pull_request;
  if (!pr) {
    return {
      problems: [],
      summary: "The event is not a pull request: nothing to check.",
    };
  }
  const files = changedFiles(gitIn(cwd), pr.base.sha, pr.head.sha);
  const problems = descriptionProblems(pr.body, files);
  return {
    problems,
    summary: `Pull request #${String(pr.number ?? "?")}: ${problems.length === 0 ? "the description has what it needs" : "the description is incomplete"}.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { problems, summary } = checkEvent(
      process.env.GITHUB_EVENT_PATH,
      process.cwd(),
    );
    console.log(summary);
    for (const problem of problems) console.log(problem);
    if (problems.length > 0) {
      console.log(
        "The check reads the description as it was when this run started: after fixing it, push, or turn the pull request back into a draft and mark it ready again, to start a new run.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
