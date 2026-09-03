import { describe, expect, it } from "vitest";

import {
  isNearBottom,
  NEAR_BOTTOM_PX,
  transcriptSignature,
} from "@/components/canvas/scroll-follow";

/**
 * The decision that keeps the Builder transcript from yanking a reader who scrolled up, and the
 * signature that tells the panel something worth scrolling to has arrived.
 */

/** A scrolling element with 400px of window onto 1000px of content: 600px of travel. */
const viewport = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

describe("isNearBottom", () => {
  it("is true at the bottom", () => {
    expect(isNearBottom(viewport(600))).toBe(true);
  });

  it("is true within the threshold of the bottom", () => {
    expect(isNearBottom(viewport(600 - NEAR_BOTTOM_PX))).toBe(true);
    expect(isNearBottom(viewport(599))).toBe(true);
  });

  it("is false one pixel past the threshold", () => {
    expect(isNearBottom(viewport(600 - NEAR_BOTTOM_PX - 1))).toBe(false);
  });

  it("is false at the top of a long transcript", () => {
    expect(isNearBottom(viewport(0))).toBe(false);
  });

  it("is true when there is nothing to scroll", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toBe(true);
  });

  it("survives elastic overscroll past the end", () => {
    expect(isNearBottom(viewport(640))).toBe(true);
  });

  it("takes a caller's threshold", () => {
    expect(isNearBottom(viewport(500), 100)).toBe(true);
    expect(isNearBottom(viewport(500), 50)).toBe(false);
  });
});

describe("transcriptSignature", () => {
  const message = (id: string, text: string) => ({ id, parts: [{ type: "text", text }] });

  it("is stable for an unchanged transcript", () => {
    const messages = [message("a", "hello"), message("b", "there")];
    expect(transcriptSignature(messages)).toBe(transcriptSignature(messages));
    // A fresh snapshot with the same content — what `useEveAgent` hands back on a no-op event.
    expect(transcriptSignature([message("a", "hello"), message("b", "there")])).toBe(
      transcriptSignature(messages),
    );
  });

  it("changes as a reply streams in", () => {
    const before = transcriptSignature([message("a", "Adding the")]);
    const after = transcriptSignature([message("a", "Adding the Slack node")]);
    expect(after).not.toBe(before);
  });

  it("changes when a message is added", () => {
    expect(transcriptSignature([message("a", "hi"), message("b", "hi")])).not.toBe(
      transcriptSignature([message("a", "hi")]),
    );
  });

  it("changes when a tool call advances, and when a part appears", () => {
    const requested = transcriptSignature([
      { id: "a", parts: [{ type: "dynamic-tool", state: "input-available" }] },
    ]);
    const done = transcriptSignature([
      { id: "a", parts: [{ type: "dynamic-tool", state: "output-available" }] },
    ]);
    const both = transcriptSignature([
      {
        id: "a",
        parts: [
          { type: "dynamic-tool", state: "output-available" },
          { type: "text", text: "done" },
        ],
      },
    ]);

    expect(done).not.toBe(requested);
    expect(both).not.toBe(done);
  });

  it("is empty for an empty transcript", () => {
    expect(transcriptSignature([])).toBe("");
  });
});
