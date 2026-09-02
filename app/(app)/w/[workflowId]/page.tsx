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
  // lib/engine-client → workflows/run-graph — so the import has to stay even before the Run button
  // exists (Task 4 hands this action to <RunBar/>). Without it the dev server compiles 0 workflows.
  void runWorkflow;

  // The id is only trusted as far as Convex: `workflows.get` re-checks it against the org.
  return <Editor workflowId={workflowId as Id<"workflows">} />;
}
