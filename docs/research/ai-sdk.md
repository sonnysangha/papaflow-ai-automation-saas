# verify:ai-sdk

## SUMMARY
ai@7.0.90 is dist-tag latest (published 2026-09-02); ESM-only ("type":"module", 7.0.0 changelog "Remove CommonJS exports from all packages"), engines node>=22, peerDependency zod "^3.25.76 || ^4.1.8" (pin zod 4.5.4). Every @ai-sdk/* provider is ESM, node>=22, same zod peer. CLAUDE.md rule 9 and PLAN gotchas hold: ToolLoopAgent/isStepCount/instructions/Output.object/@ai-sdk/mcp are all verified against the raw source. Corrections to the first researcher: (1) `agent.stream()` is declared `async` and returns `Promise<StreamTextResult>` in source (docs prose says "returns a StreamTextResult") — always `await agent.stream(...)`. (2) `toolApproval` values are richer than "'user-approval' | undefined": a per-tool map or generic function may return 'not-applicable' | 'approved' | 'denied' | 'user-approval' | undefined; `needsApproval` JSDoc: "@deprecated Tool approval is handled on a generateText / streamText level now." (3) The brief's Google URL (/google-generative-ai) 404s; the page is /providers/ai-sdk-providers/google. (4) fal docs now state an invalid key returns 401; `/v1/models` auth is optional and `/v1/models/usage` needs Admin scope, so a cheap authenticated run remains the only validation for a normal key. (5) Anthropic: the models overview says "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on"; Haiku's Claude API ID is `claude-haiku-4-5-20251001` with alias `claude-haiku-4-5`; whether GET /v1/models returns aliases or dated ids is still unverifiable without a key. (6) claude-api skill gotchas that affect AI SDK usage: on Fable 5/5.1, Opus 5, Sonnet 5 `temperature/top_p/top_k` and `budget_tokens` are rejected (400), and on claude-fable-5-1 forced tool choice (`toolChoice: 'required'` / named tool) returns 400 — the LLM node must not blindly pass temperature to Anthropic 5-series. generateObject/streamObject remain exported with "@deprecated Use `generateText` with an `output` setting instead." (vendor skill's "removed in v6" is wrong). Image/speech/STT are stable exports (generateImage, generateSpeech, transcribe); only experimental_streamTranscribe stays experimental. Public model catalogues need no auth: GET ai-gateway.vercel.sh/v1/models (data[].id, dot-versioned e.g. anthropic/claude-fable-5.1) and openrouter.ai/api/v1/models (data[].id). Gateway per-request BYOK is providerOptions.gateway.byok.{provider}[]; Vercel confirms failing BYOK keys fall back to system credentials billed to your credits, budgets don't cap BYOK; detect via providerMetadata.gateway.routing.modelAttempts[].providerAttempts[].credentialType. Both local vercel-plugin 0.30.0 skills are v6-era and stale.

## VERSIONS
{
"ai": "7.0.90",
"@ai-sdk/openai": "4.0.56",
"@ai-sdk/anthropic": "4.0.48",
"@ai-sdk/google": "4.0.62",
"@ai-sdk/xai": "4.0.53",
"@ai-sdk/mistral": "4.0.39",
"@ai-sdk/groq": "4.0.37",
"@ai-sdk/deepseek": "3.0.39",
"@ai-sdk/elevenlabs": "3.0.37",
"@ai-sdk/fal": "3.0.37",
"@ai-sdk/gateway": "4.0.72",
"@ai-sdk/mcp": "2.0.43",
"@ai-sdk/replicate": "3.0.37",
"@ai-sdk/deepgram": "3.1.7",
"@ai-sdk/provider": "4.0.10",
"@ai-sdk/provider-utils": "5.0.36",
"@ai-sdk/otel": "1.0.90",
"@ai-sdk/codemod": "4.0.1",
"@openrouter/ai-sdk-provider": "3.0.0",
"zod": "4.5.4"
}

## COMMANDS
- npm view ai version dist-tags engines type peerDependencies dependencies --json
- npm view @openrouter/ai-sdk-provider version peerDependencies --json
- npx @ai-sdk/codemod v7   # only when migrating v6 code; not needed greenfield
- curl -s https://ai-gateway.vercel.sh/v1/models | jq -r '.data[].id'   # public gateway catalogue, no auth (ids use dots: anthropic/claude-fable-5.1)
- curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $KEY" | jq -r '.data[].id'
- curl -s 'https://api.anthropic.com/v1/models?limit=1000' -H "x-api-key: $KEY" -H 'anthropic-version: 2023-06-01' | jq -r '.data[].id'   # persist exactly what comes back (dateless vs dated ids)
- curl -s 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' -H "x-goog-api-key: $KEY" | jq -r '.models[] | select(.supportedGenerationMethods|index("generateContent")) | .name' | sed 's#^models/##'
- curl -s https://api.x.ai/v1/api-key -H "Authorization: Bearer $KEY" | jq '{api_key_blocked,api_key_disabled,team_blocked}'   # validate; then:
- curl -s https://api.x.ai/v1/language-models -H "Authorization: Bearer $KEY" | jq -r '.models[].id'   # or /v1/models → .data[].id ; /v1/image-generation-models → .models[].id
- curl -s https://api.mistral.ai/v1/models -H "Authorization: Bearer $KEY" | jq -r '.data[] | select(.capabilities.completion_chat) | .id'
- curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $KEY" | jq -r '.data[].id'
- curl -s https://api.deepseek.com/models -H "Authorization: Bearer $KEY" | jq -r '.data[].id'
- curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $KEY" | jq '.data | {label,limit,limit_remaining,usage,is_free_tier}'
- curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id'   # public, no auth needed
- curl -s https://api.elevenlabs.io/v1/user -H "xi-api-key: $KEY" | jq '{user_id, tier: .subscription.tier, status: .subscription.status}'
- curl -s https://api.elevenlabs.io/v1/models -H "xi-api-key: $KEY" | jq -r '.[] | select(.can_do_text_to_speech) | .model_id'
- curl -s 'https://api.elevenlabs.io/v2/voices?page_size=100' -H "xi-api-key: $KEY" | jq -r '.voices[] | "\(.voice_id) \(.name)"'
- curl -s -o /dev/null -w '%{http_code}' -X POST https://fal.run/fal-ai/flux/schnell -H "Authorization: Key $KEY" -H 'Content-Type: application/json' -d '{"prompt":"test","image_size":"square","num_images":1}'   # 401 = bad key (documented); /v1/models does NOT validate
- curl -s 'https://api.fal.ai/v1/models?limit=50&status=active' -H "Authorization: Key $KEY" | jq -r '.models[].endpoint_id'   # picker only; auth optional here
- curl -s https://api.replicate.com/v1/account -H "Authorization: Bearer $KEY" | jq '{type,username}'
- curl -s https://api.deepgram.com/v1/projects -H "Authorization: Token $KEY" | jq -r '.projects[].project_id'
- curl -s https://api.deepgram.com/v1/models -H "Authorization: Token $KEY" | jq -r '.stt[].canonical_name, .tts[].canonical_name'
- MANUAL: (optional, team-level BYOK only) Vercel dashboard → AI Gateway → Bring Your Own Key → Add → Test Key; per-request byok needs no dashboard step

## NON-CONFIRMED FACTS (7 of 45)
- [partially] ToolLoopAgent constructor options: model, instructions, tools, stopWhen: isStepCount(n); methods .generate({ prompt }) / .stream({ prompt }).
  TRUTH: import { ToolLoopAgent } from 'ai'. ToolLoopAgentSettings (source): id?, instructions? (string | SystemModelMessage), allowSystemInMessages? (@default false), model, tools?, toolChoice? (default 'auto'), stopWhen? ("@default isStepCount(20)"), telemetry?, activeTools?, toolOrder?, output?, toolApproval? ("takes precedence over tool-defined approval settings"), prepareStep?, providerOptions?, include?, callOptionsSchema?, repairToolCall?, onStart?, plus call settings (maxOutputTokens, temperature, headers…). There is NO `system` field on the settings type. generate(options: AgentCallParameters) → Promise<GenerateTextResult>; CORRECTION: `async stream(options: AgentStreamParameters): Promise<StreamTextResult<...>>` — stream() is async in source (docs prose says "Returns a StreamTextResult"); always `await agent.stream()`. Call params: prompt | messages, abortSignal?, timeout?, options?, onStart/onStepStart/onToolExecutionStart/onToolExecutionEnd/onStepEnd/onEnd (onStepFinish/onFinish still accepted as aliases).
  SRC: https://raw.githubusercontent.com/vercel/ai/main/packages/ai/src/agent/tool-loop-agent-settings.ts ; https://raw.githubusercontent.com/vercel/ai/main/packages/ai/src/agent/tool-loop-agent.ts ; https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent
- [partially] tool({ description, inputSchema, execute }) plus needsApproval.
  TRUTH: tool({ description?, inputSchema, outputSchema?, execute?: (input, { toolCallId, messages, abortSignal, context }) => …, contextSchema?, toModelOutput?, needsApproval? }). needsApproval JSDoc: "Whether the tool needs approval before it can be executed. @deprecated Tool approval is handled on a generateText / streamText level now." Use `toolApproval` on generateText/streamText/ToolLoopAgent: per-tool map `{ runCommand: 'user-approval' }` or per-tool fn `async (input) => cond ? 'user-approval' : undefined`, or a GenericToolApprovalFunction; valid returns: 'not-applicable' | 'approved' | 'denied' | 'user-approval' | undefined. Answer with `{ type: 'tool-approval-response', approvalId, approved: boolean }` in a role:'tool' message. Docs: "The older needsApproval property on tool() definitions is deprecated."
  SRC: https://raw.githubusercontent.com/vercel/ai/main/packages/provider-utils/src/types/tool.ts ; https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling.md ; https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0.md
- [unverifiable] Anthropic list-models endpoint returns exactly the ids named in CLAUDE.md/PLAN.
  TRUTH: GET /v1/models docs example returns `"id":"claude-opus-5"` (created_at 2026-07-24), newest first, with capabilities/max_input_tokens/max_tokens; the overview says the Haiku Claude API ID is the dated `claude-haiku-4-5-20251001`. Whether the list includes alias rows was not checked (no key in this read-only session). At install: run the Anthropic curl in commands, persist ids verbatim, and treat both dated and dateless forms as valid.
  SRC: https://platform.claude.com/docs/en/api/models-list ; https://platform.claude.com/docs/en/about-claude/models/overview
- [partially] Gemini models today: gemini-3.7-flash, gemini-3.1-pro-preview, gemini-3.1-flash-image (PLAN 89).
  TRUTH: Google page: language gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.1-pro-preview, gemini-3.1-flash-image-preview, gemini-3.1-flash-lite-preview, gemini-3-pro-preview, gemini-2.5-pro/flash/flash-lite, gemma-3-*; image models gemini-3.1-flash-image-preview, gemini-3-pro-image-preview, gemini-2.5-flash-image; TTS gemini-3.1-flash-tts-preview, gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts; embeddings gemini-embedding-2. Fix PLAN: `gemini-3.1-flash-image-preview`, not `gemini-3.1-flash-image`.
  SRC: https://ai-sdk.dev/providers/ai-sdk-providers/google
- [partially] fal.ai: @ai-sdk/fal · generateImage; fal-ai/flux/dev, recraft/v3, Wizper STT; Authorization: Key.
  TRUTH: import { createFal } from '@ai-sdk/fal'; apiKey env FAL_API_KEY then FAL_KEY, header `Authorization: Key <key>`, baseURL default 'https://fal.run'. fal.image(), fal.transcription(), fal.speech(). Listed image ids: fal-ai/flux/dev, fal-ai/flux-pro/kontext(/max), fal-ai/flux-lora, fal-ai/qwen-image, fal-ai/recraft/v3/text-to-image (PLAN's `recraft/v3` should be this full endpoint id), fal-ai/wan/v2.2-a14b/text-to-image, etc. flux/schnell is not on the provider page but is fal's own auth-doc example endpoint.
  SRC: https://ai-sdk.dev/providers/ai-sdk-providers/fal ; https://fal.ai/docs/reference/platform-apis/authentication
- [partially] fal.ai: any list endpoint, or only a cheap call, to validate a key (PLAN: cheap flux/schnell call)?
  TRUTH: GET https://api.fal.ai/v1/models?limit&cursor&q&category&status=active|deprecated&endpoint_id&expand → { models:[{ endpoint_id, metadata{…} }], next_cursor, has_more } — but "Optional. Providing an API key grants higher rate limits", so it does not validate a key. fal auth docs: header `Authorization: Key YOUR_API_KEY`; invalid key → 401 Unauthorized; `GET https://api.fal.ai/v1/models/usage` exists but requires Admin scope (not usable for ordinary keys). Keep PLAN's approach: POST https://fal.run/fal-ai/flux/schnell (fal's own auth example) and treat 401 as invalid; use /v1/models for the picker.
  SRC: https://fal.ai/docs/platform-apis/v1/models ; https://fal.ai/docs/reference/platform-apis/authentication
- [wrong] Local vendor skills (vercel-plugin 0.30.0 ai-sdk and ai-gateway) are current for AI SDK 7.
  TRUTH: Both target ai v6: ai-sdk SKILL.md validate rules say `stopWhen: stepCountIs(N)`, "generateObject was removed in AI SDK v6", `Experimental_Agent is deprecated in v6`, docs at node_modules/ai/docs for ai@6.0.34+; references/common-errors.md uses stepCountIs and claude-opus-4.5; ai-gateway SKILL.md pins ai@^6.0.0 / @ai-sdk/gateway@^3.0.0, uses experimental_generateImage and gemini-3.1-flash-image-preview/gpt-5.4/claude-sonnet-4.6. Use only for generic shapes (provider/model strings, providerOptions.gateway.order/only/models/user/tags, getAvailableModels).
  SRC: /Users/sonnysangha/.claude/plugins/cache/vercel-vercel-plugin/vercel-plugin/0.30.0/skills/ai-sdk/SKILL.md ; .../ai-sdk/references/common-errors.md ; .../ai-gateway/SKILL.md

## CONFIRMED FACTS
- Current "ai" major is 7; exact version to pin. → ai@7.0.90 is dist-tag latest (published 2026-09-02T03:17Z). ai-v6 (6.0.275) and ai-v5 (5.0.251) tags still patched. ai depends on @ai-sdk/gateway 4.0.72, @ai-sdk/provider 4.0.10, @ai-sdk/provider-utils 5.0.36.
- AI SDK 7 is ESM-only, Node 22+ (CLAUDE.md rule 9, PLAN gotcha 437). → package.json "type":"module", engines.node ">=22". Migration guide: "AI SDK 7.0 requires Node.js 22 or later." and "All AI SDK packages are now ESM-only. The require() function is no longer supported." 7.0.0 changelog: "Remove CommonJS exports from all package
- zod v3 vs v4 support in ai@7. → peerDependencies zod "^3.25.76 || ^4.1.8" on ai and every @ai-sdk/* package and @openrouter/ai-sdk-provider. 7.0.0 changelog: "chore: enforce consistent imports from `zod/v4` instead of `zod`". Latest zod 4.5.4 — pin it; import { z } from 'zod' (v4 default) or
- generateText({ output: Output.object({ schema }) }) replaces generateObject; result on result.output. → import { generateText, Output } from 'ai'. Output.object<OBJECT>({ schema: FlexibleSchema<OBJECT>; name?: string; description?: string }) → Output<OBJECT, DeepPartial<OBJECT>, never>. Value is `result.output` (migration guide: experimental_output→output, resul
- Output.choice exists for Classify (PLAN 104); is there Output.enum? → output.ts exports exactly five: text(), object({schema}), array({element}), choice<CHOICE extends string>({ options: Array<CHOICE>; name?; description? }) → Output<CHOICE, CHOICE, never>, json({name?,description?}). No Output.enum anywhere in source or docs.
- generateObject is deprecated (CLAUDE.md rule 9, PLAN 104/437). → packages/ai/src/index.ts has `export * from './generate-object'`; generate-object.ts JSDoc: "@deprecated Use `generateText` with an `output` setting instead." Deprecated-but-exported. The 7.0 migration guide does not mention it at all; the vercel-plugin ai-sdk
- streamText equivalents for structured output. → streamText({ output }) → result.partialOutputStream (Output.object, DeepPartial), result.elementStream (Output.array; "Each element emitted by elementStream is complete and validated"), `await result.output` (final). 7.0.0 changelog: "Deprecate `streamText` re
- isStepCount (not stepCountIs) and instructions (not system) — CLAUDE.md rule 9. → generate-text/index.ts: `export { hasToolCall, isLoopFinished, isStepCount, isStepCount as stepCountIs, type StopCondition }` — stepCountIs is a deprecated alias. 7.0.0 changelog: "rename `stepCountIs` to `isStepCount`" and "add `instructions` as the primary p
- jsonSchema() helper and dynamicTool exist in v7. → Both re-exported from 'ai' (index.ts re-exports dynamicTool, jsonSchema, tool, zodSchema, asSchema from @ai-sdk/provider-utils). jsonSchema<OBJECT>(schema: JSONSchema7, options?: { validate?: (value: unknown) => {success:true; value:OBJECT} | {success:false; e
- Image/speech/transcription export names in v7. → import { generateImage, generateSpeech, transcribe } from 'ai'. 7.0.0 changelog: "Remove deprecated experimental generateImage exports", "Promote `generateSpeech` and `SpeechResult` to stable exports", "Promote `transcribe` and `TranscriptionResult` to stable 
- Return shapes: image.uint8Array / base64, audio.uint8Array, text. → generateImage({ model, prompt, n?, size '{w}x{h}', aspectRatio '{w}:{h}', seed?, maxImagesPerCall?, providerOptions?, abortSignal?, headers? }) → { image: { base64, uint8Array, mediaType, providerMetadata? } | images[], warnings, calls }. generateSpeech({ mode
- OpenAI: @ai-sdk/openai · createOpenAI({ apiKey }), Responses API by default (PLAN 87). → import { createOpenAI } from '@ai-sdk/openai'; options baseURL, apiKey, name, organization, project, headers, fetch. "The default OpenAI model factory (openai('model-id')) uses the Responses API." openai.chat(id) = Chat Completions, openai.responses(id), opena
- OpenAI models today: GPT-5.6 family, gpt-image-2, gpt-4o-mini-tts, gpt-4o-transcribe (PLAN 87). → openai.md language table: gpt-5.6, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.5, gpt-5.4-pro, gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-5.3-chat-latest, gpt-5.2*, gpt-5.1*, gpt-5*, gpt-4.1*, gpt-4o*. gpt-image-2 appears in docs examples; gpt-4o-mini-tts an
- Anthropic: @ai-sdk/anthropic · createAnthropic({ apiKey }); x-api-key + anthropic-version: 2023-06-01. → import { createAnthropic } from '@ai-sdk/anthropic'; baseURL default 'https://api.anthropic.com/v1'; apiKey sent as x-api-key (authToken → Authorization: Bearer). Thinking: providerOptions.anthropic.thinking { type:'adaptive'|'enabled'|'disabled', budgetTokens
- Anthropic 5-series rejects sampling params, budget_tokens and (Fable 5.1) forced tool choice — impacts the LLM node. → claude-api skill (bundled 2.1.255, cached 2026-06-24): on Fable 5/5.1, Opus 5, Sonnet 5 `temperature/top_p/top_k` → 400, `{type:'enabled', budget_tokens}` → 400 (use adaptive); on claude-fable-5-1 `tool_choice` any/tool → 400 ("tool_choice: type \"tool\" and \
- Anthropic models today: claude-fable-5-1, claude-opus-5, claude-sonnet-5, claude-haiku-4-5-… (PLAN 88, CLAUDE rule 11). → Models overview table (live): Claude API IDs `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`); "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on
- Google: @ai-sdk/google · factory is createGoogle in v7 (old name kept as alias). → packages/google/src/index.ts: `export { createGoogle, google, /** @deprecated Use createGoogle instead. */ createGoogle as createGoogleGenerativeAI } from './google-provider'`. createGoogle({ apiKey → x-goog-api-key header (env GOOGLE_GENERATIVE_AI_API_KEY), b
- xAI: @ai-sdk/xai · createXai({ apiKey }); grok-4.6, grok-imagine-image; test via GET /v1/api-key. → import { createXai } from '@ai-sdk/xai'; baseURL default 'https://api.x.ai/v1', Bearer auth. "Since AI SDK 7, xai(modelId) uses the xAI Responses API by default." xai.chat() = Chat Completions, xai.responses(), xai.image('grok-imagine-image'|'grok-imagine-imag
- Mistral: @ai-sdk/mistral; mistral-large-latest, mistral-small-latest, Voxtral TTS/STT. → import { createMistral } from '@ai-sdk/mistral'; baseURL default 'https://api.mistral.ai/v1'. mistral(id); mistral.transcription('voxtral-mini-latest'); mistral.speech('voxtral-mini-tts-2603'); mistral.embedding('mistral-embed'). Listed: mistral-large-latest, 
- Groq: @ai-sdk/groq; llama-3.3-70b-versatile, openai/gpt-oss-120b, whisper-large-v3. → import { createGroq } from '@ai-sdk/groq'; baseURL default 'https://api.groq.com/openai/v1', Bearer. groq(id); groq.transcription('whisper-large-v3'|'whisper-large-v3-turbo'). Page lists llama-3.1-8b-instant, llama-3.3-70b-versatile, openai/gpt-oss-20b/120b, m
- DeepSeek: @ai-sdk/deepseek; deepseek-v4-flash/pro; deepseek-chat alias retired July 2026. → import { createDeepSeek, deepSeek } from '@ai-sdk/deepseek' (default instance is camelCase `deepSeek`); baseURL default 'https://api.deepseek.com'. Page: "DeepSeek retired the deepseek-chat and deepseek-reasoner aliases on July 24, 2026." Models: deepseek-v4-f
- OpenRouter: @openrouter/ai-sdk-provider (community, confirm the v7 peer dep). → @openrouter/ai-sdk-provider@3.0.0: peerDependencies { ai: '^7.0.0', zod: '^3.25.76 || ^4.1.8' }, node>=22, ESM. README table: v7 → latest; v6 → 2.9.1; v5 → 1.5.4. import { createOpenRouter } from '@openrouter/ai-sdk-provider'; createOpenRouter({ apiKey, header
- ElevenLabs: @ai-sdk/elevenlabs · generateSpeech; eleven_v3, eleven_flash_v2_5, scribe_v2; xi-api-key. → import { createElevenLabs, elevenLabs } from '@ai-sdk/elevenlabs' (instance `elevenLabs`); apiKey sent as xi-api-key (env ELEVENLABS_API_KEY). elevenLabs.speech('eleven_v3'|'eleven_multilingual_v2'|'eleven_flash_v2_5'|'eleven_flash_v2'|'eleven_turbo_v2_5'|…); 
- AI Gateway per-request BYOK option shape is providerOptions.gateway.byok (PLAN 103). → providerOptions: { gateway: { byok: { anthropic: [{ apiKey }], openai: [{ apiKey }], azure: [{ apiKey, resourceName, modelMappings? }], vertex: [{ project, location, googleCredentials:{ privateKey, clientEmail } }], bedrock: [{ accessKeyId, secretAccessKey, re
- A failing user key falls back to your credits and BYOK isn't capped by budgets; check provider metadata (PLAN 103/439). → Vercel BYOK page (updated 2026-07-31): "BYOK is available on the paid tier. When a request with your credentials fails, AI Gateway keeps it running by falling back to system credentials, and that fallback usage is billed against your credits balance. To use BY
- Gateway model catalogue can be listed programmatically. → gateway.getAvailableModels() → models[{ id, name, description?, pricing?{input,output,cachedInputTokens?,cacheCreationInputTokens?} }]. Unauthenticated GET https://ai-gateway.vercel.sh/v1/models → { object, data:[{ id }] }; verified live: ids use dots (anthrop
- MCP client moved to @ai-sdk/mcp; creation function name and transports. → npm i @ai-sdk/mcp (2.0.43). import { createMCPClient } from '@ai-sdk/mcp'; await createMCPClient({ transport: { type:'http', url, headers?, redirect? } | { type:'sse', url } | new Experimental_StdioMCPTransport({ command, args }) from '@ai-sdk/mcp/mcp-stdio' (
- OpenAI key validation + model list endpoint. → GET https://api.openai.com/v1/models, Authorization: Bearer <key> → { object:'list', data:[{ id, object:'model', created, owned_by, shutdown_date }] } → data[].id.
- Anthropic key validation + model list endpoint and headers. → GET https://api.anthropic.com/v1/models?limit=1..1000 (default 20)&after_id&before_id; headers x-api-key + anthropic-version: 2023-06-01 (official curl). Response { data:[{ id, display_name, created_at, type:'model', max_input_tokens, max_tokens, capabilities:
- Google Gemini key validation + model list endpoint. → GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=<=1000 (default 50)&pageToken; header x-goog-api-key (the api-key page shows only the header form). Response { models:[{ name:'models/…', displayName, supportedGenerationMethods[], inputToken
- xAI key validation via GET /v1/api-key; model list. → GET https://api.x.ai/v1/api-key (Bearer) → { redacted_api_key, api_key_id, user_id, name, team_id, create_time, modify_time, modified_by, acls[], api_key_blocked, api_key_disabled, team_blocked } — reject if any *_blocked/disabled is true. Lists (all Bearer): 
- Mistral key validation + model list. → GET https://api.mistral.ai/v1/models, Authorization: Bearer. The docs page renders the example as a bare array, but the official TS client's ModelList type is `{ object: string; data?: Array<BaseModelCard|FTModelCard> }` → use data[].id; each has capabilities{
- Groq key validation + model list. → GET https://api.groq.com/openai/v1/models, Authorization: Bearer gsk_… (+ Content-Type: application/json in docs example) → { object:'list', data:[{ id, … }] } → data[].id.
- DeepSeek key validation + model list. → GET https://api.deepseek.com/models, Authorization: Bearer → { object:'list', data:[{ id, object:'model', owned_by }] }; example ids deepseek-v4-flash, deepseek-v4-pro → data[].id.
- OpenRouter: GET /api/v1/key returns limits and usage; models list. → GET https://openrouter.ai/api/v1/key, Authorization: Bearer sk-or-v1-… → { data:{ label, limit (null=unlimited), limit_remaining, usage, usage_daily/weekly/monthly, byok_usage*, is_free_tier } } (rate_limit "deprecated in the response, safe to ignore"). GET ht
- ElevenLabs: which endpoint validates a key; which lists models/voices. → Validate: GET https://api.elevenlabs.io/v1/user, xi-api-key → { user_id, subscription:{ tier, status ('trialing'|'active'|'incomplete'|'past_due'|'free'|'free_disabled'), character_count, character_limit } }. Models: GET /v1/models (xi-api-key) → top-level arr
- Replicate and Deepgram official packages + validation endpoints (PLAN 98). → @ai-sdk/replicate 3.0.37: GET https://api.replicate.com/v1/account, Authorization: Bearer r8_… → { type, username, name, github_url }; GET /v1/models → { results:[{ owner, name }], next } (public catalogue). @ai-sdk/deepgram 3.1.7: GET https://api.deepgram.com
- Other v7 renames a plan author must know (not in CLAUDE.md). → onFinish→onEnd, onStepFinish→onStepEnd, experimental_onStart→onStart, streamText fullStream→stream, experimental_output→output (result.output), experimental_telemetry→telemetry (@ai-sdk/otel 1.0.90), experimental_context→context (runtimeContext/toolsContext), 

## SNIPPETS
### ai@7 core imports (all from 'ai')
```
import {
  generateText, streamText, Output,
  ToolLoopAgent, isStepCount, hasToolCall, isLoopFinished,
  tool, dynamicTool, jsonSchema, zodSchema,
  generateImage, generateSpeech, transcribe, experimental_streamTranscribe,
  gateway, createGateway,
  APICallError, NoObjectGeneratedError, NoSpeechGeneratedError,
  type ToolApprovalResponse,
} from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import type { GatewayProviderOptions } from '@ai-sdk/gateway';
// stepCountIs = deprecated alias of isStepCount; generateObject/streamObject exported but @deprecated
```
### Extract / Classify / LLM nodes (generateText + Output)
```
import { generateText, Output } from 'ai';
import { z } from 'zod';

