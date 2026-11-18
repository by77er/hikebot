# Working in src/guild

The examples use a feature named `trail`; replace it with your feature's name
(lowercase letters, digits and dashes).

## Add a slash command handler

1. Pick a command name that no line in `registerFeatures`
   (`src/features/index.ts`) registers yet, and that no test in
   `test/guild/guild-hike.test.ts` registers on the router (registering a
   name twice throws when the object starts):

   ```sh
   grep -rn 'command("' src/features test/guild
   ```

2. In `src/features/trail.ts` (create it if needed), export the handler. It
   receives the interaction and a `HandlerContext` (`env`, `storage`) and
   returns `{ response }`:

   ```ts
   import {
     container,
     ephemeralReply,
     textDisplay,
   } from "../discord/components";
   import type { CommandHandler } from "../guild/router";

   export const trailCommand: CommandHandler = (interaction) => ({
     response: ephemeralReply([
       container([textDisplay(`You ran /${interaction.data.name}`)]),
     ]),
   });
   ```

3. Register it with one line in `registerFeatures` in
   `src/features/index.ts`, before `return router;`, and import it at the top
   of that file:

   ```ts
   router.command("trail", trailCommand);
   ```

4. Write a test that sends the command through the Worker, following "Write
   a test that sends a signed interaction" in `test/AGENTS.md`, using
   `commandInteraction("trail", "<guild id>")`.
5. Run `npx vitest run test/features/trail.test.ts`.

## Add a component handler (button or select)

1. Pick an action name and check that no `registerFeatures` line or test
   already registers `hb:trail:<action>`:

   ```sh
   grep -rn 'component("hb:' src/features test/guild
   ```

2. Build the component with an id from `customId(feature, action, arg?)`,
   where `arg` carries whatever the handler needs to find its data:

   ```ts
   actionRow(
     button({
       custom_id: customId("trail", "pick", String(trailId)),
       label: "Pick",
     }),
   );
   ```

3. In `src/features/trail.ts`, export the handler. Read the arg back with
   `parseCustomId`, and answer with `update([...])` to replace the message
   the component was on, or `ephemeralReply([...])` to answer only the
   member:

   ```ts
   import { parseCustomId, textDisplay, update } from "../discord/components";
   import type { ComponentHandler } from "../guild/router";

   export const pickTrail: ComponentHandler = (interaction) => {
     const trailId = parseCustomId(interaction.data.custom_id)?.arg;
     return { response: update([textDisplay(`Picked ${trailId ?? "?"}`)]) };
   };
   ```

4. Register it under the prefix without the arg, in `registerFeatures`:

   ```ts
   router.component("hb:trail:pick", pickTrail);
   ```

5. Test it through the Worker with
   `componentInteraction("hb:trail:pick:7", "<guild id>")`, then run
   `npx vitest run test/features/trail.test.ts`.

## Add an action to the admin panel

1. Add the button to `actionButtons` in `src/features/admin-panel.ts`,
   before Settings, with an id from `customId("<feature>", "<action>")`.
   Return it only in the states where the action makes sense (read them
   from `AdminPanelState`; add what you need to `AdminPanelState` and
   `loadAdminPanelState`). Keep the status view within 40 components and
   4000 characters.
2. Write the handler in `src/features/<feature>.ts` and wrap it in
   `adminOnly`, so non-admins who replay the `custom_id` are refused. Answer
   with `adminPanelUpdate(context, "<what happened>")` to redraw the status
   view in place:

   ```ts
   import { adminPanelUpdate } from "./admin-panel";
   import { adminOnly } from "../guild/permissions";
   import type { ComponentHandler } from "../guild/router";

   export const startTrail: ComponentHandler = adminOnly((_i, context) =>
     adminPanelUpdate(context, "Trail vote started."),
   );
   ```

3. Register it in `registerFeatures`:
   `router.component("hb:trail:start", startTrail);`.
4. In `test/features/admin-panel.test.ts`, add the button's id to the
   status view test of the state that shows it and to the "refuses a
   non-admin replaying" list; test the handler in
   `test/features/<feature>.test.ts`. Add the click to an end-to-end
   scenario with `owner.click(panel, "hb:trail:start")`.
5. Run them:

   ```sh
   npx vitest run test/features/admin-panel.test.ts
   npx vitest run --project e2e test/e2e/admin-panel.test.ts
   ```

## Add a modal and its submit handler

1. Pick an action name and check that no `registerFeatures` line or test
   already registers `hb:trail:<action>` as a modal:

   ```sh
   grep -rn 'modal("hb:' src/features test/guild
   ```

2. Open the modal from a command or component handler. Each field is a
   `label` around an input whose `custom_id` comes from `customId`:

   ```ts
   return {
     response: modal(customId("trail", "propose"), "Propose a trail", [
       label("Name", textInput({ custom_id: customId("trail", "name") })),
     ]),
   };
   ```

