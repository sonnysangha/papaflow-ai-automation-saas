import { describe, expect, it } from "vitest";

import { edgeRunState } from "@/components/canvas/edge-run-state";

describe("edgeRunState", () => {
  it("is neutral before any run", () => {
    expect(
      edgeRunState({ sourceStatus: undefined, sourceHandle: undefined, targetStatus: undefined }),
    ).toEqual({ taken: true, tone: "neutral", animated: false });
  });

  it("linear chain mid-run: lights the hop the run just took, stays dark one hop further out", () => {
    // A -> B -> C. A has finished (no branch of its own) and B is now running.
    const aToB = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "running",
    });
    expect(aToB).toEqual({ taken: true, tone: "running", animated: true });

    // B has not finished yet, so B -> C has nothing to say — exactly the pre-run appearance.
    const bToC = edgeRunState({
      sourceStatus: "running",
      sourceHandle: undefined,
      targetStatus: undefined,
    });
    expect(bToC).toEqual({ taken: true, tone: "neutral", animated: false });
  });

  it("treats a target with no row yet the same as one already running — both are 'queued'", () => {
    const queued = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: undefined,
    });
    const running = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "running",
    });
    expect(queued).toEqual({ taken: true, tone: "running", animated: true });
    expect(queued).toEqual(running);
  });

  it("branch with one untaken side: lights the taken arrow, dims the other", () => {
    const yes = edgeRunState({
      sourceStatus: "success",
      sourceHandle: "true",
      handle: "true",
      targetStatus: "success",
    });
    const no = edgeRunState({
      sourceStatus: "success",
      sourceHandle: "true",
      handle: "false",
      targetStatus: undefined,
    });
    expect(yes).toEqual({ taken: true, tone: "success", animated: false });
    expect(no).toEqual({ taken: false, tone: "neutral", animated: false });
  });

  it("loop passes: a body's second pass lights the same way a first pass would", () => {
    // `runByNode` already carries only the latest step per node (`latestStepByNode`), so from this
    // helper's point of view a Loop's later pass is indistinguishable from an ordinary running
    // target — there is no history to get right here, only the current status.
    const secondPass = edgeRunState({
      sourceStatus: "success",
      sourceHandle: "each",
      handle: "each",
      targetStatus: "running",
    });
    expect(secondPass).toEqual({ taken: true, tone: "running", animated: true });
  });

  it("failed node: the wire into it turns the failed tone, not animated", () => {
    const state = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "failed",
    });
    expect(state).toEqual({ taken: true, tone: "failed", animated: false });
  });

  it("waiting node: lit but not animated — the run is paused, nothing is moving", () => {
    const state = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "waiting",
    });
    expect(state).toEqual({ taken: true, tone: "running", animated: false });
  });

  it("settles to a solid traveled wire once the target has succeeded", () => {
    const state = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "success",
    });
    expect(state).toEqual({ taken: true, tone: "success", animated: false });
  });

  it("stays neutral while the source itself is still going, whatever the target says", () => {
    const state = edgeRunState({
      sourceStatus: "waiting",
      sourceHandle: undefined,
      targetStatus: "running",
    });
    expect(state).toEqual({ taken: true, tone: "neutral", animated: false });
  });

  it("stays neutral when the source failed — it never committed to a wire", () => {
    const state = edgeRunState({
      sourceStatus: "failed",
      sourceHandle: undefined,
      targetStatus: undefined,
    });
    expect(state).toEqual({ taken: true, tone: "neutral", animated: false });
  });

  it("defaults the handle to the single default handle", () => {
    const withDefault = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "success",
    });
    const explicit = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      handle: "out",
      targetStatus: "success",
    });
    expect(withDefault).toEqual(explicit);
  });

  it("reads a skipped target as neutral rather than as an error", () => {
    const state = edgeRunState({
      sourceStatus: "success",
      sourceHandle: undefined,
      targetStatus: "skipped",
    });
    expect(state).toEqual({ taken: true, tone: "neutral", animated: false });
  });
});
