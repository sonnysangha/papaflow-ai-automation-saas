"use client";

import { Fragment, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CopyIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { NodeIcon } from "@/components/canvas/node-icon";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAbsoluteTime, formatRelativeTime } from "@/components/workflows/relative-time";
import { CONNECTORS } from "@/connectors/registry";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

import { AddConnectionDialog } from "./AddConnectionDialog";

/** One row of `api.connections.list` — the projection, never the sealed secret (CLAUDE.md rule 1). */
type Connection = FunctionReturnType<typeof api.connections.list>[number];

/** The same colour language as the run statuses: green good, amber wants attention, red dead. */
const STATUS_TONE: Record<Connection["status"], string> = {
  active: "bg-emerald-500",
  needs_reconnect: "bg-amber-500",
  revoked: "bg-destructive",
};

const STATUS_LABEL: Record<Connection["status"], string> = {
  active: "Active",
  needs_reconnect: "Needs reconnect",
  revoked: "Revoked",
};

/** `meta.models` is `v.any()` on the wire, so it is counted rather than trusted. */
function modelCount(meta: unknown): number | null {
  if (typeof meta !== "object" || meta === null) return null;
  const models = (meta as { models?: unknown }).models;
  return Array.isArray(models) ? models.length : null;
}

/**
 * Where this connection's provider should send its events. Written by the connector's `afterCreate`
 * (`connectors/{telegram,stripe}.ts`), because the URL contains the connection id and so cannot
 * exist before the row does. Absent for every connector that has nothing inbound to offer.
 */
function inboundUrl(meta: unknown): string | null {
  if (typeof meta !== "object" || meta === null) return null;
  const url = (meta as { inboundUrl?: unknown }).inboundUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * What the user is supposed to do with that URL, which is the whole difference between the two
 * inbound connectors: Telegram was told about it automatically (`setWebhook`), Stripe cannot be —
 * the user has to paste it into their own dashboard before a single event arrives.
 */
function inboundHint(provider: string, meta: unknown): string {
  if (provider === "telegram") {
    const webhookSet = (meta as { webhookSet?: unknown } | null)?.webhookSet;
    return webhookSet === false
      ? "Telegram was not told about this URL — it only accepts https, so reconnect once this app has an https origin"
      : "Telegram webhook registered";
  }
  if (provider === "stripe") return "Paste this URL into Stripe's webhook settings";
  return "Send this provider's events to this URL";
}

/** The inbound URL as its own full-width row: read-only, copyable, and long enough to need one. */
function InboundUrlRow({ connection, url }: { connection: Connection; url: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={7} className="px-4 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {url}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Copy the inbound URL for ${connection.label}`}
            onClick={() => {
              void navigator.clipboard.writeText(url).then(
                () => toast.success("Inbound URL copied"),
                () => toast.error("Could not copy — select the URL and copy it yourself"),
              );
            }}
          >
            <CopyIcon />
          </Button>
          <p className="text-xs text-muted-foreground">
            {inboundHint(connection.provider, connection.meta)}
          </p>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ConnectionStatusBadge({ status }: { status: Connection["status"] }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATUS_TONE[status])} />
      {STATUS_LABEL[status]}
    </Badge>
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
  return "Something went wrong. Please try again.";
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
      toast.error("Could not reach the server. Please try again.");
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
          <CardTitle>Connect your first app</CardTitle>
          <CardDescription>
            Bring your own API keys; they are encrypted before they are stored, and nodes open them
            only while a run is in flight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddConnectionDialog />
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
              // `CONNECTORS` is data here: the name, icon and category behind a stored provider.
              const definition = CONNECTORS[connection.provider];
              const models = modelCount(connection.meta);
              const inbound = inboundUrl(connection.meta);
              const busy = busyId === connection._id;

              return (
                <Fragment key={connection._id}>
                  <TableRow className={cn(busy && "opacity-60", inbound && "border-b-0")}>
                    <TableCell className="px-4 font-medium">
                      <span className="flex items-center gap-2">
                        <NodeIcon
                          name={definition?.icon}
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        {definition?.name ?? connection.provider}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{connection.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      ••••{connection.hint}
                    </TableCell>
                    <TableCell>
                      <ConnectionStatusBadge status={connection.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {models === null ? "—" : models}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      title={formatAbsoluteTime(connection.updatedAt)}
                    >
                      updated {formatRelativeTime(connection.updatedAt)}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                          <MoreHorizontalIcon />
                          <span className="sr-only">Actions for {connection.label}</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem
                            disabled={busy}
                            onClick={() => void runAction(connection, "retest")}
                          >
                            <RotateCwIcon />
                            Re-test
                          </DropdownMenuItem>
                          {definition?.category === "ai" && (
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={() => void runAction(connection, "refresh")}
                            >
                              <RefreshCwIcon />
                              Refresh models
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                              setDeleteTarget(connection);
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

                  {inbound ? <InboundUrlRow connection={connection} url={inbound} /> : null}
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
      toast.error("Could not reach the server. Please try again.");
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
        <DialogHeader>
          <DialogTitle>Delete connection</DialogTitle>
          <DialogDescription>
            “{connection.label}” is removed for everyone in this organisation, and any node still
            pointing at it fails on its next run. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={pending}>
            Cancel
          </DialogClose>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete connection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
