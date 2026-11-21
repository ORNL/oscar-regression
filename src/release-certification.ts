import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {isAbsolute, join, normalize, resolve} from "node:path";
import type {RestoreDrillCertification} from "./types.js";

const BACKUP_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/;

export interface ReleaseCertificationIdentity {
  suiteGitCommit: string;
  oscarBuildLabel: string;
  oscarBaseUrl: string;
  oscarReleaseDirectory: string;
}

export type RestoreEvidenceAttestation = RestoreDrillCertification;

export interface ValidatedRestoreEvidence {
  directory: string;
  runId: string;
  backupId: string;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireRegularFile(path: string, maximumBytes: number): void {
  const identity = lstatSync(path);
  if (!identity.isFile() || identity.isSymbolicLink()) {
    throw new Error(`Certification evidence is not a regular no-link file: ${path}`);
  }
  const size = statSync(path).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > maximumBytes) {
    throw new Error(`Certification evidence has an invalid bounded size: ${path}`);
  }
}

/** Validate that a prior destructive drill is a successful match for this release candidate. */
export function validateRestoreEvidenceBundle(
  requestedDirectory: string,
  expected: ReleaseCertificationIdentity,
): ValidatedRestoreEvidence {
  if (!isAbsolute(requestedDirectory) || requestedDirectory.includes("\0")) {
    throw new Error("OSCAR_3_9_2_RESTORE_EVIDENCE_DIR must be an absolute path");
  }
  const canonical = realpathSync(requestedDirectory);
  if (canonical !== normalize(resolve(requestedDirectory))) {
    throw new Error("Restore evidence directory must be canonical and must not traverse links");
  }
  const directoryIdentity = lstatSync(canonical);
  if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) {
    throw new Error("Restore evidence directory must be a real directory");
  }

  const runPath = join(canonical, "run.json");
  requireRegularFile(runPath, 1024 * 1024);
  for (const name of [
    "functional-results.csv",
    "errors.csv",
    "performance.csv",
    "storage-performance.csv",
    "summary.csv",
    "summary.md",
  ]) requireRegularFile(join(canonical, name), 64 * 1024 * 1024);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(runPath, "utf8"));
  } catch (error) {
    throw new Error("Restore evidence run.json is not valid JSON", {cause: error});
  }
  const run = record(parsed, "restore evidence run.json");
  const environment = record(run.environment, "restore evidence environment");
  const counts = record(run.counts, "restore evidence counts");
  const attestation = record(
    environment.restoreDrillCertification,
    "restore evidence attestation",
  );

  if (run.schemaVersion !== 2 || run.status !== "PASS" ||
      typeof run.runId !== "string" || !RUN_ID_PATTERN.test(run.runId)) {
    throw new Error("Restore evidence is not a successful schema-2 run");
  }
  if (counts.incorrect !== 0 || counts.skipped !== 0 ||
      !Number.isSafeInteger(counts.correct) || Number(counts.correct) < 3) {
    throw new Error("Restore evidence contains failed, skipped, or incomplete checks");
  }
  if (environment.profile !== "restore-drill" ||
      !Array.isArray(environment.scenarioFilter) || environment.scenarioFilter.length !== 0) {
    throw new Error("Restore evidence must be an unfiltered restore-drill profile");
  }
  if (typeof environment.storageExpectedRelease !== "string" ||
      !/^3\.11\.\d+$/.test(environment.storageExpectedRelease) ||
      environment.storageWorkflow !== "required" ||
      environment.storageBackupWorkflow !== "required" ||
      environment.storageBackupMode !== "single") {
    throw new Error("Restore evidence did not run all required 3.9.2 storage gates");
  }
  for (const [field, actual, wanted] of [
    ["suiteGitCommit", environment.suiteGitCommit, expected.suiteGitCommit],
    ["oscarBuildLabel", environment.oscarBuildLabel, expected.oscarBuildLabel],
    ["oscarBaseUrl", environment.oscarBaseUrl, expected.oscarBaseUrl],
    ["oscarReleaseDirectory", environment.oscarReleaseDirectory, expected.oscarReleaseDirectory],
  ] as const) {
    if (typeof wanted !== "string" || !wanted || actual !== wanted) {
      throw new Error(`Restore evidence ${field} does not match this release candidate`);
    }
  }
  if (attestation.schemaVersion !== 2 ||
      typeof attestation.backupId !== "string" ||
      !BACKUP_ID_PATTERN.test(attestation.backupId) ||
      attestation.authenticatedBackupReverified !== true ||
      attestation.allCanariesRestored !== true ||
      attestation.immutableImageIdentityPreserved !== true ||
      attestation.preRestoreSafetyCopyVerified !== true) {
    throw new Error("Restore evidence has no complete release attestation");
  }
  return {directory: canonical, runId: run.runId, backupId: attestation.backupId};
}
