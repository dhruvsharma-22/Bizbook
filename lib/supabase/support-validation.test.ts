import { parseSupportReplyInput, parseSupportStateInput, parseSupportTicketInput } from "./support-validation";

const ticketId = "dfd8fcb4-5242-4e82-9c9c-38b3a83c9321";
const key = "d0629361-d40d-4c0d-9016-6f69bb34b8c0";
let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: boolean) {
  const success = actual === expected;
  if (success) passed += 1; else failed += 1;
  console.log(`${success ? "PASS" : "FAIL"}: ${name}`);
}

check("accepts bounded support ticket input", Boolean(parseSupportTicketInput({
  instituteId: "institute-id", category: "payments", subject: "Receipt issue",
  message: "A receipt is missing from the payment history.", idempotencyKey: key,
})), true);
const trimmed = parseSupportTicketInput({
  instituteId: "institute-id", category: "payments", subject: "  Issue  ",
  message: "  Details long enough to submit.  ", idempotencyKey: key,
});
check("trims subject and message before storing", trimmed?.subject === "Issue" && trimmed.message === "Details long enough to submit.", true);
check("rejects missing institute and invalid category", Boolean(parseSupportTicketInput({
  instituteId: "", category: "arbitrary", subject: "Receipt issue",
  message: "A receipt is missing from the payment history.", idempotencyKey: key,
})), false);
check("rejects oversized fields and non-UUID idempotency", Boolean(parseSupportTicketInput({
  instituteId: "institute-id", category: "data", subject: "x".repeat(121),
  message: "A receipt is missing from the payment history.", idempotencyKey: "retry",
})), false);
check("accepts a bounded reply", Boolean(parseSupportReplyInput({ ticketId, message: "We have checked the record.", idempotencyKey: key })), true);
check("rejects malformed reply identity", Boolean(parseSupportReplyInput({ ticketId: "bad", message: "reply", idempotencyKey: key })), false);
check("accepts only enumerated support state and priority", Boolean(parseSupportStateInput({ ticketId, status: "in_progress", priority: "high" })), true);
check("rejects unsupported state or priority", Boolean(parseSupportStateInput({ ticketId, status: "paid", priority: "critical" })), false);

console.log(`Support validation: ${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
