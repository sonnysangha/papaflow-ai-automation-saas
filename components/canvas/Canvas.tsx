"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type IsValidConnection,
  type NodeTypes,
  type OnConnect,
  type OnMoveEnd,
  type Viewport,
} from "@xyflow/react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { LayoutTemplateIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TemplateDialog } from "@/components/workflows/TemplateDialog";
import { api } from "@/convex/_generated/api";
import type { WorkflowTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { NODES } from "@/nodes/registry";

import { ConfigPanel } from "./ConfigPanel";
import { EdgeWithLabel, LABELLED_EDGE_TYPE, type LabelledEdgeData } from "./EdgeWithLabel";
import {
  DEFAULT_HANDLE,
  fromStoredGraph,
  nextKey,
  NODE_DRAG_MIME,
  PAPAFLOW_NODE_TYPE,
  serializeGraph,
  sourceHandles,
  toStoredGraph,
  type RunNodeState,
  type SaveState,
  type StoredGraph,
  type WorkflowNodeType,
} from "./graph-io";
import type { RunStepRow } from "./last-run";
import { isTypingTarget } from "./shortcuts";
import { WorkflowNode } from "./WorkflowNode";

// Module scope on purpose: a fresh object here remounts every node on every render.
const nodeTypes: NodeTypes = { [PAPAFLOW_NODE_TYPE]: WorkflowNode };
const edgeTypes: EdgeTypes = { [LABELLED_EDGE_TYPE]: EdgeWithLabel };

const SAVE_DEBOUNCE_MS = 600;

/** Applied to the edge the run actually followed out of a branching node. */
const TAKEN_EDGE_CLASS = "[&_.react-flow__edge-path]:stroke-primary";
/** …and to its siblings, so an untaken branch reads as "this did not happen". */
const UNTAKEN_EDGE_CLASS = "opacity-40";

export type WorkflowDoc = FunctionReturnType<typeof api.workflows.get>;

type CanvasProps = {
  workflow: WorkflowDoc;
  /** Live state per node id from the latest run; anything missing is idle. */
  runByNode: Record<string, RunNodeState>;
  /** The latest run's step rows, which the config panel reads real input and output data off. */
  steps: readonly RunStepRow[];
  onSaveStateChange: (state: SaveState) => void;
};

/** The `ConvexError({ code, ... })` payload, or null for a transport or unexpected error. */
function convexErrorData(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/**
 * The editable graph. React Flow owns the nodes and edges; every change is debounced into
 * `workflows.saveGraph` with the version we last saw, so a Builder agent or a second tab
 * writing at the same time is detected instead of silently overwritten.
 */
export function Canvas({ workflow, runByNode, steps, onSaveStateChange }: CanvasProps) {
  const saveGraph = useMutation(api.workflows.saveGraph);
  const { screenToFlowPosition, setViewport } = useReactFlow<WorkflowNodeType, Edge>();

  // Seeded once. `serialized` is the normalised form of what the server holds, so the first
  // render never counts as an edit and selection or drag noise never triggers a save.
  const [initial] = useState(() => {
    const graph = fromStoredGraph(workflow.graph);
    return {
      graph,
      serialized: serializeGraph(toStoredGraph(graph.nodes, graph.edges, graph.viewport)),
    };
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeType>(initial.graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.graph.edges);

  const versionRef = useRef(workflow.version);
  const savedRef = useRef(initial.serialized);
  const viewportRef = useRef<Viewport | undefined>(initial.graph.viewport);
  const pendingRef = useRef(false);
  const workflowRef = useRef(workflow);
  // Saves are chained so a second one always sees the version the first one came back with.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  // Bumped by every `adopt`. A save queued or in flight against an older generation is abandoned
  // rather than written: the Builder agent's graph is now the truth, and applying a stale
  // `expectedVersion` (or a stale `savedRef`) after it would undo what the user just watched appear.
  const generationRef = useRef(0);

  /** Replace local state with the server's graph — after a conflict, or a Builder agent edit. */
  const adopt = useCallback(
    (doc: WorkflowDoc) => {
      const graph = fromStoredGraph(doc.graph);
      generationRef.current += 1;
      versionRef.current = doc.version;
      viewportRef.current = graph.viewport ?? viewportRef.current;
      savedRef.current = serializeGraph(
        toStoredGraph(graph.nodes, graph.edges, viewportRef.current),
      );
      pendingRef.current = false;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      if (graph.viewport) setViewport(graph.viewport);
      onSaveStateChange("saved");
    },
    [onSaveStateChange, setEdges, setNodes, setViewport],
  );

  const commit = useCallback(
    async (graph: StoredGraph, serialized: string, generation: number) => {
      // Adopted while this save sat in the chain: what it would write no longer exists.
      if (generationRef.current !== generation) return;
      try {
        const { version } = await saveGraph({
          id: workflow._id,
          graph,
          expectedVersion: versionRef.current,
        });
        // …or adopted while it was in flight. The write landed, but this canvas has moved on.
        if (generationRef.current !== generation) return;
        versionRef.current = version;
        savedRef.current = serialized;
        pendingRef.current = false;
        onSaveStateChange("saved");
      } catch (error) {
        if (generationRef.current !== generation) return;
        pendingRef.current = false;
        if (convexErrorData(error)?.code === "version_conflict") {
          onSaveStateChange("conflict");
          toast.error("Someone else edited this workflow — reloading");
          // Reload from the subscription. If the newer document has not landed yet the effect
          // below adopts it the moment it does — `pendingRef` is already clear.
          if (workflowRef.current.version > versionRef.current) adopt(workflowRef.current);
          return;
        }
        onSaveStateChange("error");
        toast.error("Could not save the canvas");
        console.error(error);
      }
    },
    [adopt, onSaveStateChange, saveGraph, workflow._id],
  );

  // Live run status from the `steps` subscription, merged into the nodes React Flow renders.
  // `toStoredGraph` drops `data.status`, so the save effect below sees an unchanged graph and
  // nothing is written — a run lighting the canvas up never bumps the workflow version.
  // The map is returned untouched when every node already has its status, which makes this a
  // no-op re-render rather than a loop.
  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const state = runByNode[node.id];
        const status = state?.status ?? "idle";
        const durationMs = state?.durationMs;
        if (node.data.status === status && node.data.durationMs === durationMs) return node;
        changed = true;
        return { ...node, data: { ...node.data, status, durationMs } };
      });
      return changed ? next : current;
    });
  }, [runByNode, setNodes]);

  // Debounced save. Re-running the effect clears the previous timer, so a drag saves 600ms
  // after it stops rather than once per frame.
  useEffect(() => {
    const graph = toStoredGraph(nodes, edges, viewportRef.current);
    const serialized = serializeGraph(graph);
    if (serialized === savedRef.current) {
      pendingRef.current = false;
      return;
    }

    pendingRef.current = true;
    onSaveStateChange("saving");
    const generation = generationRef.current;
    const timer = setTimeout(() => {
      chainRef.current = chainRef.current.then(() => commit(graph, serialized, generation));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commit, edges, nodes, onSaveStateChange]);

  // The subscription moved ahead of us: take the server's graph.
  //
  // This is what draws the Builder agent's work onto an open canvas. A Builder edit is adopted even
  // with a local save pending, which the ordinary case (a second tab) deliberately is not: the agent
  // is editing *this* user's workflow, in front of them, on their instruction, so its node appearing
  // is the thing they asked for — while a debounced local edit that has not been written yet is at
  // most a drag. Adopting cancels that debounce (the save effect re-runs against the adopted graph
  // and finds nothing to write) and `generationRef` abandons anything already queued, so the version
  // conflict a Builder session would otherwise raise every few seconds never happens.
  useEffect(() => {
    workflowRef.current = workflow;
    if (workflow.version <= versionRef.current) return;
    if (pendingRef.current && workflow.lastEditSource !== "builder") return;
    adopt(workflow);
  }, [adopt, workflow]);

  const onMoveEnd = useCallback<OnMoveEnd>((_event, viewport) => {
    // Panning alone must not bump the version; the viewport rides along with the next edit.
    viewportRef.current = viewport;
  }, []);

  const onConnect = useCallback<OnConnect>(
    (connection) => {
      setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID() }, current));
    },
    [setEdges],
  );

  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => {
      if (connection.source === connection.target) return false;
      return !edges.some(
        (edge) =>
          edge.source === connection.source &&
          (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
          edge.target === connection.target,
      );
    },
    [edges],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData(NODE_DRAG_MIME);
      const definition = NODES[nodeType];
      if (!definition) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setNodes((current) =>
        current.concat({
          id: crypto.randomUUID(),
          type: PAPAFLOW_NODE_TYPE,
          position,
          data: {
            nodeType,
            // Assigned against the nodes as they are right now, so two quick drops of the same
            // node type get `http_request_1` and `http_request_2` rather than the same key twice.
            key: nextKey(current, nodeType),
            label: definition.name,
            inputs: {},
            status: "idle",
          },
        }),
      );
    },
    [screenToFlowPosition, setNodes],
  );

  // Exactly one node selected opens the config panel; a marquee over three does not.
  const selected = useMemo(() => {
    const picked = nodes.filter((node) => node.selected);
    return picked.length === 1 ? picked[0] : null;
  }, [nodes]);

  const deselect = useCallback(() => {
    setNodes((current) =>
      current.map((node) => (node.selected ? { ...node, selected: false } : node)),
    );
  }, [setNodes]);

  /**
   * Branch feedback: once a node has finished, the edge leaving the handle its step recorded is
   * drawn in the primary colour and the rest are dimmed, which is what makes an untaken Condition
   * branch grey out. Styling lives here rather than in state — `toStoredGraph` ignores `className`,
   * but writing it into `edges` would still churn the save effect on every run.
   */
  const styledEdges = useMemo(() => {
    // One lookup per edge instead of a scan per edge, and the branch names come from the same
    // `sourceHandles()` the node itself draws its handles from.
    const branching = new Map<string, boolean>();
    for (const node of nodes) {
      branching.set(node.id, sourceHandles(node.data.nodeType, node.data.inputs).length > 1);
    }

    return edges.map((edge) => {
      const handle = edge.sourceHandle ?? DEFAULT_HANDLE;
      // Only a node with more than one way out has anything to say: "out" would be noise.
      const labelled = branching.get(edge.source) === true;
      const typed: Edge = labelled
        ? { ...edge, type: LABELLED_EDGE_TYPE, data: { label: handle } satisfies LabelledEdgeData }
        : edge;

      const source = runByNode[edge.source];
      if (source?.status !== "success") return typed;
      // A node that records no handle (everything but Condition/Switch) took all of its edges.
      const taken = source.handle ? handle === source.handle : true;
      return {
        ...typed,
        animated: false,
        className: cn(edge.className, taken ? TAKEN_EDGE_CLASS : UNTAKEN_EDGE_CLASS),
      };
    });
  }, [edges, nodes, runByNode]);

  /**
   * Drops a starter template onto an empty canvas.
   *
   * This is the same graph `workflows.create` would have been handed from the workflow list; here
   * the workflow already exists, so the template becomes an ordinary edit and the debounced save
   * writes it. Guarded on emptiness at the call site — a template is a starting point, never
   * something that overwrites work.
   */
  const applyTemplate = useCallback(
    (template: WorkflowTemplate) => {
      const loaded = fromStoredGraph(template.graph);
      setNodes(loaded.nodes);
      setEdges(loaded.edges);
      toast.success(`Added the ${template.name} template`);
    },
    [setEdges, setNodes],
  );

  // Escape closes the settings panel. Ignored while a field has focus, so it still means "put that
  // back" inside the panel's own inputs, and while a dialog is open, which owns Escape itself.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      deselect();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deselect]);

  return (
    // Node tooltips wait a beat: panning across a busy canvas must not set off every node at once.
    <TooltipProvider delay={400}>
      <div className="flex h-full min-h-0 w-full">
        <div className="min-w-0 flex-1">
          <ReactFlow<WorkflowNodeType, Edge>
            nodes={nodes}
            edges={styledEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMoveEnd={onMoveEnd}
            isValidConnection={isValidConnection}
            onDrop={onDrop}
            onDragOver={onDragOver}
            defaultViewport={initial.graph.viewport}
            fitView={!initial.graph.viewport}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="system"
            minZoom={0.2}
            className="bg-background"
            aria-label="Workflow canvas"
          >
            <Background gap={16} />
            {/* Zoom in / out / fit view, in the app's own tokens rather than React Flow's default
                white-on-white — see the `.react-flow__controls` block in `app/globals.css`. */}
            <Controls
              showInteractive={false}
              aria-label="Canvas zoom controls"
              fitViewOptions={{ padding: 0.2, duration: 200 }}
            />
            <MiniMap pannable zoomable ariaLabel="Canvas minimap" />

            {nodes.length === 0 ? (
              <Panel position="top-center" className="pointer-events-none mt-24">
                <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/80 px-6 py-8 text-center backdrop-blur-sm">
                  <p className="text-sm font-medium">This canvas is empty</p>
                  <p className="text-sm text-muted-foreground">
                    Drag a trigger here from the left, or start from a template and change what you
                    do not want.
                  </p>
                  <TemplateDialog
                    onPick={applyTemplate}
                    title="Start from a template"
                    description="Each one drops a working graph onto this canvas. Nothing is locked — edit or delete any node afterwards."
                    trigger={
                      <Button variant="outline" size="sm">
                        <LayoutTemplateIcon />
                        Pick a template
                      </Button>
                    }
                  />
                </div>
              </Panel>
            ) : null}
          </ReactFlow>
        </div>

        {selected ? (
          <ConfigPanel
            key={selected.id}
            node={selected}
            nodes={nodes}
            edges={edges}
            workflowId={workflow._id}
            // Read straight off the live document, not the seeded snapshot: rotating the secret in
            // another tab has to change the URL this panel shows.
            webhookSecret={workflow.webhookSecret}
            steps={steps}
            setNodes={setNodes}
            onClose={deselect}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}
