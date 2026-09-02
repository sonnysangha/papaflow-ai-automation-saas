import { ConvexError } from "convex/values";
import { toast } from "sonner";

/**
 * Convex functions signal expected failures with `ConvexError({ code, … })`; anything else that
 * reaches the client is a bug or a dropped connection. `data` is typed as an arbitrary Convex value,
 * so narrow it before reading `code`.
 */
function convexErrorData(error: unknown): { code?: unknown; limit?: unknown } | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  return typeof data === "object" && data !== null ? data : undefined;
}

function convexErrorCode(error: unknown): string | undefined {
  const code = convexErrorData(error)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The plan's workflow cap, when that is why a create failed. `undefined` means the failure was
 * something else — the caller shows its own message; `null` means the limit was hit but the payload
 * did not name it (a shape change in `convex/workflows.ts`), so the card drops the number.
 */
export function workflowLimitFrom(error: unknown): number | null | undefined {
  if (convexErrorCode(error) !== "plan_limit") return undefined;

  const limit = convexErrorData(error)?.limit;
  return typeof limit === "number" ? limit : null;
}

/**
 * Turns a failed workflow mutation into a toast. The plan wall gets an upgrade card at the call
 * site (`NewWorkflowDialog`); everywhere else a toast is the whole story.
 */
export function reportWorkflowError(error: unknown, fallback: string): void {
  if (convexErrorCode(error) === "plan_limit") {
    toast.error("Workflow limit reached for this plan");
    return;
  }

  console.error(error);
  toast.error(fallback);
}
