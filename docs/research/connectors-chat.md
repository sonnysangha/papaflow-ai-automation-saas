# verify:connectors-chat

## SUMMARY
Re-verified against live docs, raw GitHub sources and npm on 2026-09-02. Researcher was largely right; corrections: (1) Telegram file-by-URL limits are 5 MB for photos / 20 MB other files (10 MB photo / 50 MB other only for multipart upload); (2) Resend Node SDK takes idempotencyKey in the SECOND argument (CreateEmailRequestOptions), not the payload; (3) svix 2.2.0 Webhook.verify() is typed to return undefined (throws on failure) so JSON.parse the raw body yourself, or use resend.webhooks.verify(); (4) Discord GET /users/@me/guilds with a Bot token is not stated in the docs but is exactly what discord.js GuildManager.fetch() does (Routes.userGuilds()), so treat as working; (5) Twilio: the WhatsApp Sandbox lives in the LEGACY console (twilio.com/console/sms/whatsapp/sandbox) and trial accounts are told to use "Try out WhatsApp" instead; (6) Resend webhook retry schedule starts with an immediate attempt then 5s, 5m, 30m, 2h, 5h, 10h, 10h. SLACK: HTTPS-only redirect URLs (no localhost exception; use a tunnel or the vercel.app URL); redirect_uri must match or be a subdirectory of a configured Redirect URL; oauth.v2.access should use HTTP Basic client_id:client_secret; response scope = granted scopes (optional scopes since 2026-03-16; required scopes still auto-approved); tokens never expire unless rotation is on (irreversible, 12h). Signature v0:{ts}:{rawBody} HMAC-SHA256, 5-min skew. Events: url_verification (respond text/plain, form or JSON challenge), 2xx within 3s, 3 retries with x-slack-retry-num/-reason. Interactivity: form-encoded payload=JSON, 200 within 3s, response_url 5 uses/30 min. Button value <=2000, action_id <=255. DISCORD: webhook POST ?wait=true returns message else 204; 10 embeds/6000 chars; 404 = 10015 Unknown Webhook and repeated 404s get your IP restricted, so FatalError. Interactions: Ed25519 over timestamp+rawBody, 401 on failure, PING 1->PONG 1, type 5 within 3s, token 15 min, PATCH /webhooks/{app_id}/{token}/messages/@original. Message triggers Gateway-only. Invite scope=bot applications.commands&permissions=3072. TELEGRAM: Bot API 10.3 (2026-08-24), no 2026 webhook changes; header X-Telegram-Bot-Api-Secret-Token; ports 443/80/88/8443. RESEND: User-Agent mandatory (403/1010), Idempotency-Key 1-256 chars/24h, 10 req/s, free 3,000/mo 100/day, inbound counts; before domain verification only onboarding@resend.dev -> your own account email (400 validation_error); email.received is metadata-only, GET /emails/receiving/{id} for body. TEAMS: connectors disabled 2026-05-18..22; Workflows trigger accepts Adaptive AND Message Cards (no buttons for Message Cards, no actionable messages); 28 KB, ~4 req/s. TWILIO: +14155238886, join <code>, 3-day session, 24h window, 1 msg/3s, Basic auth API Key SID:secret with Account SID in path, twilio.validateRequest(authToken, sig, url, params).

## VERSIONS
{
"resend": "6.25.0",
"resend-cli": "2.18.0",
"svix": "2.2.0",
"discord-interactions": "4.4.0",
"tweetnacl": "1.0.3",
"twilio": "6.1.0",
"@slack/web-api": "8.1.1"
}

