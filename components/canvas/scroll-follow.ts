/**
 * The two decisions behind "follow the conversation", pulled out of `BuilderPanel` so they can be
 * reasoned about (and tested) without a DOM.
 *
 * `isNearBottom` takes the three numbers it needs rather than an element, which means an
 * `HTMLElement` satisfies it structurally at the call site and a plain object satisfies it in the
 * node test project, where there is no jsdom.
 */

/**
 * How far from the bottom still counts as "reading the latest", in CSS pixels.
 *
 * Big enough to survive sub-pixel layout and the last line of a streaming paragraph; small enough
 * that a reader who has deliberately scrolled up by a line is left where they are.
 */
export const NEAR_BOTTOM_PX = 48;

/** The scroll geometry of a scrolling element. `HTMLElement` satisfies this. */
export type ScrollMetrics = {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
};

/**
 * Is the transcript scrolled far enough down that new content should pull it along?
 *
 * Elastic overscroll and fractional layout both push the remaining distance slightly negative, so
 * the comparison is `<=` against the threshold rather than an equality with zero.
 */
export function isNearBottom(metrics: ScrollMetrics, threshold: number = NEAR_BOTTOM_PX): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

/** The part shape `transcriptSignature` reads. Every `EveMessagePart` member satisfies it. */
export type SignaturePart = {
  readonly type: string;
  readonly text?: string;
  readonly state?: string;
};

/** The message shape `transcriptSignature` reads. `EveMessage` satisfies it. */
export type SignatureMessage = {
  readonly id: string;
  readonly parts: readonly SignaturePart[];
};

/**
 * A cheap string that changes whenever the rendered transcript changes.
 *
 * `useEveAgent` hands back a fresh snapshot on every stream event, so the messages array cannot be
 * used as an effect dependency directly without re-scrolling on events that changed nothing
 * visible. Text parts grow a token at a time (their length moves), tool parts advance through
 * `state` instead (their chip changes with it) — between them that is everything the panel draws.
 */
export function transcriptSignature(messages: readonly SignatureMessage[]): string {
  let signature = "";
  for (const message of messages) {
    signature += `${message.id}/`;
    for (const part of message.parts) {
      signature += `${part.type}:${part.text?.length ?? part.state ?? ""};`;
    }
    signature += "|";
  }
  return signature;
}
