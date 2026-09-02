import type { Metadata } from "next";

import { AuthShell } from "@/components/marketing/AuthShell";
import { SignUpCard } from "@/components/marketing/ClerkCards";

export const metadata: Metadata = {
  title: "Create an account — PapaFlow",
  description:
    "Create a PapaFlow workspace: three workflows and a hundred runs a month, free.",
};

export default function SignUpPage() {
  return (
    <AuthShell title="Draw a workflow today, forget about it by Friday.">
      <SignUpCard />
    </AuthShell>
  );
}