## COMMANDS
- npm view resend version engines --json   # 6.25.0, node>=20
- npm view svix version engines --json     # 2.2.0, node>=22
- npm view discord-interactions version --json   # 4.4.0 (verifyKey is async -> Promise<boolean>)
- npm view twilio version --json   # 6.1.0 (twilio.validateRequest)
- npm view resend-cli version engines --json   # 2.18.0, node>=22
- curl -s 'https://api.telegram.org/bot<TOKEN>/getMe'   # validate a pasted Telegram token
- curl -s -X POST 'https://api.telegram.org/bot<TOKEN>/setWebhook' -d 'url=https://<app>.vercel.app/api/events/telegram/<connectionId>' -d 'secret_token=<random 1-256 chars A-Za-z0-9_->' -d 'allowed_updates=["message","callback_query"]'
- curl -s 'https://discord.com/api/webhooks/<id>/<token>'   # validate a pasted Discord webhook URL (no auth; HTTP 404 code 10015 = gone)
- curl -X PUT 'https://discord.com/api/v10/applications/<DISCORD_APP_ID>/guilds/<GUILD_ID>/commands' -H 'Authorization: Bot <DISCORD_BOT_TOKEN>' -H 'Content-Type: application/json' -d '[{"name":"papaflow","description":"Run a PapaFlow workflow","type":1,"options":[{"type":3,"name":"input","description":"Text input","required":false}]}]'   # guild commands update instantly; use /applications/<APP_ID>/commands for global
- curl -s 'https://discord.com/api/v10/users/@me/guilds' -H 'Authorization: Bot <DISCORD_BOT_TOKEN>'   # guild picker (paginate with ?after=<id>&limit=200)
- curl -X POST 'https://api.resend.com/domains' -H 'Authorization: Bearer $RESEND_API_KEY' -H 'Content-Type: application/json' -H 'User-Agent: papaflow/0.1' -d '{"name":"mail.<yourdomain>","region":"us-east-1","capabilities":{"sending":{"status":"enabled"},"receiving":{"status":"enabled"}}}'   # returns records[] (DKIM/SPF/MX) to add at DNS; verify capabilities shape against the live docs page
- curl -X POST 'https://api.resend.com/domains/<domain_id>/verify' -H 'Authorization: Bearer $RESEND_API_KEY' -H 'User-Agent: papaflow/0.1'
- curl -X POST 'https://api.resend.com/api-keys' -H 'Authorization: Bearer $RESEND_API_KEY' -H 'Content-Type: application/json' -H 'User-Agent: papaflow/0.1' -d '{"name":"papaflow-prod","permission":"sending_access","domain_id":"<domain_id>"}'   # needs a full_access key
- resend login --key re_...   # or export RESEND_API_KEY; then: resend domains create --name mail.<yourdomain> --region us-east-1 ; resend domains verify <domain_id> ; resend api-keys create --name papaflow-prod --permission sending_access ; resend webhooks create --endpoint https://<app>.vercel.app/api/events/resend --events email.received ; resend doctor --json
- curl -X POST 'https://api.twilio.com/2010-04-01/Accounts/<ACCOUNT_SID>/Messages.json' -u '<API_KEY_SID>:<API_KEY_SECRET>' --data-urlencode 'From=whatsapp:+14155238886' --data-urlencode 'To=whatsapp:+<E164>' --data-urlencode 'Body=hello'
- MANUAL: Slack — https://api.slack.com/apps → Create New App → From a manifest → paste the manifest snippet with oauth_config.redirect_urls: ["https://<app>.vercel.app/api/oauth/slack/callback", "https://<tunnel-host>/api/oauth/slack/callback"] (HTTPS only — http://localhost:3000 cannot be registered; run `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000` for local dev), oauth_config.scopes.bot: [chat:write, chat:write.public, channels:read, app_mentions:read], settings.event_subscriptions.request_url: https://<app>.vercel.app/api/events/slack with bot_events: [app_mention], settings.interactivity.is_enabled: true + request_url: https://<app>.vercel.app/api/events/slack, settings.token_rotation_enabled: false (never enable; irreversible). Basic Information → copy Client ID / Client Secret / Signing Secret → SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET. The Events request URL only saves once the deployed route answers url_verification (respond with the challenge, HTTPS, case-sensitive URL). Invite the bot to a channel (/invite @PapaFlow) before testing app_mention.
- MANUAL: Discord — https://discord.com/developers/applications → New Application → General Information: copy Application ID → DISCORD_APP_ID and Public Key → DISCORD_PUBLIC_KEY; set Interactions Endpoint URL = https://<app>.vercel.app/api/events/discord (on Save, Discord POSTs {type:1} with a valid signature and also invalid signatures; the deployed route must verify Ed25519 and answer {type:1} / 401). Bot tab → Reset Token → DISCORD_BOT_TOKEN. No OAuth redirect needed for the bot install. User-facing invite URL: https://discord.com/oauth2/authorize?client_id=<DISCORD_APP_ID>&scope=bot%20applications.commands&permissions=3072 (use 19456 if the node sends embeds). Register the slash command with the PUT command above.
- MANUAL: Telegram — in Telegram open @BotFather → /newbot → name + username ending in 'bot' → copy the token; user pastes it into PapaFlow, which calls getMe then setWebhook with a generated secret_token stored on the connection. Optional /setprivacy → Disable so the bot sees all group messages. chat_id is discovered from the first inbound update.message.chat.id (store as string).
- MANUAL: Resend — https://resend.com/api-keys → Create API Key (Full access, bootstrap) → RESEND_API_KEY (shown once). https://resend.com/domains → Add Domain (e.g. mail.<yourdomain>, region us-east-1, enable Receiving) → add the DKIM/SPF (TXT + MX/CNAME) and the receiving MX record at your DNS host → Verify (usually <15 min, up to 72 h). https://resend.com/webhooks → Add Webhook → endpoint https://<app>.vercel.app/api/events/resend, event email.received → copy Signing Secret (whsec_…) → RESEND_WEBHOOK_SECRET. Until the domain is verified, onboarding@resend.dev can only send to your own account email (400 validation_error otherwise).
- MANUAL: Teams (per end user) — Teams → channel … → Workflows → template "Send webhook alerts to a channel" → pick Team + Channel → Save → copy the webhook URL from the details page; in Power Automate set the trigger's 'Who can trigger the flow' = Anyone (and send no Authorization header). User pastes the URL into PapaFlow; PapaFlow POSTs the Adaptive Card body (<=28 KB, <=4 req/s).
- MANUAL: Twilio — legacy Console https://www.twilio.com/console/sms/whatsapp/sandbox (Messaging → Try it out → Send a WhatsApp message on the new Console; trial accounts are sent to 'Try out WhatsApp' instead): note the join code; from your phone send 'join <code>' to +1 415 523 8886 (rejoin every 3 days). Sandbox settings → Sandbox configuration → 'When a Message Comes in' = https://<app>.vercel.app/api/events/twilio/<connectionId> (POST). Account → API keys & tokens → Create API key (Standard) → API_KEY_SID + SECRET, plus Account SID; the Auth Token is needed only for X-Twilio-Signature validation.

