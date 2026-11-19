/**
 * A sentence the bot says in Discord, such as a refusal, shown on the web
 * with the same words and marks: `**Lake**` in bold and `` `2030-06-15` ``
 * as code. Everything else, and everything inside the marks, is text.
 */

/** A backtick, which opens and closes the bot's code marks. */
const TICK = "\x60";

const MARKS = /(\*\*.+?\*\*|\x60[^\x60]+\x60)/;

export function BotSentence({ text }: { text: string }) {
  return (
    <>
      {text.split(MARKS).map((part, i) => {
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.length > 2 && part.startsWith(TICK) && part.endsWith(TICK)) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return part;
      })}
    </>
  );
}
