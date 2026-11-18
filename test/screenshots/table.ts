/**
 * `npm run screenshots:table`: prints the `## Screenshots` section of a
 * pull request description. It lists each PNG under `docs/screenshots/` that
 * differs between the merge base with `origin/main` and `HEAD`, with the
 * image before and after, each a `raw.githubusercontent.com` URL pinned to
 * the merge-base commit and to the head commit, "new" or "removed" where one
 * side has none, or the single line `No visual change.` when none differs.
 * It refuses to run while `HEAD` is not pushed or `docs/screenshots/` has
 * uncommitted changes, because the images would not match the pull request.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPOSITORY = "by77er/hikebot";
export const SCREENSHOTS_DIR = "docs/screenshots";
export const NO_VISUAL_CHANGE = "No visual change.";

export type Git = (args: string[]) => string;

export interface ScreenshotChange {
  /** The file name inside `docs/screenshots/`. */
  file: string;
  change: "changed" | "new" | "removed";
}

export function gitIn(cwd: string): Git {
  return (args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The PNGs under `docs/screenshots/` that differ from `base` to `head`. */
export function changedScreenshots(
  git: Git,
  base: string,
  head: string,
): ScreenshotChange[] {
  const output = git([
    "diff",
    "--name-status",
    "--no-renames",
    base,
    head,
    "--",
    `${SCREENSHOTS_DIR}/*.png`,
  ]);
  const changes: ScreenshotChange[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [status = "", path = ""] = line.split("\t");
    const file = path.slice(SCREENSHOTS_DIR.length + 1);
    const change =
      status === "A" ? "new" : status === "D" ? "removed" : "changed";
    changes.push({ file, change });
  }
  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

export function imageUrl(commit: string, file: string): string {
  return `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${SCREENSHOTS_DIR}/${file}`;
}

/** The `## Screenshots` section for `changes` from `base` to `head`. */
export function screenshotsSection(
  changes: ScreenshotChange[],
  base: string,
  head: string,
): string {
  const lines = ["## Screenshots", ""];
  if (changes.length === 0) {
    lines.push(NO_VISUAL_CHANGE);
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `Before is ${base.slice(0, 7)} (the merge base with main), after is ${head.slice(0, 7)}.`,
    "",
    "| Screenshot | Before | After |",
    "| --- | --- | --- |",
  );
  for (const { file, change } of changes) {
    const before =
      change === "new" ? "new" : `![before](${imageUrl(base, file)})`;
    const after =
      change === "removed" ? "removed" : `![after](${imageUrl(head, file)})`;
    lines.push(`| \`${file}\` | ${before} | ${after} |`);
  }
  return `${lines.join("\n")}\n`;
}

/** Builds the section for the checkout at `cwd`, against `baseRef`. */
export function tableForCheckout(cwd: string, baseRef = "origin/main"): string {
  const git = gitIn(cwd);
  const head = git(["rev-parse", "HEAD"]);
  const base = git(["merge-base", baseRef, head]);
  const dirty = git([
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    SCREENSHOTS_DIR,
  ]);
  if (dirty) {
    throw new Error(
      `${SCREENSHOTS_DIR}/ has uncommitted changes; commit and push them first:\n${dirty}`,
    );
  }
  const remotes = git([
    "for-each-ref",
    "--format=%(refname:short)",
    "--contains",
    head,
    "refs/remotes",
  ]);
  if (!remotes) {
    throw new Error(
      `HEAD (${head.slice(0, 7)}) is on no remote branch, so its images would not load; push it first (git push), then run this again.`,
    );
  }
  return screenshotsSection(changedScreenshots(git, base, head), base, head);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(tableForCheckout(process.cwd()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
