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
import { useMutation, useQuery } from "convex/react";
import { useTheme } from "next-themes";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { LayoutTemplateIcon, PlusIcon, SparklesIcon, WorkflowIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TemplateDialog } from "@/components/workflows/TemplateDialog";
import { api } from "@/convex/_generated/api";
import type { WorkflowTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";

import { ConfigPanel } from "./ConfigPanel";
import { centredNodePosition, createNodeFromPalette } from "./create-node";
import { edgeRunState, type EdgeRunTone } from "./edge-run-state";
import { EdgeWithLabel, LABELLED_EDGE_TYPE, type LabelledEdgeData } from "./EdgeWithLabel";
import {
  DEFAULT_HANDLE,
  fromStoredGraph,
  graphKey,
  handleLabel,
  NODE_DRAG_MIME,
  PAPAFLOW_NODE_TYPE,
  sourceHandles,
  toStoredGraph,
  type RunNodeState,
  type SaveState,
  type WorkflowNodeType,
} from "./graph-io";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "./history";
import { autoLayout, canAutoLayout } from "./auto-layout";
import type { RunStepRow } from "./last-run";
import { NodePaletteSheet } from "./NodeSidebar";
import { nodeSetup, type NodeSetup, type SetupConnection } from "./node-setup";
import { hasModifier, isTypingTarget } from "./shortcuts";
import { useIsMobile } from "./use-media-query";
import { NodeSetupContext, WorkflowNode } from "./WorkflowNode";

// Module scope on purpose: a fresh object here remounts every node on every render.
const nodeTypes: NodeTypes = { [PAPAFLOW_NODE_TYPE]: WorkflowNode };
const edgeTypes: EdgeTypes = { [LABELLED_EDGE_TYPE]: EdgeWithLabel };

/** …and to its siblings, so an untaken branch reads as "this did not happen". */
const UNTAKEN_EDGE_CLASS = "opacity-40";

/**
 * One Tailwind class per `EdgeRunTone` (`edge-run-state.ts`), targeting the `<path>` React Flow
 * always renders inside an edge regardless of which edge component drew it — the same
 * arbitrary-variant trick `UNTAKEN_EDGE_CLASS` already relies on. `"success"` keeps the exact class
 * a taken edge has always used, so a finished run still looks the way it did before live wires
 * existed; `"running"` and `"failed"` are new. `"neutral"` is never actually read (the branch below
 * returns early on it) but is here so indexing by the full union type-checks.
 */
const EDGE_TONE_CLASS: Record<EdgeRunTone, string> = {
  neutral: "",
  running: "[&_.react-flow__edge-path]:stroke-amber-500",
  success: "[&_.react-flow__edge-path]:stroke-primary",
  failed: "[&_.react-flow__edge-path]:stroke-destructive",
};

export type WorkflowDoc = FunctionReturnType<typeof api.workflows.get>;

/**
 * What the header drives the canvas with, and what it reports about it.
 *
 * The graph lives in this component (React Flow's hooks own it, and the config panel edits it
 * through `setNodes`), while Save, Undo and Redo are drawn in the editor's header strip above the
 * node sidebar. Rather than lift the whole graph out, the canvas hands these up: the three actions,
 * and the state a button needs to know whether it should be enabled and what it should say.
 */
export type EditorControls = {
  saveState: SaveState;
  /** Whether the canvas holds edits Convex has not been told about. */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Whether there is an arrangement to make: two nodes or more. */
  canTidy: boolean;
  /** Writes the current graph. Resolves false when it did not land — a conflict, or an error. */
  save: () => Promise<boolean>;
  undo: () => void;
  redo: () => void;
  /** Spaces every node out along its wires, and fits the result in the viewport. */
  tidy: () => void;
  /**
   * Drops a palette entry in the middle of the viewport and selects it — the tap-to-add path the
   * node list uses, reported up because the graph lives in here and the palette does not.
   */
  addNode: (nodeType: string) => void;
};

/** One graph as the undo stack holds it, with the string the sameness of two graphs is decided by. */
type Snapshot = {
  key: string;
  nodes: WorkflowNodeType[];
  edges: Edge[];
};

/** Someone else's newer graph, waiting because this canvas has unsaved edits of its own. */
type RemoteChange = { version: number; fromBuilder: boolean };

type CanvasProps = {
  workflow: WorkflowDoc;
  /** Live state per node id from the latest run; anything missing is idle. */
  runByNode: Record<string, RunNodeState>;
  /** The latest run's step rows, which the config panel reads real input and output data off. */
  steps: readonly RunStepRow[];
  /**
   * "Select this node", asked for from outside — the run timeline clicking a bar. The nonce is
   * what makes asking twice for the same node a second request rather than a no-op.
   */
  focusNode?: { nodeId: string; nonce: number } | null;
  /** Reports the header's controls, whenever any of them changes. Must be a stable callback. */
  onControlsChange: (controls: EditorControls) => void;
  /** Reports which single node is selected, so a panel outside the canvas can follow along. */
  onSelectedNodeChange?: (nodeId: string | null) => void;
  /** Opens the Builder chat — offered from the empty canvas as well as from the toolbar. */
  onBuildWithAi?: () => void;
};

/** The `ConvexError({ code, ... })` payload, or null for a transport or unexpected error. */
function convexErrorData(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

/**
 * The editable graph. React Flow owns the nodes and edges, and edits stay local until somebody
 * presses Save: `workflows.saveGraph` is called once, with the version this canvas last saw, so a
 * Builder agent or a second tab writing at the same time is detected instead of silently
 * overwritten. Every edit also lands on an undo stack (`history.ts`).
 */
export function Canvas({
  workflow,
  runByNode,
  steps,
  focusNode,
  onControlsChange,
  onSelectedNodeChange,
  onBuildWithAi,
}: CanvasProps) {
  const saveGraph = useMutation(api.workflows.saveGraph);
  const { fitView, screenToFlowPosition, setViewport } = useReactFlow<WorkflowNodeType, Edge>();

  /**
   * React Flow's colour mode, taken from the app's theme rather than from the operating system.
   *
   * A `colorMode` of “system” reads `prefers-color-scheme` and puts `class="dark"` on the wrapper —
   * a different question from the one the user answered with the header's Light/Dark/System toggle.
   * Worse, `dark` is exactly the class the app's tokens are redefined under (`.dark { --background
   * … }`) and the selector Tailwind's `dark:` variant matches, so a dark OS with the app set to
   * Light turned the whole flow subtree dark from the inside: a black pane, a dark minimap, and
   * near-white node text on white cards.
   *
   * `resolvedTheme` is undefined until next-themes has mounted; light is the safe first paint, and
   * the rules in `app/globals.css` keep every surface on app tokens either way.
   */
  const { resolvedTheme } = useTheme();
  const colorMode = resolvedTheme === "dark" ? "dark" : "light";

  // Seeded once. `key` is the normalised form of what the server holds, so the first render never
  // counts as an edit and selection or drag noise never marks the canvas dirty.
  const [initial] = useState(() => {
    const graph = fromStoredGraph(workflow.graph);
    const snapshot: Snapshot = {
      key: graphKey(graph.nodes, graph.edges),
      nodes: graph.nodes,
      edges: graph.edges,
    };
    return { graph, snapshot };
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeType>(initial.graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.graph.edges);

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const [undoable, setUndoable] = useState({ canUndo: false, canRedo: false });
  /** Open when a save came back `version_conflict` and the user has to choose. */
  const [conflict, setConflict] = useState<{ version: number } | null>(null);
  /** The non-blocking notice: someone else's graph is newer, and this canvas has edits of its own. */
  const [remote, setRemote] = useState<RemoteChange | null>(null);

  const versionRef = useRef(workflow.version);
  const savedKeyRef = useRef(initial.snapshot.key);
  const viewportRef = useRef<Viewport | undefined>(initial.graph.viewport);
  const workflowRef = useRef(workflow);
  // The dirty flag effects read. `dirty` state is for rendering; within a single commit the state
  // is one render behind, and the adopt effect below must not overwrite an edit made in that pass.
  const dirtyRef = useRef(false);
  // The graph as of the last committed render, which `save` writes. Kept in a ref rather than
  // closed over, so the header's `save` callback keeps one identity for the life of the canvas.
  const latestRef = useRef<Snapshot>(initial.snapshot);
  // Seeded at `at: 0`, so the first edit is always its own undo step however soon it lands.
  const historyRef = useRef<History<Snapshot>>(createHistory(initial.snapshot));
  // At most one save is ever in flight; a second ⌘S while the first is going joins it.
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  // Set by "Reload theirs" when the newer document has not arrived yet: the subscription effect
  // adopts whatever lands next, edits or no edits.
  const reloadRef = useRef(false);

  const syncUndoable = useCallback((history: History<Snapshot>) => {
    const next = { canUndo: canUndo(history), canRedo: canRedo(history) };
    setUndoable((current) =>
      current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next,
    );
  }, []);

  /**
   * Replace local state with the server's graph — a Builder agent edit, a second tab, or the user
   * choosing "Reload theirs".
   *
   * The undo stack is reset rather than kept: its entries describe a graph that no longer exists,
   * and undoing onto someone else's document would offer to overwrite their work with a snapshot
   * of a version this canvas has already given up.
   */
  const adopt = useCallback(
    (doc: WorkflowDoc) => {
      const graph = fromStoredGraph(doc.graph);
      const snapshot: Snapshot = {
        key: graphKey(graph.nodes, graph.edges),
        nodes: graph.nodes,
        edges: graph.edges,
      };
      versionRef.current = doc.version;
      viewportRef.current = graph.viewport ?? viewportRef.current;
      savedKeyRef.current = snapshot.key;
      dirtyRef.current = false;
      latestRef.current = snapshot;
      historyRef.current = createHistory(snapshot, Date.now());
      reloadRef.current = false;
      setNodes(graph.nodes);
      setEdges(graph.edges);
      if (graph.viewport) setViewport(graph.viewport);
      setDirty(false);
      setConflict(null);
      setRemote(null);
      setSaveState("saved");
      syncUndoable(historyRef.current);
    },
    [setEdges, setNodes, setViewport, syncUndoable],
  );

  /**
   * One `saveGraph` call for the graph as it stands.
   *
   * `expectedVersion` is the version this canvas last saw; a mismatch means somebody wrote in
   * between, and the answer is the conflict dialog rather than a decision made for the user. The
   * dialog's "Keep mine" comes back through here with the version the failure reported.
   */
  const commit = useCallback(
    async (expectedVersion: number): Promise<boolean> => {
      const snapshot = latestRef.current;
      const graph = toStoredGraph(snapshot.nodes, snapshot.edges, viewportRef.current);
      setSaveState("saving");
      try {
        const { version } = await saveGraph({
          id: workflow._id,
          graph,
          expectedVersion,
        });
        versionRef.current = version;
        savedKeyRef.current = snapshot.key;
        setConflict(null);
        setRemote(null);
        // Edits made while the save was in flight are still unsaved, and the header has to keep
        // saying so — the write that just landed was of an older graph.
        const stillDirty = latestRef.current.key !== snapshot.key;
        dirtyRef.current = stillDirty;
        setDirty(stillDirty);
        setSaveState(stillDirty ? "dirty" : "saved");
        return true;
      } catch (error) {
        const data = convexErrorData(error);
        if (data?.code === "version_conflict") {
          const version =
            typeof data.version === "number" ? data.version : workflowRef.current.version;
          setSaveState("conflict");
          setConflict({ version });
          return false;
        }
        setSaveState("error");
        toast.error("Could not save the canvas");
        console.error(error);
        return false;
      }
    },
    [saveGraph, workflow._id],
  );

  const save = useCallback((): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current;
    if (latestRef.current.key === savedKeyRef.current) {
      setSaveState("saved");
      return Promise.resolve(true);
    }
    const running = commit(versionRef.current);
    inFlightRef.current = running;
    void running.finally(() => {
      inFlightRef.current = null;
    });
    return running;
  }, [commit]);

  /**
   * Puts a snapshot from the undo stack back on the canvas.
   *
   * Run status and selection are taken from what is on screen rather than from the snapshot: the
   * rings belong to the latest run, not to the graph as it was three edits ago, and an undo that
   * silently reopened the settings panel for a node you had deselected would be its own surprise.
   * Neither is stored, so the restored graph still hashes to the snapshot's key and this does not
   * come back round as a new entry.
   */
  const applyHistory = useCallback(
    (next: History<Snapshot>) => {
      if (next === historyRef.current) return;
      historyRef.current = next;
      setNodes((current) => {
        const live = new Map(current.map((node) => [node.id, node]));
        return next.present.nodes.map((node) => {
          const now = live.get(node.id);
          if (!now) return node;
          return {
            ...node,
            selected: now.selected ?? false,
            data: { ...node.data, status: now.data.status, durationMs: now.data.durationMs },
          };
        });
      });
      setEdges(next.present.edges);
      syncUndoable(next);
    },
    [setEdges, setNodes, syncUndoable],
  );

  const undo = useCallback(() => {
    applyHistory(undoHistory(historyRef.current, Date.now()));
  }, [applyHistory]);

  const redo = useCallback(() => {
    applyHistory(redoHistory(historyRef.current, Date.now()));
  }, [applyHistory]);

  /**
   * "Tidy up": lay every node out along its wires.
   *
   * It goes through `setNodes` and nothing else, which is the same path a drag-move takes — so the
   * effect that watches the graph marks the canvas unsaved and pushes exactly one undo entry, and
   * Undo puts the pile back where it was. There is deliberately no second history mechanism here.
   *
   * The nodes are read inside the updater rather than closed over, so dragging a node does not
   * hand the toolbar a new callback sixty times a second.
   */
  const tidy = useCallback(() => {
    setNodes((current) => {
      if (!canAutoLayout(current)) return current;
      const positions = autoLayout(current, edges);
      let changed = false;
      const next = current.map((node) => {
        const at = positions[node.id];
        if (!at || (node.position.x === at.x && node.position.y === at.y)) return node;
        changed = true;
        return { ...node, position: at };
      });
      return changed ? next : current;
    });
    // After the layout, not with it: React Flow has to measure the moved nodes before it can frame
    // them, and `fitView` reads the store the commit above is about to write.
    requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 300 });
    });
  }, [edges, fitView, setNodes]);

  // Live run status from the `steps` subscription, merged into the nodes React Flow renders.
  // `toStoredGraph` drops `data.status`, so the effect below sees an unchanged graph key and the
  // canvas does not become dirty — a run lighting the canvas up is not an edit.
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

  // Every change to the graph passes through here: it is what marks the canvas dirty and what
  // records an undo step. Nothing is written to Convex — that is Save's job now.
  //
  // Declared before the adopt effect on purpose. Both can run in the same commit, and the flag this
  // one writes is what stops the other from replacing an edit the user just made.
  useEffect(() => {
    const key = graphKey(nodes, edges);
    dirtyRef.current = key !== savedKeyRef.current;
    setDirty(dirtyRef.current);
    setSaveState((current) => {
      // A save in flight, and a conflict nobody has answered yet, both outrank the flag: the first
      // is about to change it and the second is a question, not a status. A failed save is not
      // sticky — once the graph has moved again, "Unsaved changes" is the honest thing to say.
      if (current === "conflict" || current === "saving") return current;
      return dirtyRef.current ? "dirty" : "saved";
    });

    // Unchanged graph: selection, a drag that ended where it started, or a snapshot we just
    // restored. Neither an undo step nor anything to save.
    if (key === historyRef.current.present.key) {
      latestRef.current = historyRef.current.present;
      return;
    }

    const snapshot: Snapshot = { key, nodes, edges };
    latestRef.current = snapshot;
    historyRef.current = pushHistory(historyRef.current, snapshot, Date.now());
    syncUndoable(historyRef.current);
  }, [edges, nodes, syncUndoable]);

  // The subscription moved ahead of us: take the server's graph, or say that it is there.
  //
  // This is what draws the Builder agent's work onto an open canvas. With nothing unsaved locally
  // the newer document is simply adopted, exactly as before — the agent is editing *this* user's
  // workflow, in front of them, on their instruction, and watching its nodes appear is the point.
  //
  // With unsaved edits it is not, because those edits are now the user's own work rather than the
  // tail of a 600ms debounce: overwriting them silently is the one thing this must not do. The
  // notice says the graph moved, and the two ways out are both explicit — Save (which will raise
  // the conflict dialog, since the version has moved) or "Reload theirs".
  useEffect(() => {
    workflowRef.current = workflow;
    // Our own write coming back round. Nothing to adopt and nothing to warn about: `commit` is
    // holding the newer version and will file it the moment the mutation answers.
    if (inFlightRef.current) return;
    if (workflow.version <= versionRef.current) return;
    if (!dirtyRef.current || reloadRef.current) {
      adopt(workflow);
      return;
    }
    // …and it stays there until the user answers it. Adopting the moment the local edits happen to
    // go away — an undo back to the saved graph — would move the canvas under someone who did not
    // ask for it, and take their Redo with it.
    setRemote({ version: workflow.version, fromBuilder: workflow.lastEditSource === "builder" });
  }, [adopt, workflow]);

  /** "Reload theirs", from either the conflict dialog or the notice. */
  const reloadTheirs = useCallback(() => {
    if (workflowRef.current.version > versionRef.current) {
      adopt(workflowRef.current);
      return;
    }
    // The newer document has not reached this subscription yet; the effect above adopts it the
    // moment it does.
    reloadRef.current = true;
    setConflict(null);
    setRemote(null);
  }, [adopt]);

  /** "Keep mine": retry the save against the version the conflict reported. */
  const keepMine = useCallback(() => {
    const target = conflict;
    setConflict(null);
    if (!target) return;
    const expected = Math.max(target.version, workflowRef.current.version);
    versionRef.current = expected;
    const running = inFlightRef.current ?? commit(expected);
    inFlightRef.current = running;
    void running.finally(() => {
      inFlightRef.current = null;
    });
  }, [commit, conflict]);

  // Save, Undo and Redo from the keyboard.
  //
  // ⌘S is answered wherever the caret is, config panel fields included: "save what I just typed" is
  // the whole reason the shortcut exists, and the browser's own Save dialog is never what someone
  // pressing it here wants. Undo and Redo are the opposite — inside a text field ⌘Z belongs to the
  // field, and stealing it to rearrange the graph would be indefensible.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !hasModifier(event)) return;
      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        void save();
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, save, undo]);

  /**
   * The other way a palette entry becomes a node: tapped rather than dragged.
   *
   * A finger cannot drag a card out of a list that scrolls under it, so on a phone this is the only
   * way to add a node at all — and it is the faster way with a mouse too. The node lands in the
   * middle of whatever the user is looking at (the flow container's centre, put through the same
   * `screenToFlowPosition` the drop uses) and is selected, which opens its settings: adding a node
   * you then have to hunt for would be half a gesture.
   */
  const flowRef = useRef<HTMLDivElement | null>(null);
  const addNode = useCallback(
    (nodeType: string) => {
      const box = flowRef.current?.getBoundingClientRect();
      const centre = screenToFlowPosition(
        box
          ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
          : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      );
      setNodes((current) => {
        const node = createNodeFromPalette(current, nodeType, centredNodePosition(centre));
        if (!node) return current;
        return current
          .map((existing) => (existing.selected ? { ...existing, selected: false } : existing))
          .concat({ ...node, selected: true });
      });
    },
    [screenToFlowPosition, setNodes],
  );

  // The toolbar's controls, reported up whenever one of them changes. Keyed on the node *count*
  // rather than on the nodes, so moving one does not rebuild this on every animation frame.
  const nodeCount = nodes.length;
  const controls = useMemo<EditorControls>(
    () => ({
      saveState,
      dirty,
      canUndo: undoable.canUndo,
      canRedo: undoable.canRedo,
      canTidy: nodeCount > 1,
      save,
      undo,
      redo,
      tidy,
      addNode,
    }),
    [
      addNode,
      dirty,
      nodeCount,
      redo,
      save,
      saveState,
      tidy,
      undo,
      undoable.canRedo,
      undoable.canUndo,
    ],
  );

  useEffect(() => {
    onControlsChange(controls);
  }, [controls, onControlsChange]);

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
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setNodes((current) => {
        const node = createNodeFromPalette(current, nodeType, position);
        return node ? current.concat(node) : current;
      });
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

  // Selection out. An effect rather than a call inside the memo above, because reporting is a
  // side effect and `selected` is derived state.
  useEffect(() => {
    onSelectedNodeChange?.(selected?.id ?? null);
  }, [onSelectedNodeChange, selected]);

  // …and selection in: the run timeline clicking a bar. Selecting is what opens the config panel,
  // and `fitView` on that one node is what makes the click land somewhere you can see when the bar
  // belongs to a node three screens to the right. `maxZoom` keeps a lone node from filling the
  // canvas at 4×. Keyed on the request, so re-clicking the same bar re-centres.
  useEffect(() => {
    if (!focusNode) return;
    const { nodeId } = focusNode;
    setNodes((current) => {
      if (!current.some((node) => node.id === nodeId)) return current;
      // The same array back when nothing moved. `map` would hand out a fresh one every time, which
      // re-renders, which re-runs this effect — and the debounced save would wake for a selection.
      let changed = false;
      const next = current.map((node) => {
        const selected = node.id === nodeId;
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
    void fitView({ nodes: [{ id: nodeId }], padding: 0.6, maxZoom: 1.2, duration: 250 });
  }, [fitView, focusNode, setNodes]);

  /**
   * Live run feedback on every wire, from `edgeRunState` (`edge-run-state.ts`): a branch the run
   * did not take dims exactly as before, and one it did lights up while the node at its far end is
   * still working (an animated, amber wire), settles solid once that node succeeds (the same
   * primary colour a taken edge has always used), or turns the failed tone if it did not. Styling
   * lives here rather than in state — `toStoredGraph` ignores `className` and `animated`, but
   * writing either into `edges` would still churn the save effect on every run.
   */
  const styledEdges = useMemo(() => {
    // One lookup per edge instead of a scan per edge, and the branch names come from the same
    // `sourceHandles()` the node itself draws its handles from. The value carries the node type and
    // its handles, because placing a branch label takes all three: which node, which of its
    // handles, and how many there are — the last two are what keep two labels off each other.
    const branching = new Map<string, { nodeType: string; handles: string[] }>();
    for (const node of nodes) {
      const handles = sourceHandles(node.data.nodeType, node.data.inputs);
      if (handles.length > 1) branching.set(node.id, { nodeType: node.data.nodeType, handles });
    }

    return edges.map((edge) => {
      const handle = edge.sourceHandle ?? DEFAULT_HANDLE;
      // Only a node with more than one way out has anything to say: "out" would be noise.
      const branch = branching.get(edge.source);
      // The plain word rather than the handle id: the wire leaving a Condition reads "no", not
      // "false". The id is still what the edge is stored and matched by — only the chip changes.
      const typed: Edge = branch
        ? {
            ...edge,
            type: LABELLED_EDGE_TYPE,
            data: {
              label: handleLabel(branch.nodeType, handle),
              handleIndex: Math.max(branch.handles.indexOf(handle), 0),
              handleCount: branch.handles.length,
            } satisfies LabelledEdgeData,
          }
        : edge;

      const run = edgeRunState({
        sourceStatus: runByNode[edge.source]?.status,
        sourceHandle: runByNode[edge.source]?.handle,
        handle,
        targetStatus: runByNode[edge.target]?.status,
      });
      // Nothing to say yet — no run, or the source has not finished — so the edge stays exactly as
      // `typed` left it, branch label included.
      if (run.taken && run.tone === "neutral") return typed;
      return {
        ...typed,
        animated: run.animated,
        className: cn(edge.className, run.taken ? EDGE_TONE_CLASS[run.tone] : UNTAKEN_EDGE_CLASS),
      };
    });
  }, [edges, nodes, runByNode]);

  /**
   * What each node still needs before it could run — a missing connection, a dead token, an empty
   * required field, a node this plan does not include.
   *
   * The two subscriptions it reads are the same ones the palette and the config panel's connection
   * picker use, so a card, a dropdown and a dimmed palette entry can never disagree about whether
   * this org has a usable Slack token. The result is handed to the cards through context rather
   * than written into `node.data`: it is derived from the org, not from the document, and a
   * connection changing must not light up Save, push an undo entry or wake the save effect.
   */
  const connections = useQuery(api.connections.list);
  const plan = useQuery(api.plan.current, {});
  // Below `md` the palette has no column of its own: it comes up from the bottom when the floating
  // button asks for it. The flag also moves the zoom controls out from under that button and
  // rewrites the empty canvas's instruction, both of which are markup rather than styling.
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const planFeatures = plan?.features;
  const setupByNode = useMemo(() => {
    const byNode: Record<string, NodeSetup> = {};
    for (const node of nodes) {
      const setup = nodeSetup(node, connections as readonly SetupConnection[] | undefined, planFeatures);
      if (setup.state !== "ready") byNode[node.id] = setup;
    }
    return byNode;
  }, [connections, nodes, planFeatures]);

  /**
   * Drops a starter template onto an empty canvas.
   *
   * This is the same graph `workflows.create` would have been handed from the workflow list; here
   * the workflow already exists, so the template becomes an ordinary edit — one undo step, unsaved
   * until Save, exactly like drawing it by hand. Guarded on emptiness at the call site: a template
   * is a starting point, never something that overwrites work.
   */
  const applyTemplate = useCallback(
    (template: WorkflowTemplate) => {
      const loaded = fromStoredGraph(template.graph);
      setNodes(loaded.nodes);
      setEdges(loaded.edges);
      toast.success(`Added the ${template.name} template — press Save to keep it`);
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
      {/* `relative`, because under 900px the settings panel stops taking width and overlays the
          canvas from the right instead of squeezing it into a strip. */}
      <div className="relative flex h-full min-h-0 w-full">
        {/* Only the flow needs to know what each node is missing; the panel reads the node it is
            editing directly. */}
        <NodeSetupContext.Provider value={setupByNode}>
          <div ref={flowRef} className="min-w-0 flex-1">
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
              // A phone's whole gesture vocabulary here: one finger pans, two pinch to zoom, and a
              // two-finger scroll is *not* a pan — `panOnScroll` would fight the pinch and make the
              // canvas lurch. `padding` keeps a fitted graph off the toolbar and the floating
              // button; `minZoom` lets a wide workflow be seen whole on a 390px screen.
              zoomOnPinch
              panOnDrag
              panOnScroll={false}
              fitViewOptions={{ padding: 0.15 }}
              deleteKeyCode={["Backspace", "Delete"]}
              colorMode={colorMode}
              minZoom={0.2}
              className="bg-background"
              aria-label="Workflow canvas"
            >
                {/* Dots rather than lines: a ruled surface you can judge distance on without it
                  competing with the wires. Their colour is a token, in `app/globals.css`. */}
              <Background gap={20} size={1} />
              {/* Zoom in / out / fit view, in the app's own tokens rather than React Flow's default
                  white-on-white — see the `.react-flow__controls` block in `app/globals.css`. */}
              <Controls
                showInteractive={false}
                aria-label="Canvas zoom controls"
                fitViewOptions={{ padding: 0.2, duration: 200 }}
                // Bottom-left is where the "Add node" button is on a phone, and the minimap that
                // normally owns the other corner is gone below 900px — so they swap.
                position={isMobile ? "bottom-right" : "bottom-left"}
              />
              {/* Bottom-right of the canvas column, and gone below 900px, where the settings panel
                  overlays that corner (`.pf-canvas-minimap` in `app/globals.css`). */}
              <MiniMap pannable zoomable ariaLabel="Canvas minimap" className="pf-canvas-minimap" />

              {/*
                Someone else's newer graph, held back because this canvas has edits of its own. A
                panel rather than a dialog on purpose: the user is mid-edit, and the right thing is to
                tell them, not to take the canvas away from them.
              */}
              {remote ? (
                <Panel position="top-center" className="mt-2">
                  <div
                    role="status"
                    className="flex max-w-md items-center gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 text-sm shadow-sm backdrop-blur-sm"
                  >
                    <span>
                      {remote.fromBuilder
                        ? "The Builder changed this workflow"
                        : "This workflow changed elsewhere"}{" "}
                      — Save to overwrite, or
                    </span>
                    <Button variant="outline" size="sm" onClick={reloadTheirs}>
                      Reload theirs
                    </Button>
                  </div>
                </Panel>
              ) : null}

              {/*
                Nothing here yet. An overlay rather than a card in a corner: an empty canvas has no
                other content to sit beside, and the three ways to start one — drag, template,
                describe it — are the whole of what the page can do right now. Everything but the
                buttons lets the pointer through, so dragging a node onto the middle still works.
              */}
              {nodes.length === 0 ? (
                <Panel position="top-center" className="pointer-events-none mt-20">
                  <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
                    <span
                      aria-hidden
                      className="grid size-12 place-items-center rounded-xl border border-border bg-card text-muted-foreground"
                    >
                      <WorkflowIcon className="size-5" />
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Start with a trigger</p>
                      <p className="text-sm text-muted-foreground">
                        {isMobile
                          ? "Tap + to add a trigger, or start from something that already works."
                          : "Drag one in from the left, or start from something that already works."}
                      </p>
                    </div>
                    {/* Side by side where there is width for it; a stack on a phone, where two
                        buttons on one line would each be too narrow to read. */}
                    <div className="pointer-events-auto flex w-full flex-col items-center justify-center gap-2 md:w-auto md:flex-row md:flex-wrap">
                      <TemplateDialog
                        onPick={applyTemplate}
                        title="Start from a template"
                        description="Each one drops a working graph onto this canvas. Nothing is locked — edit or delete any node afterwards."
                        trigger={
                          <Button variant="outline" size="sm">
                            <LayoutTemplateIcon />
                            Use a template
                          </Button>
                        }
                      />
                      {onBuildWithAi ? (
                        <Button variant="ghost" size="sm" onClick={onBuildWithAi}>
                          <SparklesIcon />
                          Build with AI
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Panel>
              ) : null}
            </ReactFlow>
          </div>
        </NodeSetupContext.Provider>

        {/*
          The way to add a node when there is no palette beside the canvas. Bottom-left, where the
          zoom controls sit on a desktop and where a thumb reaches, clear of the home indicator; the
          settings sheet (z-30) comes over it, because while you are configuring a node "add another
          one" is not the next thing.
        */}
        {isMobile ? (
          <>
            <div
              className="absolute bottom-0 left-0 z-20 p-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
            >
              <Button
                type="button"
                size="icon"
                aria-label="Add node"
                className="size-11 rounded-full shadow"
                onClick={() => setPaletteOpen(true)}
              >
                <PlusIcon className="size-5" />
                <span className="sr-only">Add node</span>
              </Button>
            </div>
            <NodePaletteSheet open={paletteOpen} onOpenChange={setPaletteOpen} onPick={addNode} />
          </>
        ) : null}

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
            workflowStatus={workflow.status}
            steps={steps}
            setNodes={setNodes}
            onClose={deselect}
          />
        ) : null}
      </div>

      {/*
        The save came back `version_conflict`: the graph on the server is not the one this canvas
        started from. Both ways out lose something, so neither is chosen for the user — "Reload
        theirs" throws away the local edits, "Keep mine" writes over the other version.
      */}
      <AlertDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This workflow changed elsewhere</AlertDialogTitle>
            <AlertDialogDescription>
              {conflict === null
                ? null
                : `Someone else — another tab, or the Builder — saved version ${conflict.version} while you were editing. Reload theirs and your unsaved changes are gone; keep yours and theirs are overwritten.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={reloadTheirs}>
              Reload theirs
            </AlertDialogAction>
            <AlertDialogAction onClick={keepMine}>Keep mine</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
