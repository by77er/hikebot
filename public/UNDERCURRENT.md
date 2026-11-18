These rules govern `public/`, the static files that Workers Static Assets
serves at the same path (`public/assets/app.css` is `/assets/app.css`).
"Web pages" in `docs/design.md` describes how they are served and cached;
"Add a static asset" in `src/web/AGENTS.md` says how to add one.

## Static files live under public/assets/

`public/_headers` makes everything under `/assets/` cacheable for five
minutes, so a deploy that changes a file reaches every browser within five
minutes; a file elsewhere in `public/` gets no such header and could be
served at a path a page route needs. Move the file into `public/assets/` and
link it as `/assets/<name>`. `_headers`, `.assetsignore` and the rule and
procedure files are the only other files here.

```sh
case "$FILE" in
  ./assets/*|./_headers|./.assetsignore|./UNDERCURRENT.md|./AGENTS.md) exit 0 ;;
esac
echo "$FILE is outside public/assets/; move it to public/assets/ and link it as /assets/<name> (\"Add a static asset\" in src/web/AGENTS.md)"
exit 1
```

## Stylesheets load nothing from another host
only: *.css

A stylesheet loads fonts, images and other stylesheets from the Worker's own
origin only, by a root-relative path such as `/assets/hills.svg`. The
Content-Security-Policy blocks other hosts, and a font service or CDN would
learn who opened the page. Copy the file into `public/assets/` and refer to
it by its path.

```sh
perl -ne '
  if (/\@import\s+(url\()?\s*["\x27]?(https?:)?\/\/|url\(\s*["\x27]?(https?:)?\/\//i) {
    print "$ARGV:$.: loads a file from another host; copy it into public/assets/ and refer to it as /assets/<name>\n";
    $bad = 1;
  }
  END { exit($bad ? 1 : 0) }
' "$FILE"
```
