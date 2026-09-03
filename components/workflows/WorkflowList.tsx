"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  HistoryIcon,
  LayoutTemplateIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  SquarePenIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { RunStatusDot, RUN_STATUS_TONE, WorkflowStatusPill } from "@/components/shared/status";
import { TriggerChip } from "@/components/shared/TriggerChip";
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
import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { NewWorkflowDialog, PlanWall } from "./NewWorkflowDialog";
import { TemplateGallery } from "./TemplateDialog";
import { reportWorkflowError } from "./errors";
import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";
import { useCreateWorkflow } from "./use-create-workflow";
import {
  activityCaption,
  filterWorkflows,
  formatRunDuration,
  nextRunLabel,
  statusCounts,
  WORKFLOW_FILTERS,
  type WorkflowStatusFilter,
} from "./workflow-list";

/** One row of `api.workflows.list` — the summary projection, never the graph. */
export type Workflow = FunctionReturnType<typeof api.workflows.list>[number];

/**
 * The organisation's workflows, live from Convex. Switching organisations re-runs the query with new
 * token claims, so the list swaps itself; nothing here filters by org on the client.
 *
 * Search and the status chips are client-side on purpose: the query already holds every row this
 * organisation has (a plan caps them well below a page), so filtering is arithmetic on data that is
 * already here rather than a round trip per keystroke.
 */
