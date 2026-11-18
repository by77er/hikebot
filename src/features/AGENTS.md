# Working in src/features

## Add a poll kind to the shared poll UI

The example adds a kind named `date` in `src/features/date-vote.ts`; use
your kind's name and file.

1. Export a `PollWording` for the kind, with its own buttons after Vote in
   `extraButtons` (return `[]` for none) and `showProposer: false` when the
   admin enters the options:

   ```ts
   import type { PollWording } from "./poll-ui";

   export const DATE_POLL: PollWording = {
     kind: "date",
     title: "When should we hike?",
     instructions: "Vote for every date you could make.",
     empty: "No dates yet.",
     noOptions: "There are no dates to vote for yet.",
     noun: "date",
     nouns: "dates",
     name: "date vote",
     showProposer: false,
     extraButtons: () => [],
     announcement: "Hike date decided",
   };
   ```

2. Add it to `POLL_KINDS` in `src/features/index.ts`:

   ```ts
   const POLL_KINDS: PollWordings = {
     location: LOCATION_POLL,
     date: DATE_POLL,
   };
   ```

3. Post the poll message with
   `messageBody(renderPollMessage(poll, DATE_POLL))` in a follow-up and
   record it with `store.setPollMessage(poll.id, channelId, message.id)`, as
   `startLocationVote` in `src/features/location-vote.ts` does. Register the
   kind's own controls in a `registerDateVote(router)` called from
   `registerFeatures`.
4. Check that its poll message stays within Discord's limits by adding a
   case with 25 options at the longest label to `renderPollMessage` in
   `test/features/poll-ui.test.ts`, then run:

   ```sh
   npx vitest run test/features/poll-ui.test.ts
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
