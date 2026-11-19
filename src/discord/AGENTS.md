# Working in src/discord

## Add a REST method to the client

1. Look up the endpoint in Discord's docs and find its body and result types
   in `discord-api-types/v10` (`RESTPost…JSONBody`, `RESTPost…Result`, and
   so on):

   ```sh
   grep -rn "export .*RESTPostAPIChannelMessage" node_modules/discord-api-types/rest/v10/
   ```

2. Add a method to `DiscordApi` in `src/discord/api.ts` that returns
   `this.call({ method, path, body, auth })`, typed with those types.
   - `auth: true` for bot routes; `auth: false` for routes authorised by an
     interaction token in the path (`/webhooks/{application_id}/{token}…`).
   - When the path holds a token, also pass `route` with the token replaced
     by `:token`, so `DiscordApiError` messages can be logged.
   - When the body is a message (it has `allowed_mentions`), wrap it in
     `withoutPings(body)`.
   - For an OAuth2 route, pass `auth: false` and the `authorization`
     value instead (`basicAuth(client)` for the token routes,
     `Bearer <access token>` for a user's routes), and send a token
     route's body as `form`, as the methods in the OAuth2 block of
     `DiscordApi` do, so the path, and with it every error, holds no token
     or secret.
3. Add the method to the `cases` table in `test/discord/api.test.ts` (method,
   URL, whether it sends the bot token). If it sends a message, add it to the
   `calls` table in the `allowed_mentions` block too.
4. Run `npx vitest run test/discord/api.test.ts`.

## Send a file with a message

1. Pass the files as the last argument of `createMessage` or `editMessage`
   in `src/discord/api.ts`, each a `FileUpload` (`name`, `data`,
   `contentType`), and show a file in the message with a component that
   refers to it as `attachment://<name>`:

   ```ts
   await discordApi(context.env).editMessage(
     channelId,
     messageId,
     messageBody([
       container([mediaGallery([{ url: "attachment://hike-map.png" }])]),
     ]),
     [{ name: "hike-map.png", data: png, contentType: "image/png" }],
   );
   ```

2. On an edit, pick how the message's attachments change: to replace
   them, pass files, listing any to keep by id in `body.attachments`; to
   keep them, pass neither files nor `attachments`; to remove them all, set
   `attachments: []`.
3. For an image field, such as a scheduled event's `image`, pass
   `imageData(bytes, "image/png")`.
4. Test the request as the "file uploads" block of
   `test/discord/api.test.ts` does: read it back with `request.formData()`,
   the message from the `payload_json` field and the files from `files[0]`,
   `files[1]` and so on, then run it:

   ```sh
   npx vitest run test/discord/api.test.ts
   ```

## Call Discord from a handler or follow-up

1. Build the client from the handler context:
   `const api = discordApi(context.env);`
2. Build message bodies with `messageBody([...])` from
   `src/discord/components.ts`.
3. Catch `DiscordApiError` where an admin should see why a call failed, and
   show `error.discordMessage` (and `error.code` if useful) in an ephemeral
   reply or an edit of the original response.
4. In tests, pass a fake: `discordApi(env, { fetch: fakeFetch, sleep })`, or
   `new DiscordApi({ token, fetch, sleep })`. See `fakeFetch` in
   `test/discord/api.test.ts`.

## Add a slash command or subcommand

1. Add the definition to `commands` in `src/discord/commands.ts`: a new
   subcommand goes in the `options` of `hike` with
   `type: ApplicationCommandOptionType.Subcommand`, a new command is a new
   entry with the same `contexts` and `integration_types` as `hike` and no
   `default_member_permissions`. Names are lowercase, 1 to 32 characters;
   descriptions 1 to 100.
2. For a subcommand, add its handler to `subcommands` in
   `src/features/hike.ts`. Wrap it in `adminOnly` if only admins may use it.
   For a command, register its handler as "Add a slash command handler" in
   `src/guild/AGENTS.md` says.
3. Update the expected definition in `test/discord/commands.test.ts`, and
   add a case to `test/features/hike.test.ts` that the subcommand reaches
   its handler. Add an end-to-end scenario that runs it, as "Write an
   end-to-end scenario" in `test/AGENTS.md` says, with
   `member.run("hike", [subcommand("<name>")])`.
4. Run the tests:

   ```sh
   npx vitest run test/discord/commands.test.ts
   npx vitest run test/features/hike.test.ts
   ```

5. The `Deploy` workflow registers the new definition when the pull request
   merges. To see it in a test application first, follow "Register the slash
   commands" in `AGENTS.md`.

## Add a component builder

1. Find the component's type in `discord-api-types/v10`:

   ```sh
   grep -n "export interface API.*Component " node_modules/discord-api-types/payloads/v10/message.d.ts
   ```

2. Add a function to `src/discord/components.ts` in the matching group
   (message parts or modal parts) that returns that type with its `type`
   set and takes the other fields as an options object named like Discord's fields (`custom_id`, `max_values`, …). Give
   optional fields a default only where Discord's default is unhelpful.
3. If Discord caps a count or length the builder controls, check it and
   throw with the limit in the message (see `stringSelect`).
4. Add a structural test to `test/discord/components.test.ts` with
   `toEqual` on the whole object, plus a test for each limit.
5. Run `npx vitest run test/discord/components.test.ts`.

## Build a reply

- Immediate reply to a command or component:
  `return { response: reply([container([textDisplay("…")])]) };`
- Reply only the user sees: `ephemeralReply([...])`.
- Replace the message a button or select was on: `update([...])`.
- Open a modal: `modal(customId("location", "propose"), "Title", [label("Name", textInput({ custom_id: customId("location", "name") }))])`.
- Work that takes more than one REST call or longer than 3 seconds (the
  whole procedure is "Give a handler a follow-up job" in
  `src/guild/AGENTS.md`):
  1. Return `{ response: deferredReply({ ephemeral: true }), followUp }`
     (or `deferredUpdate()` for a component).
  2. In `followUp`, call
     `api.editOriginalInteractionResponse(interaction.application_id, interaction.token, messageBody([...]))`.
- Post or edit a message in a channel:
  `api.createMessage(channelId, messageBody([...]))`.
- Read a submitted modal: `textInputValue(interaction.data, id)` and
  `selectValues(interaction.data, id)`.
- Make and read ids: `customId("poll", "vote", pollId)` and
  `parseCustomId(interaction.data.custom_id)?.arg`.
- Check the result in a test with `toEqual` against the builders, as in
  `test/guild/guild-hike.test.ts`.

## Read something that may not exist

1. When Discord answers a read with 404 as its "no" (Get Guild Member for
   a user who is not a member, code 10007), catch `DiscordApiError` and
   check `status` (and `code` when one 404 is not like another). Treat
   only that answer as "no"; report every other error as a failure, never
   as "no" or "yes":

   ```ts
   try {
     return (await api.getGuildMember(guildId, userId)).roles;
   } catch (error) {
     if (error instanceof DiscordApiError && error.status === 404) return null;
     throw error;
   }
   ```

2. Test both answers and a 500 with `fakeFetch` in
   `test/discord/api.test.ts`, or with `discordFor` in
   `test/guild/web-view-helpers.ts` for code inside the guild object, then
   run them:

   ```sh
   npx vitest run test/discord/api.test.ts test/guild/web-view.test.ts
   ```
