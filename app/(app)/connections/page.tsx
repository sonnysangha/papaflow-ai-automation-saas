import { Suspense } from "react";
import type { Metadata } from "next";

import { AddConnectionButton } from "@/components/connections/AddConnectionButton";
import { ConnectionList } from "@/components/connections/ConnectionList";

export const metadata: Metadata = {
  title: "Connections",
};

/**
 * The organisation's credentials. The org guard lives in `app/(app)/layout.tsx`; both halves of
 * this page are client components so they can subscribe to Convex and post to `/api/connections`.
 */
export default function ConnectionsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Connections</h1>
          <p className="text-sm text-muted-foreground">
            The keys and tokens this organisation&apos;s workflows run with. Each one is encrypted
            before it is stored and only ever opened mid-run.
          </p>
        </div>
        {/* `useSearchParams` inside, for the `?add=` link the node palette sends people here with
            — so the button needs a boundary of its own rather than making the page bail out to the
            client. */}
        <Suspense fallback={null}>
          <AddConnectionButton />
        </Suspense>
      </div>

      <ConnectionList />
    </div>
  );
}
