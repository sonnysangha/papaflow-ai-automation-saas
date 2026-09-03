import type { Metadata } from "next";
import Link from "next/link";

import {
  CTA_ROW,
  Eyebrow,
  ctaPrimary,
  ctaSecondary,
} from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Docs — PapaFlow",
  description:
    "The written docs are being assembled. Until they land, here is the short version of getting a workflow running.",
};

const QUICKSTART = [
  {
    title: "Create an organisation",
    body: "Signing up asks you to name a workspace. Everything — workflows, connections, runs and the plan — belongs to it, so a solo account is just an organisation of one.",
  },
  {
    title: "Add a connection",
    body: "Connections → Add. Pick a provider, paste the credential, and PapaFlow calls the provider to check it before saving. Only the last four characters are ever shown again.",
  },
  {
    title: "Draw a workflow",
    body: "Start with a Manual trigger so you can run it from the editor, add one action node, and wire them together. Any field can quote an earlier node with {{ node_key.field }}.",
  },
  {
    title: "Run it and read the run",
    body: "Press Run. Nodes light up as the engine reaches them, and the run page keeps every step's inputs, outputs and timing, which is where you look when something is not what you expected.",
  },
] as const;

const SECTION = "mx-auto w-full max-w-3xl px-5 sm:px-8";

export default function DocsPage() {
  return (
    <>
      <section
        className={`${SECTION} flex flex-col gap-5 pt-10 pb-8 sm:gap-6 sm:pt-20 sm:pb-10`}
      >
        <Eyebrow className="w-full max-w-sm">Docs</Eyebrow>
        <h1 className="pf-display text-[2rem] leading-[1.07] font-semibold tracking-[-0.02em] text-balance min-[360px]:text-4xl sm:text-5xl sm:leading-[1.05]">
          The full docs are still being written.
        </h1>
        <p className="text-base text-pretty text-muted-foreground sm:text-lg">
          Reference pages for every node and connector are on the way. In the
          meantime, this is the whole path from a new account to a run you can
          read.
        </p>
      </section>

      <section className={`${SECTION} pb-14 sm:pb-20`}>
        <ol className="flex flex-col">
          {QUICKSTART.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-2 border-t border-border py-5 sm:py-6"
            >
              <span className="font-mono text-xs text-[var(--pf-accent)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="text-lg font-semibold tracking-tight">{step.title}</h2>
              <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-border py-12 sm:py-16">
        <div className={SECTION}>
          <div className={CTA_ROW}>
            <Link href="/sign-up" className={ctaPrimary()}>
              Start free
            </Link>
            <Link href="/pricing" className={ctaSecondary()}>
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
