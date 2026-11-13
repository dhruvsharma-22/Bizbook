import assert from "node:assert/strict";
import { getAuthGateDecision } from "./auth-gate";

assert.equal(getAuthGateDecision("/login", false), "allow-public");
assert.equal(
  getAuthGateDecision("/api/payments/checkout-link/resolve", false),
  "allow-public",
);
assert.equal(getAuthGateDecision("/dashboard", false), "configuration-unavailable");
assert.equal(getAuthGateDecision("/platform-admin", false), "configuration-unavailable");
assert.equal(getAuthGateDecision("/api/payments/create-order", false), "configuration-unavailable");
assert.equal(getAuthGateDecision("/dashboard", true), "require-session");
assert.equal(getAuthGateDecision("/login", true), "allow-public");

console.log("Supabase auth gate tests: 7 assertions passed.");
