"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Id } from "@/convex/_generated/dataModel";
import type { FormField, FormSpec } from "@/nodes/triggers/form";

import {
  answersToPayload,
  mergeAnswers,
  missingRequiredFields,
  sampleValueFor,
  type FormAnswers,
} from "./form-run";

/**
 * The Run button's stand-in for the hosted form, for the trigger type where "run it and see" is not
 * enough on its own: a form's payload lives under `values.<field>`, and getting the shape wrong is
 * invisible until a template downstream reads the wrong key. Filling this in and pressing "Run with
 * these answers" starts a run with exactly the payload a real visitor's submission would have sent
 * (`answersToPayload` — the same "present, then coerce" rule the forms route applies), so a template
 * built against a test run keeps working once the form goes out for real.
 *
 * Answers are remembered per workflow in `localStorage` so a form worth testing twice does not need
 * retyping — read and written here, never sent anywhere else, and never touched by `form-run.ts`
 * itself so that module stays a plain, DOM-free function library.
 */

const STORAGE_PREFIX = "papaflow:form-run:";

function storageKey(workflowId: string): string {
  return `${STORAGE_PREFIX}${workflowId}`;
}

/** The last answers typed for this workflow's form, or `null` for "nothing remembered (yet)". */
function readStoredAnswers(workflowId: string): FormAnswers | null {
  try {
    const raw = window.localStorage.getItem(storageKey(workflowId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const answers: FormAnswers = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") answers[key] = value;
    }
    return answers;
  } catch {
    // Private browsing, a disabled store, or corrupt JSON from an older shape — sampling fresh is
    // the safe fallback, not a reason to fail the dialog.
    return null;
  }
}

function writeStoredAnswers(workflowId: string, answers: FormAnswers): void {
  try {
    window.localStorage.setItem(storageKey(workflowId), JSON.stringify(answers));
  } catch {
    // Storage full or disabled outright — the run still goes through, it just is not remembered.
  }
}

function FieldControl({
  id,
  field,
  value,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  field: FormField;
  value: string;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const shared = {
    id,
    name: field.name,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
  };

  if (field.type === "textarea") {
    return (
      <Textarea
        {...shared}
        rows={3}
        value={value}
        placeholder={sampleValueFor(field)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.type === "select") {
    const options = field.options ?? [];
    return (
      // `null` rather than `undefined`, exactly like `PublicForm`: an undefined value would make
      // the select uncontrolled.
      <Select
        value={value === "" ? null : value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger id={id} aria-invalid={invalid || undefined} className="h-9 w-full">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      {...shared}
      type={field.type === "email" ? "email" : field.type === "number" ? "number" : "text"}
      value={value}
      placeholder={sampleValueFor(field)}
      onChange={(event) => onChange(event.target.value)}
      className="h-9"
    />
  );
}

export type FormRunDialogProps = {
  workflowId: Id<"workflows">;
  /** The saved Form trigger's fields, parsed the same way the public page and the route are. */
  spec: FormSpec;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether a run is already starting — disables the button for the moment before the dialog closes. */
  pending: boolean;
  /** Starts the run with the built payload, JSON-encoded exactly as `runWorkflow` expects. */
  onRun: (payloadJson: string) => void;
};

export function FormRunDialog({
  workflowId,
  spec,
  open,
  onOpenChange,
  pending,
  onRun,
}: FormRunDialogProps) {
  const prefix = useId();

  // `answers`/`showJson` re-prime every time the dialog *transitions into* open: whatever was last
  // remembered for this workflow, filled out with samples for anything the form has gained since,
  // and the JSON panel closed again. Reading fresh on each transition (rather than once, on mount)
  // picks up an edit made in another tab between opens.
  //
  // Computed during the render that sees the transition rather than in an effect afterwards — the
  // React-recommended way to adjust state from a changing prop
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // — the same pattern `Editor.tsx#useCarriedSteps` uses for a subscription result. `open` itself
  // rides along in the state so the comparison survives `spec`/`workflowId` changing too.
  const [state, setState] = useState<{ open: boolean; answers: FormAnswers; showJson: boolean }>(
    () => ({ open, answers: mergeAnswers(spec, readStoredAnswers(workflowId)), showJson: false }),
  );

  if (open !== state.open) {
    setState(
      open
        ? { open, answers: mergeAnswers(spec, readStoredAnswers(workflowId)), showJson: false }
        : { ...state, open },
    );
  }

  const { answers, showJson } = state;
  const missing = missingRequiredFields(spec, answers);
  const payload = answersToPayload(spec, answers);

  function set(name: string, value: string): void {
    setState((current) => ({ ...current, answers: { ...current.answers, [name]: value } }));
  }

  function run(): void {
    writeStoredAnswers(workflowId, answers);
    onOpenChange(false);
    onRun(JSON.stringify(payload));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Test “{spec.title}”</DialogTitle>
          <DialogDescription>
            Fill this in the way a visitor would, then run the workflow with exactly that payload —
            the same shape a real submission sends.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[55vh] gap-4 overflow-y-auto py-1">
          {spec.fields.map((field) => {
            const id = `${prefix}-${field.name}`;
            const invalid = missing.includes(field.name);
            const describedBy = invalid ? `${id}-error` : undefined;

            return (
              <div key={field.name} className="grid gap-1.5">
                <Label htmlFor={id}>
                  {field.label}
                  {field.required && (
                    <span aria-label="required" className="text-destructive">
                      *
                    </span>
                  )}
                </Label>

                <FieldControl
                  id={id}
                  field={field}
                  value={answers[field.name] ?? ""}
                  invalid={invalid}
                  describedBy={describedBy}
                  onChange={(value) => set(field.name, value)}
                />

                {invalid && (
                  <p id={describedBy} className="text-sm text-destructive">
                    {field.label} is required.
                  </p>
                )}
              </div>
            );
          })}

          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setState((current) => ({ ...current, showJson: !current.showJson }))
              }
            >
              {showJson ? "Hide JSON" : "Show JSON"}
            </Button>
            {showJson && (
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
                {JSON.stringify(payload, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || missing.length > 0} onClick={run}>
            {pending ? "Starting…" : "Run with these answers"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
