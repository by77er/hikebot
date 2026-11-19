/**
 * A sentence the bot says in Discord, such as a refusal, shown on the web
 * with the same words and marks: `**Lake**` in bold and `` `2030-06-15` ``
 * as code. Everything else, and everything inside the marks, is text.
 */

const MARKS = /(\*\*.+?\*\*|`[^`]+`)/;

export function BotSentence({ text }: { text: string }) {
  return (
    <>
      {text.split(MARKS).map((part, i) => {
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return part;
      })}
    </>
  );
}
