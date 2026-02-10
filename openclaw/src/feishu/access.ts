import type { AllowlistMatch } from "../channels/allowlist-match.js";

export type NormalizedAllowFrom = {
  entries: string[];
  entriesLower: string[];
  hasWildcard: boolean;
  hasEntries: boolean;
};

export type AllowFromMatch = AllowlistMatch<"wildcard" | "id">;

const normalizeSenderCandidate = (value: unknown): string | null => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^(feishu|lark):/i, "")
    .toLowerCase();
  return normalized || null;
};

const collectSenderCandidates = (params: {
  senderId?: string;
  senderIds?: Array<string | null | undefined>;
}): string[] => {
  const candidates = [...(params.senderIds ?? []), params.senderId]
    .map((value) => normalizeSenderCandidate(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates));
};

/**
 * Normalize an allowlist for Feishu.
 * Feishu IDs are open_id (ou_xxx) or union_id (on_xxx), no usernames.
 */
export const normalizeAllowFrom = (list?: Array<string | number>): NormalizedAllowFrom => {
  const entries = (list ?? []).map((value) => String(value).trim()).filter(Boolean);
  const hasWildcard = entries.includes("*");
  // Strip optional "feishu:" prefix
  const normalized = entries
    .filter((value) => value !== "*")
    .map((value) => value.replace(/^(feishu|lark):/i, ""));
  const normalizedLower = normalized.map((value) => value.toLowerCase());
  return {
    entries: normalized,
    entriesLower: normalizedLower,
    hasWildcard,
    hasEntries: entries.length > 0,
  };
};

export const normalizeAllowFromWithStore = (params: {
  allowFrom?: Array<string | number>;
  storeAllowFrom?: string[];
}): NormalizedAllowFrom => {
  const combined = [...(params.allowFrom ?? []), ...(params.storeAllowFrom ?? [])]
    .map((value) => String(value).trim())
    .filter(Boolean);
  return normalizeAllowFrom(combined);
};

export const firstDefined = <T>(...values: Array<T | undefined>) => {
  for (const value of values) {
    if (typeof value !== "undefined") {
      return value;
    }
  }
  return undefined;
};

/**
 * Check if a sender is allowed based on the normalized allowlist.
 * Feishu uses open_id (ou_xxx) or union_id (on_xxx) - no usernames.
 */
export const isSenderAllowed = (params: {
  allow: NormalizedAllowFrom;
  senderId?: string;
  senderIds?: Array<string | null | undefined>;
}) => {
  const { allow, senderId, senderIds } = params;
  if (!allow.hasEntries) {
    return true;
  }
  if (allow.hasWildcard) {
    return true;
  }

  const senderCandidates = collectSenderCandidates({
    senderId,
    senderIds,
  });

  for (const candidate of senderCandidates) {
    if (allow.entries.includes(candidate) || allow.entriesLower.includes(candidate)) {
      return true;
    }
  }

  return false;
};

export const resolveSenderAllowMatch = (params: {
  allow: NormalizedAllowFrom;
  senderId?: string;
  senderIds?: Array<string | null | undefined>;
}): AllowFromMatch => {
  const { allow, senderId, senderIds } = params;
  if (allow.hasWildcard) {
    return { allowed: true, matchKey: "*", matchSource: "wildcard" };
  }
  if (!allow.hasEntries) {
    return { allowed: false };
  }

  const senderCandidates = collectSenderCandidates({
    senderId,
    senderIds,
  });

  for (const candidate of senderCandidates) {
    if (allow.entries.includes(candidate) || allow.entriesLower.includes(candidate)) {
      return { allowed: true, matchKey: candidate, matchSource: "id" };
    }
  }

  return { allowed: false };
};
