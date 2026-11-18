# Rules for the GitHub Actions workflows

These rules govern the workflow files in `.github/workflows/`. Check a change
to them as "Check a workflow change" in the root `AGENTS.md` says.

## Run scripts take expressions through env
only: *.yml

A `run:` script holds no `${{ }}` expression: Actions pastes its value into
the script before the shell parses it, so a commit message, branch name or
secret in it can break or rewrite the command. Put the expression in the
step's `env:` (`TITLE: ${{ github.event.head_commit.message }}`) and use
`"$TITLE"` in the script.

```sh
awk '
  function flag() {
    print FILENAME ":" FNR ": ${{ }} in a run: script. Move the expression to the step env: and use \"$NAME\" in the script."
    bad = 1
  }
  in_run && /[^[:space:]]/ && match($0, /^ */) && RLENGTH <= key_indent { in_run = 0 }
  in_run && /\$\{\{/ { flag() }
  match($0, /^[[:space:]]*(-[[:space:]]+)?run:/) {
    key_indent = RLENGTH - 4
    rest = substr($0, RLENGTH + 1)
    if (rest ~ /^[[:space:]]*[|>]/) in_run = 1
    else if (rest ~ /\$\{\{/) flag()
  }
  END { exit bad }
' "$FILE"
```

## The deploy workflow does not run for pull requests
only: deploy.yml

`deploy.yml` holds the production secrets and deploys to
`https://hiking.bitcru.sh`, so it starts only from a push to `main` (through
the `Undercurrent` run it waits for) or by hand. Remove the `pull_request` or
`pull_request_target` trigger; run checks on pull requests in
`undercurrent.yml` instead.

```sh
! grep -Hn "pull_request" "$FILE"
```

## Pull request jobs do not run on drafts
only: undercurrent.yml

A draft pull request is pushed to many times while it is worked on, so the
`Undercurrent` jobs run only once it is ready for review. Give every job that
runs for pull requests `!github.event.pull_request.draft` in its job-level
`if:` (`github.event_name == 'push' || !github.event.pull_request.draft` for a
job that also runs on a push to `main`), and list the `pull_request` trigger's
types in full, with `ready_for_review` so marking a draft ready starts the
checks and `converted_to_draft` so turning it back into a draft cancels them:
`types: [opened, reopened, synchronize, ready_for_review, converted_to_draft]`.

```sh
awk '
  function indent(s) { match(s, /^ */); return RLENGTH }
  function endjob() {
    if (job != "" && jobif !~ /!github\.event\.pull_request\.draft/ && jobif !~ /^ *(\$\{\{ *)?github\.event_name *== *.push. *(\}\})? *$/) {
      print FILENAME ":" jobline ": job `" job "` runs for pull requests without the draft condition. Add `!github.event.pull_request.draft` to its if: (`github.event_name == '\''push'\'' || !github.event.pull_request.draft` for a job that also runs on push)."
      bad = 1
    }
    job = ""; jobif = ""
  }
  /^[^[:space:]#]/ { if (section == "jobs") endjob(); section = ""; in_pr = 0 }
  /^on:/ { section = "on"; if ($0 ~ /pull_request/ && $0 !~ /pull_request_target/) { pr = 1; prline = FNR } }
  /^jobs:/ { section = "jobs" }
  section == "on" && /^  pull_request:/ { pr = 1; prline = FNR; in_pr = 1; next }
  section == "on" && in_pr && /[^[:space:]]/ && indent($0) <= 2 { in_pr = 0 }
  section == "on" && in_pr && /ready_for_review/ { ready = 1 }
  section == "jobs" && /^  [^[:space:]#][^:]*:/ { endjob(); job = $1; sub(/:$/, "", job); jobline = FNR; in_if = 0; next }
  section == "jobs" && job != "" && /^    if:/ { jobif = $0; sub(/^    if: */, "", jobif); in_if = 1; next }
  section == "jobs" && in_if && /[^[:space:]]/ && indent($0) > 4 { jobif = jobif " " $0; next }
  section == "jobs" && in_if { in_if = 0 }
  END {
    if (section == "jobs") endjob()
    if (pr && !ready) {
      print FILENAME ":" prline ": the pull_request trigger does not list ready_for_review in its types:. List them in full: types: [opened, reopened, synchronize, ready_for_review, converted_to_draft]."
      bad = 1
    }
    exit bad
  }
' "$FILE"
```
