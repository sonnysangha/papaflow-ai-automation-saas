import { Editor } from "@/components/canvas/Editor";
import type { Id } from "@/convex/_generated/dataModel";
import { runWorkflow } from "./actions";

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
  // The id is only trusted as far as Convex: `workflows.get` re-checks it against the org.
  return <Editor workflowId={workflowId as Id<"workflows">} runWorkflow={runWorkflow} />;
}
