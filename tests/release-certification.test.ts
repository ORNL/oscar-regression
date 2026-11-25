import assert from "node:assert/strict";
import {mkdtempSync, realpathSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {validateRestoreEvidenceBundle} from "../src/release-certification.js";

const identity = {
  suiteGitCommit: "abc123",
  oscarBuildLabel: "oscar-3.9.2-build-7",
  oscarBaseUrl: "https://oscar.test",
  oscarReleaseDirectory: "/srv/oscar/3.9.2",
};

function evidenceBundle(overrides: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "oscar-restore-evidence-"));
  for (const name of [
    "functional-results.csv", "errors.csv", "performance.csv", "storage-performance.csv",
    "summary.csv", "summary.md",
  ]) writeFileSync(join(root, name), "evidence\n", {mode: 0o600});
  const run = {
    schemaVersion: 2,
    runId: "2026-10-18-restore",
    status: "PASS",
    counts: {correct: 3, incorrect: 0, skipped: 0},
    environment: {
      ...identity,
      profile: "restore-drill",
      scenarioFilter: [],
      storageExpectedRelease: "3.11.0",
      storageWorkflow: "required",
      storageBackupWorkflow: "required",
      storageBackupMode: "single",
      restoreDrillCertification: {
        schemaVersion: 2,
        backupId: "20261018T120000Z-0123abcd",
        authenticatedBackupReverified: true,
        allCanariesRestored: true,
        immutableImageIdentityPreserved: true,
        preRestoreSafetyCopyVerified: true,
      },
    },
    ...overrides,
  };
  writeFileSync(join(root, "run.json"), `${JSON.stringify(run)}\n`, {mode: 0o600});
  return realpathSync(root);
}

test("release certification accepts only a matching complete restore bundle", () => {
  const root = evidenceBundle();
  const result = validateRestoreEvidenceBundle(root, identity);
  assert.equal(result.backupId, "20261018T120000Z-0123abcd");
  assert.equal(result.runId, "2026-10-18-restore");
});

test("release certification rejects mismatched build identity", () => {
  const root = evidenceBundle();
  assert.throws(
    () => validateRestoreEvidenceBundle(root, {...identity, oscarBuildLabel: "other-build"}),
    /oscarBuildLabel does not match/,
  );
});

test("release certification rejects filtered, skipped, or incomplete restore evidence", () => {
  const filtered = evidenceBundle({
    counts: {correct: 3, incorrect: 0, skipped: 0},
    environment: {
      ...identity,
      profile: "restore-drill",
      scenarioFilter: ["storage-restore-drill"],
      storageExpectedRelease: "3.11.0",
      storageWorkflow: "required",
      storageBackupWorkflow: "required",
      storageBackupMode: "single",
      restoreDrillCertification: {
        schemaVersion: 2,
        backupId: "20261018T120000Z-0123abcd",
        authenticatedBackupReverified: true,
        allCanariesRestored: true,
        immutableImageIdentityPreserved: true,
        preRestoreSafetyCopyVerified: true,
      },
    },
  });
  assert.throws(() => validateRestoreEvidenceBundle(filtered, identity), /unfiltered/);

  const skipped = evidenceBundle({counts: {correct: 3, incorrect: 0, skipped: 1}});
  assert.throws(() => validateRestoreEvidenceBundle(skipped, identity), /failed, skipped, or incomplete/);
});

test("release certification accepts 3.12.0 restore evidence and rejects unsupported major/minor series", () => {
  const v312 = evidenceBundle({
    environment: {
      ...identity,
      profile: "restore-drill",
      scenarioFilter: [],
      storageExpectedRelease: "3.12.0",
      storageWorkflow: "required",
      storageBackupWorkflow: "required",
      storageBackupMode: "single",
      restoreDrillCertification: {
        schemaVersion: 2,
        backupId: "20261125T120000Z-89abcdef",
        authenticatedBackupReverified: true,
        allCanariesRestored: true,
        immutableImageIdentityPreserved: true,
        preRestoreSafetyCopyVerified: true,
      },
    },
  });
  const validated = validateRestoreEvidenceBundle(v312, identity);
  assert.equal(validated.backupId, "20261125T120000Z-89abcdef");

  const v310 = evidenceBundle({
    environment: {
      ...identity,
      profile: "restore-drill",
      scenarioFilter: [],
      storageExpectedRelease: "3.10.0",
      storageWorkflow: "required",
      storageBackupWorkflow: "required",
      storageBackupMode: "single",
      restoreDrillCertification: {
        schemaVersion: 2,
        backupId: "20261125T120000Z-89abcdef",
        authenticatedBackupReverified: true,
        allCanariesRestored: true,
        immutableImageIdentityPreserved: true,
        preRestoreSafetyCopyVerified: true,
      },
    },
  });
  assert.throws(() => validateRestoreEvidenceBundle(v310, identity), /did not run all required/);
});
