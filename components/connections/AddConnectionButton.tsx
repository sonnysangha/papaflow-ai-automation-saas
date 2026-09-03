"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveAddTarget } from "@/lib/connection-match";

import { AddConnectionDialog } from "./AddConnectionDialog";

/**
 * "Add connection" on the connections page, plus the `?add=` handshake the rest of the app uses to
 * send someone here for a specific credential.
 *
 * The node palette dims a node the organisation has nothing connected for and links to
 * `/connections?add=slack` (or `?add=ai` for a family). Landing on a page with a button on it and
 * having to find the right app in a list would waste the trip, so the param opens the dialog on the
 * form it means: a provider skips straight to its fields, a family filters the picker to its
 * category (`lib/connection-match.ts` decides which).
 *
 * The param is cleared as the dialog closes, so a reload — or a Back into this page — does not
 * reopen a form the user has already dismissed, and the link stays shareable.
 */
export function AddConnectionButton() {
  const requested = useSearchParams().get("add");

  // Remounted whenever the URL asks for something different, which is what lets the dialog's open
  // state be *initialised* from the param rather than pushed into it by an effect — an effect that
  // reopens a dialog would fight the user for the close button.
  return <AddConnection key={requested ?? ""} requested={requested} />;
}

function AddConnection({ requested }: { requested: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  const target = useMemo(() => resolveAddTarget(requested), [requested]);
  const [open, setOpen] = useState(target !== null);

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      // Closing tidies the URL up. That also remounts this component with `open: false`, so the
      // param can never resurrect a form the user has just dismissed.
      if (!next && requested !== null) router.replace(pathname, { scroll: false });
    },
    [pathname, requested, router],
  );

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <PlusIcon />
        Add connection
      </Button>

      <AddConnectionDialog
        open={open}
        onOpenChange={onOpenChange}
        provider={target?.provider}
        category={target?.category}
      />
    </>
  );
}
