# Working in src/features

## Add a round action

Use this for anything done to a round (start or close a vote, cancel,
retry), so the panel's handlers, the web pages and the bot's own schedule
call the same function. The example adds `reopenVote`; use your action's
name, input and refusals.

1. In `src/features/round-actions.ts`, write the function. It takes a
   `RoundContext` (`env`, `storage`, `guildId`), the actor's user id and an
   input object, and returns an `ActionOutcome`. Put every rule of the
   action here: return `refuse("<code>", "<the sentence the panel shows>")`
   for each refusal; make the stored change, and claim anything Discord
   will create (see "Let an admin retry a close step from the panel"),
   before the function returns; put the Discord calls in `work`, which
   resolves to the panel's notes. Read the guild from `context.guildId` and
   name the actor in a message with
   `actorName(actor, context.env.DISCORD_APPLICATION_ID)` from
   `./poll-ui`, so the bot acting by itself is named hikebot. Say in the doc
   comment that the caller checks the actor may act:

   ```ts
   export type ReopenVoteCode = "not_closed";

   /**
    * Reopens the closed vote `pollId`. Does not check that the actor is an
    * admin: the caller must.
    */
   export function reopenVote(
     context: RoundContext,
     actor: string,
     input: { pollId: number },
   ): ActionOutcome<ReopenVoteCode, { poll: PollView }> {
     const store = storeOf(context);
     const poll = store.getPoll(input.pollId);
     if (poll?.status !== "closed") {
       return refuse("not_closed", "That vote is not closed.");
     }
     // The stored change, through PollStore, recording `actor`.
     return {
       ok: true,
       poll,
       work: async () => {
         // The Discord calls, through discordApi(context.env).
         return [`The ${poll.kind} vote is open again.`];
       },
     };
   }
   ```

   When the panel asks before acting (a confirmation or a modal), export
   the check as a function of its own that returns the refusal, as
   `closeVoteCheck` and `locationVoteRefusal` do, and call it from both the
   action and the handler that asks.

2. Call it from the button's handler in the feature's file, through
   `adminOnly`, with no rule of the handler's own: read the input from the
   `custom_id` or the modal's fields, and answer with `answerPanel`, which
   redraws the panel with a refusal's sentence, or defers and runs `work` in
   the follow-up:

   ```ts
   const reopen: ComponentHandler = adminOnly((interaction, context) =>
     answerPanel(
       interaction,
       context,
       reopenVote(roundContext(interaction, context), actorOf(interaction), {
         pollId: Number(parseCustomId(interaction.data.custom_id)?.arg),
       }),
     ),
   );
   ```

   A modal's handler passes a fourth argument,
   `(message) => ({ response: ephemeralNotice(message) })`, to answer a
   refusal ephemerally, as `submitStart` in `src/features/date-vote.ts`
   does. A caller without an interaction awaits `work` itself. Add the
   button to the panel as "Add an action to the admin panel" in
   `src/guild/AGENTS.md` says.

3. Test the action with no interaction in
   `test/features/round-actions.test.ts`: inside `inGuild("<unique name>",
(context, store) => ...)`, with `fakeDiscord()` standing in for Discord,
   call it once per refusal and check
   `toEqual({ ok: false, code, message })` and that nothing was stored;
   then call it to succeed, check the stored change before `work` runs,
   await `done(outcome).work()` and check its notes and `discord.sent`.
   Call it once with `APP` as the actor and check the `*_by` column and
   that no message holds `<@${APP}>`. Test the handler through the Worker
   as "Post vote message" in `test/features/poll-ui.test.ts` does, and add
   the click to an end-to-end scenario.
4. Run them:

   ```sh
   npx vitest run test/features/round-actions.test.ts test/features/poll-ui.test.ts
   npm run test:e2e
   ```

## Add a poll kind to the shared poll UI

The example adds a kind named `route` in `src/features/route-vote.ts`; use
your kind's name and file. A new kind needs the poll core changed first:
`PollKind` in `src/polls/store.ts` and the `kind` check of the `polls`
table, through a migration as "Add a column or table for polls" in
`src/polls/AGENTS.md` says. Model the kind on the location vote
(`src/features/location-vote.ts`) or the date vote
(`src/features/date-vote.ts`).

