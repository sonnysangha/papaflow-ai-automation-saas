"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Skeleton } from "@/components/ui/skeleton";

// Convex queries would otherwise run once before ConvexProviderWithClerk hands over the Clerk token
// (and every org-scoped query throws "unauthenticated" on that first execution). Render app pages only
// once Convex reports the session as authenticated.
export function ConvexAuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Connecting your session…
        </div>
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}
