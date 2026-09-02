# verify:connectors-data

## SUMMARY
Re-verified on 2026-09-02 against live docs pages, raw GitHub sources, npm registry, the local Stripe CLI and an actual Node 24.14.1 run. The first researcher was largely right; corrections and additions:

NOTION: Notion-Version 2026-03-11 is latest and the header "must be included in all REST API requests" (incl. /v1/oauth/token). NEW: @notionhq/client 5.26.0 defaults to notionVersion "2025-09-03" (Client.defaultNotionVersion), so pass notionVersion:"2026-03-11" or use fetch; the SDK has oauth.token/introspect/revoke but no oauth.refresh (refresh = oauth.token with grant_type "refresh_token"). 2026-03-11 breaking changes are only archived->in_trash, after->position, transcription->meeting_notes; webhook payloads identical to 2025-09-03. Page parent data_source_id confirmed (page_id/database_id/workspace also accepted); ids from GET /v1/databases/{id}.data_sources[] or POST /v1/search filter {property:"object", value:"data_source"}. OAuth: owner=user; Basic auth; JSON body; response has refresh_token string|null and NO expires_in. Refresh returns a new access+refresh pair; lifetime undocumented -> expiresAt null, refresh reactively on 401. Webhooks UI-only; X-Notion-Signature "sha256=<hex>" HMAC(body, verification_token); events carry IDs only; up to 8 attempts over ~24h. Portal https://app.notion.com/developers/connections (extra public-form fields unverified).

AIRTABLE: all confirmed. Docs literally say credentials are "base64 url-encoding" of client_id:client_secret, but Airtable's official oauth-example uses standard base64 (RFC 7617) - use that. Payload listing also extends expiry by 7 days; creator role required; 10 webhooks/base, 2 per OAuth integration/base.

LINEAR: bare key for API keys, Bearer for OAuth (docs + SDK client.ts). OAuth tokens expire in 24h (expires_in 86399) with rotating refresh tokens since 2026-04-01 - PLAN.md misses this. Rate-limit = HTTP 400 + RATELIMITED. "lin_api_" prefix not documented.

GITHUB: sha256=<hex> and test vector reproduced locally; Issues:write / Webhooks:write confirmed on the permissions page; API versions 2026-03-10 (latest) and 2022-11-28 (default).

STRIPE: header/HMAC/300s/3-day retry/event.id all confirmed; constructEvent(payload, header, secret, tolerance?, cryptoProvider?, receivedAt?). Local CLI 1.41.2 names the flag -a/--use-configured-webhooks while docs say -a/--load-from-webhooks-api; use -a. Signing secret stable across listen restarts.

NODE: seal/open order verified by execution on v24.14.1 (tag 16 bytes; wrong AAD throws "Unsupported state or unable to authenticate data"; timingSafeEqual throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH on unequal lengths). Use aad = `${orgId}:${connectionId}` (CLAUDE.md), not userId (PLAN.md L252).

## VERSIONS
{
"stripe": "22.6.1",
"@stripe/cli": "1.50.8",
"@notionhq/client": "5.26.0",
"@linear/sdk": "92.0.0",
"@octokit/rest": "22.0.1",
"@octokit/webhooks": "14.2.0",
"@octokit/webhooks-methods": "6.0.0",
"airtable": "0.12.2",
"node": "24.14.1 (local); stripe CLI binary installed locally is 1.41.2"
}