// Extract
const { output } = await generateText({
  model, instructions: 'Extract fields.', prompt,
  output: Output.object({ schema: z.object({ name: z.string(), total: z.number() }) }),
});
// Classify (no Output.enum exists)
const { output: label } = await generateText({
  model, prompt,
  output: Output.choice({ options: ['billing', 'bug', 'other'] as const }),
});
// Plain LLM — do NOT pass temperature/toolChoice:'required' to Anthropic 5-series (400)
const { text, usage, finishReason, providerMetadata } = await generateText({
  model, instructions, prompt, maxOutputTokens: 1024,
});
```
### streamText structured output
```
const result = streamText({ model, prompt, output: Output.object({ schema }) });
for await (const partial of result.partialOutputStream) { /* DeepPartial<T> */ }
const final = await result.output;          // typed T
// Output.array({ element }) → result.elementStream (each element complete + validated)
// result.stream (v6 fullStream is deprecated); callbacks onEnd / onStepEnd (onFinish/onStepFinish deprecated)
```
### ToolLoopAgent (Runtime/Builder agent shape)
```
import { ToolLoopAgent, isStepCount, hasToolCall, tool } from 'ai';
import { z } from 'zod';

const agent = new ToolLoopAgent({
  model,
  instructions: 'You are the PapaFlow runtime agent.',   // no `system` field on the agent
  tools: {
    slackPost: tool({
      description: 'Post to Slack',
      inputSchema: z.object({ channel: z.string(), text: z.string() }),
      execute: async ({ channel, text }, { toolCallId, abortSignal, context }) => ({ ok: true }),
    }),
  },
  stopWhen: [isStepCount(10), hasToolCall('finish')],   // default isStepCount(20)
  toolApproval: {                                       // replaces tool.needsApproval (deprecated)
    slackPost: async ({ text }) => (text.length > 500 ? 'user-approval' : undefined),
    // values: 'not-applicable' | 'approved' | 'denied' | 'user-approval' | undefined
  },
});
const res = await agent.generate({ prompt });   // Promise<GenerateTextResult>: text, steps, toolCalls, usage
const stream = await agent.stream({ prompt });  // async in source → Promise<StreamTextResult>
// answer an approval: messages.push({ role: 'tool', content: [{ type: 'tool-approval-response', approvalId, approved: true }] })
```
### jsonSchema() + dynamicTool (tools generated from node defs)
```
import { jsonSchema, dynamicTool } from 'ai';

