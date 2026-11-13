
/**
 * BizBook Brain — Audit Engine
 *
 * Creates validated, structured audit records.
 * Storage and authorization are handled separately.
 *
 * This engine does not persist records and does not establish
 * whether an actor is authorized to perform an action.
 */

import { BizBookError } from "./errors";

export const AUDIT_ACTIONS = [
  "PAYMENT_CREATED",
  "PAYMENT_RECORDED",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "REFUND_REQUESTED",
  "REFUND_COMPLETED",
  "REFUND_FAILED",
  "INSTALLMENT_UPDATED",
  "ADVANCE_ALLOCATED",
  "STUDENT_UPDATED",
  "STAFF_UPDATED",
  "MANUAL_CORRECTION",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditRecord {
  id: string;
  actorId: string;
  actorRole: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CreateAuditInput {
  id: string;
  actorId: string;
  actorRole: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

function fail(message: string): never {
  throw new BizBookError("VALIDATION_ERROR", message);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function validateTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    return fail("Audit timestamp is invalid.");
  }

  return value;
}

function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "string" &&
    (AUDIT_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * Creates a safe metadata copy.
 *
 * JSON-compatible metadata is intentionally required so the record
 * can later be stored in localStorage or a database consistently.
 */
function cloneMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return fail("Audit metadata must be an object.");
  }

  try {
    const serialized = JSON.stringify(metadata);

    if (serialized === undefined) {
      return fail("Audit metadata could not be serialized.");
    }

    const cloned: unknown = JSON.parse(serialized);

    if (
      cloned === null ||
      typeof cloned !== "object" ||
      Array.isArray(cloned)
    ) {
      return fail("Audit metadata must be a JSON object.");
    }

    return cloned as Record<string, unknown>;
  } catch {
    return fail(
      "Audit metadata must contain only serializable JSON values."
    );
  }
}

/**
 * Creates a validated audit record.
 * This function does not persist the record.
 */
export function createAuditRecord(
  input: CreateAuditInput
): AuditRecord {
  if (!input || typeof input !== "object") {
    return fail("Audit input is required.");
  }

  const id = requireText(input.id, "Audit ID");
  const actorId = requireText(input.actorId, "Actor ID");
  const actorRole = requireText(input.actorRole, "Actor role");
  const entityType = requireText(input.entityType, "Entity type");
  const entityId = requireText(input.entityId, "Entity ID");
  const description = requireText(
    input.description,
    "Audit description"
  );

  if (!isAuditAction(input.action)) {
    return fail("Audit action is invalid.");
  }

  const createdAt =
    input.createdAt === undefined
      ? new Date().toISOString()
      : validateTimestamp(input.createdAt);

  const metadata = cloneMetadata(input.metadata);

  return {
    id,
    actorId,
    actorRole,
    action: input.action,
    entityType,
    entityId,
    description,
    ...(metadata !== undefined ? { metadata } : {}),
    createdAt,
  };
}

/**
 * Checks whether an audit record already uses a given ID.
 */
export function ensureUniqueAuditId(
  record: AuditRecord,
  existingRecords: AuditRecord[]
): void {
  if (!record || typeof record.id !== "string" || !record.id.trim()) {
    return fail("Audit record ID is invalid.");
  }

  if (!Array.isArray(existingRecords)) {
    return fail("Existing audit records must be an array.");
  }

  const duplicate = existingRecords.some(
    (item) => item && item.id === record.id
  );

  if (duplicate) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "An audit record with this ID already exists.",
      { auditId: record.id }
    );
  }
}

/**
 * Returns audit records sorted newest first.
 * The original array is not modified.
 */
export function sortAuditRecords(
  records: AuditRecord[]
): AuditRecord[] {
  if (!Array.isArray(records)) {
    return fail("Audit records must be an array.");
  }

  for (const record of records) {
    if (
      !record ||
      typeof record.createdAt !== "string" ||
      !Number.isFinite(Date.parse(record.createdAt))
    ) {
      return fail("Cannot sort audit records with invalid timestamps.");
    }
  }

  return [...records].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}
