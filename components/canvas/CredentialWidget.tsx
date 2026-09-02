"use client";

import { useState } from "react";
import { KeyRoundIcon, PlusIcon } from "lucide-react";

import { AddConnectionDialog } from "@/components/connections/AddConnectionDialog";
import { Button } from "@/components/ui/button";
import { connectorCatalogue } from "@/connectors/registry";
import type { PendingConnectionRequest } from "@/lib/builder-protocol";

/**
 * What a `request_connection` ask looks like in the chat.
 *
 * The agent has parked a durable run waiting for one string: the id of a connection this workspace
 * owns. This widget is the only path to it — the credential itself goes from the dialog straight to
 * `POST /api/connections`, which tests it, seals it with AES-GCM and answers `{ id, label }`. The
 * chat only ever carries the id, so nothing the model can read was ever a secret (CLAUDE.md rule 1).
 *
 * Step two of `AddConnectionDialog` is reused verbatim with `provider` preselected, rather than
 * reimplemented: that component already owns the field list, the plan wall, the error shapes and
 * the rule that a typed key never lives in state longer than the dialog is open.
 */
export function CredentialWidget({
  request,
  disabled,
  onConnected,
  onCancel,
}: {
  request: PendingConnectionRequest;
  disabled: boolean;
  /** The connection id the agent is waiting for — an existing one, or one just created. */
  onConnected: (connectionId: string) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);

  const connector = connectorCatalogue([]).find((entry) => entry.provider === request.provider);
  const providerName = connector?.name ?? request.provider;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="flex items-start gap-2 text-sm">
        <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="whitespace-pre-wrap">{request.prompt}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {request.options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => onConnected(option.id)}
          >
            {option.label}
          </Button>
        ))}

        <Button size="sm" disabled={disabled || !connector} onClick={() => setOpen(true)}>
          <PlusIcon />
          {connector ? `Connect ${providerName}` : `No ${request.provider} connector`}
        </Button>

        <Button size="sm" variant="ghost" disabled={disabled} onClick={onCancel}>
          Not now
        </Button>
      </div>

      {connector ? (
        <AddConnectionDialog
          open={open}
          onOpenChange={setOpen}
          provider={request.provider}
          onCreated={(created) => {
            setOpen(false);
            onConnected(created.id);
          }}
        />
      ) : null}
    </div>
  );
}