## NON-CONFIRMED FACTS (7 of 35)
- [wrong] Slack redirect URI http://localhost:3000/... can be registered for local dev
  TRUTH: "The redirect_uri must use HTTPS." and "A Redirect URL must also use HTTPS." No localhost exception anywhere on the page (re-fetched, searched for 'localhost'). Use an HTTPS tunnel (ngrok/cloudflared) or the https://<app>.vercel.app callback for local dev.
  SRC: https://docs.slack.dev/authentication/installing-with-oauth/
- [partially] Users can decline individual Slack scopes now; store granted scopes from the token response
  TRUTH: True only for scopes the developer marks optional (shipped 2026-03-16): manifest oauth_config.scopes.bot_optional / user_optional ("must be a subset of your declared bot or user scopes"). "Required scopes are auto-approved as always" (still all-or-nothing). "the oauth.v2.access response includes the list of scopes that were actually granted. Store these." Handle missing_scope errors explicitly. For PapaFlow keep chat:write, chat:write.public, channels:read required (not optional) so the connector always works.
  SRC: https://docs.slack.dev/changelog/2026/03/16/optional-scopes/ and https://slack.dev/introducing-optional-scopes-for-slack-apps/
- [partially] Slack mention trigger delivers app_mention events
  TRUTH: Needs scope app_mentions:read and the bot must be in the channel: "If your app is mentioned but not part of a conversation (and not invited to join), you won't receive an event." Payload event: {type:"app_mention", user, text, ts, channel, event_ts}.
  SRC: https://docs.slack.dev/reference/events/app_mention/
