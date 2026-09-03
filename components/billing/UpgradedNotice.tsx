"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2Icon, XIcon } from "lucide-react";

/**
 * The landing strip after a checkout started somewhere else.
 *
 * `newSubscriptionRedirectUrl` on the public pricing page sends the org to
 * `/settings/billing?upgraded=1`, so this is the only signal that the drawer they just closed was
 * on a different page. Dismissing drops the query parameter as well as hiding the strip, so a
 * refresh or a back-forward does not congratulate anyone twice.
 *
 * `useSearchParams` opts a route into client rendering unless it is inside a Suspense boundary —
 * `app/(app)/settings/billing/page.tsx` wraps it in one.
 */
export function UpgradedNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || params.get("upgraded") !== "1") return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm"
    >
      <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Plan updated.</span>{" "}
        <span className="text-muted-foreground">
          The new features reach the app when your session token refreshes, usually within a minute.
        </span>
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        className="-m-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDismissed(true);
          router.replace(pathname);
        }}
      >
        <XIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}
