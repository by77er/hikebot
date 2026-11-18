These rules govern the end-to-end harness under `test/e2e/harness/`: the fake
Discord API, the rules it enforces, and the code that starts the Worker.

## Every rule the fake enforces cites where Discord states it
only: validate.ts

Each entry of `RULES` in `validate.ts` is `<name>: rule("<id>", <docs>)`
directly under a `/** … */` comment that quotes the sentence stating the
limit, and `<docs>` is the URL of the page that sentence is on: a URL
constant of this file or a string literal, under
`https://docs.discord.com/developers/`. A limit written from memory, with no
source, makes the fake refuse payloads Discord accepts or accept ones it
refuses. Find the sentence on Discord's docs, quote it and link its page, as
"Teach the fake Discord API a new route or limit" in `test/AGENTS.md` says.
Only when Discord's own pages do not state a limit that its API enforces may
`<docs>` point elsewhere, and then the comment says so in those words
("Discord's own pages do not state this").

```sh
perl -0777 -ne '
  our %const;
  while (/^const\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;]+);/mg) {
    (my $value = $2) =~ s/^\s+|\s+$//g;
    $const{$1} = $value;
  }
  our $depth = 0;
  sub url {
    my ($e) = @_;
    $e =~ s/^\s+|\s+$//g;
    return "" if ++$depth > 10;
    my $url = "";
    if ($e =~ /^"([^"]*)"$/) { $url = $1 }
    elsif ($e =~ /^`([^`]*)`$/) {
      $url = $1;
      $url =~ s/\$\{([A-Z][A-Z0-9_]*)\}/defined $const{$1} ? url($const{$1}) : "\x00"/ge;
      $url = "" if $url =~ /\x00|\$\{/;
    }
    elsif ($e =~ /^([A-Z][A-Z0-9_]*)$/ && defined $const{$1}) { $url = url($const{$1}) }
    $depth--;
    return $url;
  }
  my $fix = "quote the sentence that states the limit in a /** */ comment directly above the entry and give the URL of its page under https://docs.discord.com/developers/ as docs (\"Teach the fake Discord API a new route or limit\" in test/AGENTS.md)";
  unless (/^export const RULES = \{\n(.*?)^\} as const;/ms) {
    print "$ARGV:1: no `export const RULES = { ... } as const;` block found; keep the rules in it, each $fix\n";
    exit 1;
  }
  my ($block, $offset) = ($1, $-[1]);
  my $bad = 0;
  while ($block =~ /^  ([\w\$]+)\s*:/mg) {
    my ($name, $at) = ($1, $-[0]);
    my $line = 1 + (substr($_, 0, $offset + $at) =~ tr/\n//);
    my $rest = substr($block, $at);
    my ($comment) = substr($block, 0, $at) =~ m{/\*\*((?:(?!\*/).)*)\*/\s*\z}s;
    $comment =~ s/\n\s*\*?\s*/ /g if defined $comment;
    if (!defined $comment || $comment !~ /\w/) {
      print "$ARGV:$line: RULES.$name has no /** */ comment; $fix\n";
      $bad = 1;
    }
    unless ($rest =~ /\A\s*\Q$name\E\s*:\s*rule\(\s*"[^"]+"\s*,\s*([^,()]+?)\s*,?\s*\)\s*,/) {
      print "$ARGV:$line: RULES.$name is not rule(\"<id>\", <docs URL>); $fix\n";
      $bad = 1;
      next;
    }
    my $url = url($1);
    next if $url =~ m{^https://docs\.discord\.com/developers/};
    if ($url !~ m{^https://}) {
      print "$ARGV:$line: RULES.$name docs is not a URL constant or literal of this file; $fix\n";
      $bad = 1;
    } elsif (!defined $comment || $comment !~ /Discord\x27s own (?:docs|pages) (?:do|does) not state/) {
      print "$ARGV:$line: RULES.$name cites $url, outside Discord\x27s docs; link the page under https://docs.discord.com/developers/ that states the limit, or, if none does, say \"Discord\x27s own pages do not state\" it in the comment\n";
      $bad = 1;
    }
  }
  exit $bad;
' "$FILE"
```
