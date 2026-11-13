export const MAX_LEGACY_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_LEGACY_TOTAL_BYTES = 24 * 1024 * 1024;

export const LEGACY_SOURCES = [
  { key: "bizbook-students-staff-v1", label: "Students and staff", kind: "people" },
  { key: "bizbook-staff-attendance-v1", label: "Staff attendance", kind: "attendance" },
  { key: "bizbook-fee-receipts-v1", label: "Fee receipts", kind: "transactions" },
  { key: "bizbook-advance-payments-v1", label: "Advance receipts", kind: "transactions" },
  { key: "bizbook-payment-history-v1", label: "Payment history", kind: "transactions" },
  { key: "bizbook-payment-records-v1", label: "Payment records", kind: "transactions" },
  { key: "bizbook-salary-payments-v1", label: "Salary payments", kind: "transactions" },
  { key: "bizbook-other-expenses-v1", label: "Expenses", kind: "transactions" },
  { key: "bizbook-refunds-v1", label: "Refunds", kind: "transactions" },
  { key: "bizbook-business-profile", label: "Business profile", kind: "profile" },
  { key: "bizbook-business-logo", label: "Business logo", kind: "logo" },
] as const;

export type LegacySourcePreview = {
  key: string;
  label: string;
  present: boolean;
  bytes: number;
  records: number;
  malformedRecords: number;
  invalidAmounts: number;
  invalidDates: number;
  observedAmountPaise: number;
  repeatedIdOccurrences: number;
  unverifiedOnlinePaidClaims: number;
  completedRefundClaims: number;
  firstDate: string | null;
  lastDate: string | null;
  issue: string | null;
};

export type LegacyPreview = {
  sources: LegacySourcePreview[];
  presentSourceCount: number;
  totalRecords: number;
  totalBytes: number;
  totalMalformedRecords: number;
  totalInvalidAmounts: number;
  totalInvalidDates: number;
  totalRepeatedIdOccurrences: number;
  totalUnverifiedOnlinePaidClaims: number;
  totalCompletedRefundClaims: number;
};

type StorageReader = Pick<Storage, "getItem">;
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePaise(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const raw = String(value).trim();
  if (!/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(raw)) return null;
  const [rupeesText, fractionText = ""] = raw.split(".");
  const paise = Number(rupeesText) * 100 + Number(fractionText.padEnd(2, "0") || "0");
  return Number.isSafeInteger(paise) ? paise : null;
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const date = new Date(candidate + "T00:00:00.000Z");
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== candidate) return null;
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) return null;
  return candidate;
}

function getRecords(kind: (typeof LEGACY_SOURCES)[number]["kind"], value: unknown) {
  if (kind === "people") {
    if (Array.isArray(value)) return { rows: value, malformed: 0 };
    if (!isRecord(value)) return { rows: [], malformed: 1 };
    const students = value.students;
    const staff = value.staff;
    const malformed = Number(students !== undefined && !Array.isArray(students))
      + Number(staff !== undefined && !Array.isArray(staff));
    return { rows: [...(Array.isArray(students) ? students : []), ...(Array.isArray(staff) ? staff : [])], malformed };
  }
  if (kind === "attendance") {
    if (!isRecord(value)) return { rows: [], malformed: 1 };
    const validStatuses = new Set(["Present", "Absent", "Leave", "Holiday"]);
    const rows = Object.entries(value).map(([key, status]) => ({ key, status }));
    return { rows, malformed: rows.filter((row) => !validStatuses.has(String(row.status))).length };
  }
  if (kind === "transactions") {
    if (!Array.isArray(value)) return { rows: [], malformed: 1 };
    return { rows: value, malformed: 0 };
  }
  if (kind === "profile") return isRecord(value) ? { rows: [value], malformed: 0 } : { rows: [], malformed: 1 };
  if (kind === "logo") return typeof value === "string" && value.length ? { rows: [value], malformed: 0 } : { rows: [], malformed: 1 };
  return { rows: [], malformed: 1 };
}

