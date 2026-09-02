import { orgPlanFromClerk } from "@/lib/billing-engine";
import { BUILDER_FEATURE } from "@/lib/builder-protocol";
import { featuresForPlan } from "@/lib/plans";

/**
 * Who is on the other end of a Builder session, and whether their plan may use it.
 *
 * Every tool starts here. Layer three of the plan gate (CLAUDE.md rule 3): `<Show>` hides the
 * button, `has()` refuses the session route, and this refuses the tool itself — the only one of the
 * three an agent could ever reach on its own.
 *
 * Pure enough to unit-test: the identity half is a function of the session's auth attributes, and
 * the only I/O is the Clerk billing read.
 */

export { BUILDER_FEATURE };

/** The attribute bag `agents/builder/channels/eve.ts` projects from the caller's Clerk token. */
export type AuthedContext = {
  session: {
    auth: {
      current: { attributes?: Readonly<Record<string, string | readonly string[]>> } | null;
    };
  };
};

export type BuilderIdentity = {
  orgId: string;
  userId: string;
  workflowId: string;
  /** The plan on the session token. Indicative — `requireBuilder` re-reads it from Clerk. */
  tokenPlan: string;
};

function attribute(
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
  name: string,
): string {
  const value = attributes?.[name];
  return typeof value === "string" ? value : "";
}

/**
 * The identity on the session, or a sentence saying what is missing.
 *
 * A session with no attributes at all is the `localDev()` fallback under `eve dev`
 * (`principalType: "local-dev"`, no attributes) — a developer poking the agent with curl rather
 * than the panel. It gets a refusal that explains itself instead of a confusing "not found" from
 * Convex later.
 */
export function readIdentity(ctx: AuthedContext): BuilderIdentity | { error: string } {
  const attributes = ctx.session.auth.current?.attributes;
  const orgId = attribute(attributes, "orgId");
  const userId = attribute(attributes, "userId");
  const workflowId = attribute(attributes, "workflowId");

  if (!orgId || !userId) {
    return {
      error:
        "This session is not signed in to a PapaFlow organisation, so there is nothing to edit. " +
        "Open the Build with AI panel from a workflow canvas.",
    };
  }
  if (!workflowId) {
    return {
      error:
        "This session is not bound to a workflow. The chat panel sends the workflow id with every " +
        "request; open the Build with AI panel from a workflow canvas.",
    };
  }

  return { orgId, userId, workflowId, tokenPlan: attribute(attributes, "plan") };
}

export type BuilderSession = BuilderIdentity & { plan: string; features: readonly string[] };

/** The identity on the session, or a thrown refusal. The pure half of `requireBuilder`. */
export function requireIdentity(ctx: AuthedContext): BuilderIdentity {
  const identity = readIdentity(ctx);
  if ("error" in identity) throw new Error(identity.error);
  return identity;
}

/**
 * An identity plus a fresh plan read, refusing when the organisation is not on a plan that
 * includes the Builder.
 *
 * The plan comes from Clerk rather than from the session token's `pla` claim: Clerk is the source
 * of truth for billing (CLAUDE.md rule 10), a token is minted for about a minute, and a Builder
 * chat outlives that easily. `orgPlanFromClerk` caches for 60 s per org and never throws — a
 * billing outage answers `free_org`, which closes the Builder rather than opening it.
 *
 * Takes a plain identity rather than the context so a `"use step"` function can call it: step
 * arguments are recorded by the Workflow SDK and must be serializable, which a `ToolContext` is
 * not.
 *
 * @throws Error with a message the model may show the user.
 */
export async function requireBuilderPlan(identity: BuilderIdentity): Promise<BuilderSession> {
  const plan = await orgPlanFromClerk(identity.orgId);
  const features = featuresForPlan(plan);
  if (!features.includes(BUILDER_FEATURE)) {
    throw new Error(
      "The AI builder is a Pro feature and this organisation's plan does not include it. " +
        "Tell the user to upgrade in Settings → Billing; do not try another tool.",
    );
  }

  return { ...identity, plan, features };
}

/** What every plain tool calls first: who is asking, and may their plan use the Builder at all. */
export async function requireBuilder(ctx: AuthedContext): Promise<BuilderSession> {
  return await requireBuilderPlan(requireIdentity(ctx));
}