1. Export a `PollWording` for the kind, with its own buttons after Vote in
   `extraButtons` (return `[]` for none), `showProposer: false` when the
   admin enters the options, and `order: "date"` to list options by date
   rather than by votes:

   ```ts
   import type { PollWording } from "./poll-ui";

   export const ROUTE_POLL: PollWording = {
     kind: "route",
     title: () => "Which way up?",
     instructions: "Vote for every route you would take.",
     empty: "No routes yet.",
     noOptions: "There are no routes to vote for yet.",
     noun: "route",
     nouns: "routes",
     name: "route vote",
     showProposer: false,
     order: "votes",
     extraButtons: () => [],
     announcement: "Hike route decided",
     announcementLines: () => [],
     closeSteps: [],
   };
   ```

   To name what the round decided earlier, read it from the round that
   `title` and `announcementLines` receive, as `DATE_POLL` does for the
   location.

2. Add it to what `pollWordings` returns in
   `src/features/round-actions.ts`, which the round actions and the shared
   poll controls read:

   ```ts
   export function pollWordings(): PollWordings {
     return { location: LOCATION_POLL, date: DATE_POLL, route: ROUTE_POLL };
   }
   ```

3. Write the kind's start as a round action, as "Add a round action" below
   says: it opens the poll before it returns, and its `work` posts and
   records the poll message with `claimAndSend(context, poll.id, channelId)`
   and takes the poll back when Discord refuses, as `startDateVote` in
   `src/features/round-actions.ts` does. **Post vote message** then repairs
   a route vote whose message was lost, with no change. Register the kind's
   own controls in a `registerRouteVote(router)` called from
   `registerFeatures`.
4. Check that its poll message stays within Discord's limits by adding a
   case with 25 options at the longest label to the kind's tests, as "stays
   within Discord's limits with 25 dates" in
   `test/features/date-vote.test.ts` does, then run:

   ```sh
   npx vitest run test/features/date-vote.test.ts test/features/poll-ui.test.ts
   ```

## Add a step to the close flow

The example adds a step that posts a note in the voting channel; use your
step's name and work.

