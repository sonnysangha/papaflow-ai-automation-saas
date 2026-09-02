import type { Metadata } from "next";
import Link from "next/link";

import { PlanCards } from "@/components/marketing/PlanCards";
import { Eyebrow, ctaPrimary, ctaSecondary } from "@/components/marketing/primitives";
import { PRICING } from "@/lib/plans";

const DESCRIPTION = `Free to start, $${PRICING.pro.monthly} a month for Pro. Plans are per organisation, and AI usage is billed by the provider whose key you bring.`;

export const metadata: Metadata = {
  title: "Pricing — PapaFlow",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/pricing",
    siteName: "PapaFlow",
    title: "Pricing — PapaFlow",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Pricing — PapaFlow",
    description: DESCRIPTION,
  },
};

const FAQ = [
  {
    question: "Do I need to bring my own AI keys?",
    answer:
      "Yes, and that is the point. You add an OpenAI, Anthropic, Gemini or Groq key as a connection, PapaFlow tests it and seals it, and the AI nodes call the provider as you. Model usage lands on your provider bill at their price, so your plan here never changes because a workflow got chatty.",
  },
  {
    question: "What counts as a run?",
    answer:
      "One execution of one workflow, however many nodes it visits. A trigger firing, a manual run from the editor and a scheduled run all count once each. Retries inside a step, waits and approvals do not add to the count — a run that sleeps for three days is still one run.",
  },
  {
    question: "How does approval in Slack or Discord work?",
    answer:
      "An Approval node posts a message with buttons to Slack, Discord or Telegram and then parks the run. Whoever presses a button resumes it exactly where it stopped, with the answer available to every node downstream. Nobody needs a PapaFlow account to press the button.",
  },
  {
    question: "Can I cancel or change plan?",
    answer:
      "Any time, from Settings → Plans inside the app. Billing is handled by Clerk, so a change takes effect on the spot and the new features reach the app as soon as your session refreshes, usually within a minute. Downgrading keeps your workflows; the ones over the new limit stop running rather than disappearing.",
  },
  {
    question: "How are my credentials stored?",
    answer:
      "Every connection is encrypted with AES-256-GCM before it reaches the database, with a fresh IV per row and your organisation id bound into the encryption so a row cannot be replayed under another org. Keys are opened inside the single step that makes the call, and never appear in a prompt, a step argument or anything a browser can query.",
  },
] as const;

const SECTION = "mx-auto w-full max-w-6xl px-5 sm:px-8";

export default function PricingPage() {
  return (
    <>
      <section className={`${SECTION} flex flex-col gap-6 pt-16 pb-10 sm:pt-20`}>
        <Eyebrow className="w-full max-w-md">Pricing</Eyebrow>
        <h1 className="pf-display max-w-3xl text-4xl leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-5xl">
          One price per organisation. Your AI spend stays yours.
        </h1>
        <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
          Everyone in the org gets the plan&apos;s features. Model calls are billed
          by the provider whose key you connected, so nothing here marks up your
          tokens.
        </p>
      </section>

      <section className={`${SECTION} pb-20`}>
        <PlanCards />
      </section>

      <section className="scroll-mt-20 border-t border-border bg-muted/25 py-20" id="faq">
        <div className={`${SECTION} flex flex-col gap-10`}>
          <div className="flex flex-col gap-4">
            <Eyebrow className="max-w-sm">Questions</Eyebrow>
            <h2 className="pf-display max-w-2xl text-3xl font-semibold tracking-[-0.015em] text-balance sm:text-4xl">
              Before you pick a plan.
            </h2>
          </div>

          <dl className="grid gap-x-12 gap-y-8 md:grid-cols-2">
            {FAQ.map((item) => (
              <div key={item.question} className="flex flex-col gap-2">
                <dt className="text-base font-semibold tracking-tight">
                  {item.question}
                </dt>
                <dd className="text-sm text-pretty text-muted-foreground">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-t border-border py-20">
        <div className={`${SECTION} flex flex-col items-start gap-6`}>
          <h2 className="pf-display max-w-2xl text-3xl font-semibold tracking-[-0.015em] text-balance sm:text-4xl">
            Start on Free. Move up when a schedule needs to fire every minute.
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className={ctaPrimary()}>
              Start free
            </Link>
            <Link href="/" className={ctaSecondary()}>
              Back to the tour
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
