export interface DailyJournalStatus {
  publications: number;
  manifests: number;
  validatedManifests: number;
  manifestFailures: number;
  partialFiles: number;
  unsafeLinks: number;
  unsafeEntries: number;
  bounded: boolean;
  inventoryEntries: number;
  zoneId: string;
  currentDate: string;
  eligiblePriorDayDirectories: number;
  currentDayDirectories: number;
  currentDayOpenSegments: number;
  currentDaySealedSegments: number;
  currentDayBytes: number;
  journalIntegrityFailures: number;
  openSegments: number;
  sealedSegments: number;
}

export interface DailyJournalAssessment {
  passed: boolean;
  state: "published" | "publication-not-yet-eligible" | "invalid";
  explanation: string;
}

export interface DirectJournalSegment {
  path: string;
  kind: "open" | "seg";
  bytes: number;
  sha256: string;
}

export interface DirectJournalLaneState {
  directoryId?: string;
  present: boolean;
  files: number;
  bytes: number;
  openSegments: number;
  sealedSegments: number;
  partialFiles: number;
  unsafeEntries: number;
  segments: DirectJournalSegment[];
}

function segmentUtcDate(path: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})\/\d{6}\.(?:open|seg)$/.exec(path);
  return m?.[1] ?? null;
}

function subtractUtcDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Verifies that every non-expired daily-journal segment captured before a
 * supported OSCAR restart remains intact after restart.
 *
 * When a long regression run straddles a UTC midnight rollover (e.g., 23:49Z ->
 * 00:43Z), OSCAR's 30-day retention policy intentionally prunes expired
 * 31+-day-old day directories. Only complete directories strictly older than
 * `latestPostDate - retentionDays` may disappear across a calendar rollover;
 * every retained sealed segment must survive with identical bytes and SHA-256,
 * and total post-restart bytes must be at least the sum of retained pre-restart
 * segment bytes.
 */
export function directJournalRestartPreserved(
  preRestart: DirectJournalLaneState,
  postRestart: DirectJournalLaneState,
  retentionDays = 30,
): boolean {
  if (!preRestart.present || !postRestart.present) return false;
  if (!Array.isArray(preRestart.segments) || !Array.isArray(postRestart.segments)) return false;

  const postByPath = new Map<string, DirectJournalSegment>();
  const postDates = new Set<string>();
  let latestPostDate = "";
  for (const seg of postRestart.segments) {
    const d = segmentUtcDate(seg.path);
    if (!d) return false;
    postByPath.set(seg.path, seg);
    postDates.add(d);
    if (d > latestPostDate) latestPostDate = d;
  }

  let latestPreDate = "";
  for (const seg of preRestart.segments) {
    const d = segmentUtcDate(seg.path);
    if (!d) return false;
    if (d > latestPreDate) latestPreDate = d;
  }

  const rolledOverUtcDay = latestPostDate.length === 10 &&
    latestPreDate.length === 10 &&
    latestPostDate > latestPreDate;
  const retentionCutoffDate = rolledOverUtcDay
    ? subtractUtcDays(latestPostDate, retentionDays)
    : "";

  let expectedMinBytes = 0;
  for (const preSeg of preRestart.segments) {
    const preDate = segmentUtcDate(preSeg.path)!;
    const expiredAtRollover = rolledOverUtcDay &&
      preDate < retentionCutoffDate &&
      !postDates.has(preDate);
    if (expiredAtRollover) continue;

    expectedMinBytes += preSeg.bytes;
    if (preSeg.kind === "seg") {
      const postSeg = postByPath.get(preSeg.path);
      if (!postSeg || postSeg.kind !== "seg" ||
          postSeg.bytes !== preSeg.bytes || postSeg.sha256 !== preSeg.sha256) {
        return false;
      }
    }
  }

  return postRestart.bytes >= expectedMinBytes;
}

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/**
 * A daily publication cannot exist until a complete calendar day closes in the
 * configured journal zone. Before that boundary, durable current-day segments
 * are the correct product state; once a prior day is eligible, exact CSV and
 * manifest validation remains mandatory.
 */
export function assessDailyJournalStatus(value: DailyJournalStatus): DailyJournalAssessment {
  const numericFields = [
    value.publications,
    value.manifests,
    value.validatedManifests,
    value.manifestFailures,
    value.partialFiles,
    value.unsafeLinks,
    value.unsafeEntries,
    value.inventoryEntries,
    value.eligiblePriorDayDirectories,
    value.currentDayDirectories,
    value.currentDayOpenSegments,
    value.currentDaySealedSegments,
    value.currentDayBytes,
    value.journalIntegrityFailures,
    value.openSegments,
    value.sealedSegments,
  ];
  const safe = numericFields.every(count) && value.bounded === true &&
    value.inventoryEntries <= 500_000 &&
    typeof value.zoneId === "string" && /^[A-Za-z0-9._+/-]{1,128}$/.test(value.zoneId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.currentDate) &&
    value.manifestFailures === 0 && value.partialFiles === 0 &&
    value.unsafeLinks === 0 && value.unsafeEntries === 0 &&
    value.journalIntegrityFailures === 0;
  if (!safe) {
    return {passed: false, state: "invalid", explanation: "journal inventory or integrity checks failed"};
  }

  const publicationPairsValid = value.publications > 0 &&
    value.publications === value.manifests &&
    value.validatedManifests === value.manifests;
  if (value.eligiblePriorDayDirectories > 0 || value.publications > 0 || value.manifests > 0) {
    return publicationPairsValid
      ? {
        passed: true,
        state: "published",
        explanation: `${value.publications} exact daily CSV/manifest pair(s) validated`,
      }
      : {
        passed: false,
        state: "invalid",
        explanation: "a completed journal day exists but no exact validated CSV/manifest pair is available",
      };
  }

  const currentSegments = value.currentDayOpenSegments + value.currentDaySealedSegments;
  const durableCurrentDay = value.publications === 0 && value.manifests === 0 &&
    value.validatedManifests === 0 && value.currentDayDirectories > 0 &&
    currentSegments > 0 && value.currentDayBytes >= currentSegments * 16 &&
    value.openSegments >= value.currentDayOpenSegments &&
    value.sealedSegments >= value.currentDaySealedSegments;
  return durableCurrentDay
    ? {
      passed: true,
      state: "publication-not-yet-eligible",
      explanation: `publication not yet eligible: no completed ${value.zoneId} day; ` +
        `${currentSegments} durable current-day segment(s) passed header and layout checks`,
    }
    : {
      passed: false,
      state: "invalid",
      explanation: "no completed day or valid durable current-day journal segment is available",
    };
}