3. In `src/features/trail.ts`, export the submit handler. Read each field
   with `textInputValue(interaction.data, id)` (or `selectValues` for a
   select), using the same `customId` call as the field:

   ```ts
   import {
     customId,
     ephemeralReply,
     textDisplay,
     textInputValue,
   } from "../discord/components";
   import type { ModalHandler } from "../guild/router";

   export const saveTrail: ModalHandler = (interaction, context) => {
     const name =
       textInputValue(interaction.data, customId("trail", "name")) ?? "";
     context.storage.sql.exec("INSERT INTO trails (name) VALUES (?)", name);
     return { response: ephemeralReply([textDisplay(`Saved ${name}`)]) };
   };
   ```

4. Register it under the modal's `custom_id`, in `registerFeatures`:

   ```ts
   router.modal("hb:trail:propose", saveTrail);
   ```

5. Test it through the Worker with a modal interaction that carries the
   field values (see "Write a test that sends a signed interaction" in
   `test/AGENTS.md`), then run `npx vitest run test/features/trail.test.ts`.

## Give a handler a follow-up job

Use a follow-up when the work needs more than one Discord REST call or may
take longer than Discord's 3-second window.

1. Write everything that must survive to `context.storage` before the
   handler returns. The follow-up runs after the response is sent and is
   lost if the object restarts in between.
2. Return a deferred response and a `followUp` function that finishes the
   work and replaces the deferred response. From a component, return
   `deferredUpdate()` in place of `deferredReply(...)`:

   ```ts
   import { discordApi } from "../discord/api";
   import {
     deferredReply,
     messageBody,
     textDisplay,
   } from "../discord/components";
   import type { CommandHandler } from "../guild/router";

   export const announceTrail: CommandHandler = (interaction, context) => ({
     response: deferredReply({ ephemeral: true }),
     followUp: async () => {
       const api = discordApi(context.env);
       await api.editOriginalInteractionResponse(
         interaction.application_id,
         interaction.token,
         messageBody([textDisplay("Announced")]),
       );
     },
   });
   ```

3. Test it with "Test a follow-up job" in `test/AGENTS.md`.

## Add a scheduled job

Use a scheduled job for work due at a later time, or again and again, that
must survive a restart of the object. It runs from the object's alarm.

1. Pick a job name `trail:<action>` and check that no `registerFeatures` line
   or test registers it yet (registering a name twice throws when the object
   starts):

   ```sh
   grep -rnE 'job\(|_JOB = ' src/features test/guild
   ```

2. Keep what the job needs in `context.storage`, written before you schedule
   it: the job gets the `HandlerContext` and no arguments. In
   `src/features/trail.ts`, export the job. A job that throws is logged with
   its name and not retried; to try again later, schedule it again:

   ```ts
   import type { JobHandler } from "../guild/router";
   import { schedule } from "../guild/schedule";
   import { PollStore } from "../polls/store";

   export const remindTrail: JobHandler = async (context) => {
     const store = new PollStore(context.storage);
     // ...the work...
     await schedule(context.storage, "trail:remind", store.now() + 3_600_000);
   };
   ```

3. Register it with one line in `registerFeatures` in
   `src/features/index.ts`, and import it at the top of that file:

   ```ts
   router.job("trail:remind", remindTrail);
   ```

4. Schedule it from a handler, a follow-up or another job, with the time from
   the store's clock. If it is already scheduled, the earlier time is kept:

   ```ts
   await schedule(context.storage, "trail:remind", store.now() + 60_000);
   ```

5. Test it by running the alarm, as "Test a Durable Object alarm" in
   `test/AGENTS.md` says, in `test/features/trail.test.ts`, then run it and
   the scheduler's tests:

   ```sh
   npx vitest run test/features/trail.test.ts test/guild/schedule.test.ts
   ```

## Add a SQLite migration

1. Append a migration to the end of `migrations` in `src/guild/schema.ts`,
   numbered one past the last entry. To change a table an earlier migration
   created, append a migration that runs `ALTER TABLE`:

   ```ts
   {
     name: "0002_trails",
     sql: "CREATE TABLE trails (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
   },
   ```

   The schema tests create a scratch table named `notes`; pick another name.

2. In `test/guild/schema.test.ts`, add a test inside `describe("migrations")`
   that checks your table or column on a fresh object and that its rows
   survive a restart. The existing tests compare `_migrations` against the
   list in `src/guild/schema.ts`, so they need no change:

   ```ts
   it("create the trails table and keep its rows across restarts", async () => {
     const stub = stubFor("schema-trails");
     await runInDurableObject(stub, (_instance, state) => {
       state.storage.sql.exec("INSERT INTO trails (name) VALUES ('Ridge')");
     });
     await evictDurableObject(stub);
     await runInDurableObject(stub, (_instance, state) => {
       expect(appliedNames(state.storage)).toEqual(shipped);
       expect(
         state.storage.sql
           .exec<{ n: number }>("SELECT count(*) AS n FROM trails")
           .one().n,
       ).toBe(1);
     });
   });
   ```

3. If the migration changes the data model, update the matching section of
   `docs/design.md`.
4. Run the schema tests, then the whole suite:

   ```sh
   npx vitest run test/guild/schema.test.ts
   npm test
   ```
