/**
 * Which of a provider's advertised models a text-generation call can actually use.
 *
 * Several list endpoints answer with "everything this key may reach": OpenAI's `/v1/models` returns
 * embeddings, speech, transcription, image and moderation models alongside the chat ones, Groq's
 * carries Whisper and PlayAI TTS, and OpenRouter's runs to several hundred entries. Google and
 * Mistral filter at discovery because their responses carry capability flags; nothing else has one,
 * so recognising the families by id is the only filter available.
 *
 * Two callers, for two different reasons. `validateAndDiscover` applies it so `meta.models` is the
 * list a *node* can use — the Builder picks its own planning model out of that array by substring
 * (`agents/builder/lib/models.ts`), and "large" happily matches `whisper-large-v3`. `modelOptions`
 * applies it again when it fills the Model dropdown, which also cleans up rows captured before this
 * existed, without making anyone re-test a working connection.
 *
 * Deliberately conservative — an unknown family is kept rather than hidden, because a missing model
 * is worse than a rejected one, and both callers leave "type a value" open. Pure and dependency-free
 * on purpose: `connectors/` reaches this through `lib/ai/validate.ts`, and everything reachable from
 * a connector has to stay free of `node:*` (CLAUDE.md rule 4).
 */

const NOT_TEXT_GENERATION: readonly RegExp[] = [
  /embed/i, // text-embedding-3-small, nomic-embed-text
  /(^|[/_-])tts([_-]|$)/i, // tts-1, gpt-4o-mini-tts, playai-tts
  /whisper/i, // whisper-1, distil-whisper-large-v3-en
  /(^|[/_-])dall-e/i, // dall-e-3
  /gpt-image/i, // gpt-image-1
  /moderation/i, // omni-moderation-latest
  /(^|[/_-])sora([_-]|$)/i, // sora-2
  /rerank/i, // rerank-2
  /(^|[/_-])(babbage|davinci)([_-]|$)/i, // completion-only base models
];

/** Whether a model id belongs to a family `generateText` can call. */
export function isTextGenerationModel(id: string): boolean {
  return !NOT_TEXT_GENERATION.some((pattern) => pattern.test(id));
}

/** The same, over a discovered list, in the provider's own order. */
export function textGenerationModels(ids: readonly string[]): string[] {
  return ids.filter(isTextGenerationModel);
}
