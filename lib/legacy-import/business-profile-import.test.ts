import assert from "node:assert/strict";
import { previewLegacyBusinessProfile } from "./business-profile-import";

const valid = {
  businessName: "North Coaching",
  ownerName: "Asha",
  phone: "9876543210",
  email: "owner@example.test",
  address: "12 Main Road",
  pincode: "560001",
  gstin: "29ABCDE1234F1Z5",
};
const from = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

const accepted = previewLegacyBusinessProfile(from(valid));
assert.equal(accepted.eligible, true);
assert.equal(accepted.profile.businessName, "North Coaching");
assert.equal(accepted.profile.gstin, "29ABCDE1234F1Z5");

assert.equal(previewLegacyBusinessProfile({ getItem: () => null }).eligible, false);
assert.match(previewLegacyBusinessProfile({ getItem: () => "{" }).reason ?? "", /malformed/);
assert.match(previewLegacyBusinessProfile(from({ updatedAt: "2026-01-01" })).reason ?? "", /no importable/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, phone: "+919876543210" })).reason ?? "", /10 digits/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, pincode: "1234" })).reason ?? "", /6 digits/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, email: "not-an-email" })).reason ?? "", /Email/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, website: "javascript:alert(1)" })).reason ?? "", /HTTP or HTTPS/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, gstin: "bad" })).reason ?? "", /15 letters or digits/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, arbitrary: "secret" })).reason ?? "", /Unrecognized/);
assert.match(previewLegacyBusinessProfile(from({ ...valid, businessName: "A", name: "B" })).reason ?? "", /Conflicting/);
assert.equal(previewLegacyBusinessProfile(from({ ...valid, updatedAt: "2026-01-01" })).eligible, true);
assert.equal(JSON.stringify(accepted).includes("example.test"), true, "profile values are returned only to the explicit local review UI");
console.log("Legacy business profile import: 15 assertions passed.");
