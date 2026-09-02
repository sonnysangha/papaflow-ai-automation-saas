"use client";

import { useId, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { PlusIcon } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import type { WorkflowTemplate } from "@/lib/templates";

import { reportWorkflowError, workflowLimitFrom } from "./errors";
import { TemplateGallery } from "./TemplateDialog";

/** Matches the fallback `convex/workflows.ts` applies to a blank name. */
const DEFAULT_NAME = "Untitled workflow";

type Tab = "blank" | "template";

/**
 * The "New workflow" button and the two ways to start one: a blank canvas, or a starter template
 * that arrives already wired up.
 *
 * Both go through the same `workflows.create` — a template is nothing more than a `graph` argument
 * — so the plan wall, the toast and the redirect to the canvas are shared rather than duplicated.
 * Used from the page header, the empty state and the getting-started checklist, so it owns its own
 * trigger and lets the caller replace it.
 */
export function NewWorkflowDialog({
  trigger,
  defaultTab = "blank",
}: {
  /** Replaces the default "New workflow" button — the empty state wants its own wording. */
  trigger?: ReactElement;
  defaultTab?: Tab;
}) {
  const router = useRouter();
  const create = useMutation(api.workflows.create);
  const nameId = useId();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  /** The template being created, so its card can say "Adding…" while the mutation is in flight. */
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  // The plan's workflow cap once `workflows.create` has refused; `undefined` until it does.
  const [limit, setLimit] = useState<number | null | undefined>(undefined);

  const atLimit = limit !== undefined;

  async function submitCreate(args: { name: string; graph?: WorkflowTemplate["graph"] }) {
    if (pending) return;

    setPending(true);
    try {
      const id = await create(args);
      setOpen(false);
      setName("");
      router.push(`/w/${id}`);
    } catch (error) {
      // Most often the free plan's three-workflow wall; the dialog stays open either way, and
      // swaps the form's footer for an upgrade card rather than only flashing a toast.
      setLimit(workflowLimitFrom(error));
      reportWorkflowError(error, "Could not create the workflow");
    } finally {
      setPending(false);
      setPendingTemplate(null);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCreate({ name: name.trim() || DEFAULT_NAME });
  }

  function onPickTemplate(template: WorkflowTemplate) {
    setPendingTemplate(template.id);
    void submitCreate({ name: template.name, graph: template.graph });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nowOpen) => {
        // A fresh open starts without last time's wall — the org may have upgraded since — and on
        // the tab the caller asked for rather than the one abandoned last time.
        if (!nowOpen) {
          setLimit(undefined);
          setTab(defaultTab);
        }
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button>
              <PlusIcon />
              New workflow
            </Button>
          )
        }
      />

      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>
            Start from nothing, or from a template that already runs.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            <TabsTrigger value="blank">Blank</TabsTrigger>
            <TabsTrigger value="template">From template</TabsTrigger>
          </TabsList>

          <TabsContent value="blank" className="pt-2">
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={nameId}>Name</Label>
                <Input
                  id={nameId}
                  autoFocus
                  value={name}
                  placeholder={DEFAULT_NAME}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  You can rename it at any time from the canvas.
                </p>
              </div>

              {atLimit ? <PlanWall limit={limit} /> : null}

              <DialogFooter>
                <DialogClose render={<Button variant="outline" />} disabled={pending}>
                  Cancel
                </DialogClose>
                <Button type="submit" disabled={pending || atLimit}>
                  {pending ? "Creating…" : "Create workflow"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="template" className="pt-2">
            <div className="grid gap-4">
              {atLimit ? <PlanWall limit={limit} /> : null}
              <div className="max-h-[55vh] overflow-y-auto pr-0.5">
                <TemplateGallery
                  onPick={onPickTemplate}
                  pendingId={atLimit ? undefined : pendingTemplate}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** The plan's workflow cap, once `workflows.create` has refused. Shared by both tabs. */
function PlanWall({ limit }: { limit: number | null | undefined }) {
  return (
    <UpgradeCard
      compact
      title={
        limit === null || limit === undefined
          ? "Workflow limit reached"
          : `This plan includes ${limit} workflow${limit === 1 ? "" : "s"}`
      }
      description="Delete one you no longer need, or upgrade for unlimited workflows."
    />
  );
}
