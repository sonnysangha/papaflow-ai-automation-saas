// Constant-time comparison, shared by every signature verifier under `lib/signatures/`.
//
// `crypto.timingSafeEqual` throws when the two buffers differ in length, and a length check on its
// own already leaks the length — which is public information for a hex digest or a token we
// generated ourselves. So an unequal length is `false` and everything else is compared byte by byte.
import { timingSafeEqual } from "node:crypto";

/** Node only: signature verification lives in route handlers, never in the browser bundle. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
