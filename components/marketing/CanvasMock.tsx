import { CircleDotIcon } from "lucide-react";

import { StatusRing } from "@/components/canvas/StatusRing";
import { NodeIcon } from "@/components/canvas/node-icon";
import type { NodeStatus } from "@/components/canvas/graph-io";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * A still of the editor mid-run, hand-composed from the product's own parts — `StatusRing` and
 * `NodeIcon` are the components the real canvas renders, so the dots and glyphs here are the ones
 * a user will see five minutes after signing up. React Flow itself is deliberately not imported:
 * the landing page should not ship an editor to draw four boxes.
 *
 * Positions live in a 100 × 340 space (x in percent, y in pixels) that the wire SVG shares via
 * `preserveAspectRatio="none"`, so the wires stay glued to the cards at every width while
 * `vectorEffect` keeps the stroke an honest 2px. Below `md` the stage folds into a column and the
 * wires are replaced by short vertical connectors.
 */

type MockNode = {
  key: string;
  label: string;
  icon: string;
  category: string;
  status: NodeStatus;
  /** md+ placement: `left`/`width` as a percentage of the stage, `top` in pixels. */
  left: number;
  top: number;
};

const NODES: readonly MockNode[] = [
  { key: "form_1", label: "Form", icon: "FileText", category: "Trigger", status: "success", left: 2, top: 139 },
  { key: "classify_1", label: "Classify", icon: "Tags", category: "AI", status: "success", left: 30, top: 139 },
  { key: "slack_1", label: "Slack: Post message", icon: "MessageSquare", category: "Chat", status: "running", left: 68, top: 48 },
  { key: "email_1", label: "Send email", icon: "Mail", category: "Action", status: "idle", left: 68, top: 230 },
];

const NODE_WIDTH = 25;

const LEDGER: readonly {
  time: string;
  key: string;
  status: NodeStatus;
  outcome: string;
  took: string;
}[] = [
  { time: "14:02:31.114", key: "form_1", status: "success", outcome: "submitted", took: "41ms" },
  { time: "14:02:31.155", key: "classify_1", status: "success", outcome: "urgent", took: "1.2s" },
  { time: "14:02:32.361", key: "slack_1", status: "running", outcome: "posting", took: "—" },
  { time: "14:02:32.361", key: "email_1", status: "idle", outcome: "queued", took: "—" },
];

function NodeCard({ node }: { node: MockNode }) {
  return (
    <div
      style={{
        "--pf-left": `${node.left}%`,
        "--pf-top": `${node.top}px`,
        "--pf-width": `${NODE_WIDTH}%`,
      } as React.CSSProperties}
      className={cn(
        "relative z-10 rounded-lg border border-border bg-card p-3 shadow-sm",
        "md:absolute md:top-(--pf-top) md:left-(--pf-left) md:w-(--pf-width)",
        node.status === "running" &&
          "border-[var(--pf-accent-line)] ring-3 ring-[var(--pf-accent-soft)]",
      )}
    >
      <div className="flex items-center gap-2">
        <StatusRing status={node.status} />
        <NodeIcon name={node.icon} className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{node.label}</span>
        <Badge variant="outline" className="ml-auto shrink-0 max-sm:hidden">
          {node.category}
        </Badge>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{node.key}</p>
    </div>
  );
}

/** The vertical stand-in for a wire, below `md` where the stage is a single column. */
function Connector() {
  return (
    <span
      aria-hidden
      className="mx-auto block h-5 w-px bg-[var(--pf-wire)] md:hidden"
    />
  );
}

export function CanvasMock() {
  return (
    <figure className="mx-auto w-full max-w-5xl">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Editor chrome, so the still reads as a screen and not a diagram. */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5 sm:gap-3 sm:px-4">
          <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-sm font-medium">Support triage</span>
          <span className="font-mono text-xs text-muted-foreground max-sm:hidden">v7</span>
          <span className="ml-auto flex items-center gap-2 rounded-full border border-border px-2.5 py-1 font-mono text-[0.7rem] text-muted-foreground">
            <StatusRing status="running" />
            run in progress
          </span>
        </div>

        {/* The stage. */}
        <div className="pf-grid relative flex flex-col bg-background p-3 sm:p-4 md:block md:h-[340px] md:p-0">
          <svg
            aria-hidden
            viewBox="0 0 100 340"
            preserveAspectRatio="none"
            className="absolute inset-0 hidden size-full md:block"
          >
            <g
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            >
              <path
                d="M27 170 C 28.5 170, 28.5 170, 30 170"
                stroke="var(--pf-wire)"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M55 170 C 60 170, 63 79, 68 79"
                stroke="var(--pf-accent)"
                vectorEffect="non-scaling-stroke"
                className="pf-wire-live"
              />
              <path
                d="M55 170 C 60 170, 63 261, 68 261"
                stroke="var(--pf-wire)"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </svg>

          {NODES.map((node, index) => (
            <div key={node.key} className="contents">
              <NodeCard node={node} />
              {index < NODES.length - 1 ? <Connector /> : null}
            </div>
          ))}
        </div>

        {/* The run ledger: the thing PapaFlow actually sells, written the way the product writes it. */}
        <div className="border-t border-border bg-muted/30">
          <p className="border-b border-border px-3 py-2 font-mono text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase sm:px-4">

            Run 01K4X · steps
          </p>
          <ol className="divide-y divide-border">
            {LEDGER.map((row) => (
              <li
                key={row.key}
                className="flex items-center gap-2.5 px-3 py-2 font-mono text-xs sm:gap-3 sm:px-4"
              >
                <span className="text-muted-foreground max-sm:hidden">{row.time}</span>
                <StatusRing status={row.status} />
                <span className="truncate text-foreground">{row.key}</span>
                <span className="truncate text-muted-foreground">{row.outcome}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{row.took}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <figcaption className="mt-3 text-center text-xs text-muted-foreground">
        A form submission classified by your own model, posted to Slack while the
        follow-up email waits its turn.
      </figcaption>
    </figure>
  );
}
