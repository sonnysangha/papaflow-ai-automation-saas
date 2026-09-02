import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicForm } from "@/components/forms/PublicForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicForm } from "@/lib/engine-client";
import { parseFormSpec, type FormSpec } from "@/nodes/triggers/form";

/**
 * `/f/:workflowId` — the hosted public form.
 *
 * Deliberately outside the `(app)` route group: no sidebar, no org switcher, and above all no
 * session. `proxy.ts` runs Clerk's middleware but protects nothing, so this page renders for a
 * stranger as long as it never touches `auth()`-gated code — which is why it loads the form through
 * the engine client (`ENGINE_SECRET`, CLAUDE.md rule 5) rather than a user-scoped Convex query.
 *
 * What the visitor may learn is exactly the form's own configuration. A workflow that does not
 * exist and a workflow with no form trigger both answer 404, so the URL space stays opaque.
 */
export const runtime = "nodejs";

/** The public page must always reflect the workflow as it is saved right now. */
export const dynamic = "force-dynamic";

type PageParams = { params: Promise<{ workflowId: string }> };

/**
 * The form's own configuration, or null for "there is nothing to show here". Never throws: a
 * malformed id reaches Convex's `v.id()` validator as an error, and that is a 404 like any other.
 */
async function loadForm(workflowId: string): Promise<{ spec: FormSpec } | null> {
  try {
    const form = await getPublicForm(workflowId);
    if (!form) return null;

    const spec = parseFormSpec(form.form);
    return spec ? { spec } : null;
  } catch (cause) {
    console.error("form page: could not load the form", cause);
    return null;
  }
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { workflowId } = await params;
  const loaded = await loadForm(workflowId);

  return {
    title: loaded?.spec.title ?? "Form",
    description: loaded?.spec.description,
    // A form is not something to index; its owner shares the link with whoever should fill it in.
    robots: { index: false, follow: false },
  };
}

export default async function PublicFormPage({ params }: PageParams) {
  const { workflowId } = await params;
  const loaded = await loadForm(workflowId);
  if (!loaded) notFound();

  const { spec } = loaded;

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-16 text-foreground">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">{spec.title}</CardTitle>
          {spec.description && <CardDescription>{spec.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <PublicForm workflowId={workflowId} spec={spec} />
        </CardContent>
      </Card>
    </main>
  );
}