- [partially] Discord pickers via GET /users/@me/guilds then GET /guilds/{id}/channels with the Bot token
  TRUTH: Docs only say "For OAuth2, requires the guilds scope" and "returns 200 guilds by default"; they do not state bot support. Second method: discord.js GuildManager.fetch() with no id calls this.client.rest.get(Routes.userGuilds(), {query: before/after/limit}) with the bot token, so it works for bots (paginate with after= beyond 200). GET /guilds/{guild.id}/channels returns channels excluding threads; filter type 0 GUILD_TEXT / 5 GUILD_ANNOUNCEMENT; "Starting November 16, 2026" it omits channels the bot cannot view (changelog 2026-08-12 'Channel Obfuscation').
  SRC: https://docs.discord.com/developers/resources/user , https://raw.githubusercontent.com/discordjs/discord.js/main/packages/discord.js/src/managers/GuildManager.js , https://docs.discord.com/developers/resources/guild
- [partially] Telegram sendMessage parse_mode=HTML; sendPhoto URL up to 10 MB; sendVoice 50 MB
  TRUTH: sendMessage text 1-4096 chars after entity parsing; parse_mode HTML|MarkdownV2|Markdown; HTML tags b/strong, i/em, u/ins, s/strike/del, code, pre, tg-spoiler, a href, tg-emoji, blockquote, mark, sub, sup; escape <, > and &. Sending files: file_id (no limit), HTTP URL (5 MB for photos, 20 MB for other files), multipart upload (10 MB photos, 50 MB other). So a photo by URL is limited to 5 MB, not 10. sendVoice: .OGG(OPUS)/.MP3/.M4A up to 50 MB; caption <=1024. Rate limits (FAQ): ~1 msg/s per chat, 20/min per group, ~30/s broadcast; 429 otherwise.
  SRC: https://core.telegram.org/bots/api (Sending files, Formatting options) via context7 /websites/core_telegram_bots_api , https://core.telegram.org/bots/faq