const t = dynamicTool({
  description: nodeDef.name,
  inputSchema: jsonSchema<Record<string, unknown>>(z.toJSONSchema(nodeDef.inputs) as any),
  execute: async (input) => runNodeViaEngine(nodeDef.type, input),
});
// jsonSchema<T>(schema: JSONSchema7, { validate?: (v) => {success:true,value:T}|{success:false,error} })
// dynamicTool → Tool<unknown, unknown> with type:'dynamic'
```
### lib/ai/providers.ts — providerFor(provider, apiKey)
```
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';          // createGoogleGenerativeAI = @deprecated alias
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import { createDeepSeek } from '@ai-sdk/deepseek';       // default instance is `deepSeek`
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export function providerFor(p: string, apiKey: string) {
  switch (p) {
    case 'openai':     return createOpenAI({ apiKey });      // Responses API default; .chat(id) = Chat Completions
    case 'anthropic':  return createAnthropic({ apiKey });   // x-api-key
    case 'google':     return createGoogle({ apiKey });      // x-goog-api-key
    case 'xai':        return createXai({ apiKey });         // Responses API default in v7; .chat(id) legacy
    case 'mistral':    return createMistral({ apiKey });
    case 'groq':       return createGroq({ apiKey });
    case 'deepseek':   return createDeepSeek({ apiKey });
    case 'openrouter': return createOpenRouter({ apiKey });
    default: throw new Error(`unknown provider ${p}`);
  }
}
// usage: const model = providerFor(conn.provider, key)(inputs.model);
```
### Image / TTS / STT nodes
```
import { generateImage, generateSpeech, transcribe } from 'ai';
import { createFal } from '@ai-sdk/fal';
import { createElevenLabs } from '@ai-sdk/elevenlabs';
import { createOpenAI } from '@ai-sdk/openai';

