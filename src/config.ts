import {existsSync, mkdirSync, readFileSync, statSync} from "node:fs";
import {isAbsolute, posix, resolve} from "node:path";
import {assertCanonicalOperationalViewOracle, loadLaneConfigOracle} from "./lane-config.js";
import {publicObservationId} from "./public-observation-id.js";
import type {BackupMode, CapabilityMode, Profile, SuiteConfig} from "./types.js";

// A newly restarted emulator can enter OCCUPIED before OSCAR's prior socket
// reaches its heartbeat timeout and reconnects.  The Viewer deliberately uses
// the first occupancy sample OSCAR actually observes as its start time, and its
// default fault threshold is strictly greater than 60 seconds.  Budget the
// emulator's complete 60-second reconnect allowance plus a 30-second window in
// which both Health and Dashboard can observe the post-threshold state.
export const EXTENDED_OCCUPANCY_THRESHOLD_SECONDS = 60;
export const EXTENDED_OCCUPANCY_RECONNECT_ALLOWANCE_SECONDS = 60;
export const EXTENDED_OCCUPANCY_OBSERVATION_WINDOW_SECONDS = 30;
export const MIN_EXTENDED_OCCUPANCY_SECONDS =
  EXTENDED_OCCUPANCY_THRESHOLD_SECONDS +
  EXTENDED_OCCUPANCY_RECONNECT_ALLOWANCE_SECONDS +
  EXTENDED_OCCUPANCY_OBSERVATION_WINDOW_SECONDS;

