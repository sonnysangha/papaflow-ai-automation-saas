"use client";

import { CornerDownRightIcon } from "lucide-react";

import type { NodeGuide as NodeGuideMeta } from "@/nodes/define";

import type { HandleDisplay } from "./graph-io";

export type NodeGuideProps = {
  guide: NodeGuideMeta;
  /**
   * The node's actual source handles, in canvas order. Not read off `guide.outputs`: a Switch's
   * arrows are its cases, which only exist in the configuration in front of you.
   */
  handles: HandleDisplay[];
};

/**
 * "How this node works", above the form.
 *
 * The Logic nodes are the ones people get wrong, and they get them wrong before they reach a
 * field: the question is not what `operator` means, it is what the two wires leaving the node
 * *are*. So the panel opens with a sentence or three and then draws the arrows in the same chips
 * the canvas and the edges use, in the same order they come off the node — the diagram is the list
 * of ways out, which is the whole of what a branching node does.
 *
 * The handle id stays reachable on hover rather than printed: it is documentation (it is what the
 * stored edge and `steps.handle` carry), and printing it beside every chip would put the confusing
 * word back on the screen the plain one was meant to replace.
 */
export function NodeGuide({ guide, handles }: NodeGuideProps) {
  const branches = handles.length > 1 ? handles : [];

  return (
    <section
      aria-label="How this node works"
      className="min-w-0 rounded-lg border border-border bg-muted/40 p-2.5"
    >
      <h3 className="text-xs font-medium">How this node works</h3>
      <p className="mt-1 text-xs leading-relaxed break-words text-muted-foreground">
        {guide.summary}
      </p>

      {branches.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Ways out:</span>
          {branches.map(({ handle, label }) => (
            <span
              key={handle}
              title={`Arrow “${label}” — saved as ${handle}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-1.5 py-px text-[11px] leading-4 text-muted-foreground"
            >
              <CornerDownRightIcon aria-hidden className="size-3 shrink-0" />
              {/* A Switch's arrows are the cases the user typed, so this is arbitrary text in a
                  360px column: truncate rather than let one case widen the panel. */}
              <span className="min-w-0 truncate">{label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