const { image } = await generateImage({ model: createFal({ apiKey }).image('fal-ai/flux/dev'), prompt });
//  image.uint8Array | image.base64 | image.mediaType   (n>1 → images[]); also result.calls, warnings
const { audio } = await generateSpeech({ model: createElevenLabs({ apiKey }).speech('eleven_flash_v2_5'), text, voice: voiceId });
//  audio.uint8Array | audio.base64
const { text, segments, language, durationInSeconds } = await transcribe({
  model: createOpenAI({ apiKey }).transcription('gpt-4o-transcribe'), audio: bytes });
// other accessors: openai.image('gpt-image-2'|'dall-e-3'), openai.speech('gpt-4o-mini-tts'|'tts-1'),
// google.image('gemini-3.1-flash-image-preview'), google.speech('gemini-3.1-flash-tts-preview'),
// xai.image('grok-imagine-image'), mistral.transcription('voxtral-mini-latest'), mistral.speech('voxtral-mini-tts-2603'),
// groq.transcription('whisper-large-v3'), elevenLabs.transcription('scribe_v2'), fal.transcription('wizper')
```
### AI Gateway per-request BYOK + credential check (All-Vercel option)
```
import { generateText } from 'ai';
import type { GatewayProviderOptions } from '@ai-sdk/gateway';