export function WorkflowList() {
  const router = useRouter();
  const workflows = useQuery(api.workflows.list);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkflowStatusFilter>("all");

  // The row menu opens dialogs that live outside the menu (Base UI's documented pattern). Each target
  // survives until its dialog has finished animating closed, then unmounts — so the next open starts
  // from fresh state instead of the last row's, without an effect to reseed it.
  const [renameTarget, setRenameTarget] = useState<Workflow | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loading = workflows === undefined;
  const rows = workflows ?? [];
  const counts = statusCounts(rows);
  const visible = filterWorkflows(rows, { query, status });
  const filtered = query.trim() !== "" || status !== "all";

  // Nothing has ever been created here: the toolbar would be a row of controls for an empty set,
  // so the shelf of templates takes the whole page instead.
  if (!loading && rows.length === 0) return <WorkflowsEmpty />;

  return (
    <>
      <WorkflowToolbar
        query={query}
        onQueryChange={setQuery}
        status={status}
        onStatusChange={setStatus}
        counts={counts}
        loading={loading}
        actions={
          <>
            <NewWorkflowDialog
              defaultTab="template"
              trigger={
                <Button variant="outline">
                  <LayoutTemplateIcon />
                  Browse templates
                </Button>
              }
            />
            <NewWorkflowDialog />
          </>
        }
      />

      {loading ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Loading workflows">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-border p-8">
          <p className="text-sm font-medium">No workflows match</p>
          <p className="text-sm text-muted-foreground">
            {counts.all === 1
              ? "This organisation has one workflow, and it is not this."
              : `This organisation has ${counts.all} workflows, none of them matching.`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-4">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Last run</TableHead>
                <TableHead className="hidden lg:table-cell">Activity</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                <TableHead className="w-12 px-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((workflow) => (
                <WorkflowRow
                  key={workflow._id}
                  workflow={workflow}
                  onOpen={() => router.push(`/w/${workflow._id}`)}
                  onRename={() => {
                    setRenameTarget(workflow);
                    setRenameOpen(true);
                  }}
                  onDelete={() => {
                    setDeleteTarget(workflow);
                    setDeleteOpen(true);
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {filtered && visible.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing {visible.length} of {counts.all}
        </p>
      ) : null}

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

/**
 * Search, the status chips and the two ways to start a workflow.
 *
 * Takes its buttons as `actions` rather than reaching for the create mutation itself, which keeps
 * the whole bar renderable without a Convex provider — and testable as markup.
 */
export function WorkflowToolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  counts,
  loading = false,
  actions,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  status: WorkflowStatusFilter;
  onStatusChange: (status: WorkflowStatusFilter) => void;
  counts: Record<WorkflowStatusFilter, number>;
  loading?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search workflows"
            aria-label="Search workflows"
            className="pl-8"
          />
        </div>

        <div
          role="group"
          aria-label="Filter by status"
          className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
        >
          {WORKFLOW_FILTERS.map((filter) => {
            const active = filter.value === status;
            return (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                aria-pressed={active}
                disabled={loading}
                onClick={() => onStatusChange(filter.value)}
              >
                {filter.label}
                <span className="text-muted-foreground tabular-nums">{counts[filter.value]}</span>
              </Button>
            );
          })}
        </div>

        {loading ? (
          <Skeleton className="h-4 w-20" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {counts.all} workflow{counts.all === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A click that landed on something with its own behaviour — the row must not answer for it too. */
function onOwnControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a, button, [role='menuitem']") !== null;
}

/**
 * One workflow: what it is, whether it is live, how its last run went and how busy it has been.
 *
 * The row is clickable as a convenience, and every one of the things it says is also reachable on
 * its own — the name is a link to the canvas, the last run is a link to the history, the menu holds
 * the rest — so a keyboard never depends on the row's own click.
 */
export function WorkflowRow({
  workflow,
  now,
  onOpen,
  onRename,
  onDelete,
}: {
  workflow: Workflow;
  /** The clock the row reads ages against. Left out in the app; pinned by the tests. */
  now?: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { lastRun, recentRuns, schedule } = workflow;
  const duration = lastRun ? formatRunDuration(lastRun.startedAt, lastRun.finishedAt) : null;

  return (
    <TableRow
      className="cursor-pointer"
      onClick={(event) => {
        if (onOwnControl(event.target)) return;
        onOpen();
      }}
    >
      {/* `w-full max-w-0` is the truncation trick: the name column absorbs the slack the other
          columns leave, and the link inside it clips rather than widening the table. */}
      <TableCell className="w-full max-w-0 px-4 py-3 align-top whitespace-normal">
        <Link
          href={`/w/${workflow._id}`}
          className="block truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {workflow.name}
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TriggerChip type={workflow.triggerNodeType} />
          {schedule ? (
            <span className="font-mono text-xs text-muted-foreground" title={schedule.cron}>
              {nextRunLabel(schedule, now)}
            </span>
          ) : null}
        </div>
      </TableCell>

      <TableCell className="py-3 align-top">
        <WorkflowStatusPill status={workflow.status} />
      </TableCell>

      <TableCell className="hidden py-3 align-top md:table-cell">
        {lastRun ? (
          <Link
            href={`/w/${workflow._id}/runs`}
            className="group/run inline-flex flex-col gap-0.5 outline-none"
          >
            <span className="inline-flex items-center gap-1.5">
              <RunStatusDot
                status={lastRun.status}
                title={`${RUN_STATUS_TONE[lastRun.status].label} · ${formatAbsoluteTime(lastRun.startedAt)}`}
              />
              <span
                className="text-muted-foreground underline-offset-4 group-hover/run:text-foreground group-hover/run:underline group-focus-visible/run:underline"
                title={formatAbsoluteTime(lastRun.startedAt)}
              >
                {formatRelativeTime(lastRun.startedAt, now)}
              </span>
            </span>
            {duration ? (
              <span className="font-mono text-xs text-muted-foreground">{duration}</span>
            ) : null}
          </Link>
        ) : (
          <span className="text-muted-foreground">Never run</span>
        )}
      </TableCell>

      <TableCell className="hidden py-3 align-top lg:table-cell">
        {recentRuns.length > 0 ? (
          <>
            {/* Oldest on the left, so the strip reads forwards in time like everything else. */}
            <span className="flex items-center gap-1">
              {[...recentRuns].reverse().map((run, index) => (
                <RunStatusDot
                  key={`${run.startedAt}-${index}`}
                  status={run.status}
                  title={`${RUN_STATUS_TONE[run.status].label} · ${formatAbsoluteTime(run.startedAt)}`}
                />
              ))}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
              {activityCaption(workflow.runCount7d)}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No runs yet</span>
        )}
      </TableCell>

      <TableCell
        className="hidden py-3 align-top text-xs text-muted-foreground lg:table-cell"
        title={formatAbsoluteTime(workflow.updatedAt)}
      >
        {formatRelativeTime(workflow.updatedAt, now)}
      </TableCell>

      <TableCell className="px-4 py-3 text-right align-top">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${workflow.name}`} />}
                />
              }
            >
              <MoreHorizontalIcon />
            </TooltipTrigger>
            <TooltipContent>Actions</TooltipContent>
          </Tooltip>

          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem render={<Link href={`/w/${workflow._id}`} />}>
              <SquarePenIcon />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/w/${workflow._id}/runs`} />}>
              <HistoryIcon />
              View runs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

/**
 * Nothing has been built here yet. One card that says what a workflow is and offers the two ways
 * in, and then the templates themselves — a shelf you can read is a better answer to "what can this
 * do?" than a button that promises one.
 */
function WorkflowsEmpty() {
  const { createFromTemplate, pendingTemplate, limit, atLimit } = useCreateWorkflow();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6">
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <WorkflowIcon className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Build your first workflow</h2>
          <p className="text-sm text-muted-foreground">
            A workflow is a trigger, a few actions, and the lines between them.
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <NewWorkflowDialog
            defaultTab="template"
            trigger={
              <Button>
                <LayoutTemplateIcon />
                Start from a template
              </Button>
            }
          />
          <NewWorkflowDialog
            trigger={
              <Button variant="outline">
                <SquarePenIcon />
                Start blank
              </Button>
            }
          />
        </div>
      </div>

      {atLimit ? <PlanWall limit={limit} /> : null}

      <section aria-label="Starter templates" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Or open one of these</h2>
          <p className="text-sm text-muted-foreground">
            Each one is a working graph. Pick it, finish the connections it names, and run it.
          </p>
        </div>
        <TemplateGallery
          onPick={createFromTemplate}
          pendingId={atLimit ? undefined : pendingTemplate}
        />
      </section>
    </div>
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
