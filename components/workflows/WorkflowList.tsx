"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon, WorkflowIcon } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeCron } from "@/lib/schedule";

import { NewWorkflowDialog } from "./NewWorkflowDialog";
import { reportWorkflowError } from "./errors";
import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";

/** One row of `api.workflows.list` — the summary projection, never the graph. */
type Workflow = FunctionReturnType<typeof api.workflows.list>[number];

const STATUS_VARIANT: Record<
  Workflow["status"],
  React.ComponentProps<typeof Badge>["variant"]
> = {
  draft: "outline",
  active: "default",
  paused: "secondary",
};

/**
 * The stored enum in the words the rest of the app uses. `active` is the one that had to change:
 * the canvas' button says "Publish", so the badge has to say "Published" or the two are describing
 * different things. `paused` keeps its own word — it means published once and switched off, which
 * is not the same as a draft.
 */
const STATUS_LABEL: Record<Workflow["status"], string> = {
  draft: "Draft",
  active: "Published",
  paused: "Paused",
};

/**
 * The organisation's workflows, live from Convex. Switching organisations re-runs the query with new
 * token claims, so the list swaps itself; nothing here filters by org on the client.
 */
export function WorkflowList() {
  const workflows = useQuery(api.workflows.list);

  // The row menu opens dialogs that live outside the menu (Base UI's documented pattern). Each target
  // survives until its dialog has finished animating closed, then unmounts — so the next open starts
  // from fresh state instead of the last row's, without an effect to reseed it.
  const [renameTarget, setRenameTarget] = useState<Workflow | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (workflows === undefined) {
    return (
      <div
        className="flex flex-col gap-3"
        role="status"
        aria-label="Loading workflows"
      >
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <span
            aria-hidden
            className="mb-2 inline-flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <WorkflowIcon className="size-4.5" />
          </span>
          <CardTitle>No workflows yet</CardTitle>
          <CardDescription>
            A workflow is a trigger, a few actions, and the lines between them. Start from a
            template if you would rather see one working before drawing your own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewWorkflowDialog defaultTab="template" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-12 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((workflow) => (
              <TableRow key={workflow._id}>
                <TableCell className="px-4 font-medium">
                  <Link
                    href={`/w/${workflow._id}`}
                    className="underline-offset-4 outline-none hover:underline focus-visible:underline"
                  >
                    {workflow.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={STATUS_VARIANT[workflow.status]}>
                      {STATUS_LABEL[workflow.status]}
                    </Badge>
                    {/* Only enabled schedules appear: a paused one is not something to claim. */}
                    {workflow.schedule ? (
                      <Badge variant="secondary">
                        Scheduled · {describeCron(workflow.schedule.cron)}
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  v{workflow.version}
                </TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={formatAbsoluteTime(workflow.updatedAt)}
                >
                  updated {formatRelativeTime(workflow.updatedAt)}
                </TableCell>
                <TableCell className="px-4 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                    >
                      <MoreHorizontalIcon />
                      <span className="sr-only">
                        Actions for {workflow.name}
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-36">
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget(workflow);
                          setRenameOpen(true);
                        }}
                      >
                        <PencilIcon />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setDeleteTarget(workflow);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {renameTarget ? (
        <RenameWorkflowDialog
          workflow={renameTarget}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          onClosed={() => {
            if (!renameOpen) setRenameTarget(null);
          }}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteWorkflowDialog
          workflow={deleteTarget}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onClosed={() => {
            if (!deleteOpen) setDeleteTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

function RenameWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onClosed,
}: {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const rename = useMutation(api.workflows.rename);
  const nameId = useId();

  // Seeded once per mount, and the parent unmounts this dialog after it closes, so an abandoned edit
  // never survives into the next rename.
  const [name, setName] = useState(workflow.name);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    try {
      await rename({ id: workflow._id, name: name.trim() || workflow.name });
      toast.success("Workflow renamed");
      onOpenChange(false);
    } catch (error) {
      reportWorkflowError(error, "Could not rename the workflow");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed();
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename workflow</DialogTitle>
            <DialogDescription>
              Everyone in this organisation sees the new name.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={pending}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onClosed,
}: {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const remove = useMutation(api.workflows.remove);
  const [pending, setPending] = useState(false);

  async function onDelete() {
    if (pending) return;

    setPending(true);
    try {
      await remove({ id: workflow._id });
      toast.success(`Deleted ${workflow.name}`);
      onOpenChange(false);
    } catch (error) {
      reportWorkflowError(error, "Could not delete the workflow");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete “{workflow.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The workflow and its canvas go for everyone in this organisation. Runs already recorded
            stay in the history. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete workflow"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
