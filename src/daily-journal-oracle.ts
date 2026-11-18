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
