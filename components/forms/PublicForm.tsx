"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
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
import type { FormField, FormSpec } from "@/nodes/triggers/form";

/**
 * The hosted form itself, rendered from the trigger node's configuration.
 *
 * This runs for strangers on the public internet: there is no session, no Clerk component and
 * nothing about the workspace on the page beyond the title its owner chose. The validation here is
 * a courtesy — it saves a round trip and puts the message under the right input — while the real
 * check is `app/api/forms/[workflowId]/route.ts`, which rebuilds the schema from the same spec.
 *
 * Every answer is held as a string (that is what an input gives you); the route coerces numbers.
 *
 * Sizing is phone-first: this form is shared as a link, so most of the people filling it in are on
 * a phone. Controls are 44px there and hand back to the compact desktop sizes at `sm`.
 */
export function PublicForm({ workflowId, spec }: { workflowId: string; spec: FormSpec }) {
  const prefix = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  function set(name: string, value: string): void {
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  /** Required-and-empty only: formats are the route's business, and its messages land the same way. */
  function missingFields(): Record<string, string> {
    const missing: Record<string, string> = {};
    for (const field of spec.fields) {
      if (field.required && (values[field.name] ?? "").trim() === "") {
        missing[field.name] = `${field.label} is required.`;
      }
    }
    return missing;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    const missing = missingFields();
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      setError(null);
      return;
    }

    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/forms/${workflowId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });

      if (response.ok) {
        setSent(true);
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        fields?: Record<string, string>;
      } | null;

      if (body?.fields) setFieldErrors(body.fields);
      setError(body?.error ?? "Something went wrong — please try again");
    } catch {
      setError("Could not reach the server — please try again");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="grid gap-2 py-6 text-center sm:py-4">
        <p className="text-base font-medium">Thanks — we got it.</p>
        <p className="text-sm text-muted-foreground">Your answers have been sent.</p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5 sm:gap-4">
      {spec.fields.map((field) => (
        <FieldRow
          key={field.name}
          id={`${prefix}-${field.name}`}
          field={field}
          value={values[field.name] ?? ""}
          error={fieldErrors[field.name]}
          onChange={(value) => set(field.name, value)}
        />
      ))}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-full text-[0.9375rem] sm:h-8 sm:text-sm"
      >
        {pending ? "Sending…" : spec.submitLabel}
      </Button>
    </form>
  );
}

function FieldRow({
  id,
  field,
  value,
  error,
  onChange,
}: {
  id: string;
  field: FormField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div className="grid gap-1.5">
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
        value={value}
        invalid={Boolean(error)}
        describedBy={describedBy}
        onChange={onChange}
      />

      {error && (
        <p id={describedBy} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
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
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-28 sm:min-h-16"
      />
    );
  }

  if (field.type === "select") {
    const options = field.options ?? [];
    return (
      // `null` rather than `undefined`: an undefined value would make the select uncontrolled.
      <Select
        value={value === "" ? null : value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        {/* `h-11!` because the trigger takes its height from `data-size`, which out-specifies a
            plain height class; leaving `sm:` alone hands it back to that default. */}
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          className="w-full max-sm:h-11! max-sm:text-base"
        >
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
      onChange={(event) => onChange(event.target.value)}
      className="h-11 sm:h-9"
    />

  );
}
