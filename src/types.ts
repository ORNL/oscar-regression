import type {LaneConfigOracle} from "./lane-config.js";

export type Profile = "smoke" | "full" | "3.9.2-release" | "3.11.0-release" | "restore-drill";

export type CapabilityMode = "auto" | "required" | "disabled";

export type BackupMode = "disabled" | "single";

export type ResultStatus = "correct" | "incorrect" | "skipped";

export const OSCAR_COMPOSE_SERVICES = ["gateway", "oscar", "postgres"] as const;

export type OscarComposeService = typeof OSCAR_COMPOSE_SERVICES[number];

export interface SuiteConfig {
  profile: Profile;
  oscarBaseUrl: string;
  oscarUsername: string;
  oscarPassword: string;
  targetHost: string;
  targetAcknowledgement: string;
  rpmEmulatorUrl: string;
  rpmEmulatorHost: string;
  rpmEmulatorAcknowledgement: string;
  rpmLaneMappingAcknowledgement: string;
  testRpmId: string;
  testLaneLabel: string;
  expectedLaneCount: number;
  expectedCameraCount: number;
  operationalViewWorkflow: CapabilityMode;
  oscarLaneConfigPath: string;
  laneConfigOracle?: LaneConfigOracle;
  oscarSshTarget?: string;
  sshIdentityFile?: string;
  browserExecutablePath?: string;
  oscarBuildLabel?: string;
  emulatorBuildLabel?: string;
  headless: boolean;
  metricsIntervalMs: number;
  uiTimeoutMs: number;
  eventTimeoutMs: number;
  extendedOccupancySeconds: number;
  eventUuidWorkflow: CapabilityMode;
  alarmTransferCameraWorkflow: CapabilityMode;
  emlWorkflow: CapabilityMode;
  emlPluginPath?: string;
  storageWorkflow: CapabilityMode;
  storageExpectedRelease: "3.11.0";
  storageBackupWorkflow: CapabilityMode;
  storageBackupMode: BackupMode;
  storageTargetAcknowledgement: string;
  restoreTargetAcknowledgement: string;
  restoreDisposableAcknowledgement: string;
  restoreDataLossAcknowledgement: string;
  restorePathsAcknowledgement: string;
  restoreArchiveDirectory?: string;
  restoreBackupDirectory?: string;
  oscarReleaseDirectory?: string;
  releaseRestoreEvidenceDirectory?: string;
  storageRetainedEventId?: string;
  storageLegacyEventId?: string;
  storageEventNodeId?: string;
  storageDatabaseScope: number;
  storageHotRetentionDays: number;
  storageArchiveTimeoutMs: number;
  storageProbeTimeoutMs: number;
  storageRestoreProbeTimeoutMs: number;
  resultsRoot: string;
  scenarioFilter: Set<string>;
}

export interface FunctionalResult {
  runId: string;
  timestamp: string;
  scenario: string;
  category: string;
  action: string;
  target: string;
  expected: string;
  observed: string;
  status: ResultStatus;
  durationMs: number;
  evidence: string;
  error: string;
}

export interface ErrorRecord {
  runId: string;
  timestamp: string;
  scenario: string;
  source: string;
  severity: "warning" | "error";
  message: string;
  evidence: string;
}

export interface MetricSample {
  runId: string;
  timestamp: string;
  phase: string;
  source: "oscar-container" | "oscar-host" | "test-runner" | "test-runner-host";
  target: string;
  composeService: OscarComposeService | null;
  containerId: string | null;
  containerState: string | null;
  containerHealth: string | null;
  containerStatsAvailable: boolean | null;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
  pids: number | null;
  restartCount: number | null;
  oomKilled: boolean | null;
  load1m: number | null;
  hostMemoryAvailableBytes: number | null;
  note: string;
}

