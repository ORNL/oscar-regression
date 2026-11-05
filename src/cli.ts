#!/usr/bin/env node
import {createHash} from "node:crypto";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {arch, hostname, platform, tmpdir} from "node:os";
import {join} from "node:path";
import {BrowserHarness} from "./browser.js";
import {assertMutationAllowed, loadConfig, requiresRemoteSuiteLease} from "./config.js";
import {RpmEmulatorClient} from "./emulator.js";
import {suiteGitCommit as resolveSuiteGitCommit} from "./git-state.js";
import {REQUIRED_OPERATIONAL_VIEW_KEYS} from "./lane-config.js";
import {MetricsSampler} from "./metrics.js";
import {RunReporter} from "./reporter.js";
import {validateRestoreEvidenceBundle} from "./release-certification.js";
import {RemoteSuiteLease} from "./remote-suite-lease.js";
import {RegressionScenarios} from "./scenarios.js";
import {describeError} from "./util.js";

function acquireFullRunLock(emulatorUrl: string, rpmId: string): {path: string; release: () => void} {
  const identity = createHash("sha256").update(`${emulatorUrl}\n${rpmId}`).digest("hex").slice(0, 16);
  const path = join(tmpdir(), `oscar-regression-${identity}.lock`);
  try {
    mkdirSync(path);
    writeFileSync(join(path, "owner.json"), `${JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}, null, 2)}\n`);
  } catch {
    throw new Error(
      `Another full regression may own ${rpmId}; verify emulator state, then remove stale lock ${path}`,
    );
  }
  return {path, release: () => rmSync(path, {recursive: true, force: true})};
}

function acquireRestoreRunLock(target: string, releaseDirectory: string): {path: string; release: () => void} {
  const identity = createHash("sha256").update(`${target}\n${releaseDirectory}`).digest("hex").slice(0, 16);
  const path = join(tmpdir(), `oscar-restore-drill-${identity}.lock`);
  try {
    mkdirSync(path);
    writeFileSync(join(path, "owner.json"), `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      target,
      releaseDirectory,
    }, null, 2)}\n`);
  } catch {
    throw new Error(
      `Another destructive restore drill may own ${target}:${releaseDirectory}; ` +
      `verify target state, then remove stale lock ${path}`,
    );
  }
  return {path, release: () => rmSync(path, {recursive: true, force: true})};
}

function runIdentifier(): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const host = hostname().toLowerCase().replaceAll(/[^a-z0-9-]+/g, "-").slice(0, 32);
  return `${stamp}-${host}`;
}

