# Working on hikebot

These procedures apply everywhere in the repository. Run every command from
the repository root unless a step says otherwise.

## Before you change a directory

1. Read this file.
2. Read the `AGENTS.md` of every directory between the root and the files you
   are changing, for example `src/guild/AGENTS.md` before you change
   `src/guild/schema.ts`. Each one holds the procedures for its directory.
3. List the Undercurrent rules that govern each file you will change, then
   read them in the `UNDERCURRENT.md` files the listing names:

   ```sh
   uc explain src/guild/schema.ts
   ```

4. Read the sections of `docs/design.md` that describe the behaviour you are
   changing.

## Set up a checkout

1. Check that Node.js is 22.13 or later:

   ```sh
   node --version
   ```

2. Install the dependencies and create the local secrets file. The example
   values are enough for the tests and for `GET /`:

   ```sh
   npm ci
   cp .dev.vars.example .dev.vars
   ```

3. Install `uc`, the Undercurrent command line, from the latest release of
   `by77er/undercurrent` into `~/.local/bin`. On other platforms replace
   `uc-linux-x86_64` with `uc-linux-aarch64` or `uc-macos-aarch64`:

   ```sh
   mkdir -p ~/.local/bin
   curl -fsSL https://github.com/by77er/undercurrent/releases/latest/download/uc-linux-x86_64.tar.gz | tar -xz -C ~/.local/bin uc
   export PATH="$HOME/.local/bin:$PATH"
   uc --version
   ```

4. Check that the checkout is healthy:

   ```sh
   uc validate
   npm test
   ```

## Run the bot locally

Start the dev server in the background with a time limit, make your
requests, then stop it and check that no `workerd` process is left:

```sh
timeout 300 npm run dev > /tmp/hikebot-dev.log 2>&1 &
DEV_PID=$!
for i in $(seq 60); do curl -fs http://localhost:8787/ && break; sleep 1; done
# make your requests to http://localhost:8787 here
kill "$DEV_PID"; wait "$DEV_PID"
for i in $(seq 10); do pgrep -x workerd > /dev/null || break; sleep 1; done
pkill -x workerd; pgrep -lx workerd || echo "dev server stopped"
```

The loop prints `hikebot is running` once the server answers. If it prints
nothing, read `/tmp/hikebot-dev.log`. On macOS install GNU coreutils
(`brew install coreutils`) and use `gtimeout` in place of `timeout`.

To exercise interactions, write a test that sends a signed interaction, as
`test/AGENTS.md` describes.

## Change wrangler.jsonc

1. Edit `wrangler.jsonc`.
2. Regenerate the Worker's types and check them:

   ```sh
   npm run cf-typegen
   npm run typecheck
   ```

3. Commit `wrangler.jsonc` and `worker-configuration.d.ts` together.

## Add a Worker secret

1. Add the name to `secrets.required` in `wrangler.jsonc`.
2. Add a line with a dummy value to `.dev.vars.example`, and the same line to
   your `.dev.vars`.
3. Add a dummy value to `miniflare.bindings` in `vitest.config.ts`.
4. Add a row for it to the secrets table in `README.md`, saying where to find
   its value.
5. Follow "Change wrangler.jsonc" from step 2, then run `npm test`.

## Check your change before opening a pull request

1. Format, then run Undercurrent against the base branch:

   ```sh
   npm run format
   git fetch origin main
   uc check --base origin/main
   ```

   `uc check` runs every rule that governs a changed file. Fix each
   violation it prints and run it again until it reports `0 violation(s)`.

2. Semantic rules are judged only when `ANTHROPIC_API_KEY` or
   `TYPESAFE_API_KEY` is set. Without one, check them yourself: for each
   changed file, run `uc explain <file>`, read every rule it marks
   `[semantic]` in the file it names, and compare your change with that
   rule's good and bad examples.