## COMMANDS
- MANUAL: Notion - https://app.notion.com/developers/connections > New connection > Distribution: Public; add redirect URI https://<app>/api/oauth/notion/callback (cannot be changed afterwards); copy OAuth Client ID / Client Secret -> NOTION_CLIENT_ID / NOTION_CLIENT_SECRET. Webhook trigger (v2): same connection > Webhooks tab > + Create a subscription > URL https://<app>/api/events/notion > paste back the verification_token that Notion POSTs.
- MANUAL: Airtable - https://airtable.com/create/oauth > Register new OAuth integration: name, redirect URL https://<app>/api/oauth/airtable/callback, scopes data.records:read data.records:write schema.bases:read webhook:manage; Generate client secret (shown once) -> AIRTABLE_CLIENT_ID / AIRTABLE_CLIENT_SECRET.
- MANUAL: Linear - each user creates a personal API key at https://linear.app/settings/account/security and pastes it into PapaFlow. OAuth path (optional): https://linear.app/settings/api/applications/new, redirect https://<app>/api/oauth/linear/callback, scopes read write issues:create (+ admin for webhooks); tokens expire in 24h with rotating refresh tokens.
- MANUAL: GitHub - each user creates a fine-grained PAT at https://github.com/settings/personal-access-tokens/new: Resource owner, Repository access = Only select repositories, Repository permissions Issues: Read and write (+ Webhooks: Read and write for the trigger). Org-owned repos may need owner approval.
- MANUAL: Stripe - https://dashboard.stripe.com/webhooks (Workbench > Webhooks) > Create an event destination > Your account > choose event types > Continue > Webhook endpoint > Endpoint URL https://<app>/api/events/stripe/<connectionId> > Reveal secret > paste whsec_ into PapaFlow (test and live secrets differ).
- npm install -g @stripe/cli   # or: brew install stripe   (local binary is 1.41.2; latest 1.50.8)
- stripe login
- stripe listen --forward-to localhost:3000/api/events/stripe/<connectionId> --events payment_intent.succeeded   # prints whsec_..., stable across restarts; --print-secret prints only the secret
- stripe trigger payment_intent.succeeded
- stripe events resend <evt_id> --webhook-endpoint=<we_id>   # manual redelivery, up to 30 days
- npm view stripe version   # 22.6.1
- npm view @notionhq/client version   # 5.26.0 (defaults to Notion-Version 2025-09-03; pass notionVersion)
- npm view @linear/sdk version   # 92.0.0
- npm view @octokit/webhooks-methods version   # 6.0.0 (optional verify()/sign() helpers)

## NON-CONFIRMED FACTS (9 of 40)
- [wrong] @notionhq/client sends Notion-Version 2026-03-11 by default.
  TRUTH: @notionhq/client 5.26.0: Client.defaultNotionVersion = "2025-09-03" (README: 'The default is 2025-09-03'). Pass new Client({ auth, notionVersion: "2026-03-11" }) or use plain fetch with the header. SDK has pages.create, dataSources.*, oauth.token/oauth.introspect/oauth.revoke; there is no oauth.refresh method (refresh via oauth.token with grant_type 'refresh_token').
  SRC: https://raw.githubusercontent.com/makenotion/notion-sdk-js/main/src/Client.ts ; https://raw.githubusercontent.com/makenotion/notion-sdk-js/main/README.md ; npm view @notionhq/client version
- [wrong] Notion 2026-03-11 changes page create / data sources / OAuth.
  TRUTH: Only: Append block children `after` -> `position` {after_block|start|end}; `archived` -> `in_trash` (REST bodies only, not webhook payloads); block type `transcription` -> `meeting_notes`. 'Webhook event payloads are identical between 2025-09-03 and 2026-03-11.' Data sources arrived in 2025-09-03.
  SRC: https://developers.notion.com/docs/upgrade-guide-2026-03-11 ; https://developers.notion.com/page/changelog (2026-03-11 entry)
- [partially] Notion page parent must be data_source_id (PLAN.md L119, L443).
  TRUTH: POST /v1/pages parent accepts page_id, database_id, data_source_id, or workspace (public connections/PATs only). For a database row use {"parent":{"data_source_id":"..."}} (type key optional in the docs example). Data source ids: GET /v1/databases/{database_id} -> data_sources: [{id, name}] (max 100).
  SRC: https://developers.notion.com/reference/post-page ; https://developers.notion.com/reference/retrieve-a-database
- [partially] Notion issues refresh tokens and rotates them (PLAN.md L174, L191 refreshRotates:true).
  TRUTH: Refresh: POST /v1/oauth/token (Basic auth + Notion-Version) body {grant_type:"refresh_token", refresh_token}; response has the same shape as the code exchange. Docs: 'Refreshing an access token will generate a new access token and a new refresh token.' and 'Store the token pair from each successful authorization response. This includes re-authorization of the same connection, where Notion may return a new access_token and refresh_token.' Changelog 2026-06-08: new public connections mint a fresh pair per authorization. NOT documented: access-token lifetime, expires_in, or whether the old refresh token is invalidated. Implement expiresAt=null, refresh reactively on 401, always overwrite the pair; measure lifetime at install time.
  SRC: https://developers.notion.com/reference/refresh-a-token ; https://developers.notion.com/docs/authorization ; https://developers.notion.com/page/changelog
