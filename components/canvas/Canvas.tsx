"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type IsValidConnection,
  type NodeTypes,
  type OnConnect,
  type OnMoveEnd,
  type Viewport,
} from "@xyflow/react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { NODES } from "@/nodes/registry";

import {
  fromStoredGraph,
  NODE_DRAG_MIME,
  PAPAFLOW_NODE_TYPE,
  serializeGraph,
  toStoredGraph,
  type SaveState,
  type StoredGraph,
  type WorkflowNodeType,
} from "./graph-io";
import { WorkflowNode } from "./WorkflowNode";

// Module scope on purpose: a fresh object here remounts every node on every render.
const nodeTypes: NodeTypes = { [PAPAFLOW_NODE_TYPE]: WorkflowNode };

const SAVE_DEBOUNCE_MS = 600;

export type WorkflowDoc = FunctionReturnType<typeof api.workflows.get>;

type CanvasProps = {
  workflow: WorkflowDoc;
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
export function Canvas({ workflow, onSaveStateChange }: CanvasProps) {
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

  /** Replace local state with the server's graph — after a conflict, or a Builder agent edit. */
  const adopt = useCallback(
    (doc: WorkflowDoc) => {
      const graph = fromStoredGraph(doc.graph);
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
    async (graph: StoredGraph, serialized: string) => {
      try {
        const { version } = await saveGraph({
          id: workflow._id,
          graph,
          expectedVersion: versionRef.current,
        });
        versionRef.current = version;
        savedRef.current = serialized;
        pendingRef.current = false;
        onSaveStateChange("saved");
      } catch (error) {
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
    const timer = setTimeout(() => {
      chainRef.current = chainRef.current.then(() => commit(graph, serialized));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commit, edges, nodes, onSaveStateChange]);

  // The subscription moved ahead of us and we have nothing pending: take the server's graph.
  // This is what lets the Builder agent draw onto an open canvas in Phase 12.
  useEffect(() => {
    workflowRef.current = workflow;
    if (pendingRef.current || workflow.version <= versionRef.current) return;
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
          data: { nodeType, label: definition.name, inputs: {}, status: "idle" },
        }),
      );
    },
    [screenToFlowPosition, setNodes],
  );

  return (
    <ReactFlow<WorkflowNodeType, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
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
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