- [partially] Resend works before anyone connects anything (send from the app's domain)
  TRUTH: Needs a verified domain first: "You must add and verify at least one domain to send emails with Resend"; DKIM + SPF (TXT and MX or CNAME) records; usually verifies within 15 min, up to 72 h; subdomain recommended. Before that, onboarding@resend.dev may only target your own account email: 400 validation_error "You can only send testing emails to your own email address (youremail@domain.com)" plus test addresses delivered@/bounced@/complained@/suppressed@resend.dev. Domains via POST /domains {name, region us-east-1|eu-west-1|sa-east-1|ap-northeast-1, custom_return_path, capabilities.{sending,receiving}} -> records[] {record,name,type,ttl,value,priority,status}; POST /domains/{id}/verify.
  SRC: https://resend.com/docs/add-a-domain , https://resend.com/docs/api-reference/errors , https://resend.com/docs/send-with-nodejs , https://resend.com/docs/api-reference/domains/create-domain
- [wrong] Teams Workflows payload must be an Adaptive Card; plain text no longer works
  TRUTH: "Workflows support both Adaptive Cards and Message Card format (button rendering won't be supported)." "This trigger also does not support actionable messages"; "only supports POST requests"; "Do not pass an authentication token header if you selected the 'Anyone' authentication option, or POST requests to the trigger will fail." Body: {type:"message", attachments:[{contentType:"application/vnd.microsoft.card.adaptive", contentUrl:null, content:{$schema, type:"AdaptiveCard", version:"1.2", body:[{type:"TextBlock", text}]}}]}. Limits: 28 KB per message; >4 req/s throttled (429). Adaptive Card remains the right default; whether a bare {"text":…} JSON works depends on how the flow maps the payload - test at setup.
  SRC: https://learn.microsoft.com/en-us/connectors/teams/#microsoft-teams-webhook , https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook

## CONFIRMED FACTS
- Slack OAuth authorize https://slack.com/oauth/v2/authorize, token URL https://slack.com/api/oauth.v2.access, bot scopes in scope, user scopes in user_scope → Params client_id, scope (bot), user_scope, redirect_uri, state, team. Code "expires after ten minutes". Redirect URLs are configured under App Management (multiple allowed); "Your redirect_uri must match or be a subdirectory of a Redirect URL configured under 
- oauth.v2.access response has access_token, team.id, team.name, bot_user_id, scope; Basic auth recommended → Example response: {ok, access_token:"xoxb-…", token_type:"bot", scope, bot_user_id, app_id, team:{name,id}, enterprise:{name,id}|null, authed_user:{id,scope,access_token,token_type}}; expires_in (43200) + refresh_token only with rotation. Exact sentence: "If a
- Slack tokens don't expire unless token rotation is enabled, which can't be turned off → "Without token rotation, the access token never expires. With token rotation, it expires every 12 hours." "Token rotation may not be turned off once it's turned on". expires_in "will always expire in 43,200 seconds". Refresh: oauth.v2.access with grant_type=re
- Scopes chat:write, chat:write.public, channels:read cover post-to-channel + channel picker → chat.postMessage requires chat:write. chat:write.public = "Send messages to channels your Slack app isn't a member of" and "To use this scope, your app must also request chat:write" (bot tokens only, public channels). conversations.list needs channels:read (gr
- POST https://slack.com/api/chat.postMessage with Authorization: Bearer xoxb-… → Accepts application/json or application/x-www-form-urlencoded; channel required; text/blocks/thread_ts/unfurl_links/unfurl_media optional; response {ok, channel, ts, message}. "generally allow an app to post 1 message per second to a specific channel" plus a w
- Slack signature: HMAC-SHA256 of v0:{ts}:{body}; headers X-Slack-Signature / X-Slack-Request-Timestamp → "Concatenate the version number, the timestamp, and the request body together, using a colon (:) as a delimiter" -> e.g. v0:1531420618:token=xyzz…; hex digest prefixed v0= compared to X-Slack-Signature; "the timestamp does not differ from local time by more th
- Slack Events API: echo url_verification challenge once; ack within 3 seconds or Slack retries → Request body {"token":"…","challenge":"…","type":"url_verification"}; respond with the challenge as text/plain, application/x-www-form-urlencoded challenge=, or application/json {"challenge":"…"}. "respond to the event request with an HTTP 2xx within three sec
- Slack interactivity POST is form-encoded with payload= JSON; ack within 3s → "sent to your specified Request URL in an HTTP POST request in the form application/x-www-form-urlencoded" with a payload parameter to parse as JSON; ack "must be sent within 3 seconds". block_actions payload: type, trigger_id (expires in seconds), user, team,
- Block Kit button carries value + action_id for the Approval node → Button: text plain_text <=75 chars, action_id <=255, value <=2000, url <=3000, accessibility_label <=75, style primary|danger, confirm object. Valid in an actions block or as a section accessory.
- Slack app manifest configures redirect URLs, request URLs and scopes in one paste → oauth_config.redirect_urls[] (HTTPS), oauth_config.scopes.bot[] / bot_optional[], settings.event_subscriptions.request_url + bot_events[] (max 100), settings.interactivity.is_enabled + request_url, settings.token_rotation_enabled, features.bot_user.display_nam
- conversations.list is safe for the channel picker → Tier 2 (20+/min); types=public_channel[,private_channel]; exclude_archived (default false); limit default 100, max <1000; cursor via response_metadata.next_cursor. Only conversations.history/replies got the May 29 2025 non-Marketplace restriction. Only 2026 Sl
- Discord webhook POST discord.com/api/webhooks/{id}/{token}; <=10 embeds, 6000 chars; never retry a 404 → POST /webhooks/{webhook.id}/{webhook.token}, no auth; ?wait=true "waits for server confirmation of message send before response, and returns the created message body (defaults to false; when false a message that is not saved does not return an error)" else 204
- Discord bot posts with POST /channels/{id}/messages and Authorization: Bot → POST https://discord.com/api/v10/channels/{channel.id}/messages, header Authorization: Bot <token>; needs VIEW_CHANNEL + SEND_MESSAGES (+EMBED_LINKS for embeds); at least one of content/embeds/sticker_ids/components/files/poll; same length limits as webhooks. 
- Discord invite URL scope=bot applications.commands&permissions=3072 → https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot%20applications.commands&permissions=3072 (optional guild_id, disable_guild_select=true, integration_type); bot flow has no response_type/redirect_uri. Bits: VIEW_CHANNEL 1<<10=1024, SEND_MESSAGE
- Discord interactions: Ed25519 over timestamp+body with X-Signature-Ed25519 / X-Signature-Timestamp; PING type 1 -> type 1 → Headers X-Signature-Ed25519 (hex) and X-Signature-Timestamp; verify signature over timestamp + raw body with the app Public Key; "return a 401" on failure; Discord periodically sends invalid signatures and removes the URL if accepted. "When adding your Interac
- Discord slash command: reply type 5 within 3s, then PATCH /webhooks/{app}/{token}/messages/@original; token lives 15 minutes → "you must send an initial response within 3 seconds of receiving the event" (else token invalidated); "Interaction tokens are valid for 15 minutes". Callback: POST /interactions/{id}/{token}/callback (?with_response=true optional) types 1 PONG, 4 CHANNEL_MESSA
- Discord message triggers need Gateway; triggers are slash commands only → HTTP Webhook Events list: APPLICATION_AUTHORIZED/DEAUTHORIZED, ENTITLEMENT_*, QUEST_USER_ENROLLMENT, LOBBY_MESSAGE_*, GAME_DIRECT_MESSAGE_*; MESSAGE_CREATE not available. (Webhook Events use a different PING: type 0 -> 204 empty.) Commands: POST or bulk PUT /a
- Telegram: getMe validates; setWebhook with secret_token -> header X-Telegram-Bot-Api-Secret-Token → Bot API 10.3 (2026-08-24); changelog shows no 2026 changes to webhooks/secret_token/rate limits. setWebhook: url ("HTTPS URL to send updates to"; ports 443, 80, 88, 8443), secret_token ("A secret token to be sent in a header 'X-Telegram-Bot-Api-Secret-Token' i
- Resend: POST api.resend.com/emails with Bearer key; requests without User-Agent get 403 → Base https://api.resend.com; Authorization: Bearer re_…; "All API requests must include a User-Agent header. Requests without this header will be rejected with a 403 status code" (error 1010, blocked before the API; SDKs/curl set it, bare fetch must set it). B
- Resend supports an Idempotency-Key header → Header Idempotency-Key (Resend-Idempotency-Key for SMTP), 1-256 chars, kept 24 hours, on POST /emails and POST /emails/batch; 400 invalid_idempotency_key, 409 invalid_idempotent_request (same key, different payload), 409 concurrent_idempotent_requests. Node SD
- Resend free tier is 100 emails/day and inbound counts → Free: 3,000 emails/month, 100/day, 3 domains, 30-day retention; Pro $20/mo (50k) or $35/mo (100k). "Both sent emails and received emails (inbound) count towards your account's email quota." "Multiple To, CC, or BCC recipients in sent emails count as separate e
- Inbound email via MX record fires email.received; trigger fetches the body → Enable receiving on a verified domain and add the MX record shown in the dashboard (lowest priority; use a subdomain if MX already exists), or use the account's <id>.resend.app address. Payload {type:"email.received", created_at, data:{email_id, created_at, fr
- Resend webhooks are verified with Svix headers and a whsec_ secret → Headers svix-id, svix-timestamp, svix-signature; secret on the webhook details page (also returned by create/get/list webhook APIs). "Make sure that you're using the raw request body when verifying webhooks." Options: resend.webhooks.verify({payload, headers:{
- Resend has a CLI / API to create API keys and domains → POST /api-keys {name (<=50), permission full_access|sending_access, domain_id?} -> {id, token "re_…"}; requires a full_access key (bootstrap key from dashboard; token shown once). CLI resend-cli 2.18.0 (Node >=22): npm i -g resend-cli | curl -fsSL https://rese
- Teams: Office 365 connectors shut down May 2026; Power Automate 'post to channel when webhook received' flow replaces them → Update 2026-04-14: "Rollout begins: May 18, 2026", "Rollout completes: May 22, 2026"; after that connectors no longer function. Replacement: Teams Workflows app, trigger "When a Teams webhook request is received"; channel templates "Send webhook alerts to a ch
- Twilio WhatsApp sandbox: 'join <code>' to +14155238886; 24h window; sessions expire after 3 days → Shared number +14155238886; "join <your sandbox code>" (or QR); "The Sandbox session expires three days after joining."; "When a user sends your business a message, it opens a 24-hour customer service window."; outside it "you can use only pre-approved templat
- Twilio send: POST …/Messages.json with From=whatsapp:+14155238886; auth accountSid + API key SID/secret → POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json (form-encoded); To=whatsapp:+E164; From (whatsapp:+14155238886) or MessagingServiceSid; Body (<=1600) | MediaUrl (<=10) | ContentSid (+ContentVariables JSON); StatusCallback optional. "
- Package versions for the connector layer → resend 6.25.0 (node>=20), resend-cli 2.18.0 (node>=22), svix 2.2.0 (node>=22), discord-interactions 4.4.0 (node>=18.4), tweetnacl 1.0.3, twilio 6.1.0 (node>=20), @slack/web-api 8.1.1 (node>=20). Prefer raw fetch per CLAUDE.md; SDKs only for signature work (svi

## SNIPPETS
### Slack request signature verification (raw body first)
```
import { createHmac, timingSafeEqual } from "node:crypto";
export function verifySlack(req: Request, rawBody: string) {
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const mine = "v0=" + createHmac("sha256", process.env.SLACK_SIGNING_SECRET!)
    .update(`v0:${ts}:${rawBody}`).digest("hex");
  return mine.length === sig.length && timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
}
// Events (JSON): if (j.type === "url_verification") return Response.json({ challenge: j.challenge });
// then start(runGraph,…) and return new Response("ok") within 3 s (x-slack-retry-num => dedupe on event_id)
// Interactivity (form): const payload = JSON.parse(new URLSearchParams(rawBody).get("payload")!);
```
### Slack oauth.v2.access exchange (HTTP Basic, as the docs recommend)
```
const res = await fetch("https://slack.com/api/oauth.v2.access", {
  method: "POST",
  headers: {
    Authorization: "Basic " + Buffer.from(`${process.env.SLACK_CLIENT_ID}:${process.env.SLACK_CLIENT_SECRET}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ code, redirect_uri }), // identical to the /authorize redirect_uri (HTTPS)
});
const j = await res.json();
// { ok, access_token:"xoxb-…", token_type:"bot", scope:"chat:write,chat:write.public,channels:read",
//   bot_user_id, app_id, team:{id,name}, enterprise:null, authed_user:{id} }  — store j.scope (granted list)
```
### Slack chat.postMessage with Approve/Reject buttons (Approval node)
```
await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    channel, text: "Approval needed",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "*Approve this run?*" } },
      { type: "actions", block_id: "approval", elements: [
        { type: "button", action_id: "approve", style: "primary", text: { type: "plain_text", text: "Approve" }, value: hookToken },
        { type: "button", action_id: "reject", style: "danger", text: { type: "plain_text", text: "Reject" }, value: hookToken },
      ] },
    ],
  }),
}); // {ok, channel, ts}; value ≤2000 chars; errors not_in_channel / channel_not_found / missing_scope; 429 → Retry-After
```
### Slack app manifest (api.slack.com/apps → From a manifest)
```
{
  "display_information": { "name": "PapaFlow" },
  "features": { "bot_user": { "display_name": "PapaFlow", "always_online": true } },
  "oauth_config": {
    "redirect_urls": ["https://<app>.vercel.app/api/oauth/slack/callback"],
    "scopes": { "bot": ["chat:write", "chat:write.public", "channels:read", "app_mentions:read"] }
  },
  "settings": {
    "event_subscriptions": { "request_url": "https://<app>.vercel.app/api/events/slack", "bot_events": ["app_mention"] },
    "interactivity": { "is_enabled": true, "request_url": "https://<app>.vercel.app/api/events/slack" },
    "token_rotation_enabled": false
  }
}
```
### Discord interaction verification + PING / deferred reply
```
import { verifyKey } from "discord-interactions"; // 4.4.0: async, returns Promise<boolean>
export async function POST(req: Request) {
  const body = await req.text();
  const ok = await verifyKey(body, req.headers.get("x-signature-ed25519") ?? "",
    req.headers.get("x-signature-timestamp") ?? "", process.env.DISCORD_PUBLIC_KEY!);
  if (!ok) return new Response("invalid request signature", { status: 401 });
  const i = JSON.parse(body);
  if (i.type === 1) return Response.json({ type: 1 }); // PING -> PONG
  // i.type === 2: i.data.name, i.data.options, i.guild_id, i.channel_id, i.member?.user ?? i.user, i.token
  // start(runGraph, …) then:
  return Response.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE within 3 s
}
// later (≤15 min): PATCH https://discord.com/api/v10/webhooks/${DISCORD_APP_ID}/${i.token}/messages/@original  { content }
```
### Discord webhook + bot message
```
// Webhook (user-pasted https://discord.com/api/webhooks/{id}/{token})
const r = await fetch(`${webhookUrl}?wait=true`, { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, embeds }) });
// 200 + message with wait=true; ≤10 embeds / ≤6000 chars; 404 (code 10015) => webhook deleted => FatalError (repeat 404s get the IP banned)
// Bot
const b = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, { method: "POST",
  headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ content }) }); // 429 => body.retry_after (seconds) => RetryableError; 403 code 50001/50013 => FatalError