function loadDotEnv(path = resolve(".env")): void {
  try {
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function serviceUrl(name: string, requireHttps = false): {value: string; parsed: URL} {
  const value = required(name).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!parsed.hostname) throw new Error(`${name} must include a host`);
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not include embedded credentials`);
  }
  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error(`${name} must use https`);
  }
  return {value, parsed};
}

function integer(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole-number integer`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

function boundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = integer(name, fallback, minimum);
  if (value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

function capabilityMode(name: string, fallback: CapabilityMode): CapabilityMode {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["auto", "required", "disabled"].includes(raw)) {
    return raw as CapabilityMode;
  }
  throw new Error(`${name} must be auto, required, or disabled`);
}

function backupMode(name: string, fallback: BackupMode): BackupMode {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (raw === "disabled" || raw === "single") return raw;
  throw new Error(`${name} must be the literal lowercase value disabled or single`);
}

function remoteAbsolutePath(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!value.startsWith("/") || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be an absolute remote POSIX path without control characters`);
  }
  if (value.split("/").includes("..")) {
    throw new Error(`${name} must not contain parent-directory segments`);
  }
  return value.replace(/\/+$/, "") || "/";
}

function canonicalReleasePath(name: string): string | undefined {
  const value = remoteAbsolutePath(name);
  if (value === undefined) return undefined;
  if (value === "/" || posix.normalize(value) !== value || !/^\/[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`${name} must be a canonical, non-root absolute POSIX path using safe path characters`);
  }
  return value;
}

function canonicalRestorePath(name: string): string | undefined {
  const value = remoteAbsolutePath(name);
  if (value === undefined) return undefined;
  if (value === "/" || posix.normalize(value) !== value || !/^\/[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`${name} must be a canonical, non-root absolute POSIX path using safe path characters`);
  }
  return value;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

interface ParsedArguments {
  profile?: string;
  scenario?: string;
}

function parseArguments(args: string[]): ParsedArguments {
  const values = new Map<string, string>();
  const supported = new Set(["--profile", "--scenario"]);

  for (let index = 0; index < args.length; index++) {
    const flag = args[index] ?? "";
    if (!supported.has(flag)) {
      if (flag.startsWith("-")) throw new Error(`Unknown argument ${flag}`);
      throw new Error(`Unexpected positional argument ${flag}`);
    }
    if (values.has(flag)) throw new Error(`Duplicate argument ${flag}`);

    const rawValue = args[index + 1];
    if (rawValue === undefined || rawValue.startsWith("-") || !rawValue.trim()) {
      throw new Error(`${flag} requires a non-empty value`);
    }
    values.set(flag, rawValue.trim());
    index++;
  }

  const profile = values.get("--profile");
  const scenario = values.get("--scenario");
  return {
    ...(profile === undefined ? {} : {profile}),
    ...(scenario === undefined ? {} : {scenario}),
  };
}

export function loadConfig(args = process.argv.slice(2)): SuiteConfig {
  loadDotEnv();
  const parsedArguments = parseArguments(args);
  const profileRaw = parsedArguments.profile ?? "smoke";
  if (profileRaw !== "smoke" && profileRaw !== "full" &&
      profileRaw !== "3.9.2-release" && profileRaw !== "3.11.0-release" &&
      profileRaw !== "restore-drill") {
    throw new Error("--profile must be smoke, full, 3.9.2-release, 3.11.0-release, or restore-drill");
  }
  const profile: Profile = profileRaw;
  const {value: oscarBaseUrl, parsed} = serviceUrl("OSCAR_BASE_URL", true);
  const {value: rpmEmulatorUrl, parsed: rpmParsed} = serviceUrl("RPM_EMULATOR_URL");
  const resultsRoot = resolve(process.env.RESULTS_ROOT?.trim() || "results");
  mkdirSync(resultsRoot, {recursive: true});
  const expectedLaneCount = integer("EXPECTED_LANE_COUNT", 50, 1);
  const operationalViewWorkflow = capabilityMode("OPERATIONAL_VIEW_WORKFLOW", "required");
  const oscarLaneConfigPath = resolve(
    process.env.OSCAR_LANE_CONFIG_PATH?.trim() || "fixtures/oscar-50-lane-config.csv",
  );
  const laneConfigOracle = operationalViewWorkflow === "disabled"
    ? undefined
    : loadLaneConfigOracle(oscarLaneConfigPath);
  if (operationalViewWorkflow === "required" && laneConfigOracle) {
    assertCanonicalOperationalViewOracle(laneConfigOracle, expectedLaneCount);
  }

  const scenarioValues = parsedArguments.scenario === undefined
    ? []
    : parsedArguments.scenario.split(",").map((value) => value.trim());
  if (scenarioValues.some((value) => !value)) {
    throw new Error("--scenario requires non-empty comma-separated scenario names");
  }
  const knownScenarios = new Set([
    "preflight", "viewer-navigation", "map-national-servers", "sensorhub-admin",
    "status-of-health", "dashboard-health", "lane-video", "event-filtering", "operational-views",
    "reporting", "alarm-transfer", "alarm-transfer-camera", "rpm-connection", "rpm-faults", "rpm-alarms",
    "event-uuid", "adjudication", "eml-auto-adjudication", "extended-occupancy", "adjudication-report",
    "storage-health", "storage-lifecycle",
    "storage-restore-drill",
  ]);
  const unknownScenarios = scenarioValues.filter((value) => !knownScenarios.has(value));
  if (unknownScenarios.length) {
    throw new Error(`Unknown --scenario value(s): ${unknownScenarios.join(", ")}`);
  }
  if (profile === "restore-drill" &&
      (scenarioValues.length > 1 || (scenarioValues.length === 1 && scenarioValues[0] !== "storage-restore-drill"))) {
    throw new Error("--profile restore-drill may run only storage-restore-drill");
  }
  if (profile !== "restore-drill" && scenarioValues.includes("storage-restore-drill")) {
    throw new Error("storage-restore-drill requires --profile restore-drill");
  }
  const isReleaseCertification = profile === "3.9.2-release" || profile === "3.11.0-release";
  if (isReleaseCertification && scenarioValues.length > 0) {
    throw new Error(`--profile ${profile} must be an unfiltered full certification run`);
  }
  const oscarReleaseDirectory = canonicalReleasePath("OSCAR_RELEASE_DIR");
  const restoreArchiveDirectory = canonicalRestorePath("OSCAR_RESTORE_ARCHIVE_DIR");
  const restoreBackupDirectory = canonicalRestorePath("OSCAR_RESTORE_BACKUP_DIR");
  const eventUuidWorkflow = capabilityMode("EVENT_UUID_WORKFLOW", "auto");
  const alarmTransferCameraWorkflow = capabilityMode("ALARM_TRANSFER_CAMERA_WORKFLOW", "auto");
  const emlWorkflow = capabilityMode("EML_WORKFLOW", "auto");
  const emlPluginRaw = process.env.OSCAR_EML_PLUGIN_PATH?.trim();
  let emlPluginPath: string | undefined;
  if (emlPluginRaw) {
    if (/[\0\r\n]/.test(emlPluginRaw)) {
      throw new Error("OSCAR_EML_PLUGIN_PATH must not contain control characters");
    }
    const resolvedEml = resolve(emlPluginRaw);
    if (!/\.(?:jar|tar\.gz|tgz|zip)$/i.test(resolvedEml)) {
      throw new Error("OSCAR_EML_PLUGIN_PATH must end with .jar, .tar.gz, .tgz, or .zip");
    }
    if (!existsSync(resolvedEml) || !statSync(resolvedEml).isFile()) {
      throw new Error(`OSCAR_EML_PLUGIN_PATH does not point to an existing regular file: ${resolvedEml}`);
    }
    emlPluginPath = resolvedEml;
  }
  if (emlWorkflow === "required" && !emlPluginPath) {
    throw new Error("EML_WORKFLOW=required requires OSCAR_EML_PLUGIN_PATH");
  }
  const storageWorkflow = capabilityMode("STORAGE_WORKFLOW", "required");
  const storageBackupWorkflow = capabilityMode("STORAGE_BACKUP_WORKFLOW", "auto");
  const storageBackupMode = backupMode("OSCAR_BACKUP_MODE", "disabled");
  const oscarBuildLabel = process.env.OSCAR_BUILD_LABEL?.trim();
  const releaseRestoreEvidenceDirectory =
    process.env.OSCAR_3_11_0_RESTORE_EVIDENCE_DIR?.trim() ||
    process.env.OSCAR_3_9_2_RESTORE_EVIDENCE_DIR?.trim();
  if (releaseRestoreEvidenceDirectory &&
      (!isAbsolute(releaseRestoreEvidenceDirectory) || /[\0\r\n]/.test(releaseRestoreEvidenceDirectory))) {
    throw new Error("OSCAR_3_11_0_RESTORE_EVIDENCE_DIR / OSCAR_3_9_2_RESTORE_EVIDENCE_DIR must be an absolute local path without control characters");
  }
  if (isReleaseCertification) {
    if (operationalViewWorkflow !== "required" || eventUuidWorkflow !== "required" ||
        alarmTransferCameraWorkflow !== "required" || storageWorkflow !== "required" ||
        storageBackupWorkflow !== "required" ||
        (profile === "3.11.0-release" && emlWorkflow !== "required")) {
      throw new Error(
        `${profile} requires operational-view, UUID, camera, storage, backup${profile === "3.11.0-release" ? ", and EML" : ""} workflows to be required`,
      );
    }
    if (!oscarBuildLabel) throw new Error(`${profile} requires OSCAR_BUILD_LABEL`);
    if (storageBackupMode === "single" && !releaseRestoreEvidenceDirectory) {
      throw new Error(`${profile} requires OSCAR_3_11_0_RESTORE_EVIDENCE_DIR or OSCAR_3_9_2_RESTORE_EVIDENCE_DIR`);
    }
  }

  const retainedEventId = process.env.STORAGE_RETAINED_EVENT_ID?.trim();
  const legacyEventId = process.env.STORAGE_LEGACY_EVENT_ID?.trim();
  if (retainedEventId) publicObservationId(retainedEventId, "STORAGE_RETAINED_EVENT_ID");
  if (legacyEventId) publicObservationId(legacyEventId, "STORAGE_LEGACY_EVENT_ID");

  return {
    profile,
    oscarBaseUrl,
    oscarUsername: required("OSCAR_USERNAME"),
    oscarPassword: required("OSCAR_PASSWORD"),
    targetHost: parsed.hostname,
    targetAcknowledgement: required("OSCAR_TEST_TARGET_ACK"),
    rpmEmulatorUrl,
    rpmEmulatorHost: rpmParsed.hostname,
    rpmEmulatorAcknowledgement: process.env.RPM_EMULATOR_TARGET_ACK?.trim() || "",
    rpmLaneMappingAcknowledgement: process.env.RPM_LANE_MAPPING_ACK?.trim() || "",
    testRpmId: process.env.TEST_RPM_ID?.trim() || "rpm-50",
    testLaneLabel: process.env.TEST_LANE_LABEL?.trim() || "Lane50",
    expectedLaneCount,
    expectedCameraCount: integer(
      "EXPECTED_CAMERA_COUNT",
      laneConfigOracle?.configuredCameraCount ?? expectedLaneCount,
      0,
    ),
    operationalViewWorkflow,
    oscarLaneConfigPath,
    ...(laneConfigOracle ? {laneConfigOracle} : {}),
    ...(process.env.OSCAR_SSH_TARGET?.trim()
      ? {oscarSshTarget: process.env.OSCAR_SSH_TARGET.trim()} : {}),
    ...(process.env.OSCAR_SSH_IDENTITY_FILE?.trim()
      ? {sshIdentityFile: process.env.OSCAR_SSH_IDENTITY_FILE.trim()} : {}),
    ...(process.env.BROWSER_EXECUTABLE_PATH?.trim()
      ? {browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH.trim()} : {}),
    ...(oscarBuildLabel ? {oscarBuildLabel} : {}),
    ...(process.env.EMULATOR_BUILD_LABEL?.trim()
      ? {emulatorBuildLabel: process.env.EMULATOR_BUILD_LABEL.trim()} : {}),
    headless: boolean("HEADLESS", true),
    metricsIntervalMs: integer("METRICS_INTERVAL_MS", 5_000, 1_000),
    uiTimeoutMs: integer("UI_TIMEOUT_MS", 30_000, 1_000),
    eventTimeoutMs: integer("EVENT_TIMEOUT_MS", 90_000, 10_000),
    extendedOccupancySeconds: integer(
      "EXTENDED_OCCUPANCY_SECONDS",
      MIN_EXTENDED_OCCUPANCY_SECONDS,
      MIN_EXTENDED_OCCUPANCY_SECONDS,
    ),
    eventUuidWorkflow,
    alarmTransferCameraWorkflow,
    emlWorkflow,
    ...(emlPluginPath ? {emlPluginPath} : {}),
    storageWorkflow,
    storageExpectedRelease: "3.11.0",
    storageBackupWorkflow,
    storageBackupMode,
    storageTargetAcknowledgement: process.env.OSCAR_STORAGE_TARGET_ACK?.trim() || "",
    restoreTargetAcknowledgement: process.env.OSCAR_RESTORE_TARGET_ACK?.trim() || "",
    restoreDisposableAcknowledgement: process.env.OSCAR_RESTORE_DISPOSABLE_ACK?.trim() || "",
    restoreDataLossAcknowledgement: process.env.OSCAR_RESTORE_DATA_LOSS_ACK?.trim() || "",
    restorePathsAcknowledgement: process.env.OSCAR_RESTORE_PATHS_ACK?.trim() || "",
    ...(restoreArchiveDirectory ? {restoreArchiveDirectory} : {}),
    ...(restoreBackupDirectory ? {restoreBackupDirectory} : {}),
    ...(oscarReleaseDirectory ? {oscarReleaseDirectory} : {}),
    ...(releaseRestoreEvidenceDirectory ? {releaseRestoreEvidenceDirectory} : {}),
    ...(retainedEventId ? {storageRetainedEventId: retainedEventId} : {}),
    ...(legacyEventId ? {storageLegacyEventId: legacyEventId} : {}),
    ...(process.env.STORAGE_EVENT_NODE_ID?.trim()
      ? {storageEventNodeId: process.env.STORAGE_EVENT_NODE_ID.trim()} : {}),
    storageDatabaseScope: integer("STORAGE_DATABASE_SCOPE", 4, 0),
    storageHotRetentionDays: integer("STORAGE_HOT_RETENTION_DAYS", 1, 1),
    storageArchiveTimeoutMs: integer("STORAGE_ARCHIVE_TIMEOUT_MS", 2_700_000, 60_000),
    storageProbeTimeoutMs: integer("STORAGE_PROBE_TIMEOUT_MS", 1_800_000, 60_000),
    storageRestoreProbeTimeoutMs: boundedInteger(
      "STORAGE_RESTORE_PROBE_TIMEOUT_MS",
      7_200_000,
      600_000,
      28_800_000,
    ),
    resultsRoot,
    scenarioFilter: new Set(scenarioValues),
  };
}

export function assertMutationAllowed(config: SuiteConfig): void {
  if (config.targetAcknowledgement !== config.targetHost) {
    throw new Error(`Regression refused: OSCAR_TEST_TARGET_ACK must exactly equal ${config.targetHost}`);
  }
  if (config.profile === "restore-drill") {
    if (["localhost", "127.0.0.1", "::1"].includes(config.targetHost)) {
      throw new Error("Restore drill refused for a loopback target");
    }
    if (config.storageWorkflow !== "required") {
      throw new Error("Restore drill refused: STORAGE_WORKFLOW must be required");
    }
    if (config.storageBackupWorkflow !== "required") {
      throw new Error("Restore drill refused: STORAGE_BACKUP_WORKFLOW must be required");
    }
    if (config.storageBackupMode !== "single") {
      throw new Error("Restore drill refused: OSCAR_BACKUP_MODE must be single");
    }
    if (!config.oscarSshTarget || !config.oscarReleaseDirectory) {
      throw new Error("Restore drill refused: OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR are required");
    }
    if (!config.restoreArchiveDirectory || !config.restoreBackupDirectory) {
      throw new Error(
        "Restore drill refused: OSCAR_RESTORE_ARCHIVE_DIR and OSCAR_RESTORE_BACKUP_DIR are required",
      );
    }
    const restorePaths = [
      config.restoreArchiveDirectory,
      config.restoreBackupDirectory,
    ];
    if (restorePaths.some((path, index) => restorePaths.slice(index + 1).some(other => pathsOverlap(path, other)))) {
      throw new Error("Restore drill refused: archive and backup directories must be distinct, non-overlapping planes");
    }
    const storageAcknowledgement =
      `${config.targetHost}|${config.oscarSshTarget}|${config.oscarReleaseDirectory}|DISPOSABLE-STORAGE`;
    if (config.storageTargetAcknowledgement !== storageAcknowledgement) {
      throw new Error(
        `Restore drill refused: OSCAR_STORAGE_TARGET_ACK must exactly equal ${storageAcknowledgement}`,
      );
    }
    const targetAcknowledgement =
      `${config.targetHost}|${config.oscarSshTarget}|${config.oscarReleaseDirectory}|ISOLATED-RESTORE`;
    if (config.restoreTargetAcknowledgement !== targetAcknowledgement) {
      throw new Error(
        `Restore drill refused: OSCAR_RESTORE_TARGET_ACK must exactly equal ${targetAcknowledgement}`,
      );
    }
    const disposableAcknowledgement = `${config.targetHost}:DISPOSABLE-NO-PRODUCTION-DATA`;
    if (config.restoreDisposableAcknowledgement !== disposableAcknowledgement) {
      throw new Error(
        `Restore drill refused: OSCAR_RESTORE_DISPOSABLE_ACK must exactly equal ${disposableAcknowledgement}`,
      );
    }
    if (config.restoreDataLossAcknowledgement !== "I-ACCEPT-DESTRUCTIVE-RESTORE") {
      throw new Error(
        "Restore drill refused: OSCAR_RESTORE_DATA_LOSS_ACK must exactly equal I-ACCEPT-DESTRUCTIVE-RESTORE",
      );
    }
    const pathsAcknowledgement =
      `${config.restoreArchiveDirectory}|${config.restoreBackupDirectory}|DEDICATED-RESTORE-PATHS`;
    if (config.restorePathsAcknowledgement !== pathsAcknowledgement) {
      throw new Error(
        `Restore drill refused: OSCAR_RESTORE_PATHS_ACK must exactly equal ${pathsAcknowledgement}`,
      );
    }
    return;
  }
  if (requiresRemoteSuiteLease(config) &&
      (!config.oscarSshTarget || !config.oscarReleaseDirectory)) {
    throw new Error(
      "Regression refused: every mutating run requires OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR for the remote suite lease",
    );
  }
  const storageSelected = config.storageWorkflow !== "disabled" &&
    (config.scenarioFilter.size === 0 || config.scenarioFilter.has("storage-health") ||
      config.scenarioFilter.has("storage-lifecycle"));
  if (storageSelected) {
    if (!config.oscarSshTarget || !config.oscarReleaseDirectory) {
      if (config.storageWorkflow !== "auto") {
        throw new Error(
          "Storage regression refused: OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR are required",
        );
      }
    } else {
      const acknowledgement =
        `${config.targetHost}|${config.oscarSshTarget}|${config.oscarReleaseDirectory}|DISPOSABLE-STORAGE`;
      if (config.storageTargetAcknowledgement !== acknowledgement) {
        throw new Error(
          `Storage regression refused: OSCAR_STORAGE_TARGET_ACK must exactly equal ${acknowledgement}`,
        );
      }
    }
  }

  if (config.profile !== "full" && config.profile !== "3.9.2-release" && config.profile !== "3.11.0-release") return;
  if (["localhost", "127.0.0.1", "::1"].includes(config.targetHost)) {
    throw new Error("Full regression refused for a loopback target");
  }
  if (!config.oscarSshTarget || !config.oscarReleaseDirectory) {
    throw new Error(
      "Full regression refused: OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR are required for the remote suite lease",
    );
  }
  if (config.rpmEmulatorAcknowledgement !== config.rpmEmulatorHost) {
    throw new Error(
      `Full regression refused: RPM_EMULATOR_TARGET_ACK must exactly equal ${config.rpmEmulatorHost}`,
    );
  }
  const expectedMapping = `${config.testRpmId}:${config.testLaneLabel}`;
  if (config.rpmLaneMappingAcknowledgement !== expectedMapping) {
    throw new Error(
      `Full regression refused: RPM_LANE_MAPPING_ACK must exactly equal ${expectedMapping}`,
    );
  }

  const lifecycleSelected = config.storageWorkflow !== "disabled" &&
    (config.scenarioFilter.size === 0 || config.scenarioFilter.has("storage-lifecycle"));
  if (lifecycleSelected) {
    if (!config.oscarSshTarget || !config.oscarReleaseDirectory) {
      if (config.storageWorkflow === "auto") return;
      throw new Error(
        "Full storage regression refused: OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR are required",
      );
    }
    const acknowledgement =
      `${config.targetHost}|${config.oscarSshTarget}|${config.oscarReleaseDirectory}|DISPOSABLE-STORAGE`;
    if (config.storageTargetAcknowledgement !== acknowledgement) {
      throw new Error(
        `Full storage regression refused: OSCAR_STORAGE_TARGET_ACK must exactly equal ${acknowledgement}`,
      );
    }
  }
}

/** Whether this invocation can mutate shared OSCAR or emulator state. */
export function requiresRemoteSuiteLease(config: SuiteConfig): boolean {
  if (["full", "3.9.2-release", "3.11.0-release", "restore-drill"].includes(config.profile)) return true;
  if (config.scenarioFilter.size === 0) return true;
  if (["map-national-servers", "lane-video", "reporting", "eml-auto-adjudication"].some(
    name => config.scenarioFilter.has(name),
  )) {
    return true;
  }
  return config.storageWorkflow !== "disabled" &&
    (config.scenarioFilter.has("storage-health") || config.scenarioFilter.has("storage-lifecycle"));
}
