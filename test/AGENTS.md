# Working in test

Put the tests for `src/<dir>/<file>.ts` in `test/<dir>/<file>.test.ts`. These
unit tests run inside the Workers runtime, so imports from `cloudflare:test`
and `cloudflare:workers` work in them. End-to-end scenarios go in `test/e2e/`
and run in Node against the Worker in local workerd; the end-to-end
procedures below cover them.

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

## Run the end-to-end suite

1. Run the suite, with or without a `.dev.vars` in the checkout. It needs no
   credentials and no network beyond localhost, and `npm test` runs it after
   the unit tests.

   ```sh
   npm run test:e2e
   ```

2. To run one file, or only the tests whose name matches a pattern:

   ```sh
   npx vitest run --project e2e test/e2e/probe.test.ts
   npx vitest run --project e2e test/e2e/probe.test.ts -t "429"
   ```

3. When a scenario fails, read the Worker's log timeline printed after the
   failure. A request the fake Discord API refused fails the test with its
   method, route, status and the rule it broke, with a link to the Discord
   docs page that states the rule.
4. Check that no `workerd` process is left:

   ```sh
   pgrep -x workerd || echo "no workerd left"
   ```

   If it prints a process id, stop it with `pkill -x workerd`. A run that was
   killed with `SIGKILL` leaves its `workerd` behind; otherwise find the test
   file whose `afterAll` did not run.

## Find an intermittent test failure

1. If the failure was in CI, read the failed job's log and download the
   run's artifacts:

   ```sh
   gh run view <run-id> --log-failed
   gh run download <run-id> --dir ~/flake-ci
   ```

2. Run `npm test` 15 times in a row, then 15 times with every CPU kept busy,
   keeping each run's full output in a directory outside the checkout. Each
   failed run prints its number:

   ```sh
   mkdir -p ~/flake-$(git rev-parse --short HEAD)/idle ~/flake-$(git rev-parse --short HEAD)/load
   for i in $(seq 1 15); do npm test > ~/flake-$(git rev-parse --short HEAD)/idle/run-$i.log 2>&1 || echo "run $i failed"; done
   for c in $(seq "$(nproc)"); do yes > /dev/null & done
   for i in $(seq 1 15); do npm test > ~/flake-$(git rev-parse --short HEAD)/load/run-$i.log 2>&1 || echo "run $i failed"; done
   pkill -x yes
   pgrep -x workerd || echo "no workerd left"
   ```

3. Count the failed tests over all runs, then read one failed run's
   failures in full:

   ```sh
   sed 's/\x1b\[[0-9;]*m//g' ~/flake-$(git rev-parse --short HEAD)/*/run-*.log | grep "^ FAIL " | sort | uniq -c
   sed 's/\x1b\[[0-9;]*m//g' ~/flake-$(git rev-parse --short HEAD)/idle/run-<n>.log | grep -A20 "Failed Tests"
   ```

   For an end-to-end test, the `debug logs` timeline printed above the
   summary holds what the Worker logged before the failure.

4. If the message does not say why, make a scratch worktree, add temporary
   `console.log` calls along the failing path there, and run steps 2 and 3
   from it. What the Worker logs appears in the `debug logs` timeline; to see
   what the fake Discord API received, put `discord.requests` in the failure
   message:

   ```sh
   git worktree add ~/hikebot-flake HEAD
   cd ~/hikebot-flake && npm ci
   ```

5. Fix the cause in your checkout, delete the scratch worktree, commit the
   fix, and run step 2 again from your checkout, checking that no run
   fails:

   ```sh
   git worktree remove --force ~/hikebot-flake
   ```

## Write an end-to-end scenario

1. Create `test/e2e/<feature>.test.ts` and start the Worker for the file with
   `useE2E()` at the top level. Give each test its own guild id, so it gets a
   fresh `GuildHike`. Import from `./harness/` and `discord-api-types/v10`
   only; ESLint refuses imports from `src/`, so write the text you expect as
   literals. Leave out `{ probe: true }`, which runs the probe Worker for the
   harness self-tests in `test/e2e/probe.test.ts`.

   ```ts
   import { ChannelType } from "discord-api-types/v10";
   import { expect, it } from "vitest";
   import {
     findComponent,
     Member,
     messageText,
     waitForMessage,
   } from "./harness/helpers";
   import { subcommand, type Actor } from "./harness/interactions";
   import { useE2E } from "./harness/worker";

   const e2e = useE2E();

   const admin: Actor = {
     guildId: "200000000000000101",
     channelId: "300000000000000101",
     userId: "400000000000000101",
     roles: ["500000000000000101"],
   };
   ```