/** Point-in-time PostgreSQL and durable-storage counters captured by the 3.9.2 probe. */
export interface StorageMetricSample {
  runId: string;
  timestamp: string;
  phase: string;
  databaseSizeBytes: number | null;
  observationTableBytes: number | null;
  observationIndexBytes: number | null;
  walBytes: number | null;
  tempBytes: number | null;
  tuplesInserted: number | null;
  tuplesUpdated: number | null;
  tuplesDeleted: number | null;
  transactionCommits: number | null;
  transactionRollbacks: number | null;
  observationInsertCalls: number | null;
  observationInsertRows: number | null;
  observationRowsPerCall: number | null;
  statementTempBlocksWritten: number | null;
  observationDeleteCalls: number | null;
  observationDeleteRows: number | null;
  observationRowsPerDeleteCall: number | null;
  legacySingletonObservationDeleteCalls: number | null;
  batchedObservationDeleteCalls: number | null;
  batchedObservationDeleteRows: number | null;
  batchedObservationRowsPerDeleteCall: number | null;
  activeArchiveGenerations: number | null;
  sealedArchiveGenerations: number | null;
  archiveRows: number | null;
  archiveBytes: number | null;
  failedArchiveJobs: number | null;
  failedParityReceipts: number | null;
  activeHolds: number | null;
  verifiedBackups: number | null;
  journalBytes: number | null;
  dailyFileBytes: number | null;
  retainedMediaBytes: number | null;
  retainedMediaManifestFiles: number | null;
  retainedMediaJpegFiles: number | null;
  processedObservationIndexFiles: number | null;
  processedObservationIndexBytes: number | null;
  deletionIndexFiles: number | null;
  deletionIndexBytes: number | null;
  legacyProcessedMarkerFiles: number | null;
  legacyDeletionTombstones: number | null;
  mediaMetadataCheckpointBytes: number | null;
  backupBytes: number | null;
  datastreamsTableBytes?: number | null;
  datastreamsUpdates?: number | null;
  datastreamsHotUpdates?: number | null;
  connectionStatusRowsLastHour?: number | null;
  archiveSchemaDatastreamIndexPresent?: number | null;
  note: string;
}

export interface AggregateRow {
  runId: string;
  section: "correctness" | "performance";
  group: string;
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  accuracyPercent: number | null;
  peakCpuPercent: number | null;
  peakMemoryBytes: number | null;
  averageCpuPercent: number | null;
  averageMemoryBytes: number | null;
}

export interface RunMetadata {
  suiteVersion: string;
  suiteGitCommit: string;
  profile: Profile;
  scenarioFilter: string[];
  nodeVersion: string;
  platform: string;
  architecture: string;
  browser: string;
  oscarBaseUrl: string;
  oscarBuildLabel: string;
  rpmEmulatorUrl: string;
  emulatorBuildLabel: string;
  testRpmId: string;
  testLaneLabel: string;
  expectedLaneCount: number;
  expectedCameraCount: number;
  operationalViewWorkflow: CapabilityMode;
  oscarLaneConfigPath: string;
  oscarLaneConfigSha256?: string;
  operationalViewLaneCounts?: Record<string, number>;
  eventUuidWorkflow: CapabilityMode;
  alarmTransferCameraWorkflow: CapabilityMode;
  emlWorkflow?: CapabilityMode;
  emlPluginConfigured?: boolean;
  storageWorkflow: CapabilityMode;
  storageExpectedRelease: "3.11.0";
  storageBackupWorkflow: CapabilityMode;
  storageBackupMode: BackupMode;
  storageProbeTimeoutMs: number;
  storageRestoreProbeTimeoutMs: number;
  oscarReleaseDirectory?: string;
  releaseRestoreEvidenceDirectory?: string;
  releaseRestoreEvidenceRunId?: string;
  releaseRestoreEvidenceBackupId?: string;
  storageRetainedEventId?: string;
  storageLegacyEventId?: string;
  storageEventNodeId?: string;
  reservedRpmConfigSha256?: string;
  remoteMetricsExpected: boolean;
  restoreDrillCertification?: RestoreDrillCertification;
}

export interface RestoreDrillCertification {
  schemaVersion: 2;
  backupId: string;
  authenticatedBackupReverified: true;
  allCanariesRestored: true;
  immutableImageIdentityPreserved: true;
  preRestoreSafetyCopyVerified: true;
}

export interface RpmConfig {
  name: string;
  port: number;
  nominal_gamma_bg?: number;
  nominal_neutron_bg?: number;
  gamma_n_sigma?: number;
  neutron_n_sigma?: number;
  occupancy_frequency?: number;
  occupancy_duration_range?: [number, number];
  occupancy_schedule_enabled?: boolean;
  occupancy_hour_factors?: number[];
  occupancy_day_factors?: number[];
  gamma_alarm_probability?: number;
  neutron_alarm_probability?: number;
  unique_alarm_probability?: number;
  point_source_sigma?: number;
  distributed_source_sigma?: number;
  source_pos_length?: number | null;
  source_pos_width?: number | null;
  source_pos_height?: number | null;
  is_distributed?: boolean | null;
  unique_id?: string;
  latitude?: number | null;
  longitude?: number | null;
  eml_enabled?: boolean;
  eml_collimated?: boolean;
  lane_width?: number;
  camera_ids?: string[];
}

export interface RpmResponse {
  id: string;
  name: string;
  port: number;
  running: boolean;
  config: RpmConfig;
}

export interface RpmStatus {
  id: string;
  state: string;
  connected_clients: number;
  occupancy_count: number;
  is_gamma_alarm: boolean;
  is_neutron_alarm: boolean;
  gh_fault: boolean;
  gl_fault: boolean;
  nh_fault: boolean;
  tamper_fault: boolean;
  occupancy_frequency_effective?: number;
}
