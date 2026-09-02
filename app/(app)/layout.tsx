import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Header } from "@/components/app/Header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, orgId } = await auth();
  if (!isAuthenticated) redirect("/sign-in");
  if (!orgId) redirect("/select-org");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