2. Set up what Discord holds before anyone acts: the guild and its owner,
   channels and their types, and any failure or rate limit the scenario
   needs:

   ```ts
   it("posts the location vote in the voting channel", async () => {
     e2e.discord.addGuild({ id: admin.guildId ?? "", ownerId: admin.userId });
     e2e.discord.addChannel({ id: admin.channelId, guildId: admin.guildId ?? "" });
     e2e.discord.addChannel({
       id: "300000000000000102",
       guildId: admin.guildId ?? "",
       type: ChannelType.GuildForum,
     });
     // e2e.discord.failChannel("300000000000000102", "missing-permissions");
     // e2e.discord.rateLimitOnce("POST", "/channels/300000000000000101/messages", 0.5);
   ```

3. Act as a member. `Member` sends signed interactions and acts only on
   controls the bot rendered: `click` and `select` read the message as the
   fake stores it, `lastReply()` is the reply to the member's last
   interaction, and `submitModal` fills in the modal the Worker answered
   with. Every answer must arrive within 3 seconds and be one Discord would
   accept, or the test fails:

   ```ts
   const member = new Member(e2e.client, admin);
   const panel = await member.run("hike", [subcommand("admin")]);
   const form = await member.click(member.lastReply(), "hb:round:start");
   await member.submitModal(form, { "hb:round:location": "Ridge" });
   ```

4. Wait for background work (follow-up jobs, alarm edits) through what it
   produces, with `waitForMessage`, `waitForOriginalResponse` or
   `e2e.discord.nextRequest`. Each polls the fake until the condition holds
   and fails with what it found when its timeout passes:

   ```ts
   const vote = await waitForMessage(e2e.discord, admin.channelId, (m) =>
     messageText(m).includes("Location vote"),
   );
   ```

5. Assert on what members see: the message text and its controls.

   ```ts
     expect(messageText(vote)).toContain("Ridge");
     expect(findComponent(vote.components, "hb:poll:vote:1")).toBeDefined();
     expect(panel.type).toBe(4);
   });
   ```

6. Run the file and check that no `workerd` process is left:

   ```sh
   npx vitest run --project e2e test/e2e/<feature>.test.ts
   pgrep -x workerd || echo "no workerd left"
   ```

## Teach the fake Discord API a new route or limit

1. For a new route, add the REST method to `DiscordApi` first, then add the
   route to `route()` in `test/e2e/harness/fake-discord.ts`, before its final
   `notFound`: webhook routes in the `webhook` branch (they take no bot
   token), bot routes after the `Authorization` check. Start a channel route
   with `this.channelGate(channelId)` so configured failures apply, check the
   body with a function from `validate.ts` and answer `invalid(violations)`
   when it breaks a rule, keep what the route creates in the fake's maps, and
   add a reader method (like `threads()`) for tests.
2. For a new limit, find the sentence that states it on Discord's docs
   (`https://docs.discord.com/developers/...`). Add a rule to `RULES` in
   `test/e2e/harness/validate.ts` with an id that names the limit and the
   page URL as `docs`, and quote the sentence in its comment. Check it where
   that payload is validated with `c.fail(RULES.<rule>, path, detail)` or by
   pushing a `Violation`.
3. Add a case to `test/e2e/fake-discord.test.ts`: a payload at the limit is
   accepted and one past it is refused with `expectRefused(reply,
RULES.<rule>)` (or `refuses(RULES.<rule>, response)` for an interaction
   response). The "rule coverage" test fails until every rule has a case.
   For a new route, call it with `call(method, path, body)` and check what
   the fake stored.
4. Run the fake's self-tests, then the whole suite, since a stricter fake can
   fail scenarios whose payloads Discord would also refuse:

   ```sh
   npx vitest run --project e2e test/e2e/fake-discord.test.ts
   npm run test:e2e
   ```
