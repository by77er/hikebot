// Preact's JSX types reference TypeScript's DOM library, whose `Request`,
// `Response` and `crypto` clash with the Workers runtime's types in
// worker-configuration.d.ts. With `libReplacement` on in tsconfig.json,
// TypeScript loads this package for `lib="dom"` instead, so the Worker is
// type-checked against the Workers runtime only.
