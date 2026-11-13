import assert from "node:assert/strict";
import { isPublicRoutePath } from "./public-routes";

assert.equal(isPublicRoutePath("/login"), true);
assert.equal(isPublicRoutePath("/auth/callback"), true);
assert.equal(isPublicRoutePath("/pay"), true);
assert.equal(isPublicRoutePath("/api/payments/checkout-link/resolve"), true);
assert.equal(isPublicRoutePath("/api/payments/checkout-link/verify"), true);
assert.equal(isPublicRoutePath("/api/payments/checkout-links"), false);
assert.equal(isPublicRoutePath("/api/payments/create-order"), false);
assert.equal(isPublicRoutePath("/api/payments/checkout-link/resolve/extra"), false);
assert.equal(isPublicRoutePath("/platform-admin"), false);
assert.equal(isPublicRoutePath("/payments/history"), false);

console.log("Public route allowlist tests: 10 assertions passed.");