const r = await generateText({
  model: 'anthropic/claude-opus-5',            // gateway slugs use dots: anthropic/claude-fable-5.1
  prompt,
  providerOptions: {
    gateway: { byok: { anthropic: [{ apiKey: userKey }] }, user: orgId, tags: [`org:${orgId}`] } satisfies GatewayProviderOptions,
  },
});
const routing = (r.providerMetadata?.gateway as any)?.routing;
const attempts = routing?.modelAttempts?.flatMap((m: any) => m.providerAttempts) ?? [];
const usedSystemKey = attempts.some((a: any) => a.success && a.credentialType === 'system');
// Vercel: failing BYOK → "falling back to system credentials, and that fallback usage is billed against your credits balance";
// "a budget can't be used to cap BYOK spend". No documented opt-out.
if (usedSystemKey) { /* refuse / bill org / alert */ }
// cost: r.providerMetadata.gateway.cost (decimal string), marketCost, generationId
```
### @ai-sdk/mcp client
```
import { createMCPClient } from '@ai-sdk/mcp';

const mcp = await createMCPClient({
  transport: { type: 'http', url: 'https://server/mcp', headers: { Authorization: `Bearer ${token}` } }, // redirect defaults to 'error' in v7
  // or { type: 'sse', url }; local: new Experimental_StdioMCPTransport({ command, args }) from '@ai-sdk/mcp/mcp-stdio'
});
try {
  const tools = await mcp.tools();           // or mcp.tools({ schemas: { name: { inputSchema } } })
  const res = await generateText({ model, tools, prompt, stopWhen: isStepCount(5) });
} finally { await mcp.close(); }
```
### Provider → validate/list (url, header, jsonPath)
```
provider   | validate (GET unless noted)                                   | header                                              | list models → id path
openai     | https://api.openai.com/v1/models                               | Authorization: Bearer sk-…                          | same → data[].id
anthropic  | https://api.anthropic.com/v1/models?limit=1000                 | x-api-key: sk-ant-… + anthropic-version: 2023-06-01 | same → data[].id (has_more/after_id)
google     | https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000 | x-goog-api-key: AIza…                        | same → models[].name (strip 'models/'; nextPageToken)
xai        | https://api.x.ai/v1/api-key (reject if api_key_blocked|api_key_disabled|team_blocked) | Authorization: Bearer xai-… | /v1/language-models → models[].id ; /v1/models → data[].id ; /v1/image-generation-models → models[].id
mistral    | https://api.mistral.ai/v1/models                               | Authorization: Bearer                               | same → data[].id (filter capabilities.completion_chat)
groq       | https://api.groq.com/openai/v1/models                          | Authorization: Bearer gsk_…                         | same → data[].id
deepseek   | https://api.deepseek.com/models                                | Authorization: Bearer sk-…                          | same → data[].id
openrouter | https://openrouter.ai/api/v1/key → data.{label,limit,limit_remaining,usage,is_free_tier} | Authorization: Bearer sk-or-v1-… | https://openrouter.ai/api/v1/models (public) → data[].id
elevenlabs | https://api.elevenlabs.io/v1/user → user_id, subscription.tier/status | xi-api-key                                    | /v1/models → [].model_id ; /v2/voices?page_size=100 → voices[].voice_id,name
fal        | POST https://fal.run/fal-ai/flux/schnell (401 = invalid key; /v1/models auth optional) | Authorization: Key …      | https://api.fal.ai/v1/models?status=active&limit=50 → models[].endpoint_id (next_cursor)
replicate  | https://api.replicate.com/v1/account → username                | Authorization: Bearer r8_…                          | /v1/models → results[].owner/name (public catalogue)
deepgram   | https://api.deepgram.com/v1/projects → projects[].project_id   | Authorization: Token …                              | /v1/models → stt[].canonical_name, tts[].canonical_name
gateway    | (no validation) https://ai-gateway.vercel.sh/v1/models (public) | none                                               | data[].id (dot-versioned slugs)
```
### Anthropic models-list curl (official example headers)
```
curl 'https://api.anthropic.com/v1/models?limit=1000' \
  -H 'anthropic-version: 2023-06-01' \
  -H "x-api-key: $ANTHROPIC_API_KEY"