async function main(): Promise<number> {
  process.umask(0o077);
  const startedAt = new Date();
  const config = loadConfig();
  assertMutationAllowed(config);
  const suiteGitCommit = resolveSuiteGitCommit(config.profile);
  const isReleaseCertification =
    config.profile === "3.9.2-release" || config.profile === "3.11.0-release";
  const restoreEvidence = isReleaseCertification &&
      config.storageBackupMode === "single"
    ? validateRestoreEvidenceBundle(config.releaseRestoreEvidenceDirectory ?? "", {
      suiteGitCommit,
      oscarBuildLabel: config.oscarBuildLabel ?? "",
      oscarBaseUrl: config.oscarBaseUrl,
      oscarReleaseDirectory: config.oscarReleaseDirectory ?? "",
    })
    : undefined;
  const reporter = new RunReporter(runIdentifier(), config.resultsRoot, [config.oscarPassword], {
    suiteVersion: "1.1.0",
    suiteGitCommit,
    profile: config.profile,
    scenarioFilter: [...config.scenarioFilter].sort(),
    nodeVersion: process.version,
    platform: platform(),
    architecture: arch(),
    browser: config.browserExecutablePath ?? "playwright-managed-chromium",
    oscarBaseUrl: config.oscarBaseUrl,
    oscarBuildLabel: config.oscarBuildLabel ?? "unspecified",
    rpmEmulatorUrl: config.rpmEmulatorUrl,
    emulatorBuildLabel: config.emulatorBuildLabel ?? "unspecified",
    testRpmId: config.testRpmId,
    testLaneLabel: config.testLaneLabel,
    expectedLaneCount: config.expectedLaneCount,
    expectedCameraCount: config.expectedCameraCount,
    operationalViewWorkflow: config.operationalViewWorkflow,
    oscarLaneConfigPath: config.oscarLaneConfigPath,
    ...(config.laneConfigOracle ? {
      oscarLaneConfigSha256: config.laneConfigOracle.sha256,
      operationalViewLaneCounts: Object.fromEntries(
        (config.operationalViewWorkflow === "required"
          ? REQUIRED_OPERATIONAL_VIEW_KEYS
          : [...config.laneConfigOracle.lanesByView.keys()].sort())
          .map((key) => [key, config.laneConfigOracle?.lanesByView.get(key)?.length ?? 0]),
      ),
    } : {}),
    eventUuidWorkflow: config.eventUuidWorkflow,
    alarmTransferCameraWorkflow: config.alarmTransferCameraWorkflow,
    emlWorkflow: config.emlWorkflow,
    emlPluginConfigured: Boolean(config.emlPluginPath),
    storageWorkflow: config.storageWorkflow,
    storageExpectedRelease: config.storageExpectedRelease,
    storageBackupWorkflow: config.storageBackupWorkflow,
    storageBackupMode: config.storageBackupMode,
    storageProbeTimeoutMs: config.storageProbeTimeoutMs,
    storageRestoreProbeTimeoutMs: config.storageRestoreProbeTimeoutMs,
    ...(config.oscarReleaseDirectory
      ? {oscarReleaseDirectory: config.oscarReleaseDirectory} : {}),
    ...(config.releaseRestoreEvidenceDirectory
      ? {releaseRestoreEvidenceDirectory: config.releaseRestoreEvidenceDirectory} : {}),
    ...(restoreEvidence ? {
      releaseRestoreEvidenceRunId: restoreEvidence.runId,
      releaseRestoreEvidenceBackupId: restoreEvidence.backupId,
    } : {}),
    ...(config.storageRetainedEventId
      ? {storageRetainedEventId: config.storageRetainedEventId} : {}),
    ...(config.storageLegacyEventId
      ? {storageLegacyEventId: config.storageLegacyEventId} : {}),
    ...(config.storageEventNodeId
      ? {storageEventNodeId: config.storageEventNodeId} : {}),
    remoteMetricsExpected: Boolean(config.oscarSshTarget),
  });
  const emulator = new RpmEmulatorClient(config.rpmEmulatorUrl);
  const browser = new BrowserHarness(config, reporter);
  const metrics = new MetricsSampler(config, reporter);
  const scenarios = new RegressionScenarios(config, reporter, browser, emulator, metrics);
  let interrupted = false;
  const mutationRunLock = config.profile === "full" || isReleaseCertification
    ? acquireFullRunLock(config.rpmEmulatorUrl, config.testRpmId)
    : config.profile === "restore-drill"
      ? acquireRestoreRunLock(config.targetHost, config.oscarReleaseDirectory ?? "missing")
      : undefined;
  const remoteLease = requiresRemoteSuiteLease(config)
    ? new RemoteSuiteLease({
      oscarSshTarget: config.oscarSshTarget ?? "",
      oscarReleaseDirectory: config.oscarReleaseDirectory ?? "",
      ...(config.sshIdentityFile ? {sshIdentityFile: config.sshIdentityFile} : {}),
    })
    : undefined;

  const handleSignal = (signal: NodeJS.Signals) => {
    interrupted = true;
    reporter.error("harness", "signal", `${signal} received; cleanup requested`, "", "warning");
    void browser.stop();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  scenarios.setStopRequested(() => interrupted);

  try {
    await remoteLease?.acquire();
    await metrics.start();
    if (config.profile === "restore-drill") {
      await scenarios.runRestoreDrill();
    } else {
      await browser.start();
      await scenarios.runReadOnly();
      if ((config.profile === "full" || isReleaseCertification) && !interrupted) {
        await scenarios.runFull();
      }
    }
  } catch (error) {
    reporter.error("harness", "runner", error);
    reporter.outcome(
      "harness", "harness", "complete regression run", config.targetHost,
      "all selected scenarios execute", "runner terminated early", "incorrect", 0, "", describeError(error),
    );
  } finally {
    if (interrupted) await scenarios.emergencyCleanup().catch((error) => reporter.error("harness", "signal-cleanup", error));
    await metrics.stop().catch((error) => reporter.error("harness", "metrics-stop", error, "", "warning"));
    await browser.stop().catch((error) => reporter.error("harness", "browser-stop", error, "", "warning"));
    await remoteLease?.release().catch(error => {
      reporter.error("harness", "remote-suite-lease-release", error);
      reporter.outcome(
        "harness", "safety", "release remote suite lease", config.targetHost,
        "the host-wide mutation lease is released cleanly", "lease release failed",
        "incorrect", 0, "", describeError(error),
      );
    });
    mutationRunLock?.release();
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  }

  const result = reporter.finalize(startedAt);
  process.stdout.write(`OSCAR regression results: ${result.outputDir}\n`);
  return interrupted ? 130 : result.exitCode;
}

main()
  .then((exitCode) => { process.exitCode = exitCode; })
  .catch((error) => {
    process.stderr.write(`OSCAR regression failed to initialize: ${describeError(error)}\n`);
    process.exitCode = 2;
  });
