hikebot is a Discord bot on Cloudflare Workers and Durable Objects. These rules
govern the whole repository. Read `docs/design.md` for the design they enforce.

## Files are formatted with Prettier
only: *.{ts,js,json,jsonc,md}

Run `npm run format` and commit the result.

```sh
npx prettier --check "$FILE"
```

## ESLint passes

Fix what ESLint reports instead of disabling the rule.

```sh
npm run lint
```

## Types check

`npm run typecheck` also fails when `worker-configuration.d.ts` is stale; run
`npm run cf-typegen` after changing `wrangler.jsonc`.

```sh
npm run typecheck
```

## The tests pass

A failing test means the change is wrong or the test is out of date; fix
whichever it is. Never delete or skip a test to get past this rule.

```sh
npm test
```

## No Discord SDK
only: package.json

hikebot talks to Discord over plain HTTP with types from `discord-api-types`.
Remove the Discord client library and call the REST API through
`src/discord/api.ts` instead.

```sh
node -e '
const pkg = require("./package.json");
const sdk = /^(discord\.js|discord\.io|discordeno|eris|oceanic\.js|detritus-client|slash-create|@discordjs\/.+|@discordeno\/.+|@sapphire\/.+)$/;
const found = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
  .flatMap((field) => Object.keys(pkg[field] ?? {}))
  .filter((name) => sdk.test(name));
if (found.length > 0) {
  console.error("package.json depends on a Discord client library: " + found.join(", ") + ". Remove it; only discord-api-types is allowed.");
  process.exit(1);
}
'
```

## Bot messages use Components V2 only
only: *.ts

Every message the bot sends or edits, whether an interaction response, a
follow-up, a webhook edit or a REST call, sets the `IS_COMPONENTS_V2` flag
(`32768`, `MessageFlags.IsComponentsV2`) and puts all text in components such
as Text Display. It never sets `content` or `embeds`. Ephemeral replies add
`64` to the flags. Build the payload with Components V2 parts instead of
plain text.

```ts good
return {
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [{ type: ComponentType.TextDisplay, content: "Vote saved." }],
    allowed_mentions: { parse: [] },
  },
};
```

```ts good
await api.editMessage(channelId, messageId, {
  flags: MessageFlags.IsComponentsV2,
  components: [pollContainer(poll)],
  allowed_mentions: { parse: [] },
});
```

```ts bad
return {
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content: "Vote saved.", flags: MessageFlags.Ephemeral },
};
```

```ts bad
await api.createMessage(channelId, {
  embeds: [{ title: "Location vote", description: optionsList }],
});
```

## Bot messages never ping
only: *.ts

Every message the bot sends or edits sets `allowed_mentions: { parse: [] }`,
so a mention in a location name or a role in an announcement never notifies
anyone. Add it to the payload; do not list users or roles to ping.

```ts good
await api.createMessage(announcementsChannelId, {
  flags: MessageFlags.IsComponentsV2,
  components: [resultContainer(result)],
  allowed_mentions: { parse: [] },
});
```

```ts bad
await api.createMessage(announcementsChannelId, {
  flags: MessageFlags.IsComponentsV2,
  components: [resultContainer(result)],
});
```

```ts bad
await api.createMessage(announcementsChannelId, {
  flags: MessageFlags.IsComponentsV2,
  components: [resultContainer(result)],
  allowed_mentions: { parse: ["roles"] },
});
```

## custom_ids follow the hb scheme
only: *.ts

Every `custom_id` on a button, select, modal or modal field is
`hb:<feature>:<action>` with an optional `:<arg>`, for example
`hb:poll:vote:<poll id>`, and handlers register under the matching prefix. Rename an
id that does not fit, and its handler's prefix with it.

```ts good
const vote = {
  type: ComponentType.Button,
  style: ButtonStyle.Primary,
  label: "Vote",
  custom_id: `hb:poll:vote:${poll.id}`,
};
router.component("hb:poll:vote", openVoteSelect);
```

```ts bad
const vote = {
  type: ComponentType.Button,
  style: ButtonStyle.Primary,
  label: "Vote",
  custom_id: `vote_${poll.id}`,
};
```

```ts bad
const modal = {
  custom_id: "proposeLocationModal",
  title: "Propose",
  components,
};
```
