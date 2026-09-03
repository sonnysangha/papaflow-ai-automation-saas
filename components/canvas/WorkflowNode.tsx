"use client";

import { createContext, useContext } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { LockIcon, TriangleAlertIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/nodes/categories";
import type { NodeCategory } from "@/nodes/define";
import { NODES } from "@/nodes/registry";

import { handleDisplays, type NodeStatus, type WorkflowNodeType } from "./graph-io";
import { NodeIcon } from "./node-icon";
import { categoryTint, nodeSummary } from "./node-summary";
import { SETUP_BADGE_LABEL, type NodeSetup } from "./node-setup";
import { StatusRing, statusSummary } from "./StatusRing";

const HANDLE_CLASS = "size-2.5 border-2 border-background bg-muted-foreground transition-colors";

/** The narrowest a node may be dragged, and the width every node starts at. */
export const MIN_NODE_WIDTH = 240;
/** …and a branching node needs a column beside them, so it starts wider. */
export const MIN_BRANCHING_NODE_WIDTH = 280;

/**
 * What each node still needs before it could run, keyed by node id.
 *
 * A context rather than a field on `node.data`: the answer is derived from the org's connections
 * and plan, which are not part of the document. Putting it in node data would make every
 * connections update look like a graph edit to the dirty flag, the undo stack and the save effect.
 * `Canvas` computes the map and provides it; nothing here is ever saved.
 */
export const NodeSetupContext = createContext<Record<string, NodeSetup>>({});

/**
 * The shortest a node with this many ways out may be dragged.
 *
 * A branch chip is a real row in a real column, not a label floating over the card, so the node's
 * height is what the branches are laid out in: five Switch cases cannot be squeezed into the height
 * of a two-line header without stacking on top of each other again.
 */
export function minNodeHeight(handleCount: number): number {
  return Math.max(76, 26 + handleCount * 26);
}

/** The amber "this is not finished" chip, or the quiet zinc one for a node the plan refuses. */
function SetupBadge({ setup }: { setup: NodeSetup }) {
  if (setup.state === "ready") return null;
  const unavailable = setup.state === "unavailable";
  const Icon = unavailable ? LockIcon : TriangleAlertIcon;

  return (
    // A span, not a button: the click has to reach the node underneath, which is what selects it
    // and opens the settings panel where the missing piece is actually filled in.
    <span
      title={setup.problems.join("\n")}
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium",
        unavailable
          ? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{SETUP_BADGE_LABEL[setup.state]}</span>
    </span>
  );
}

/**
 * The inside of a node card: what it is, what it is set to do, and how it is doing.
 *
 * Free of React Flow — no handles, no resizer, no store — so it renders on its own in a test and
 * so the card's two lines are one thing to read rather than three nested in positioning code.
 */
export function NodeCardBody({
  label,
  summary,
  icon,
  category,
  status,
  setup,
}: {
  label: string;
  /** The configuration line: `GET https://…`, `Every 5 min`, or what is missing. */
  summary: string;
  icon?: string;
  category?: NodeCategory;
  status?: NodeStatus;
  setup: NodeSetup;
}) {
  const needsSetup = setup.state !== "ready";

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-3 text-card-foreground">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            categoryTint(category),
          )}
        >
          <NodeIcon name={icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
        <SetupBadge setup={setup} />
        {/* The whole node names its status in the tooltip, so the dot must not repeat it. */}
        <StatusRing status={status} labelled={false} />
      </div>

      {/* What it is set to do, in its own words. The template key it is addressed by moved into the
          tooltip: it is what you type, not what you read. */}
      <p
        className={cn(
          "min-w-0 truncate text-xs text-muted-foreground",
          needsSetup && setup.state !== "unavailable" && "italic",
        )}
      >
        {summary}
      </p>
    </div>
  );
}

/**
 * Every node on the canvas is this component — the registry decides the icon, the category and
 * how many source handles it has. `data.status` and `data.durationMs` come from the latest run's
 * steps (`Editor` merges them in), and are the only things here that are not saved.
 *
 * The card answers three questions without being opened, in the order people ask them: what is
 * this (a tinted category tile and the name you gave it), what is it set to do (one line of its
 * own configuration — `GET https://…`, `Every 5 min`, `3 cases`), and is it all right (the setup
 * badge for what is missing, the status ring for what the last run did — two separate things, so a
 * node can be green from this morning's run and still say "Reconnect").
 *
 * The layout is two columns rather than one box with things drawn over its right edge. The header
 * owns the top line, the summary owns the second, and a branching node gets a column of its own for
 * the words on its arrows, one row per handle, with the handle sitting on the card's edge at that
 * row's middle. Nothing overlaps because nothing is positioned over anything: it is a flex row, and
 * adding a branch makes the node taller rather than busier.
 */
