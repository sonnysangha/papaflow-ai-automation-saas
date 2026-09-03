"use client";

import { Fragment, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CopyIcon,
  KeyRoundIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { NodeIcon } from "@/components/canvas/node-icon";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import { FULL_WIDTH_DIALOG } from "@/components/workflows/mobile-dialog";

import { AddConnectionDialog } from "./AddConnectionDialog";
import { connectionRowView, type ConnectionRowView } from "./connection-list";

/** One row of `api.connections.list` — the projection, never the sealed secret (CLAUDE.md rule 1). */
type Connection = FunctionReturnType<typeof api.connections.list>[number];

/** The inbound URL: read-only, copyable, and long enough to need a line of its own. */
function InboundUrl({ view, className }: { view: ConnectionRowView; className?: string }) {
  if (!view.inbound) return null;
  const { url, hint } = view.inbound;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
        {url}
      </code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={view.copyLabel}
        className="relative shrink-0 after:absolute after:-inset-2 after:content-[''] md:after:hidden"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(
            () => toast.success("Inbound URL copied"),
            () => toast.error("Could not copy — select the URL and copy it yourself"),
          );
        }}
      >
        <CopyIcon />
      </Button>
      <p className="w-full text-xs text-muted-foreground sm:w-auto">{hint}</p>
    </div>
  );
}

function ConnectionStatusBadge({ view }: { view: ConnectionRowView }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", view.statusTone)} />
      {view.statusLabel}
    </Badge>
  );
}

type RowActions = {
  view: ConnectionRowView;
  busy: boolean;
  onRetest: () => void;
  onRefresh: () => void;
  onDelete: () => void;
};

