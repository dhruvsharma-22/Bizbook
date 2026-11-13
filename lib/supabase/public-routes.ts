const PUBLIC_EXACT_PATHS = new Set([
  "/login",
  "/plans",
  "/api/plans",
  "/auth/callback",
  "/pay",
  "/api/payments/checkout-link/resolve",
  "/api/payments/checkout-link/verify",
]);

export function isPublicRoutePath(pathname: string): boolean {
  return PUBLIC_EXACT_PATHS.has(pathname);
}
