import {
  canManageInstituteBilling,
  effectiveSubscriptionStatus,
  formatSubscriptionDate,
  subscriptionStatusLabels,
  subscriptionStatusTone,
} from "./subscription-access";

const checks: Array<[string, () => boolean]> = [
  ["institute owner can view billing", () => canManageInstituteBilling({ role: "owner", accessScope: "institute" })],
  ["institute administrator can view billing", () => canManageInstituteBilling({ role: "administrator", accessScope: "institute" })],
  ["accountant cannot view billing", () => !canManageInstituteBilling({ role: "accountant", accessScope: "institute" })],
  ["branch-scoped owner cannot view institute billing", () => !canManageInstituteBilling({ role: "owner", accessScope: "branches" })],
  ["missing membership cannot view billing", () => !canManageInstituteBilling(null)],
  ["known subscription status is labeled", () => subscriptionStatusLabels.past_due === "Past due"],
  ["active state uses success tone", () => subscriptionStatusTone("active") === "green"],
  ["past-due state uses caution tone", () => subscriptionStatusTone("past_due") === "amber"],
  ["unknown state stays neutral", () => subscriptionStatusTone("unexpected") === "slate"],
  ["active subscription expires from its saved period end", () => effectiveSubscriptionStatus("active", "2026-01-02T00:00:00.000Z", Date.parse("2026-01-02T00:00:00.000Z")) === "expired"],
  ["active subscription remains active before its saved period end", () => effectiveSubscriptionStatus("active", "2026-01-03T00:00:00.000Z", Date.parse("2026-01-02T00:00:00.000Z")) === "active"],
  ["trial expiry uses the saved trial timestamp", () => effectiveSubscriptionStatus("trialing", "2026-01-01T00:00:00.000Z", Date.parse("2026-01-02T00:00:00.000Z")) === "expired"],
  ["missing period dates do not fabricate expiry", () => effectiveSubscriptionStatus("active", null, Date.parse("2026-01-02T00:00:00.000Z")) === "active"],
  ["missing dates remain explicit", () => formatSubscriptionDate(null) === "Not set"],
  ["invalid dates do not render as a fabricated date", () => formatSubscriptionDate("invalid") === "Not available"],
];

let failed = 0;
for (const [name, check] of checks) {
  if (check()) console.log(`PASS: ${name}`);
  else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}
console.log(`Subscription access: ${checks.length - failed}/${checks.length} passed.`);
if (failed) process.exitCode = 1;