1. In the kind's file (`src/features/date-vote.ts` for the date vote),
   write a `CloseStep` (see `src/features/poll-ui.ts`). Return `announce`
   lines for the announcement or a `note` for the panel, and throw on a
   failed Discord call:

   ```ts
   import { discordApi } from "../discord/api";
   import { container, messageBody, textDisplay } from "../discord/components";
   import { GuildConfig } from "../guild/config";
   import type { CloseStep } from "./poll-ui";

   const postNote: CloseStep = {
     name: "post the note",
     run: async ({ poll, guildId }, context) => {
       const channelId = new GuildConfig(context.storage).get().voteChannelId;
       if (channelId === null) return { note: "No voting channel is set." };
       const message = await discordApi(context.env).createMessage(
         channelId,
         messageBody([
           container([textDisplay(`Poll ${String(poll.id)} closed.`)]),
         ]),
       );
       return {
         announce: [
           `[The note](https://discord.com/channels/${guildId}/${channelId}/${message.id})`,
         ],
       };
     },
   };
   ```

   Give it a `name` no other step of the kind has: the close records the
   steps still to do by name (`pending-close:<poll id>`), and a step that
   was cut off half-way by a restart is never run again. If the step
   creates something on Discord, make it claim that in storage before the
   call and give the admin a retry, as "Let an admin retry a close step
   from the panel" says, so a cut-off step shows as not confirmed.

2. Add it to the kind's wording, in the order the steps should run:
   `closeSteps: [postNote]`.
3. Test it the way "runs the kind's close steps after the final edit and
   before the announcement" in `test/features/date-vote.test.ts` does: run
   `(await closePoll(...)).followUp` with `fetch` stubbed (or, with no
   interaction, the `work` of `closeVote` as "closeVote" in
   `test/features/round-actions.test.ts` does), then check the
   order of the requests, the announcement's last lines and the panel's
   notes. Check that the close-flow job runs it when the follow-up was
   lost, as "finishes the flow once when the follow-up never ran" in
   `test/features/close-flow.test.ts` does: close through
   `stub.handleInteraction`, `evictDurableObject`, then
   `runDurableObjectAlarm` and count the requests. Add the step's message
   or link to the end-to-end scenario that closes that vote (for the date
   vote, `test/e2e/full-round.test.ts`).
4. Run them:

   ```sh
   npx vitest run test/features/date-vote.test.ts test/features/close-flow.test.ts
   npx vitest run --project e2e test/e2e/full-round.test.ts
   ```

## Let an admin retry a close step from the panel

The example retries a step that pins the announcement; use your step's name
and work. `src/features/hike-thread.ts` (with `hike-thread-state.ts`) is the
model.

1. Keep where the step stands per round in the object's synchronous
   key-value storage, under a key of its own such as `pin:<round id>`: when
   an attempt started, or why it failed. Write a `pinStatus(storage, round,
now)` that says `"unconfirmed"` for a claim older than a minute (its run
   was cut off, so Discord may or may not have the result), and a
   `claimPin(storage, round, now)` that returns false when the step's
   result is already on the round or a claim younger than a minute exists,
   and otherwise stores `{ creatingSince: now }` and returns true. Read and
   write it with `storage.kv` in one synchronous step, with nothing awaited
   between the check and the write. Take `now` from `store.now()`.
2. In the step and in the retry's round action, claim before calling Discord.
   On success store the result on the round and delete the key; on failure
   store `{ error: reason }`. The step returns no `note` for a failure the
   panel shows by itself.
3. Add the state to `AdminPanelState` in `loadAdminPanelState`, show the
   reason under the last hike (for `"unconfirmed"`, that it may or may not
   exist and to check before clicking), and return the button from
   `actionButtons` only while the round has no result and no fresh claim,
   as "Add an action to the admin panel" in `src/guild/AGENTS.md` says.
4. Write the retry as a round action, `retryPin(context, actor, { roundId })`
   in `src/features/round-actions.ts`, as "Add a round action" says and
   `retryHikeThread` there does: refuse unless the round is still
   `store.getLastRound()`, complete and without the result, refuse a
   refused claim with `refuse("pinning", "<it is being done>")`, claim, and
   do the Discord call in `work`. The button's handler, through `adminOnly`,
   reads the round id from the `custom_id` and answers with `answerPanel`,
   as `createAgain` in `src/features/hike-thread.ts` does.
5. Test the retry with no interaction, as "retryHikeThread" in
   `test/features/round-actions.test.ts` does: each refusal, a second call
   before the first's `work` ran, and the `work`. Test a double click by
   holding the stubbed Discord call until both clicks are answered, as
   "creates one thread when the button is clicked twice quickly" in
   `test/features/hike-thread.test.ts` does, and in an end-to-end scenario
   with two `owner.click` calls in one `Promise.all`.
6. Test a step cut off half-way, as "does not create a cut-off thread
   again" in `test/features/close-flow.test.ts` does: close without the
   follow-up, mark the step started and claimed a few minutes back with
   `startPart` and `claimPin`, run the alarm, check that nothing was
   created, that Refresh shows the step as not confirmed with the button,
   and that the button creates it once. Run them:

   ```sh
   npx vitest run test/features/round-actions.test.ts test/features/hike-thread.test.ts test/features/close-flow.test.ts
   npx vitest run --project e2e test/e2e/hike-thread.test.ts
   ```

## Refresh a poll message after a change

1. After the change is stored, mark the poll for the debounced refresh, with
   the time from the `PollStore` that made the change:

   ```ts
   const store = new PollStore(context.storage);
   store.setVotes(pollId, userId, optionIds);
   await scheduleRefresh(context.storage, pollId, store.now());
   ```

2. To edit a poll message right away instead (a close or cancel, in a
   follow-up job), go through the object's edit queue so an older refresh
   cannot land after it:

   ```ts
   await queuePollEdit(context.storage, () =>
     discordApi(context.env).editMessage(
       channelId,
       messageId,
       messageBody(
         renderPollMessage(
           poll,
           wording,
           store.getRound(poll.roundId),
           context.env.DISCORD_APPLICATION_ID,
         ),
       ),
     ),
   );
   ```

   The last argument names the options the bot entered itself hikebot;
   pass it wherever the poll message is rendered.

3. Test the refresh by running the alarm, as "Test a Durable Object alarm" in
   `test/AGENTS.md` says, then run:

   ```sh
   npx vitest run test/features/poll-ui.test.ts -t "debounced refresh"
   ```