- [partially] Notion developer portal URL and public-connection form fields.
  TRUTH: Portal: https://app.notion.com/developers/connections (confirmed). Public connection requires redirect URI(s) 'which cannot be changed afterwards' and an installation scope (any workspace / selected). Client ID/secret are 'in the Developer portal' (Configuration tab per the internal-connection text). The company name / privacy policy / terms / support email fields claimed earlier were not found on the page - verify in the portal.
  SRC: https://developers.notion.com/docs/authorization (re-fetched)
- [partially] Airtable token endpoint uses Basic auth with base64(client_id:client_secret) (PLAN.md L172, L198).
  TRUTH: POST https://airtable.com/oauth2/v1/token, application/x-www-form-urlencoded: grant_type=authorization_code&code&code_verifier&redirect_uri (+client_id when no secret). With a client_secret the Authorization header is 'Required'; without one it is 'forbidden'. Docs wording: 'Basic {credentials}, where credentials is the base64 url-encoding of {client_id}:{client_secret}' - but Airtable's official oauth-example uses Buffer.from(`${clientId}:${clientSecret}`).toString('base64') (standard base64, per RFC 7617). Use standard base64; if the secret ever yields +/ characters and the server rejects, retry base64url at install time.
  SRC: https://airtable.com/developers/web/api/oauth-reference ; https://raw.githubusercontent.com/Airtable/oauth-example/main/index.js
- [wrong] Linear OAuth tokens do not expire / PLAN.md has no refresh path for Linear.
  TRUTH: 'The access token is valid for 24 hours and will need to be refreshed when it expires.' Response includes expires_in: 86399 and refresh_token. Refresh: POST /oauth/token with grant_type=refresh_token&refresh_token (+client_id/client_secret) returns a new pair; 'Requests to consume a refresh token and obtain a new one have a 30-minute grace period'. 'All OAuth2 applications were migrated to the new refresh token system on April 1, 2026.' Add linear to the rotating-refresh path if OAuth is built.
  SRC: https://linear.app/developers/oauth-2-0-authentication
- [partially] GitHub REST API version header value is 2022-11-28.
  TRUTH: Supported: 2026-03-10 (latest) and 2022-11-28; 'Requests without the X-GitHub-Api-Version header will default to use the 2022-11-28 version.' Current doc examples send 2026-03-10. Pin explicitly.
  SRC: https://docs.github.com/en/rest/about-the-rest-api/api-versions
- [wrong] AAD is `${userId}:${connectionId}` (PLAN.md L252).
  TRUTH: CLAUDE.md rule 2 says AAD = `${orgId}:${connectionId}` and rule 12 makes ownership organisational; PLAN.md L252 contradicts it. Use orgId so a connection survives the creating user leaving the org.
  SRC: /Users/sonnysangha/Downloads/papaflow/CLAUDE.md L76, L86 vs docs/PLAN.md L252

