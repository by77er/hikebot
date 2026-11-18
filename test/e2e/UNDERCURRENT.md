These rules govern the end-to-end suite under `test/e2e/`: the scenarios, the
harness that runs the Worker in local workerd next to a fake Discord API, and
the probe Worker for the harness self-tests.

## End-to-end tests do not import from src/
only: *.ts

A scenario reaches the Worker only through signed HTTP requests, so it tests
the bundle Discord talks to and not the modules behind it. Build what the
test needs in `test/e2e/harness/`, import from `./harness/` and
`discord-api-types/v10` only, and write the text you expect as literals,
following "Write an end-to-end scenario" in `test/AGENTS.md`. The probe
Worker under `test/e2e/probe/` is Worker code and builds on `src/`; this rule
does not apply to it.

```sh
case "$FILE" in ./probe/*) exit 0 ;; esac
perl -0777 -ne '
  while (/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["\x27`])([^"\x27`\n]*)\1/g) {
    my ($spec, $at) = ($2, $-[0]);
    next unless $spec =~ m{(?:^|/)src(?:/|$)};
    my $line = 1 + (substr($_, 0, $at) =~ tr/\n//);
    print "$ARGV:$line: imports \"$spec\" from src/; reach the Worker over HTTP with useE2E, build what the test needs in test/e2e/harness/, and write expected text as literals (\"Write an end-to-end scenario\" in test/AGENTS.md)\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```
