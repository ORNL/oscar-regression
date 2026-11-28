import assert from "node:assert/strict";
import test from "node:test";
import {
  assessDailyJournalStatus,
  directJournalRestartPreserved,
  type DailyJournalStatus,
  type DirectJournalLaneState,
} from "../src/daily-journal-oracle.js";

const currentDay: DailyJournalStatus = {
  publications: 0,
  manifests: 0,
  validatedManifests: 0,
  manifestFailures: 0,
  partialFiles: 0,
  unsafeLinks: 0,
  unsafeEntries: 0,
  bounded: true,
  inventoryEntries: 600,
  zoneId: "UTC",
  currentDate: "2026-10-18",
  eligiblePriorDayDirectories: 0,
  currentDayDirectories: 50,
  currentDayOpenSegments: 50,
  currentDaySealedSegments: 500,
  currentDayBytes: 64_000,
  journalIntegrityFailures: 0,
  openSegments: 50,
  sealedSegments: 500,
};

test("daily journal accepts a durable current day before its configured-zone publication boundary", () => {
  assert.deepEqual(assessDailyJournalStatus(currentDay), {
    passed: true,
    state: "publication-not-yet-eligible",
    explanation: "publication not yet eligible: no completed UTC day; 550 durable current-day segment(s) passed header and layout checks",
  });
});

test("daily journal requires an exact publication as soon as a prior day is eligible", () => {
  const eligible = {...currentDay, eligiblePriorDayDirectories: 1};
  assert.equal(assessDailyJournalStatus(eligible).passed, false);

  const published = {
    ...eligible,
    publications: 1,
    manifests: 1,
    validatedManifests: 1,
  };
  assert.deepEqual(assessDailyJournalStatus(published), {
    passed: true,
    state: "published",
    explanation: "1 exact daily CSV/manifest pair(s) validated",
  });
});

test("daily journal never hides invalid publications or unsafe current segments", () => {
  for (const value of [
    {...currentDay, manifests: 1},
    {...currentDay, journalIntegrityFailures: 1},
    {...currentDay, currentDayBytes: 100},
    {...currentDay, partialFiles: 1},
    {...currentDay, currentDayOpenSegments: 0, currentDaySealedSegments: 0},
  ]) assert.equal(assessDailyJournalStatus(value).passed, false);
});

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const shaC = "c".repeat(64);

function makeLaneState(
  segments: DirectJournalLaneState["segments"],
): DirectJournalLaneState {
  const bytes = segments.reduce((sum, s) => sum + s.bytes, 0);
  const openSegments = segments.filter(s => s.kind === "open").length;
  const sealedSegments = segments.filter(s => s.kind === "seg").length;
  return {
    directoryId: "urn_osh_system_lane_lane-50-deadbeefcafe",
    present: true,
    files: segments.length,
    bytes,
    openSegments,
    sealedSegments,
    partialFiles: 0,
    unsafeEntries: 0,
    segments,
  };
}

test("restart preservation accepts intact same-day segments and rejects same-day byte shrinkage", () => {
  const pre = makeLaneState([
    {path: "2026-10-28/000000.seg", kind: "seg", bytes: 1000, sha256: shaA},
    {path: "2026-11-27/000000.open", kind: "open", bytes: 500, sha256: shaB},
  ]);
  const postOk = makeLaneState([
    {path: "2026-10-28/000000.seg", kind: "seg", bytes: 1000, sha256: shaA},
    {path: "2026-11-27/000000.seg", kind: "seg", bytes: 500, sha256: shaB},
    {path: "2026-11-27/000001.open", kind: "open", bytes: 200, sha256: shaC},
  ]);
  assert.equal(directJournalRestartPreserved(pre, postOk), true);

  // Without a UTC calendar rollover, pruning 2026-10-28 must still fail.
  const postPrunedSameDay = makeLaneState([
    {path: "2026-11-27/000000.seg", kind: "seg", bytes: 500, sha256: shaB},
  ]);
  assert.equal(directJournalRestartPreserved(pre, postPrunedSameDay), false);
});

test("restart preservation tolerates UTC-midnight 30-day retention pruning of 31-day-old directories only", () => {
  const pre = makeLaneState([
    {path: "2026-10-28/000000.seg", kind: "seg", bytes: 13_696, sha256: shaA},
    {path: "2026-10-29/000000.seg", kind: "seg", bytes: 13_696, sha256: shaB},
    {path: "2026-11-27/000095.open", kind: "open", bytes: 7_692, sha256: shaC},
  ]);
  // After 00:00Z rollover to 2026-11-28, 2026-10-28 (31 days old) is pruned;
  // 2026-10-29 (30 days old) and newer remain intact.
  const postRollover = makeLaneState([
    {path: "2026-10-29/000000.seg", kind: "seg", bytes: 13_696, sha256: shaB},
    {path: "2026-11-27/000095.seg", kind: "seg", bytes: 7_692, sha256: shaC},
    {path: "2026-11-28/000000.open", kind: "open", bytes: 1_024, sha256: shaA},
  ]);
  assert.equal(directJournalRestartPreserved(pre, postRollover), true);

  // Losing 2026-10-29 (still within 30 days) or corrupting its hash must fail.
  const postLostRetainedDay = makeLaneState([
    {path: "2026-11-27/000095.seg", kind: "seg", bytes: 7_692, sha256: shaC},
    {path: "2026-11-28/000000.open", kind: "open", bytes: 50_000, sha256: shaA},
  ]);
  assert.equal(directJournalRestartPreserved(pre, postLostRetainedDay), false);

  const postCorruptedRetained = makeLaneState([
    {path: "2026-10-29/000000.seg", kind: "seg", bytes: 13_696, sha256: shaC},
    {path: "2026-11-27/000095.seg", kind: "seg", bytes: 7_692, sha256: shaC},
    {path: "2026-11-28/000000.open", kind: "open", bytes: 1_024, sha256: shaA},
  ]);
  assert.equal(directJournalRestartPreserved(pre, postCorruptedRetained), false);
});