## CONFIRMED FACTS
- Notion-Version: 2026-03-11 is the current header value (PLAN.md L119, L443). → Versioning page lists 2021-05-13, 2022-06-28, 2025-09-03, 2026-03-11 with 2026-03-11 latest; 'The Notion-Version header must be included in all REST API requests.' Beta features use an extra Notion-Beta header (e.g. notion-as-code-2026-07-31), not a new versio
- List data sources shared with the integration via search filter. → POST https://api.notion.com/v1/search body {"filter":{"property":"object","value":"data_source"}}; docs: 'use the filter parameter with property: "object" and a value of "page" or "data_source"'. "database" is not an allowed value. Optional query, sort, start_
- Notion OAuth: authorize with owner=user, token endpoint with Basic auth (PLAN.md L187-193). → GET https://api.notion.com/v1/oauth/authorize?client_id&redirect_uri&response_type=code&owner=user&state (owner 'Must be user'). POST https://api.notion.com/v1/oauth/token: Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET), Content-Type: application/json, N
- Notion token response fields: workspace_id, workspace_name, bot_id (+ refresh_token). → 200: access_token, token_type "bearer", refresh_token (string|null), bot_id (UUID), workspace_id (UUID), workspace_name (string|null), workspace_icon (string|null), owner (user|workspace), duplicated_template_id (UUID|null), request_id. No expires_in in the sc
- Notion webhook subscriptions are UI-only and payloads carry IDs only (PLAN.md L119, L443). → Connection settings > Webhooks tab > '+ Create a subscription'; Notion POSTs {verification_token} once, paste it back in the UI. Header X-Notion-Signature = 'sha256=<hex HMAC-SHA256(raw body, verification_token)>'. Payload: id, timestamp (ISO 8601), workspace_
- Airtable PKCE is mandatory (PLAN.md L120, L198). → GET https://airtable.com/oauth2/v1/authorize with client_id, redirect_uri, response_type=code, scope (space-delimited), state, code_challenge, code_challenge_method='S256' (only allowed value). code_verifier 'Must be a cryptographically generated string; 43-12
- Airtable access token 60 min, refresh token 60 days, rotates (PLAN.md L120, L198). → Response fields: access_token, refresh_token, token_type, scope, expires_in ('expected value is 60 minutes', seconds), refresh_expires_in ('expected value is 60 days'). 'When a refresh token is exchanged for an access token, the previous access and refresh tok
- Airtable scopes data.records:read, data.records:write, schema.bases:read, webhook:manage (PLAN.md L197). → webhook:manage = 'View, create, delete webhooks for a base, as well as fetch webhook payloads'; schema.bases:read = 'See the structure of a base'; data.records:read/write as expected. schema.bases:read is required by GET /v0/meta/bases and /v0/meta/bases/{base
- Airtable Meta API and create records. → GET https://api.airtable.com/v0/meta/bases -> {bases:[{id,name,permissionLevel}], offset?} 1000 per page. GET https://api.airtable.com/v0/meta/bases/{baseId}/tables?include=visibleFieldIds -> {tables:[{id,name,primaryFieldId,fields[],views[]}]}. POST https://a
- Airtable webhooks: X-Airtable-Content-MAC with macSecretBase64, 7-day expiry, cursor payload pull (PLAN.md L120, L140). → POST /v0/bases/{baseId}/webhooks {notificationUrl?, specification} -> {id, macSecretBase64 ('There is no way to retrieve this value after the initial creation'), expirationTime}. 'Creator level permissions are required'; max 10 webhooks per base, 2 per OAuth i
- Airtable rate limit 5 req/s per base (PLAN.md L120). → '5 requests per second per base'; 50 req/s per user/service-account token; on 429 'wait 30 seconds before subsequent requests will succeed'.
- Airtable OAuth integration registration portal. → https://airtable.com/create/oauth: unique name, valid redirect URL(s), scopes. Client secret is optional but 'should' be generated 'if you will be issuing token requests from a server'; 'not recoverable', can be deleted/regenerated.
- Linear GraphQL header is the bare key, no Bearer (PLAN.md L121). → Personal API key: `Authorization: <API_KEY>`; OAuth: `Authorization: Bearer <ACCESS_TOKEN>`. @linear/sdk client.ts: `Authorization: accessToken ? (accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`) : (apiKey ?? "")`. Endpoint POST https
- Validate a Linear key with { viewer { id } } and create issues with issueCreate (PLAN.md L121). → query Me { viewer { id name email } }; mutation IssueCreate { issueCreate(input:{ title, description, teamId }) { success issue { id title } } }. Other IssueCreateInput fields come from the schema/SDK types.
- Linear OAuth scopes and actor (PLAN.md L121 'admin'). → GET https://linear.app/oauth/authorize: client_id, redirect_uri, response_type=code, scope (read [always], write, issues:create, comments:create, timeSchedule:write, admin), state, prompt=consent, actor=user|app; PKCE supported (code_challenge + code_challenge
- Linear webhooks need a workspace admin or an OAuth app with admin scope (PLAN.md L121). → 'Only workspace admins, or OAuth applications with the admin scope, can create or read webhooks.' mutation { webhookCreate(input:{ url, teamId | allPublicTeams:true, resourceTypes:["Issue"] }) { success webhook { id enabled } } }. 'OAuth applications can confi
- Linear rate limits. → API key 2,500 req/h + 3,000,000 complexity points/h per user; OAuth app 5,000 req/h + 2,000,000 points/h per user; rate-limit error is HTTP 400 with errors[].extensions.code 'RATELIMITED' (not 429) - the RetryableError-on-429 rule needs a GraphQL-error branch.
- GitHub X-Hub-Signature-256 is 'sha256=<hex>' and must be compared constant-time (PLAN.md L139). → 'The hash signature always starts with sha256='; 'Never use a plain == operator... crypto.timingSafeEqual'. Test vector reproduced locally: HMAC-SHA256("It's a Secret to Everybody", "Hello, World!") = 757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b0
- GitHub repo webhook created via API with a generated secret (PLAN.md L139). → POST /repos/{owner}/{repo}/hooks {name:"web", active:true (default), events:[...] (default ["push"]), config:{url, content_type:"json" (default form), secret, insecure_ssl:"0"}} -> 201. Fine-grained PAT: Repository permissions 'Webhooks' write.
- GitHub create issue endpoint and PAT permission (PLAN.md L122). → POST /repos/{owner}/{repo}/issues body title (required), body, assignees[], milestone, labels[], type, issue_field_values, parent_issue_id -> 201. Permissions page: POST /repos/{owner}/{repo}/issues under 'Repository permissions for Issues' = write. 'Creating 
- GitHub: 80 content-creating requests per minute (PLAN.md L122). → 'no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour'; 900 points/min per endpoint; 100 concurrent; primary 5,000 req/h per user; limit responses are 403 or 429 with x-ratelimit-remaining: 0 (+ retry
- GitHub fine-grained PAT details. → Create at https://github.com/settings/personal-access-tokens/new; 'Each token is limited to access resources owned by a single user or organization'; default expiry 30 days, no-expiry allowed unless org policy forbids; org owners can require approval (token 'p
- Stripe: HMAC over t.rawBody, 5-min tolerance, dedupe on event.id (PLAN.md L123, L138). → Stripe-Signature single line 't=<unix>,v1=<hex>[,v0=<hex>]'; split on ',' then '='; signed_payload = timestamp + '.' + raw request body; HMAC-SHA256 keyed with whsec_; constant-time compare against every v1; 'ignore all schemes that aren't v1'; multiple v1 dur
- Stripe retries for 3 days (PLAN.md L138). → 'Stripe attempts to deliver events to your destination for up to three days with an exponential back off in live mode... We retry event deliveries created in a sandbox three times over the course of a few hours.' Return 2xx before heavy logic; ordering not gua
- Stripe Event object fields for dedupe. → id (evt_...), object 'event', account (nullable), api_version (nullable), context (nullable), created (unix seconds), data {object, previous_attributes}, livemode, pending_webhooks, request {id, idempotency_key} (nullable), type.
- stripe-node constructEvent signature and default tolerance. → DEFAULT_TOLERANCE: 300 (5 minutes). constructEvent(payload: WebhookPayload, header: WebhookHeader, secret: string, tolerance?: number, cryptoProvider?: CryptoProvider, receivedAt?: number): Event; constructEventAsync same -> Promise<Event>; throws StripeSignat
- Stripe CLI available for local forwarding. → `npm install -g @stripe/cli` (docs) or brew; `stripe login`; `stripe listen --forward-to localhost:3000/...` prints 'Ready! Your webhook signing secret is whsec_...'; 'The webhook signing secret provided will not change between restarts to the listen command.'
- Stripe webhook endpoint is created by the user pasting our URL in their dashboard (PLAN.md L123). → Workbench > Webhooks (https://dashboard.stripe.com/webhooks) > Create an event destination > Your account > API version + event types > Continue > Webhook endpoint > Endpoint URL > Reveal secret (whsec_). API alternative: POST /v2/core/event_destinations {type
- PKCE S256: code_challenge = base64url(sha256(verifier)) with 43-128 char verifier. → RFC 7636: code_verifier = 43-128 unreserved chars [A-Z]/[a-z]/[0-9]/'-'/'.'/'_'/'~'; code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier))); params code_challenge + code_challenge_method on authorize, code_verifier on token; 'If the client is capable 
- PLAN.md seal/open call order (setAAD before update; getAuthTag after final; setAuthTag before final) is correct for Node 24 (PLAN.md L232-253). → Node v24 docs: 'The cipher.setAAD() method must be called before cipher.update()'; 'The cipher.getAuthTag() method should only be called after encryption has been completed using the cipher.final() method'; 'The decipher.setAuthTag() method must be called befo
- CLAUDE.md L115 env list: NOTION_CLIENT_ID/SECRET, AIRTABLE_CLIENT_ID/SECRET; Linear/GitHub/Stripe need none. → Linear API key, GitHub fine-grained PAT and Stripe whsec_ are per-connection secrets in the vault. Add LINEAR_CLIENT_ID/SECRET only if the Linear OAuth path (with 24h tokens + refresh) is built; a Linear webhook signing secret is per webhook and belongs in the

## SNIPPETS
### Notion: create page under a data source (Notion-Version 2026-03-11)
```
await fetch("https://api.notion.com/v1/pages", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": "2026-03-11",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: { Name: { title: [{ text: { content: title } }] } },
  }),
});
// data sources: POST /v1/search { filter: { property: "object", value: "data_source" } }
//           or GET /v1/databases/{database_id} -> data_sources[{ id, name }]
// If using @notionhq/client: new Client({ auth, notionVersion: "2026-03-11" }) (SDK default is 2025-09-03)
```
### Notion OAuth token exchange / refresh (Basic auth, JSON body, Notion-Version required)
```
const basic = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString("base64");
const res = await fetch("https://api.notion.com/v1/oauth/token", {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", "Notion-Version": "2026-03-11" },
  body: JSON.stringify(
    code ? { grant_type: "authorization_code", code, redirect_uri }
         : { grant_type: "refresh_token", refresh_token }),
});
// { access_token, token_type:"bearer", refresh_token: string|null, bot_id, workspace_id,
//   workspace_name, workspace_icon, owner, duplicated_template_id, request_id }  -- no expires_in
// -> expiresAt = null; on 401 refresh once and overwrite the pair; on refresh_token null mark needs_reconnect
// authorize: https://api.notion.com/v1/oauth/authorize?client_id&redirect_uri&response_type=code&owner=user&state
```
### Notion webhook signature (X-Notion-Signature)
```
import { createHmac, timingSafeEqual } from "node:crypto";
const raw = await req.text();
const body = JSON.parse(raw);
if (body.verification_token) { /* first call: store it, paste into Notion UI */ return new Response(null, { status: 200 }); }
const expected = "sha256=" + createHmac("sha256", verificationToken).update(raw).digest("hex");
const got = req.headers.get("x-notion-signature") ?? "";
const ok = got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
// event: { id, timestamp, workspace_id, subscription_id, integration_id, type, authors[], accessible_by[],
//          attempt_number, entity:{id,type}, data:{...} } -> fetch the page/data source by id
```
### PKCE S256 (RFC 7636) in Node - verified locally
```
import { randomBytes, createHash } from "node:crypto";
const verifier = randomBytes(64).toString("base64url");   // 86 chars, unreserved set, within 43-128
const challenge = createHash("sha256").update(verifier).digest("base64url"); // 43 chars, no '=' padding
// authorize: &code_challenge=${challenge}&code_challenge_method=S256
// token:     code_verifier=${verifier}
```
### Airtable token exchange (PKCE + Basic auth, form body)
```
const basic = Buffer.from(`${AIRTABLE_CLIENT_ID}:${AIRTABLE_CLIENT_SECRET}`).toString("base64"); // standard base64, as in Airtable's oauth-example
const res = await fetch("https://airtable.com/oauth2/v1/token", {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(code
    ? { grant_type: "authorization_code", code, code_verifier, redirect_uri }
    : { grant_type: "refresh_token", refresh_token }),
});
// { access_token, refresh_token, token_type:"Bearer", scope, expires_in: 3600, refresh_expires_in: 5184000 }
// previous access+refresh are invalidated on refresh -> overwrite the pair; 409 = refreshed too recently
// no client secret? omit the Authorization header (it is 'forbidden') and send client_id in the body
```
### Airtable webhook ping verification + payload pull
```
import { createHmac, timingSafeEqual } from "node:crypto";
const raw = await req.text();
const expected = "hmac-sha256=" + createHmac("sha256", Buffer.from(macSecretBase64, "base64")).update(raw, "ascii").digest("hex");
const got = req.headers.get("x-airtable-content-mac") ?? "";
const ok = got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
// ping body: { base:{id}, webhook:{id}, timestamp } -> respond 200, then in a step:
// GET https://api.airtable.com/v0/bases/{baseId}/webhooks/{webhookId}/payloads?cursor=${cursor}&limit=50
// -> { payloads[], cursor, mightHaveMore, payloadFormat }  (this call also extends expiry to now+7d)
// create: POST /v0/bases/{baseId}/webhooks { notificationUrl, specification:{ options:{ filters:{ dataTypes:["tableData"] } } } }
// -> { id, macSecretBase64 (shown once), expirationTime }; refresh: POST .../webhooks/{id}/refresh
```
### Linear: auth header + validation + issueCreate + RATELIMITED handling
```
const headers = {
  "Content-Type": "application/json",
  Authorization: kind === "apiKey" ? apiKey : `Bearer ${accessToken}`, // API key bare, OAuth Bearer
};
const gql = (query: string, variables?: object) =>
  fetch("https://api.linear.app/graphql", { method: "POST", headers, body: JSON.stringify({ query, variables }) });
