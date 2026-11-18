These rules govern the Worker's source. They come from building the Discord
REST client in `src/discord/api.ts`; `src/discord/AGENTS.md` says how to use
it.

## Interaction tokens never appear in errors or logs
only: *.ts

An interaction token lets anyone who holds it edit the bot's reply and send
follow-ups for 15 minutes. Wherever an error message, a thrown error's
fields or a log line names a webhook route or URL, write `:token` in place of
the token, as `DiscordApiError.route` does, and log the interaction's `id`
and `type` instead of the interaction itself. Pass the token only to
`DiscordApi` methods, as an argument.

```ts good
throw new DiscordApiError(
  "PATCH",
  `/webhooks/${applicationId}/:token/messages/@original`,
  response.status,
  error.code,
  error.message,
);
```

```ts good
console.error(
  `follow-up for interaction ${interaction.id} failed: ${error.message}`,
);
```

```ts bad
throw new Error(
  `PATCH ${baseUrl}/webhooks/${applicationId}/${interaction.token}/messages/@original failed with ${response.status}`,
);
```

```ts bad
console.error("follow-up failed", interaction);
```

```ts bad
console.log(`PATCH /webhooks/${applicationId}/${token}/messages/@original`);
```

## Deferred responses carry only the ephemeral flag
only: *.ts

A deferred response (type 5, `DeferredChannelMessageWithSource`) is not a
message: it shows "thinking…" until a follow-up replaces it. Discord accepts
only flag `64` (ephemeral) on it and rejects any other flag, so a deferral
never sets `IS_COMPONENTS_V2`, `content` or `components`. Return
`deferredReply()` or `deferredReply({ ephemeral: true })`, and put Components
V2 on the edit that replaces it: `editOriginalInteractionResponse` with a
`messageBody(...)`, which sets `IS_COMPONENTS_V2`. That edit is the message,
and it follows "Bot messages use Components V2 only".

```ts good
return {
  response: deferredReply({ ephemeral: true }),
  followUp: async () => {
    const result = await tallyVotes(storage, pollId);
    await api.editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      messageBody([container([textDisplay(resultText(result))])]),
    );
  },
};
```

```ts bad
return {
  response: {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: MessageFlags.IsComponentsV2 },
  },
  followUp,
};
```

```ts bad
return {
  response: {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: messageBody([container([textDisplay("Working…")])], {
      ephemeral: true,
    }),
  },
  followUp,
};
```

## Discord requests go through DiscordApi
only: *.ts

Only `src/discord/api.ts` calls `fetch` against Discord or names a
`discord.com` URL, so authentication, `allowed_mentions`, rate limits and
token-free errors stay in one place. Call a `DiscordApi` method from
`discordApi(env)` instead. When the endpoint has no method yet, add one to
`DiscordApi` first, following "Add a REST method to the client" in
`src/discord/AGENTS.md`. Message links (`discord.com/channels/…`) and links to
Discord's docs (`discord.com/developers/…`) are not requests and pass.

```sh
case "$FILE" in ./discord/api.ts) exit 0 ;; esac
! awk '
  /discord(app)?\.com|DISCORD_API_BASE/ && !/discord(app)?\.com\/(channels|developers)\// { hit = 1 }
  /(^|[^A-Za-z0-9_$])fetch[[:space:]]*\(/ && !/^[[:space:]]*(async[[:space:]]+)?fetch[[:space:]]*\([^)]*\)[[:space:]]*(:[^=]*)?\{/ && tolower($0) ~ /discord|\/webhooks\/|\/channels\/|\/guilds\/|\/applications\/|\/interactions\// { hit = 1 }
  hit { print FILENAME ":" FNR ": requests Discord outside DiscordApi; call a DiscordApi method instead, adding it to src/discord/api.ts first if it is missing (see src/discord/AGENTS.md): " $0; bad = 1; hit = 0 }
  END { exit !bad }
' "$FILE"
```
