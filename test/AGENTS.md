# Working in test

Put the tests for `src/<dir>/<file>.ts` in `test/<dir>/<file>.test.ts`. Every
test runs inside the Workers runtime, so imports from `cloudflare:test` and
`cloudflare:workers` work in any test file.

## Run one test file

```sh
npx vitest run test/guild/router.test.ts
```

To run only the tests whose name matches a pattern, add `-t`:

```sh
npx vitest run test/guild/router.test.ts -t "custom_id prefix"
```

Run `npm test` for the whole suite before opening a pull request.

## Write a test that sends a signed interaction

1. Create a signing key once per file, and give each test its own guild id
   so it gets a fresh `GuildHike` object:

   ```ts
   import { beforeAll, describe, expect, it } from "vitest";
   import { textDisplay, update } from "../../src/discord/components";
   import {
     callWorker,
     componentInteraction,
     createSigner,
     signedRequest,
     type Signer,
   } from "../helpers";

   let signer: Signer;
   beforeAll(async () => {
     signer = await createSigner();
   });
   ```

2. Build the interaction with `commandInteraction(name, guildId)`,
   `componentInteraction(customId, guildId)` or
   `modalInteraction(customId, guildId)` from `test/helpers.ts`, sign it with
   `signedRequest`, and send it with `callWorker`, which binds the signer's
   public key as `DISCORD_PUBLIC_KEY`:

   ```ts
   it("replaces the message when a trail is picked", async () => {
     const response = await callWorker(
       signer,
       await signedRequest(
         signer,
         componentInteraction("hb:trail:pick:7", "5001"),
       ),
     );
     expect(response.status).toBe(200);
     expect(await response.json()).toEqual(update([textDisplay("Picked 7")]));
   });
   ```

   Build the expected response with the same builders from
   `src/discord/components.ts` that the handler uses.

3. For a modal submit, put the field values on the interaction before
   signing it. Each field is a Label (type 18) around the input:

   ```ts
   const interaction = modalInteraction("hb:trail:propose", "5002");
   Object.assign(interaction.data, {
     components: [
       {
         type: ComponentType.Label,
         component: {
           type: ComponentType.TextInput,
           custom_id: "hb:trail:name",
           value: "Ridge",
         },
       },
     ],
   });
   ```

   Import `ComponentType` from `discord-api-types/v10`.

4. Run the file: `npx vitest run test/features/trail.test.ts`.

## Test a follow-up job

1. Replace `fetch` with a spy that builds a new `Response` on every call (a
   `Response` created in the test cannot be read inside the Durable Object),
   and restore it after each test:

   ```ts
   import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
   import { afterEach, expect, it, vi } from "vitest";

   afterEach(() => {
     vi.restoreAllMocks();
   });

   it("edits the deferred reply", async () => {
     const fetchSpy = vi
       .spyOn(globalThis, "fetch")
       .mockImplementation(() => Promise.resolve(Response.json({ id: "1" })));
   ```

2. Send the interaction with your own execution context, check the
   immediate response, then wait for the follow-up through
   `waitOnExecutionContext` and check the requests it made:

   ```ts
     const ctx = createExecutionContext();
     const response = await callWorker(
       signer,
       await signedRequest(signer, commandInteraction("trail-announce", "5003")),
       ctx,
     );
     expect(await response.json()).toEqual(deferredReply({ ephemeral: true }));
     await waitOnExecutionContext(ctx);
     const [input, init] = fetchSpy.mock.calls[0] ?? [];
     const request = new Request(input ?? "", init);
     expect(request.method).toBe("PATCH");
     expect(request.url).toMatch(/\/webhooks\/100\/interaction-token\/messages\/@original$/);
   });
   ```

   `100` and `interaction-token` are the application id and token every
   interaction from `test/helpers.ts` carries.

3. To test the order of events without Discord, register a handler on the
   object's router from the test instead, as "follow-up jobs" in
   `test/guild/guild-hike.test.ts` does.

## Write a test against Durable Object storage

1. Get a stub for a fresh object by giving it a name no other test uses:

   ```ts
   import { evictDurableObject, runInDurableObject } from "cloudflare:test";
   import { env } from "cloudflare:workers";

   const stub = env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName("trails-restart"));
   ```

2. Run code inside the object with `runInDurableObject`. Its callback gets
   the `GuildHike` instance and its state; `state.storage.sql` is the
   object's SQLite database, with every migration already applied:

   ```ts
   await runInDurableObject(stub, (_instance, state) => {
     state.storage.sql.exec("INSERT INTO trails (name) VALUES ('Ridge')");
   });
   ```

3. To check that data survives a restart, call `evictDurableObject(stub)`
   and read it back in a second `runInDurableObject`:

   ```ts
   await evictDurableObject(stub);
   const names = await runInDurableObject(stub, (_instance, state) =>
     state.storage.sql
       .exec<{ name: string }>("SELECT name FROM trails")
       .toArray()
       .map((row) => row.name),
   );
   expect(names).toEqual(["Ridge"]);
   ```

4. To check what a handler stored, send the interaction through the Worker
   first, then read the storage of the object for that guild:
   `env.GUILD_HIKE.get(env.GUILD_HIKE.idFromName("<guild id>"))`.
5. For poll operations, use `withStore` from `test/polls/helpers.ts`, as
   "Test an operation against Durable Object storage" in
   `src/polls/AGENTS.md` describes.
6. Run the file: `npx vitest run test/<dir>/<file>.test.ts`.