function idValue(row: unknown): string | null {
  if (!isRecord(row)) return null;
  const id = row.id ?? row.paymentId ?? row.receiptId ?? row.refundId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function emptyPreview(source: (typeof LEGACY_SOURCES)[number], issue: string | null = null): LegacySourcePreview {
  return {
    key: source.key, label: source.label, present: false, bytes: 0, records: 0,
    malformedRecords: 0, invalidAmounts: 0, observedAmountPaise: 0,
    invalidDates: 0,
    repeatedIdOccurrences: 0, unverifiedOnlinePaidClaims: 0, completedRefundClaims: 0,
    firstDate: null, lastDate: null, issue,
  };
}

/** Reports metadata only. It never returns record values, names, contact data, or raw IDs. */
export function previewLegacyStorage(storage: StorageReader): LegacyPreview {
  let totalBytes = 0;
  const idCounts = new Map<string, number>();
  const sourceIds: string[][] = [];
  const sources = LEGACY_SOURCES.map((source): LegacySourcePreview => {
    let raw: string | null;
    try {
      raw = storage.getItem(source.key);
    } catch {
      sourceIds.push([]);
      return emptyPreview(source, "Browser storage could not be read. Nothing was changed.");
    }
    if (raw === null) {
      sourceIds.push([]);
      return emptyPreview(source);
    }
    const bytes = new TextEncoder().encode(raw).byteLength;
    totalBytes += bytes;
    if (bytes > MAX_LEGACY_SOURCE_BYTES || totalBytes > MAX_LEGACY_TOTAL_BYTES) {
      sourceIds.push([]);
      return { ...emptyPreview(source, "Preview size limit exceeded. Nothing was changed."), present: true, bytes };
    }
    let value: unknown;
    if (source.kind === "logo") {
      value = raw;
    } else {
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        sourceIds.push([]);
        return { ...emptyPreview(source, "Stored value is not valid JSON. Original value was left unchanged."), present: true, bytes, malformedRecords: 1 };
      }
    }
    const extracted = getRecords(source.kind, value);
    const rows = extracted.rows;
    const recordRows = rows.filter(isRecord);
    let invalidAmounts = 0;
    let invalidDates = 0;
    let observedAmountPaise = 0;
    let unverifiedOnlinePaidClaims = 0;
    let completedRefundClaims = 0;
    const dates: string[] = [];
    const ids: string[] = [];
    if (source.kind === "transactions") {
      for (const row of rows) {
        if (!isRecord(row)) { invalidAmounts += 1; continue; }
        const amount = parsePaise(row.amount);
        if (amount === null || amount <= 0 || !Number.isSafeInteger(observedAmountPaise + amount)) invalidAmounts += 1;
        else observedAmountPaise += amount;
        const status = String(row.status ?? "").toLowerCase();
        const mode = String(row.mode ?? row.paymentMode ?? "").toLowerCase();
        const hasProviderReference = typeof row.provider === "string" || typeof row.providerOrderId === "string";
        if ((mode === "online" || hasProviderReference) && ["paid", "refunded", "partially refunded"].includes(status)) unverifiedOnlinePaidClaims += 1;
        if (source.key === "bizbook-refunds-v1" && status === "completed") completedRefundClaims += 1;
        const id = idValue(row);
        if (id) { ids.push(id); idCounts.set(id, (idCounts.get(id) ?? 0) + 1); }
        const dateFields = ["paymentDate", "paidAt", "date", "createdAt"];
        const dateValue = dateFields.map((field) => row[field]).find((item) => item !== undefined && item !== null && item !== "");
        if (dateValue !== undefined) {
          const date = validDate(dateValue);
          if (date) dates.push(date);
          else invalidDates += 1;
        }
      }
    } else if (source.kind === "people") {
      for (const row of recordRows) {
        const id = idValue(row);
        if (id) ids.push(id);
      }
    } else if (source.kind === "attendance") {
      for (const row of recordRows) {
        const date = validDate(typeof row.key === "string" ? row.key.split("__").at(-1) : null);
        if (date) dates.push(date);
        else invalidDates += 1;
      }
    }
    sourceIds.push(ids);
    const orderedDates = dates.sort();
    return {
      key: source.key, label: source.label, present: true, bytes, records: rows.length,
      malformedRecords: extracted.malformed + rows.filter((row) => !isRecord(row) && source.kind !== "logo").length,
      invalidAmounts, invalidDates, observedAmountPaise, repeatedIdOccurrences: 0,
      unverifiedOnlinePaidClaims, completedRefundClaims,
      firstDate: orderedDates[0] ?? null, lastDate: orderedDates.at(-1) ?? null, issue: null,
    };
  });
  for (let index = 0; index < sources.length; index += 1) {
    if (LEGACY_SOURCES[index].kind !== "transactions") continue;
    sources[index].repeatedIdOccurrences = sourceIds[index].filter((id) => (idCounts.get(id) ?? 0) > 1).length;
  }
  return {
    sources,
    presentSourceCount: sources.filter((source) => source.present).length,
    totalRecords: sources.reduce((sum, source) => sum + source.records, 0),
    totalBytes,
    totalMalformedRecords: sources.reduce((sum, source) => sum + source.malformedRecords, 0),
    totalInvalidAmounts: sources.reduce((sum, source) => sum + source.invalidAmounts, 0),
    totalInvalidDates: sources.reduce((sum, source) => sum + source.invalidDates, 0),
    totalRepeatedIdOccurrences: sources.reduce((sum, source) => sum + source.repeatedIdOccurrences, 0),
    totalUnverifiedOnlinePaidClaims: sources.reduce((sum, source) => sum + source.unverifiedOnlinePaidClaims, 0),
    totalCompletedRefundClaims: sources.reduce((sum, source) => sum + source.completedRefundClaims, 0),
  };
}

/** Export is an explicit browser-only backup. Raw values are never returned by previewLegacyStorage. */
export function readLegacyStorageExport(storage: StorageReader): Record<string, string> {
  const snapshot: Record<string, string> = {};
  let totalBytes = 0;
  for (const { key } of LEGACY_SOURCES) {
    const raw = storage.getItem(key);
    if (raw !== null) {
      const bytes = new TextEncoder().encode(raw).byteLength;
      totalBytes += bytes;
      if (bytes > MAX_LEGACY_SOURCE_BYTES || totalBytes > MAX_LEGACY_TOTAL_BYTES) {
        throw new Error("Legacy export size limit exceeded. Browser data was not changed.");
      }
      snapshot[key] = raw;
    }
  }
  return snapshot;
}