await gql("{ viewer { id name email } }");
const r = await gql(`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`,
  { input: { teamId, title, description } });
const json = await r.json();
if (json.errors?.some((e: any) => e.extensions?.code === "RATELIMITED")) throw new RetryableError("linear rate limited", { retryAfter: 60_000 }); // HTTP 400, not 429
// OAuth tokens: expires_in 86399 (24h), refresh_token rotates -> put linear on the refresh path
```
### Linear webhook verification (Linear-Signature)
```
const raw = await req.text();
const sig = createHmac("sha256", webhookSecret).update(raw).digest("hex");
const got = req.headers.get("linear-signature") ?? "";
const ok = got.length === sig.length && timingSafeEqual(Buffer.from(sig), Buffer.from(got));
const body = JSON.parse(raw); // { action, type, actor, data, url, createdAt, updatedFrom?, organizationId, webhookId, webhookTimestamp }
if (!ok || Math.abs(Date.now() - body.webhookTimestamp) > 60_000) return new Response(null, { status: 401 });
// respond 200 within 5s; retries at 1m, 1h, 6h
```
### GitHub: create issue + create repo webhook + verify X-Hub-Signature-256
```
const gh = { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" };
await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, { method: "POST", headers: gh, body: JSON.stringify({ title, body, labels }) }); // 201; PAT Issues: write
await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, { method: "POST", headers: gh,
  body: JSON.stringify({ name: "web", active: true, events: ["issues", "pull_request"], config: { url, content_type: "json", secret, insecure_ssl: "0" } }) }); // 201; PAT Webhooks: write
