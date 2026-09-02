"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { PlusIcon } from "lucide-react";

import { api } from "@/convex/_generated/api";
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
import { reportWorkflowError } from "./errors";

/** Matches the fallback `convex/workflows.ts` applies to a blank name. */
const DEFAULT_NAME = "Untitled workflow";

/**
 * The "New workflow" button and its name dialog. Used twice — in the page header and in the empty
 * state — so it owns its own trigger. A successful create opens the new workflow on the canvas.
 */
export function NewWorkflowDialog() {
  const router = useRouter();
  const create = useMutation(api.workflows.create);
  const nameId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    try {
      const id = await create({ name: name.trim() || DEFAULT_NAME });
      setOpen(false);
      setName("");
      router.push(`/w/${id}`);
    } catch (error) {
      // Most often the free plan's three-workflow wall; the dialog stays open either way.
      reportWorkflowError(error, "Could not create the workflow.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        New workflow
      </DialogTrigger>

      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Give it a name to start with. You can rename it at any time.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              placeholder={DEFAULT_NAME}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={pending}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create workflow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
