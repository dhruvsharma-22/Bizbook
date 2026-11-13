import { isPublicRoutePath } from "./public-routes";

export type AuthGateDecision =
  | "allow-public"
  | "require-session"
  | "configuration-unavailable";

export function getAuthGateDecision(
  pathname: string,
  hasSupabaseConfig: boolean,
): AuthGateDecision {
  if (isPublicRoutePath(pathname)) return "allow-public";
  return hasSupabaseConfig ? "require-session" : "configuration-unavailable";
}