# → { data:[{ id:'claude-opus-5', display_name, created_at, type:'model', max_input_tokens, max_tokens, capabilities:{...} }], has_more, first_id, last_id }
# current Claude API IDs (models overview): claude-fable-5-1, claude-opus-5, claude-sonnet-5, claude-haiku-4-5-20251001 (alias claude-haiku-4-5)
# legacy still served: claude-fable-5, claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6, claude-sonnet-4-5, claude-opus-4-5
```
### package.json pins (exact)
```
{
  "type": "module",
  "engines": { "node": ">=22" },
  "dependencies": {
    "ai": "7.0.90",
    "@ai-sdk/openai": "4.0.56", "@ai-sdk/anthropic": "4.0.48", "@ai-sdk/google": "4.0.62",
    "@ai-sdk/xai": "4.0.53", "@ai-sdk/mistral": "4.0.39", "@ai-sdk/groq": "4.0.37",
    "@ai-sdk/deepseek": "3.0.39", "@ai-sdk/elevenlabs": "3.0.37", "@ai-sdk/fal": "3.0.37",
    "@ai-sdk/mcp": "2.0.43", "@ai-sdk/gateway": "4.0.72",
    "@openrouter/ai-sdk-provider": "3.0.0",
    "zod": "4.5.4"
  }
}
```
