# Working in src/features

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

2. Add it to `POLL_KINDS` in `src/features/index.ts`:

   ```ts
   const POLL_KINDS: PollWordings = {
     location: LOCATION_POLL,
     date: DATE_POLL,
     route: ROUTE_POLL,
   };
   ```

3. Post the poll message with
   `messageBody(renderPollMessage(poll, ROUTE_POLL, store.getRound(poll.roundId)))`
   in a follow-up and record it with
   `store.setPollMessage(poll.id, channelId, message.id)`, as
   `startDateVote` in `src/features/date-vote.ts` does. Register the kind's
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
   write the step. `run` gets the closed poll, its round and the guild id,
   and returns lines for the announcement and an optional note for the
   panel. Throw on a failed Discord call; the close flow names the step in
   the panel with the error and still posts the announcement:

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

2. Add it to the kind's wording, in the order the steps should run:
   `closeSteps: [postNote]`.
3. Test it the way "runs the kind's close steps after the final edit and
   before the announcement" in `test/features/date-vote.test.ts` does: run
   `closePoll(...).followUp` with `fetch` stubbed, then check the order of
   the requests, the announcement's last lines and the panel's notes. Add
   the step's message or link to the end-to-end scenario that closes that
   vote (for the date vote, `test/e2e/full-round.test.ts`).
4. Run them:

   ```sh
   npx vitest run test/features/date-vote.test.ts
   npx vitest run --project e2e test/e2e/full-round.test.ts
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
       messageBody(renderPollMessage(poll, wording)),
     ),
   );
   ```

3. Test the refresh by running the alarm, as "Test a Durable Object alarm" in
   `test/AGENTS.md` says, then run:

   ```sh
   npx vitest run test/features/poll-ui.test.ts -t "debounced refresh"
   ```
