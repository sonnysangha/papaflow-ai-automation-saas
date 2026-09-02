import { Editor } from "@/components/canvas/Editor";
import type { Id } from "@/convex/_generated/dataModel";

export default async function WorkflowEditorPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;

  // The id is only trusted as far as Convex: `workflows.get` re-checks it against the org.
  return <Editor workflowId={workflowId as Id<"workflows">} />;
}
