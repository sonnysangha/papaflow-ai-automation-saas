"use client";

import { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowLeftIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { NodeIcon } from "@/components/canvas/node-icon";
import { Badge } from "@/components/ui/badge";
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
import { connectorCatalogue, type ConnectorCatalogueEntry } from "@/connectors/registry";
import { api } from "@/convex/_generated/api";

import { ProviderPicker } from "./ProviderPicker";

/**
 * "Add connection", in two steps: pick the app, then paste the credential.
 *
 * The catalogue is imported straight into the browser on purpose — `connectorCatalogue()` is
 * data only (fields, names, docs links), so the dialog can be opened from anywhere in the app,
 * including the canvas config panel, without a server round-trip. The `test()` half of a
 * connector never runs here: the pasted secret goes to `POST /api/connections`, which tests it,
 * seals it and answers `{ id, label }`. Nothing typed here is stored in component state longer
 * than the dialog is open, and the response never carries the secret back.
 */

export type CreatedConnection = { id: string; label: string };

export type AddConnectionDialogProps = {
  /** Controlled open state. Omit both to let the dialog own it and render its own trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Skip step one — used by the connection picker in node config. */
  provider?: string;
  /** Limit step one to one category (`"ai"` for the AI nodes' picker). */
  category?: ConnectorCatalogueEntry["category"];
  onCreated?: (connection: CreatedConnection) => void;
};

/** `{ code, error }` from the route, or a generic message when the response is not JSON. */
type RouteError = { code: string; error: string };

async function readError(response: Response): Promise<RouteError> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const { code, error } = body as { code?: unknown; error?: unknown };
      if (typeof code === "string" && typeof error === "string") return { code, error };
    }
  } catch {
    // Falls through to the generic message.
  }
  return { code: "unknown", error: "Something went wrong. Please try again." };
}

export function AddConnectionDialog({
  open,
  onOpenChange,
  provider,
  category,
  onCreated,
}: AddConnectionDialogProps) {
  const controlled = open !== undefined;
  const [selfOpen, setSelfOpen] = useState(false);
  const isOpen = controlled ? open : selfOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled) onOpenChange?.(next);
      else setSelfOpen(next);
    },
    [controlled, onOpenChange],
  );

  const plan = useQuery(api.plan.current);

  const entries = useMemo(() => {
    const catalogue = connectorCatalogue(plan?.features ?? []);
    // Until the plan query lands nothing is dimmed — a flash of "Pro" on a connector the org
    // already pays for would be worse than a beat of optimism. `/api/connections` decides.
    const withPlan = plan === undefined ? catalogue.map((e) => ({ ...e, allowed: true })) : catalogue;
    return category ? withPlan.filter((entry) => entry.category === category) : withPlan;
  }, [category, plan]);

  const [picked, setPicked] = useState<string | null>(null);
  const selected = provider ?? picked;
  const definition = selected ? entries.find((entry) => entry.provider === selected) : undefined;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={setOpen}
      onOpenChangeComplete={(nowOpen) => {
        // Reset only once the dialog has finished closing, so the form does not blank mid-animation.
        if (!nowOpen) setPicked(null);
      }}
    >
      {controlled ? null : (
        <DialogTrigger render={<Button />}>
          <PlusIcon />
          Add connection
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-md">
        {definition ? (
          <ConnectionForm
            // Keyed by provider so going Back and picking another app starts from empty fields
            // rather than carrying the previous provider's typed key in state.
            key={definition.provider}
            entry={definition}
            /** Only offer "Back" when this dialog owns the choice. */
            onBack={provider ? undefined : () => setPicked(null)}
            onDone={(created) => {
              setOpen(false);
              onCreated?.(created);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add connection</DialogTitle>
              <DialogDescription>
                Pick the app to connect. You bring your own API keys — they are encrypted before
                they are stored.
              </DialogDescription>
            </DialogHeader>
            <ProviderPicker entries={entries} onSelect={setPicked} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Step two: the connector's own fields, generated from `fields` exactly like node config is. */
function ConnectionForm({
  entry,
  onBack,
  onDone,
}: {
  entry: ConnectorCatalogueEntry;
  onBack?: () => void;
  onDone: (created: CreatedConnection) => void;
}) {
  const fieldPrefix = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RouteError | null>(null);

  const missing = entry.fields.some(
    (field) => field.required !== false && (values[field.name] ?? "").trim().length === 0,
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || missing || !entry.allowed) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: entry.provider,
          label: label.trim() || undefined,
          secret: values,
        }),
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const created = (await response.json()) as CreatedConnection;
      // The typed secret dies with this component; only the label ever comes back.
      setValues({});
      setLabel("");
      toast.success(`Connected ${created.label}`);
      onDone(created);
    } catch {
      setError({ code: "network", error: "Could not reach the server. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <NodeIcon name={entry.icon} className="size-4 shrink-0 text-muted-foreground" />
          Connect {entry.name}
          {!entry.allowed && <Badge variant="outline">Pro</Badge>}
        </DialogTitle>
        <DialogDescription>
          The key is tested against {entry.name}, encrypted, and never shown again — only its last
          four characters.{" "}
          <a href={entry.docsUrl} target="_blank" rel="noreferrer noopener">
            Where to find it
            <ExternalLinkIcon aria-hidden className="ml-1 inline size-3 align-[-0.1em]" />
          </a>
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        {entry.fields.map((field, index) => {
          const fieldId = `${fieldPrefix}-${field.name}`;
          return (
            <div key={field.name} className="grid gap-1.5">
              <Label htmlFor={fieldId}>
                {field.label}
                {field.required !== false && (
                  <span aria-label="required" className="text-destructive">
                    *
                  </span>
                )}
              </Label>
              <Input
                id={fieldId}
                type={field.kind === "secret" ? "password" : field.kind === "url" ? "url" : "text"}
                value={values[field.name] ?? ""}
                autoFocus={index === 0}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                disabled={pending}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
              {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
            </div>
          );
        })}

        <div className="grid gap-1.5">
          <Label htmlFor={`${fieldPrefix}-label`}>Label</Label>
          <Input
            id={`${fieldPrefix}-label`}
            value={label}
            disabled={pending}
            placeholder={`${entry.name} (optional)`}
            onChange={(event) => setLabel(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            How this connection is named in node settings.
          </p>
        </div>
      </div>

      {!entry.allowed && (
        <p className="text-xs text-muted-foreground">
          {entry.name} needs a plan with{" "}
          <span className="font-medium text-foreground">{entry.requiresFeature}</span>.{" "}
          <Link href="/settings/billing" className="underline underline-offset-4">
            See plans
          </Link>
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error.error}
          {error.code === "upgrade_required" && (
            <>
              {" "}
              <Link href="/settings/billing" className="underline underline-offset-4">
                See plans
              </Link>
            </>
          )}
        </p>
      )}

      <DialogFooter>
        {onBack ? (
          <Button type="button" variant="outline" disabled={pending} onClick={onBack}>
            <ArrowLeftIcon />
            Back
          </Button>
        ) : (
          <DialogClose render={<Button variant="outline" />} disabled={pending}>
            Cancel
          </DialogClose>
        )}
        <Button type="submit" disabled={pending || missing || !entry.allowed}>
          {pending ? "Testing…" : "Test & save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
