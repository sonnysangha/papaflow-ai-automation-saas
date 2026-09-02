import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { buttonVariants } from "@/components/ui/button";

export default async function Home() {
  const { isAuthenticated } = await auth();
  if (isAuthenticated) redirect("/w");

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-24 text-foreground">
      <main className="flex w-full max-w-xl flex-col items-start gap-6">
        <span className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          PapaFlow
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Automate the boring parts of your business.
        </h1>
        <p className="text-lg text-muted-foreground text-pretty">
          Draw a workflow on the canvas, connect the apps your team already
          uses, and let every run finish durably.
        </p>
        <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>
          Sign in
        </Link>
      </main>
    </div>
  );
}