3. If `uc` cannot be installed, run the command rules directly:

   ```sh
   npm run format:check && npm run lint && npm run typecheck && npm test
   ```

4. Follow "Record what you learned" below.

## Record what you learned

Do this before opening every pull request. For each thing you had to find
out, decide which kind of knowledge it is and put it in its one place.

### A how-to: a procedure in the AGENTS.md of its directory

1. Pick the directory the procedure applies to: the deepest directory that
   holds every file it touches. A procedure for the whole repository goes in
   this file.
2. Open that directory's `AGENTS.md`, or create it with a first line
   `# Working in <directory>`.
3. Add a `##` heading that names the job ("Add a SQLite migration"), then
   numbered steps with real paths and the exact commands, ending with the
   command that checks the result.
4. Run every command you wrote, as written, from the repository root.
5. Commit it in the same pull request as the code it describes.

Write how to do the job rather than what the code is: the code already says
what it is, and a description of it goes stale.

### A "must not be done": an Undercurrent rule, in a second pull request

Undercurrent rejects a pull request that changes `UNDERCURRENT.md` files
together with any other file, so rules go in a pull request of their own.

1. Pick the rule file: the `UNDERCURRENT.md` of the directory the rule
   governs. A rule applies to files in its file's directory and below. If the
   directory has no rule file, create one whose first paragraph says what the
   rules in it govern.
2. Start a branch from the base branch:

   ```sh
   git fetch origin main
   git checkout -b <branch>-rules origin/main
   ```

3. Write the rule under a `## ` heading that states what must hold. The
   paragraph under it is the message shown when the rule fails: say what to
   do instead. An optional `only: <glob>` line directly under the heading,
   with no blank line between them, limits the rule to file names matching
   the glob.
   - **Command rule**, when a command can detect the problem: add one `sh`
     block. It runs in the rule file's directory. If it mentions `"$FILE"` it
     runs once per changed file, with `$FILE` set to that file's path relative
     to the rule file's directory (for example `./polls/store.ts`); otherwise
     it runs once. A non-zero exit is a violation, so print the file, line and
     what to do instead before failing:

     ````text
     ## Source files have no console.log calls
     only: *.ts

     Remove the `console.log` call, or tell the user in a reply instead.

     ```sh
     ! grep -Hn "console\.log" "$FILE"
     ```
     ````

   - **Semantic rule**, when only a reader can judge it: give no `sh` block.
     Write the prose, then at least one example fenced as `ts good` and one
     fenced as `ts bad`, each a few lines of real-looking code. A model judges
     the rule when `ANTHROPIC_API_KEY` or `TYPESAFE_API_KEY` is set. When the
     rule sets a number (a count or a length), also write a command rule for
     it, because models count unreliably.

4. Check the rule files, then check that the files on the base branch pass
   the new rule:

   ```sh
   uc validate
   uc explain <a file the rule governs>
   uc check --all
   ```

   `uc validate` must report `0 error(s)`, and `uc explain` must list the new
   rule. To see a command rule fail, add a file that breaks it, run
   `uc check --base origin/main`, then delete the file.

5. Commit only `UNDERCURRENT.md` files, push, and open the pull request,
   naming the first pull request in its description. Then add a link to the
   rules pull request to the first pull request's description:

   ```sh
   git add -- '*UNDERCURRENT.md'
   git commit -m "<rule title>"
   git push -u origin HEAD
   gh pr create --base main --title "<rule title>" --body "Rules learned in #<first pull request>."
   gh pr edit <first pull request> --body "<its description, plus: Rules: #<rules pull request>>"
   ```

### A change to what the bot does: docs/design.md

Update the section of `docs/design.md` that describes the behaviour, data
model or architecture you changed, in the same pull request as the code.

### Status and plans: the task board and pull requests

Progress, plans, follow-up work, TODOs, known gaps, and task or pull request
numbers go on the task board and in pull request descriptions. Keep them out
of every file in the repository.
