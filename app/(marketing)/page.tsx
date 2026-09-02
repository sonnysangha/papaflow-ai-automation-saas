import type { Metadata } from "next";
import Link from "next/link";
import {
  HandIcon,
  HistoryIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SplitIcon,
  WebhookIcon,
  type LucideIcon,
} from "lucide-react";

import { CanvasMock } from "@/components/marketing/CanvasMock";
import { Eyebrow, ctaPrimary, ctaSecondary } from "@/components/marketing/primitives";
import { WorksWith } from "@/components/marketing/WorksWith";
import { connectorCatalogue } from "@/connectors/registry";

const DESCRIPTION =
  "Build automations on a canvas, run them on your own AI keys, and let every run finish on its own — retries, waits and human approvals included.";

export const metadata: Metadata = {
  title: "PapaFlow — automate your work with a canvas, not a codebase",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "PapaFlow",
    title: "PapaFlow — automate your work with a canvas, not a codebase",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "PapaFlow — automate your work with a canvas, not a codebase",
    description: DESCRIPTION,
  },
};

const STEPS = [
  {
    title: "Connect",
    body: "Paste an API key or a bot token. PapaFlow calls the provider to check it before saving, keeps the last four characters for the label, and seals the rest.",
  },
  {
    title: "Build",
    body: "Drag nodes onto the canvas and wire them together. Point any field at an earlier node's output by name, the way a template does.",
    code: "{{ classify_1.label }}",
  },
  {
    title: "Run durably",
    body: "Runs execute a step at a time. A failed call retries, a Wait node sleeps for days, and an Approval holds the run until someone presses the button.",
  },
] as const;

const FEATURES: readonly {
  icon: LucideIcon;
  title: string;
  body: string;
}[] = [
  {
    icon: WebhookIcon,
    title: "Triggers that match your stack",
    body: "A webhook URL, a hosted form page, a schedule, an inbound Telegram message, a Stripe event — or a manual run from the editor while you build.",
  },
  {
    icon: SparklesIcon,
    title: "AI steps on your own keys",
    body: "LLM, Extract and Classify call the provider you connected, billed to you. Swap OpenAI for Anthropic in a dropdown and the graph stays exactly as it was.",
  },
  {
    icon: HandIcon,
    title: "Approval and Wait",
    body: "Post buttons into Slack, Discord or Telegram and pause the run until an answer comes back. Or just sleep until Tuesday and carry on.",
  },
  {
    icon: SplitIcon,
    title: "Branches and loops",
    body: "Condition and Switch send the run down one edge and grey out the rest. Loop walks a list one item at a time, so a batch is still one run.",
  },
  {
    icon: HistoryIcon,
    title: "Every run on the record",
    body: "Each step keeps its inputs, outputs, timing and error. When someone asks what the automation actually did last Thursday, open the run.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Connections stay sealed",
    body: "AES-256-GCM per row, scoped to your organisation, opened only inside the step that makes the call. Never in a prompt, a log or a query result.",
  },
];

const BUILT_ON = [
  { name: "Next.js", role: "app" },
  { name: "Convex", role: "realtime state" },
  { name: "Clerk", role: "orgs and billing" },
  { name: "Vercel Workflows", role: "durable runs" },
] as const;

const SECTION = "mx-auto w-full max-w-6xl px-5 sm:px-8";

export default function LandingPage() {
  const connectorCount = connectorCatalogue([]).length;

  return (
    <>
      {/* Hero */}
      <section className={`${SECTION} flex flex-col items-start gap-6 pt-16 pb-12 sm:pt-24`}>
        <Eyebrow className="w-full max-w-md">Durable workflow automation</Eyebrow>

        <h1 className="pf-display max-w-3xl text-4xl leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-5xl lg:text-6xl">
          Automate your work with a canvas, not a codebase.
        </h1>

        <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
          Drag triggers, AI steps and app actions onto a canvas, plug in your own
          OpenAI or Anthropic key, and let every run finish on its own — retries,
          week-long waits and human approvals included.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sign-up" className={ctaPrimary()}>
            Start free
          </Link>
          <Link href="/pricing" className={ctaSecondary()}>
            See pricing
          </Link>
        </div>

        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground">
          <li>3 workflows free</li>
          <li aria-hidden>·</li>
          <li>No card to start</li>
          <li aria-hidden>·</li>
          <li>Your provider keys, encrypted per org</li>
        </ul>
      </section>

      {/* The product, mid-run */}
      <section className={`${SECTION} pb-20 sm:pb-28`}>
        <CanvasMock />
      </section>

      {/* How it works — a real sequence, so it is numbered */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-t border-border bg-muted/25 py-20 sm:py-24"
      >
        <div className={`${SECTION} flex flex-col gap-10`}>
          <div className="flex flex-col gap-4">
            <Eyebrow className="max-w-sm">How it works</Eyebrow>
            <h2 className="pf-display max-w-2xl text-3xl font-semibold tracking-[-0.015em] text-balance sm:text-4xl">
              Three moves, then it runs without you.
            </h2>
          </div>

          <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3 border-t border-border pt-5">
                <span className="font-mono text-xs text-[var(--pf-accent)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
                <p className="text-sm text-pretty text-muted-foreground">{step.body}</p>
                {"code" in step ? (
                  <code className="w-fit rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-foreground">
                    {step.code}
                  </code>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section id="features" className={`${SECTION} scroll-mt-20 py-20 sm:py-24`}>
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-4">
            <Eyebrow className="max-w-sm">What you get</Eyebrow>
            <h2 className="pf-display max-w-2xl text-3xl font-semibold tracking-[-0.015em] text-balance sm:text-4xl">
              Everything a real automation needs on day two.
            </h2>
          </div>

          <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex flex-col gap-2.5">
                <feature.icon
                  className="size-5 text-[var(--pf-accent)]"
                  aria-hidden
                />
                <h3 className="text-base font-semibold tracking-tight">{feature.title}</h3>
                <p className="text-sm text-pretty text-muted-foreground">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Works with */}
      <section
        id="works-with"
        className="scroll-mt-20 border-t border-border bg-muted/25 py-20 sm:py-24"
      >
        <div className={`${SECTION} flex flex-col gap-10`}>
          <div className="flex flex-col gap-4">
            <Eyebrow className="max-w-sm">Works with</Eyebrow>
            <h2 className="pf-display max-w-2xl text-3xl font-semibold tracking-[-0.015em] text-balance sm:text-4xl">
              Bring the accounts you already pay for.
            </h2>
            <p className="max-w-2xl text-pretty text-muted-foreground">
              {connectorCount} providers connect today, and every one of them uses
              a credential you own. Each tile says what you will need to paste.
            </p>
          </div>

          <WorksWith />
        </div>
      </section>

      {/* Built on */}
      <section className={`${SECTION} py-14`}>
        <div className="flex flex-col gap-4">
          <h2 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted-foreground uppercase">
            Built on
          </h2>
          <ul className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            {BUILT_ON.map((item) => (
              <li key={item.name} className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{item.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {item.role}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border py-20 sm:py-24">
        <div className={`${SECTION} flex flex-col items-start gap-6`}>
          <h2 className="pf-display max-w-2xl text-3xl font-semibold tracking-[-0.015em] text-balance sm:text-4xl">
            Your first run is about ten minutes away.
          </h2>
          <p className="max-w-xl text-pretty text-muted-foreground">
            Create an organisation, connect one provider, and watch a run light up
            node by node on the canvas.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className={ctaPrimary()}>
              Start free
            </Link>
            <Link href="/pricing" className={ctaSecondary()}>
              Compare plans
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
