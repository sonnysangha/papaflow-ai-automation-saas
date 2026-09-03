import { Editor } from "@/components/canvas/Editor";
import type { Id } from "@/convex/_generated/dataModel";
import { publishWorkflow, runWorkflow } from "./actions";

export default async function WorkflowEditorPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;

  // `withWorkflow()` discovers workflows by following the imports of Next entrypoints looking for
  // `start()` from "workflow/api". The Manual trigger's action is that path — page → actions.ts →
  // lib/engine-client → workflows/run-graph — so this import is what makes the dev server compile
  // the workflow at all. It is handed to the editor (and on to <RunBar/>) as a prop rather than
  // imported inside the client component, which keeps the chain rooted in this entrypoint.
  //
  // `publishWorkflow` rides the same path and is what roots `workflows/scheduler` here too: it is
  // the switch that starts and cancels a Schedule trigger's sleeping run.
  //
  // The id is only trusted as far as Convex: `workflows.get` re-checks it against the org.
  return (
    <Editor
      workflowId={workflowId as Id<"workflows">}
      runWorkflow={runWorkflow}
      publishWorkflow={publishWorkflow}
    />
  );
}
