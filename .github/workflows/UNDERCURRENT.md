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
