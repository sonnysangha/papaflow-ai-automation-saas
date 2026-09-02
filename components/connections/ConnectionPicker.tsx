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
import { CONNECTORS } from "@/connectors/registry";
import { api } from "@/convex/_generated/api";

import { AddConnectionDialog } from "./AddConnectionDialog";

/**
 * Which of the org's connections a node may use, and a way to add one without leaving the canvas.
 *
 * `credential` is the node definition's own field: `"ai"` means any AI-category connector (the LLM
 * node runs against whichever provider you point it at), anything else names one provider exactly.
 * Only connection ids cross into `node.data.inputs` — the secret is opened inside the step
 * (CLAUDE.md rule 1).
 */
export type ConnectionPickerProps = {
  id?: string;
  /** The node's `credential`: `"ai"` for any AI provider, otherwise a provider name. */
  credential: string;
  value: string | undefined;
  onChange: (connectionId: string | undefined) => void;
};

/** The providers a node with this `credential` accepts. */
function providersFor(credential: string): string[] {
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

export function ConnectionPicker({ id, credential, value, onChange }: ConnectionPickerProps) {
  const connections = useQuery(api.connections.list);
  const [addOpen, setAddOpen] = useState(false);

  const providers = useMemo(() => new Set(providersFor(credential)), [credential]);
  const matching = useMemo(
    () => (connections ?? []).filter((connection) => providers.has(connection.provider)),
    [connections, providers],
  );

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
        category={credential === "ai" ? "ai" : undefined}
        onCreated={(created) => onChange(created.id)}
      />
    </div>
  );
}