export function WorkflowNode({ id, data, selected }: NodeProps<WorkflowNodeType>) {
  const definition = NODES[data.nodeType];
  const handles = handleDisplays(data.nodeType, data.inputs);
  const summary = statusSummary(data.status, data.durationMs);
  const branching = handles.length > 1;
  const setup = useContext(NodeSetupContext)[id] ?? { state: "ready" as const, problems: [] };
  const needsSetup = setup.state !== "ready";
  // What this node is configured to do — or, when a missing connection is the whole story, that.
  const configured =
    setup.state === "needs_connection"
      ? setup.problems[0]
      : (nodeSummary(data.nodeType, data.inputs) ?? (data.key || data.nodeType));

  return (
    <>
      {/* Drag any edge or corner to resize; the controls only exist while the node is selected, so
          a canvas at rest is not eight handles per node. The size is saved with the graph
          (`toStoredGraph`), which is why a wide node stays wide after a reload. */}
      <NodeResizer
        isVisible={selected}
        color="var(--primary)"
        minWidth={branching ? MIN_BRANCHING_NODE_WIDTH : MIN_NODE_WIDTH}
        minHeight={minNodeHeight(handles.length)}
      />

      {/* The delay comes from the `TooltipProvider` `Canvas` wraps the flow in: a canvas is a lot of
          hover targets, and firing every one of them while panning would be a light show. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className={cn(
                // `h-full` so a resized node's card fills the box React Flow sized for it rather
                // than sitting content-height inside its own resize controls.
                "relative flex h-full items-stretch rounded-xl border border-border bg-card text-left text-card-foreground shadow-sm transition-shadow hover:shadow-md",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                branching ? "min-w-[280px]" : "min-w-[240px]",
                // Not finished yet, and you can see it from across the canvas.
                needsSetup && "border-dashed border-amber-500/60",
                selected && "ring-2 ring-primary",
                // A node the run never reached: the same quiet grey as its status dot, drawn as a
                // dashed outline so "this branch did not happen" reads at a glance next to a solid
                // neighbour.
                data.status === "skipped" &&
                  "outline-2 outline-offset-2 outline-dashed outline-muted-foreground/40",
              )}
            />
          }
        >
          {definition?.category !== "trigger" ? (
            <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
          ) : null}

          <NodeCardBody
            label={data.label}
            summary={configured}
            icon={definition?.icon}
            category={definition?.category}
            status={data.status}
            setup={setup}
          />

          {branching ? (
            <div className="flex w-20 shrink-0 flex-col justify-around self-stretch border-l border-border py-1.5">
              {handles.map(({ handle, label }) => (
                // `relative`, so the handle's default `right: 0; top: 50%` puts the dot on the
                // card's edge at this row's middle — the words and the dot cannot drift apart.
                <div key={handle} className="relative flex min-h-5 items-center">
                  {/* The plain word, with the id the graph stores on hover. Hoverable rather than
                      `pointer-events-none`, so the title works; mousedown still bubbles to the
                      node, so dragging the node by its own label keeps working. */}
                  <span
                    title={`Arrow “${label}” — saved as ${handle}`}
                    className="min-w-0 flex-1 cursor-default truncate pr-2.5 pl-2 text-[11px] leading-4 text-muted-foreground"
                  >
                    {label}
                  </span>
                  <Handle id={handle} type="source" position={Position.Right} className={HANDLE_CLASS} />
                </div>
              ))}
            </div>
          ) : (
            <Handle
              id={handles[0]?.handle}
              type="source"
              position={Position.Right}
              className={HANDLE_CLASS}
            />
          )}
        </TooltipTrigger>

        <TooltipContent side="top" className="flex-col items-start gap-0.5">
          <span className="font-medium">{summary}</span>
          {needsSetup
            ? setup.problems.map((problem) => (
                <span key={problem} className="text-[11px] opacity-90">
                  {problem}
                </span>
              ))
            : null}
          <span className="font-mono text-[11px] opacity-80">
            {data.key || data.nodeType}
          </span>
          <span className="text-[11px] opacity-70">
            {definition ? categoryLabel(definition.category) : "Unknown"} · {definition?.type ?? data.nodeType}
          </span>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