const raw = await req.text();
const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
const got = req.headers.get("x-hub-signature-256") ?? "";
const ok = got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
// event = req.headers.get("x-github-event"), delivery id = req.headers.get("x-github-delivery")
```
### Stripe: verify with stripe-node in a Next.js route handler
```
import Stripe from "stripe";
const stripe = new Stripe("sk_unused_for_verify"); // constructEvent needs no API call
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(raw, sig, whsec /* per connection */, 300); }
  catch { return new Response("bad signature", { status: 400 }); }
  // dedupe on event.id (also data.object.id + event.type), then start() the run; return 200 fast
  return Response.json({ received: true });
}
```
### Stripe: manual verification (no SDK)
```
const parts = sig.split(",").map(p => p.split("=") as [string, string]);
const t = parts.find(([k]) => k === "t")?.[1] ?? "";
const v1s = parts.filter(([k]) => k === "v1").map(([, v]) => v);      // ignore v0 and unknown schemes
const expected = createHmac("sha256", whsec).update(`${t}.${raw}`).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(t)) <= 300;
const ok = fresh && v1s.some(v => v.length === expected.length && timingSafeEqual(Buffer.from(v), Buffer.from(expected)));
```
### lib/vault.ts AES-256-GCM (order executed and verified on Node v24.14.1)
```
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
const kek = () => Buffer.from(process.env.CREDENTIALS_KEK!, "base64"); // 32 bytes
export function seal(plain: object, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", kek(), iv);
  c.setAAD(Buffer.from(aad));                       // must precede update()
  const ct = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();                       // after final(); 16 bytes
  return { v: 1, keyId: "k1", iv: iv.toString("base64"), tag: tag.toString("base64"), ct: ct.toString("base64") };
}
export function open(s: Sealed, aad: string) {
  const d = createDecipheriv("aes-256-gcm", kek(), Buffer.from(s.iv, "base64"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.tag, "base64"));       // before final() for GCM
  return JSON.parse(Buffer.concat([d.update(Buffer.from(s.ct, "base64")), d.final()]).toString("utf8"));
}
// aad = `${orgId}:${connectionId}` (CLAUDE.md rule 2). Wrong AAD -> throws 'Unsupported state or unable to authenticate data'.
```
