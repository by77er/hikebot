These rules govern the features under `src/features/`: the admin panel, the
poll kinds and the shared poll UI, and the hike thread.

## A panel button that creates something on Discord claims it before answering
only: *.ts

A button that creates a Discord thread, message or anything else that must
exist once (such as Create hike thread) can be clicked twice before the
first click's follow-up finishes, from two panels or by a double click. In
the handler, before returning the response, check in the object's storage
that the thing does not exist yet and that no creation is in progress, and
record the claim in the same synchronous step, with `storage.kv` (or one
SQL statement), with nothing awaited between the check and the write.
Then do the Discord call in the `followUp`, store the result and drop the
claim. A claim older than the follow-up can take counts as lost. Follow
"Let an admin retry a close step from the panel" in `src/features/AGENTS.md`.

```ts good
const retryPin: ComponentHandler = adminOnly((interaction, context) => {
  const store = new PollStore(context.storage);
  const round = store.getLastRound();
  if (round === null || !claimPin(context.storage, round, store.now())) {
    return adminPanelUpdate(context, "The announcement is being pinned.");
  }
  return {
    response: deferPanel(interaction),
    followUp: async () => {
      await pinAnnouncement(round, context);
      await finishPanel(context, interaction, "Pinned.");
    },
  };
});
```

```ts bad
const retryPin: ComponentHandler = adminOnly((interaction, context) => {
  const round = new PollStore(context.storage).getLastRound();
  if (round === null || round.pinnedId !== null) {
    return adminPanelUpdate(context, "Already pinned.");
  }
  return {
    response: deferPanel(interaction),
    followUp: async () => {
      // A second click answered before this finishes pins it again.
      await pinAnnouncement(round, context);
      await finishPanel(context, interaction, "Pinned.");
    },
  };
});
```
