"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ANY_CREDENTIAL, CHAT_CREDENTIAL, CHAT_PROVIDERS, isTokenKind } from "@/connectors/define";
import { CONNECTORS } from "@/connectors/registry";
import { api } from "@/convex/_generated/api";

import { AddConnectionDialog } from "./AddConnectionDialog";

/**
 * Which of the org's connections a node may use, and a way to add one without leaving the canvas.
 *
 * `credential` is the node definition's own field: `"ai"` means any AI-category connector (the LLM
 * node runs against whichever provider you point it at), `"any"` means any connection holding a
 * single token (the HTTP node sends it as a header), anything else names one provider exactly.
 * Only connection ids cross into `node.data.inputs` — the secret is opened inside the step
 * (CLAUDE.md rule 1).
 */
export type ConnectionPickerProps = {
  id?: string;
  /** The node's `credential`: `"ai"`, `"any"`, a provider name or a provider family. */
  credential: string;
  value: string | undefined;
  onChange: (connectionId: string | undefined) => void;
};

/** The providers a node with this `credential` accepts. */
function providersFor(credential: string): string[] {
  // `chat` is not a category and not a prefix: it is the three chat apps that can render buttons a
  // person presses back. A Discord *webhook* and a Teams Workflows URL post messages and can never
  // answer one, so an Approval node must not offer them.
  if (credential === CHAT_CREDENTIAL) return [...CHAT_PROVIDERS];
  if (credential === "ai") {
    return Object.values(CONNECTORS)
      .filter((definition) => definition.category === "ai")
      .map((definition) => definition.provider);
  }
  if (CONNECTORS[credential]) return [credential];
  // A node may name a family rather than one provider: `discord` covers `discord-webhook` and
  // `discord-bot`, which are two ways of connecting the same app and post the same message.
  return Object.keys(CONNECTORS).filter((provider) => provider.startsWith(`${credential}-`));
}

/**
 * Which of the org's connections this node may be pointed at.
 *
 * `"any"` is not a provider and cannot be answered by provider at all: the HTTP node sends
 * whatever single token a connection holds, so every API key and bot token qualifies — and a
 * webhook URL or a signing secret, which are not tokens to send, does not.
 */
function acceptsConnection(
  credential: string,
): (connection: { provider: string; kind: string }) => boolean {
  if (credential === ANY_CREDENTIAL) return (connection) => isTokenKind(connection.kind);

  const providers = new Set(providersFor(credential));
  return (connection) => providers.has(connection.provider);
}

export function ConnectionPicker({ id, credential, value, onChange }: ConnectionPickerProps) {
  const connections = useQuery(api.connections.list);
  const [addOpen, setAddOpen] = useState(false);

  const accepts = useMemo(() => acceptsConnection(credential), [credential]);
  const matching = useMemo(() => (connections ?? []).filter(accepts), [accepts, connections]);

  const selected = matching.find((connection) => connection._id === value);
  // A category picker (`credential: "ai"`) opens on step one, filtered; a single-provider node
  // skips straight to that provider's form. A family (`discord`) is not a provider, so it opens on
  // step one too — the user has to say which kind of Discord connection they are adding.
  const preselect = CONNECTORS[credential] ? credential : undefined;

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5">
        <Select
          value={value ?? null}
          disabled={connections === undefined}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          <SelectTrigger id={id} className="min-w-0 flex-1">
            {/*
              Base UI renders the raw value in the trigger unless it is told otherwise, and the raw
              value here is a Convex id. The function child turns it back into the label — and, since
              children override `placeholder`, also owns the empty case.
            */}
            <SelectValue>
              {(current: unknown) => {
                if (typeof current !== "string") {
                  return connections === undefined
                    ? "Loading…"
                    : matching.length === 0
                      ? "No connection yet"
                      : "Choose a connection…";
                }
                const match = matching.find((connection) => connection._id === current);
                return match ? `${match.label} ••••${match.hint}` : "Missing connection";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {matching.map((connection) => (
              <SelectItem key={connection._id} value={connection._id}>
                <span className="truncate">{connection.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  ••••{connection.hint}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Add connection"
          title="Add connection"
          onClick={() => setAddOpen(true)}
        >
          <PlusIcon />
        </Button>
      </div>

      {value !== undefined && selected === undefined && connections !== undefined && (
        <p className="text-xs text-destructive">
          This node points at a connection that is gone. Pick another one.
        </p>
      )}
      {selected && selected.status !== "active" && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          “{selected.label}” needs reconnecting — re-test it on the connections page.
        </p>
      )}

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        provider={preselect}
        category={
          credential === "ai" ? "ai" : credential === CHAT_CREDENTIAL ? "chat" : undefined
        }
        onCreated={(created) => onChange(created.id)}
      />
    </div>
  );
}
