import { ConvexError } from "convex/values";
import { toast } from "sonner";

/**
 * Convex functions signal expected failures with `ConvexError({ code, … })`; anything else that
 * reaches the client is a bug or a dropped connection. `data` is typed as an arbitrary Convex value,
 * so narrow it before reading `code`.
 */
function convexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Turns a failed workflow mutation into a toast. Phase 11 replaces the plan wall message with an
 * upgrade card, so the copy lives here rather than at each call site.
 */
export function reportWorkflowError(error: unknown, fallback: string): void {
  if (convexErrorCode(error) === "plan_limit") {
    toast.error("Free plan allows 3 workflows — upgrade to add more");
    return;
  }

  console.error(error);
  toast.error(fallback);
}
