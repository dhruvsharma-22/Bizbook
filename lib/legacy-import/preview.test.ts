import assert from "node:assert/strict";
import { previewLegacyStorage, readLegacyStorageExport } from "./preview";

function memoryStorage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

const preview = previewLegacyStorage(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ students: [{ id: "s1", name: "Private Student" }], staff: [{ id: "t1" }] }),
  "bizbook-fee-receipts-v1": JSON.stringify([
    { id: "receipt-1", amount: 12.34, paymentDate: "2026-01-02" },
    { id: "receipt-2", amount: "1.239", paymentDate: "2026-02-31" },
  ]),
  "bizbook-payment-records-v1": JSON.stringify([
    { id: "receipt-1", amount: 12.34, mode: "Online", status: "Paid" },
    { id: "record-2", amount: 1, date: "2026-01-02garbage" },
  ]),
  "bizbook-refunds-v1": JSON.stringify([{ id: "refund-1", amount: 1, status: "Completed" }]),
  "bizbook-staff-attendance-v1": JSON.stringify({ "staff-1__2026-01-01": "Present", "staff-1__2026-01-02": "Invalid", "staff-1__not-a-date": "Present" }),
  "bizbook-business-logo": "data:image/png;base64,AA==",
}));
assert.equal(preview.presentSourceCount, 6);
assert.equal(preview.sources.find((source) => source.key === "bizbook-students-staff-v1")?.records, 2);
assert.equal(preview.sources.find((source) => source.key === "bizbook-fee-receipts-v1")?.observedAmountPaise, 1234);
assert.equal(preview.totalInvalidAmounts, 1);
assert.equal(preview.totalInvalidDates, 3);
assert.equal(preview.sources.find((source) => source.key === "bizbook-staff-attendance-v1")?.invalidDates, 1);
assert.equal(preview.sources.find((source) => source.key === "bizbook-payment-records-v1")?.invalidDates, 1);
assert.equal(preview.totalUnverifiedOnlinePaidClaims, 1);
assert.equal(preview.totalCompletedRefundClaims, 1);
assert.equal(preview.totalRepeatedIdOccurrences, 2);
assert.equal(preview.totalMalformedRecords, 1);
assert.equal(preview.sources.find((source) => source.key === "bizbook-fee-receipts-v1")?.firstDate, "2026-01-02");
assert.equal(JSON.stringify(preview).includes("Private Student"), false);

const invalidJson = previewLegacyStorage(memoryStorage({ "bizbook-refunds-v1": "not-json" }));
assert.equal(invalidJson.totalMalformedRecords, 1);
assert.match(invalidJson.sources.find((source) => source.key === "bizbook-refunds-v1")?.issue ?? "", /unchanged/);

const readFailure = previewLegacyStorage({ getItem: () => { throw new Error("private browser error"); } });
assert.equal(readFailure.sources[0].issue, "Browser storage could not be read. Nothing was changed.");
assert.equal(JSON.stringify(readFailure).includes("private browser error"), false);

const exported = readLegacyStorageExport(memoryStorage({ "bizbook-refunds-v1": "[1]" }));
assert.deepEqual(exported, { "bizbook-refunds-v1": "[1]" });
assert.throws(() => readLegacyStorageExport(memoryStorage({ "bizbook-business-logo": "x".repeat(8 * 1024 * 1024 + 1) })), /size limit/);
console.log("Legacy import preview: 18 assertions passed.");