```
### Telegram send + inbound verification
```
const api = (m: string) => `https://api.telegram.org/bot${token}/${m}`;
await fetch(api("sendMessage"), { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }) }); // escape < > &; text ≤4096
// photo by URL ≤5 MB (multipart ≤10 MB): { chat_id, photo: url, caption }  // voice: OGG/OPUS|MP3|M4A ≤50 MB
// inbound route app/api/events/telegram/[connectionId]/route.ts
if (req.headers.get("x-telegram-bot-api-secret-token") !== stored.secret) return new Response(null, { status: 401 });
const update = await req.json(); // { update_id, message: { message_id, from, chat: { id, type }, date, text } }
// chat_id discovery: String(update.message.chat.id)  (up to 52 bits)
```
### Resend send with idempotency (SDK second arg; raw fetch needs User-Agent)
```
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send(
  { from: "PapaFlow <no-reply@mail.example.com>", to: [to], subject, html },
  { idempotencyKey: `exec/${executionId}-${nodeId}` }, // CreateEmailRequestOptions; 1-256 chars, 24 h
);
// raw fetch equivalent:
// fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`,
//   "Content-Type": "application/json", "User-Agent": "papaflow/0.1", "Idempotency-Key": k }, body })
// 429 rate_limit_exceeded / daily_quota_exceeded => RetryableError; 400/422 => FatalError
```
### Resend inbound (email.received) webhook route
```
import { Webhook } from "svix";
export async function POST(req: Request) {
  const raw = await req.text();
  const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET!);
  try {
    wh.verify(raw, {
      "svix-id": req.headers.get("svix-id")!, "svix-timestamp": req.headers.get("svix-timestamp")!,
      "svix-signature": req.headers.get("svix-signature")!,
    }); // throws WebhookVerificationError; svix 2.2.0 types the return as undefined, so parse yourself:
  } catch { return new Response("bad signature", { status: 400 }); }
  const evt = JSON.parse(raw) as { type: string; data: { email_id: string; from: string; to: string[]; subject: string } };
  if (evt.type !== "email.received") return new Response("ok");
  // metadata only → inside the step: GET https://api.resend.com/emails/receiving/${evt.data.email_id} → { html, text, headers, attachments[] }
  return new Response("ok"); // retries: now, 5s, 5m, 30m, 2h, 5h, 10h, 10h — dedupe on svix-id
}
```
### Teams Workflows webhook payload (Adaptive Card)
```
await fetch(workflowUrl, { method: "POST", headers: { "Content-Type": "application/json" }, // no Authorization header when trigger = Anyone
  body: JSON.stringify({
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null,
      content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.2",
        body: [{ type: "TextBlock", text, wrap: true }] },
    }],
  }) }); // ≤28 KB; >4 req/s => 429; Message Card format also accepted (no buttons)
```
### Twilio WhatsApp sandbox send + inbound signature check
```
import twilio from "twilio";
const auth = Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64");
await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
  method: "POST",
  headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ From: "whatsapp:+14155238886", To: `whatsapp:${e164}`, Body: text }),
}); // { sid, status, error_code }; 1 msg / 3 s; free-form only inside the 24 h window
// inbound: const params = Object.fromEntries(new URLSearchParams(await req.text()));
// const ok = twilio.validateRequest(authToken, req.headers.get("x-twilio-signature") ?? "", fullUrl, params); // boolean
// params: From "whatsapp:+…", Body, ProfileName, WaId, NumMedia, MediaUrl0 → reply new Response("<Response/>", { headers: { "Content-Type": "text/xml" } })
```
