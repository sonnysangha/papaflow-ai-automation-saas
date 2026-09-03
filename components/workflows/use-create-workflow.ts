"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { WorkflowTemplate } from "@/lib/templates";

import { reportWorkflowError, workflowLimitFrom } from "./errors";

/**
 * Creating a workflow, wherever it is started from: the "New workflow" dialog, and the template
 * gallery under the empty state.
 *
 * All of it is one `workflows.create` — a template is a `graph` argument and nothing more — so the
 * plan wall, the toast and the jump to the canvas live here once rather than in each caller. The
 * wall is state rather than a toast on purpose: hitting a plan cap is the answer to what you just
 * tried to do, and it has to stay on screen next to the thing you tried.
 */
export function useCreateWorkflow() {
  const router = useRouter();
  const create = useMutation(api.workflows.create);

  const [pending, setPending] = useState(false);
  /** The template being created, so its card can say "Adding…" while the mutation is in flight. */
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  /** The plan's workflow cap once `workflows.create` has refused; `undefined` until it does. */
  const [limit, setLimit] = useState<number | null | undefined>(undefined);

  const atLimit = limit !== undefined;

  /** Creates and navigates. Answers whether it worked, so a dialog knows to close itself. */
  async function submitCreate(args: {
    name: string;
    graph?: WorkflowTemplate["graph"];
  }): Promise<boolean> {
    if (pending) return false;

    setPending(true);
    try {
      const id = await create(args);
      router.push(`/w/${id}`);
      return true;
    } catch (error) {
      setLimit(workflowLimitFrom(error));
      reportWorkflowError(error, "Could not create the workflow");
      return false;
    } finally {
      setPending(false);
      setPendingTemplate(null);
    }
  }

  function createFromTemplate(template: WorkflowTemplate): void {
    setPendingTemplate(template.id);
    void submitCreate({ name: template.name, graph: template.graph });
  }

  /** Forgets a wall from a previous attempt — the organisation may have upgraded since. */
  function clearLimit(): void {
    setLimit(undefined);
  }

  return {
    submitCreate,
    createFromTemplate,
    pending,
    pendingTemplate,
    limit,
    atLimit,
    clearLimit,
  };
}
