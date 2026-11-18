/**
 * `npm run register`: registers the global slash commands with the
 * credentials in the environment and exits with the result. See
 * `register.ts`.
 */
import { register } from "./register";

process.exitCode = await register(process.env, {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
});
