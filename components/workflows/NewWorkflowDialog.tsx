"use client";

import { useId, useState, type ReactElement } from "react";
import { PlusIcon } from "lucide-react";

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
import { cn } from "@/lib/utils";

import { FULL_SCREEN_DIALOG } from "./mobile-dialog";
import { TemplateGallery } from "./TemplateDialog";
import { useCreateWorkflow } from "./use-create-workflow";

/** Matches the fallback `convex/workflows.ts` applies to a blank name. */
const DEFAULT_NAME = "Untitled workflow";

type Tab = "blank" | "template";

/**
 * The "New workflow" button and the two ways to start one: a blank canvas, or a starter template
 * that arrives already wired up.
 *
 * Both go through the same `workflows.create` — a template is nothing more than a `graph` argument
 * — so the plan wall, the toast and the redirect to the canvas are shared rather than duplicated.
 * Used from the toolbar, the empty state and the getting-started checklist, so it owns its own
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
  const nameId = useId();
  const { submitCreate, createFromTemplate, pending, pendingTemplate, limit, atLimit, clearLimit } =
    useCreateWorkflow();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [name, setName] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await submitCreate({ name: name.trim() || DEFAULT_NAME })) {
      setOpen(false);
      setName("");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nowOpen) => {
        // A fresh open starts without last time's wall — the org may have upgraded since — and on
        // the tab the caller asked for rather than the one abandoned last time.
        if (!nowOpen) {
          clearLimit();
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

      <DialogContent
        className={cn(
          FULL_SCREEN_DIALOG,
          "max-sm:grid-rows-[auto_minmax(0,1fr)] max-sm:overflow-hidden sm:max-w-4xl",
        )}
      >
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>
            Start from nothing, or from a template that already runs.
          </DialogDescription>
        </DialogHeader>

        {/* `min-h-0` all the way down, so on a phone it is the gallery that scrolls inside the
            full-screen dialog rather than the dialog growing past the bottom of the screen. */}
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="min-h-0 min-w-0">
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

          <TabsContent value="template" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 pt-2">
            {atLimit ? <PlanWall limit={limit} /> : null}
            <TemplateGallery
              className="min-h-0 min-w-0 flex-1 sm:max-h-[55vh]"
              onPick={createFromTemplate}
              pendingId={atLimit ? undefined : pendingTemplate}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** The plan's workflow cap, once `workflows.create` has refused. Shared by both tabs and the list. */
export function PlanWall({ limit }: { limit: number | null | undefined }) {
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