/** Re-test / Refresh models / Delete. One menu, mounted by the table row and the phone card alike. */
function ConnectionMenu({ view, busy, onRetest, onRefresh, onDelete, className }: RowActions & {
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" className={className} />}
      >
        <MoreHorizontalIcon />
        <span className="sr-only">{view.menuLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={busy} onClick={onRetest}>
          <RotateCwIcon />
          Re-test
        </DropdownMenuItem>
        {view.isAi ? (
          <DropdownMenuItem disabled={busy} onClick={onRefresh}>
            <RefreshCwIcon />
            Refresh models
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One connection as a block, for a phone: seven columns will not fit 390px, and the one column
 * that must never be clipped is the inbound URL — the whole reason someone is on this page.
 */
export function ConnectionCard({
  connection,
  ...actions
}: RowActions & { connection: Connection }) {
  const { view, busy } = actions;

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-border bg-card p-3", busy && "opacity-60")}>
      <div className="flex items-start gap-2">
        <NodeIcon name={view.icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{view.name}</p>
          <p className="truncate text-xs text-muted-foreground">{connection.label}</p>
        </div>
        <ConnectionMenu
          {...actions}
          // A 28px button with a 44px reach, which is what a thumb actually needs.
          className="relative -mt-1 shrink-0 after:absolute after:-inset-2 after:content-['']"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <ConnectionStatusBadge view={view} />
        <span className="font-mono">{view.maskedKey}</span>
        {view.models === null ? null : (
          <span className="tabular-nums">
            {view.models} model{view.models === 1 ? "" : "s"}
          </span>
        )}
        <span title={view.updatedTitle}>{view.updated}</span>
      </div>

      <InboundUrl view={view} />

      {view.notice ? <p className="text-xs text-muted-foreground">{view.notice}</p> : null}
    </div>
  );
}

/** `{ code, error }` from `/api/connections/:id`, or a generic message when it is not JSON. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { error } = body as { error?: unknown };
      if (typeof error === "string") return error;
    }
  } catch {
    // Falls through.
  }
  return "Something went wrong — please try again";
}

/**
 * The organisation's connections, live from Convex. The row menu's actions are HTTP rather than
 * Convex mutations because every one of them has to open the sealed secret, which only Node-side
 * code may do; the table itself then updates from the query subscription.
 */
export function ConnectionList() {
  const connections = useQuery(api.connections.list);

  // The menu opens a dialog that lives outside it (Base UI's documented pattern), and the target
  // survives until the dialog has finished animating closed.
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runAction(connection: Connection, action: "retest" | "refresh") {
    if (busyId) return;
    setBusyId(connection._id);
    try {
      const response = await fetch(`/api/connections/${connection._id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        toast.error(await errorMessage(response));
        return;
      }

      // `ConnectionTestOutcome`, restated rather than imported: `lib/connections-server.ts` opens
      // sealed credentials and must never be pulled into a browser bundle.
      const result = (await response.json()) as
        | { ok: true; models?: number }
        | { ok: false; error: string };

      if (!result.ok) {
        toast.error(`${connection.label}: ${result.error}`);
        return;
      }

      toast.success(
        action === "refresh" && typeof result.models === "number"
          ? `${connection.label}: ${result.models} model${result.models === 1 ? "" : "s"} available`
          : `${connection.label} is working`,
      );
    } catch {
      toast.error("Could not reach the server — please try again");
    } finally {
      setBusyId(null);
    }
  }

  if (connections === undefined) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading connections">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (connections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <span
            aria-hidden
            className="mb-2 inline-flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <KeyRoundIcon className="size-4.5" />
          </span>
          <CardTitle>Connect your first app</CardTitle>
          <CardDescription>
            Bring your own API keys and bot tokens. Each one is encrypted before it is stored, and
            a node opens it only while a run is in flight — never in the browser, never in a log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddConnectionDialog />
        </CardContent>
      </Card>
    );
  }

  /** One place decides what a row says and what its menu does; the two layouts only arrange it. */
  const rowProps = (connection: Connection) => ({
    view: connectionRowView(connection),
    busy: busyId === connection._id,
    onRetest: () => void runAction(connection, "retest"),
    onRefresh: () => void runAction(connection, "refresh"),
    onDelete: () => {
      setDeleteTarget(connection);
      setDeleteOpen(true);
    },
  });

  return (
    <>
      {/* Below `md`, stacked blocks: the inbound URL is the point of this page and a table that
          scrolls sideways puts it off-screen. */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label="Connections">
        {connections.map((connection) => (
          <li key={connection._id}>
            <ConnectionCard connection={connection} {...rowProps(connection)} />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl ring-1 ring-foreground/10 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">App</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-12 px-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((connection) => {
              const props = rowProps(connection);
              const { view, busy } = props;

              return (
                <Fragment key={connection._id}>
                  <TableRow
                    className={cn(busy && "opacity-60", (view.inbound || view.notice) && "border-b-0")}
                  >
                    <TableCell className="px-4 font-medium">
                      <span className="flex items-center gap-2">
                        <NodeIcon
                          name={view.icon}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        {view.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{connection.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {view.maskedKey}
                    </TableCell>
                    <TableCell>
                      <ConnectionStatusBadge view={view} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {view.models === null ? "—" : view.models}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={view.updatedTitle}>
                      {view.updated}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <ConnectionMenu {...props} />
                    </TableCell>
                  </TableRow>

                  {view.inbound ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="px-4 pt-0">
                        <InboundUrl view={view} />
                      </TableCell>
                    </TableRow>
                  ) : null}

                  {view.notice ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="px-4 pt-0">
                        <p className="text-xs text-muted-foreground">{view.notice}</p>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {deleteTarget ? (
        <DeleteConnectionDialog
          connection={deleteTarget}
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

function DeleteConnectionDialog({
  connection,
  open,
  onOpenChange,
  onClosed,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function onDelete() {
    if (pending) return;

    setPending(true);
    try {
      const response = await fetch(`/api/connections/${connection._id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error(await errorMessage(response));
        return;
      }
      toast.success(`Deleted ${connection.label}`);
      onOpenChange(false);
    } catch {
      toast.error("Could not reach the server — please try again");
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
      <AlertDialogContent className={FULL_WIDTH_DIALOG}>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete “{connection.label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The connection goes for everyone in this organisation, and any node still pointing at it
            fails on its next run. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete connection"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
