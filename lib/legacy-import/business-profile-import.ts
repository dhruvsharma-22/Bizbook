export const LEGACY_BUSINESS_PROFILE_KEY = "bizbook-business-profile";
export const LEGACY_BUSINESS_PROFILE_SOURCE_ID = "business-profile-v1";

export type LegacyBusinessProfile = Partial<{
  businessName: string;
  ownerName: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
}>;

export type LegacyBusinessProfilePreview = {
  eligible: boolean;
  profile: LegacyBusinessProfile;
  reason: string | null;
};

const aliases: Record<keyof LegacyBusinessProfile, readonly string[]> = {
  businessName: ["businessName", "business_name", "name", "instituteName"],
  ownerName: ["ownerName", "owner_name"],
  phone: ["phone", "mobile", "contact"],
  whatsapp: ["whatsapp", "whatsappNumber", "whatsapp_number"],
  email: ["email"],
  website: ["website", "url"],
  address: ["address"],
  city: ["city"],
  state: ["state"],
  pincode: ["pincode", "pinCode", "zip"],
  gstin: ["gstin", "GSTIN"],
};

const ignoredMetadata = new Set(["updatedAt", "updated_at", "createdAt", "created_at"]);
const fieldLimits: Record<keyof LegacyBusinessProfile, number> = {
  businessName: 100, ownerName: 100, phone: 10, whatsapp: 10, email: 254,
  website: 2048, address: 250, city: 50, state: 50, pincode: 6, gstin: 15,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findAliases(record: Record<string, unknown>, names: readonly string[]): string[] {
  return names.filter((name) => Object.hasOwn(record, name));
}

export function previewLegacyBusinessProfile(storage: Pick<Storage, "getItem">): LegacyBusinessProfilePreview {
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_BUSINESS_PROFILE_KEY);
  } catch {
    return { eligible: false, profile: {}, reason: "Browser storage could not be read." };
  }
  if (raw === null) return { eligible: false, profile: {}, reason: "No saved legacy profile was found." };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { eligible: false, profile: {}, reason: "The saved profile is malformed and was left unchanged." };
  }
  if (!isRecord(value)) return { eligible: false, profile: {}, reason: "The saved profile is not a simple object." };

  const used = new Set<string>();
  const profile: LegacyBusinessProfile = {};
  for (const field of Object.keys(aliases) as (keyof LegacyBusinessProfile)[]) {
    const present = findAliases(value, aliases[field]);
    if (present.length > 1) {
      const normalized = new Set(present.map((key) => String(value[key] ?? "").trim()));
      if (normalized.size > 1) return { eligible: false, profile: {}, reason: `Conflicting values were found for ${field}.` };
    }
    if (!present.length) continue;
    for (const key of present) used.add(key);
    const candidate = value[present[0]];
    if (candidate === null || candidate === "") continue;
    if (typeof candidate !== "string") return { eligible: false, profile: {}, reason: `The ${field} value is not text and needs review.` };
    const normalized = candidate.trim();
    if (!normalized) continue;
    if ((field === "phone" || field === "whatsapp") && !/^\d{10}$/.test(normalized)) {
      return { eligible: false, profile: {}, reason: `${field} must contain exactly 10 digits.` };
    }
    if (field === "pincode" && !/^\d{6}$/.test(normalized)) return { eligible: false, profile: {}, reason: "Pincode must contain exactly 6 digits." };
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { eligible: false, profile: {}, reason: "Email address needs review." };
    if (field === "website") {
      try {
        const url = new URL(normalized);
        if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error("invalid");
      } catch {
        return { eligible: false, profile: {}, reason: "Website must be a valid HTTP or HTTPS URL." };
      }
    }
    if (field === "gstin" && !/^[A-Z0-9]{15}$/.test(normalized.toUpperCase())) return { eligible: false, profile: {}, reason: "GSTIN must contain 15 letters or digits." };
    if (normalized.length > fieldLimits[field]) return { eligible: false, profile: {}, reason: `The ${field} value exceeds its field limit.` };
    profile[field] = field === "gstin" ? normalized.toUpperCase() : normalized;
  }

  const unexpected = Object.keys(value).filter((key) => !used.has(key) && !ignoredMetadata.has(key));
  if (unexpected.length) return { eligible: false, profile: {}, reason: "Unrecognized profile fields need review before import." };
  if (!Object.keys(profile).length) return { eligible: false, profile: {}, reason: "The saved profile has no importable values." };
  return { eligible: true, profile, reason: null };
}
