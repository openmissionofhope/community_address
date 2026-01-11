/**
 * @fileoverview In-memory ban store for tracking rate limit offenders.
 * Tracks violation counts and bans IPs that repeatedly exceed limits.
 */

interface BanRecord {
  violations: number;
  bannedUntil: number | null;
  lastViolation: number;
}

/** Number of violations before an IP gets banned */
export const BAN_THRESHOLD = 5;

/** Ban duration in milliseconds (15 minutes) */
export const BAN_DURATION_MS = 15 * 60 * 1000;

/** How long to remember violations (1 hour) */
const VIOLATION_WINDOW_MS = 60 * 60 * 1000;

/** Maximum number of tracked IPs to prevent memory exhaustion */
const MAX_TRACKED_IPS = 10000;

/** In-memory store for ban records */
const banRecords = new Map<string, BanRecord>();

/**
 * Evict the oldest non-banned entry to make room for new entries.
 * Called when the store is at capacity.
 */
function evictOldestEntry(): void {
  const now = Date.now();
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, record] of banRecords) {
    // Don't evict currently banned IPs
    if (record.bannedUntil && record.bannedUntil > now) continue;

    if (record.lastViolation < oldestTime) {
      oldestTime = record.lastViolation;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    banRecords.delete(oldestKey);
  }
}

/**
 * Records a rate limit violation for an IP.
 * Returns true if the IP should be banned.
 */
export function recordViolation(ip: string): boolean {
  const now = Date.now();
  const record = banRecords.get(ip);

  if (!record) {
    // Size limit protection - evict oldest entry if at capacity
    if (banRecords.size >= MAX_TRACKED_IPS) {
      evictOldestEntry();
    }

    banRecords.set(ip, {
      violations: 1,
      bannedUntil: null,
      lastViolation: now,
    });
    return false;
  }

  // Reset violations if outside window
  if (now - record.lastViolation > VIOLATION_WINDOW_MS) {
    record.violations = 1;
    record.lastViolation = now;
    return false;
  }

  record.violations++;
  record.lastViolation = now;

  // Check if should be banned
  if (record.violations >= BAN_THRESHOLD) {
    record.bannedUntil = now + BAN_DURATION_MS;
    return true;
  }

  return false;
}

/**
 * Checks if an IP is currently banned.
 * Returns ban expiry timestamp if banned, null otherwise.
 */
export function isBanned(ip: string): number | null {
  const record = banRecords.get(ip);
  if (!record || !record.bannedUntil) {
    return null;
  }

  const now = Date.now();
  if (now >= record.bannedUntil) {
    // Ban expired, reset record
    record.bannedUntil = null;
    record.violations = 0;
    return null;
  }

  return record.bannedUntil;
}

/**
 * Manually ban an IP address.
 */
export function banIp(ip: string, durationMs: number = BAN_DURATION_MS): void {
  const now = Date.now();
  const record = banRecords.get(ip);

  if (record) {
    record.bannedUntil = now + durationMs;
    record.violations = BAN_THRESHOLD;
  } else {
    banRecords.set(ip, {
      violations: BAN_THRESHOLD,
      bannedUntil: now + durationMs,
      lastViolation: now,
    });
  }
}

/**
 * Unban an IP address.
 */
export function unbanIp(ip: string): boolean {
  const record = banRecords.get(ip);
  if (!record) {
    return false;
  }
  record.bannedUntil = null;
  record.violations = 0;
  return true;
}

/**
 * Get all currently banned IPs with their expiry times.
 */
export function getBannedIps(): Array<{ ip: string; bannedUntil: number; violations: number }> {
  const now = Date.now();
  const banned: Array<{ ip: string; bannedUntil: number; violations: number }> = [];

  for (const [ip, record] of banRecords) {
    if (record.bannedUntil && record.bannedUntil > now) {
      banned.push({
        ip,
        bannedUntil: record.bannedUntil,
        violations: record.violations,
      });
    }
  }

  return banned;
}

/**
 * Get stats about the ban store.
 */
export function getBanStats(): {
  totalTracked: number;
  currentlyBanned: number;
  recentViolators: number;
  atCapacity: boolean;
  maxCapacity: number;
} {
  const now = Date.now();
  let currentlyBanned = 0;
  let recentViolators = 0;

  for (const record of banRecords.values()) {
    if (record.bannedUntil && record.bannedUntil > now) {
      currentlyBanned++;
    }
    if (now - record.lastViolation < VIOLATION_WINDOW_MS) {
      recentViolators++;
    }
  }

  return {
    totalTracked: banRecords.size,
    currentlyBanned,
    recentViolators,
    atCapacity: banRecords.size >= MAX_TRACKED_IPS,
    maxCapacity: MAX_TRACKED_IPS,
  };
}

/**
 * Clean up expired records to prevent memory leaks.
 * Should be called periodically.
 */
export function cleanupExpiredRecords(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [ip, record] of banRecords) {
    // Remove if no recent violations and not banned
    const isExpired = now - record.lastViolation > VIOLATION_WINDOW_MS;
    const notBanned = !record.bannedUntil || record.bannedUntil < now;

    if (isExpired && notBanned) {
      banRecords.delete(ip);
      cleaned++;
    }
  }

  return cleaned;
}
