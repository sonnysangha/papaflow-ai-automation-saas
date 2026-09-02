import type { Metadata } from "next";

import { AuthShell } from "@/components/marketing/AuthShell";
import { SelectOrgCard } from "@/components/marketing/ClerkCards";

export const metadata: Metadata = {
  title: "Choose a workspace — PapaFlow",
  description: "Pick the organisation whose workflows you want to open.",
};

/**
 * Behaviour is unchanged from Phase 1 — `hidePersonal`, and both paths land on `/w`. Only the
 * frame around Clerk's list is new; `app/(app)/layout.tsx` still sends anyone without an active
 * organisation here.
 */
export default function SelectOrgPage() {
  return (
    <AuthShell title="Pick a workspace. Everything belongs to one.">
      <SelectOrgCard />
    </AuthShell>
  );
}
