/** A file's text, as Vite's `?raw` import suffix gives it. */
declare module "*?raw" {
  const source: string;
  export default source;
}
