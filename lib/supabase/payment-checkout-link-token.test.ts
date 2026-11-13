import assert from "node:assert/strict";
import { createPaymentCheckoutLinkToken, hashPaymentCheckoutLinkToken } from "./payment-checkout-link-token";

const generated = createPaymentCheckoutLinkToken();
assert.match(generated.token, /^[A-Za-z0-9_-]{43}$/);
assert.match(generated.tokenSha256, /^[0-9a-f]{64}$/);
assert.equal(hashPaymentCheckoutLinkToken(generated.token), generated.tokenSha256);
assert.equal(hashPaymentCheckoutLinkToken("short"), null);
assert.equal(hashPaymentCheckoutLinkToken("a".repeat(43)), null, "non-canonical base64url is rejected");
assert.equal(hashPaymentCheckoutLinkToken({ token: generated.token }), null);

const second = createPaymentCheckoutLinkToken();
assert.notEqual(second.token, generated.token);
assert.notEqual(second.tokenSha256, generated.tokenSha256);
console.log("Parent payment link token tests: 8 assertions passed.");
