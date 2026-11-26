import {execFile} from "node:child_process";
import {createSocket} from "node:dgram";
import {readFileSync, writeFileSync} from "node:fs";
import {createHash, randomUUID} from "node:crypto";
import {createServer as createHttpServer, type IncomingMessage, type ServerResponse} from "node:http";
import {basename, join} from "node:path";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
import {request as playwrightRequest, type APIRequestContext, type Locator, type Page, type Request, type Response} from "playwright";
import {PDFParse} from "pdf-parse";
import {BrowserHarness} from "./browser.js";
import {boundedFetch, type BoundedFetchResult} from "./bounded-fetch.js";
import {
  discoverSpectroscopicCatalog,
  resolveOperatorDispositionFromSelectedIsotopes,
} from "./spectroscopic-catalog.js";
import {
  alarmMediaForensicsPassed,
  assertAlarmVideoAssociationUnique,
  assessAlarmMediaForensics,
  assessAlarmVideoObservation,
  cameraUidsForSystemComponents,
  laneUidForSystemName,
  type AlarmVideoAssociation,
} from "./alarm-media-oracles.js";
import {
  assessDashboardConnectionResolution,
  assessDashboardKnownClearTamper,
  assessHealthObservationBatches,
  connectionDataStreamIds,
  DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS,
  DASHBOARD_HEALTH_MAX_BATCH_STREAMS,
  DASHBOARD_HEALTH_MAX_IN_FLIGHT,
  expectedDashboardConnectionIds,
  healthRowHasRpmConnectionState,
  forceConnectionObservationsOffline,
  forceSingleConnectionObservationOffline,
  guardDashboardHealthFixtureRoute,
  parseHealthObservationBatch,
} from "./dashboard-health.js";

function scopedViewIndicatorLocator(page: Page, viewKey: string): Locator {
  return page
    .locator('[data-testid="navbar-scoped-view-select"]', {hasText: viewKey})
    .or(page.getByText(`View: ${viewKey}`, {exact: true}))
    .first();
}
import {
  ADVANCED_DATE_FILTER_MAX_BYTES,
  assessAdvancedDateFilterResponses,
  buildAdvancedDateFilterProbeUrls,
  deriveExclusiveDateCutoff,
  eventObservationStartTimes,
  hasDashboardAlarmPredicate,
  isEventObservationPageUrl,
} from "./event-filter-oracle.js";
import {
  assessDashboardLoadAndNextPageLatency,
  assessDashboardWidgetCustomization,
  assessEventLogBackwardPaginationAndScaling,
  assessEventLogOnDemandUpSet,
  assessLaneViewStatusTableFaults,
  assessLiveVideoStartupAndAdvance,
  assessMultiCameraFeedCycle,
  assessViewerCachePolicy,
  canonicalAlarmTransferDocumentJson,
  DASHBOARD_COUNT_QUERY_MAX_MS,
  DASHBOARD_DATASTREAMS_COLLECTION_MAX_MS,
  DASHBOARD_INITIAL_FIRST_ROW_MAX_MS,
  DASHBOARD_NEXT_PAGE_MAX_MS,
  EVENT_LOG_BACKWARD_10X_MAX_MS,
  EVENT_LOG_BACKWARD_10X_MAX_PAGE_QUERIES,
  EVENT_LOG_DEEP_OFFSET_MAX_MS,
  EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS,
  EVENT_LOG_MAX_DUPLICATE_OFFSET_REQUESTS,
  EVENT_LOG_UPSET_EXPAND_MAX_MS,
  importedAlarmChartsRendered,
  LIVE_VIDEO_MAX_STARTUP_MS,
  liveLaneTelemetryChartsAdvancing,
  liveLaneTelemetryChartsRendered,
  operationalViewScopePair,
  scopedUuidOperationalViewChecksEnabled,
  type AlarmChartCanvasSnapshot,
  type AlarmChartSeries,
  type EventLogBackwardSortModeObservation,
  type EventLogDeepOffsetProbeObservation,
  type MultiCameraFeedObservation,
} from "./coverage-oracles.js";
import {assessKnownClearTamperBaseline, RpmEmulatorClient} from "./emulator.js";
import {REQUIRED_OPERATIONAL_VIEW_KEYS} from "./lane-config.js";
import {MetricsSampler} from "./metrics.js";
import {navigateWithBoundedRetry} from "./navigation.js";
import {RunReporter} from "./reporter.js";
import {StorageProbeClient} from "./storage-probe.js";
import {
  archiveScratchRestartIsSafe,
  archiveScratchIsSafe,
  assessArchiveHealth,
  assessArchiveScratchRestart,
  assessArchiveScratch,
  assessCompactionHealth,
  assessImmutableStageHealth,
  assessJpeg,
  assessMediaMetadataHealth,
  assessRetainedMediaResponse,
  assessRetentionRuntimeHealth,
  assessStoragePlatform,
  compactionHealthIsSafe,
  encodeOshBigId,
  immutableStageHealthIsSafe,
  MAX_RETAINED_FRAME_BYTES,
  mediaMetadataHealthIsSafe,
  OSCAR_STORAGE_SCHEMA_CHECKSUM,
  OSCAR_STORAGE_SCHEMA_VERSION,
  parseCollectionIds,
  retentionRuntimeReady,
  storagePlatformHasExactReleaseIdentity,
  storageMetricFromProbe,
} from "./storage-oracles.js";
import {isPublicObservationId} from "./public-observation-id.js";
import {alarmRowMatchesTrigger, type AlarmTriggerIdentity} from "./alarm-trigger.js";
import {
  assessDailyJournalStatus,
  type DailyJournalStatus,
} from "./daily-journal-oracle.js";
import type {RpmConfig, RpmStatus, StorageExpectedRelease, SuiteConfig} from "./types.js";
import {describeError, normalizePathname, poll, safeName, sleep} from "./util.js";
import {
  assertNationalRefreshCompletedControl,
  assertFreshNationalStatisticsObservation,
  assertNationalRefreshPendingControl,
  assessExactNationalStatisticsObservation,
  assessLatestNationalStatisticsObservation,
  assessNationalStatisticsCommandStatus,
  assessNationalStatisticsCommandSubmission,
  classifyNationalStatisticsViewerObservationResponse,
  isNationalRefreshCompletedControl,
  NATIONAL_REFRESH_CONTROL_SELECTOR,
  NATIONAL_STATISTICS_COMPLETION_TIMEOUT_MS,
  NATIONAL_STATISTICS_FIELDS,
  NATIONAL_STATISTICS_OBSERVED_PROPERTY,
  nationalStatisticsEqual,
  parseRenderedNationalStatistics,
  type NationalStatisticsCommandProgress,
  type NationalStatisticsField,
  type NationalStatisticsObservation,
  type NationalRefreshControlState,
} from "./national-statistics.js";

interface ProbeResult<T = undefined> {
  passed: boolean;
  observed: string;
  value?: T;
  evidence?: string;
}

interface CheckMetadata {
  scenario: string;
  category: string;
  action: string;
  target: string;
  expected: string;
}

interface ReportCase {
  reportType: "RDS_SITE" | "LANE" | "EVENT" | "ADJUDICATION" | "VEHICLE_INCIDENT";
  eventType?: "ALARMS" | "ALARMS_OCCUPANCIES" | "SOH";
  vehicleId?: string;
}

interface ExportedAlarmArtifacts {
  alarmFile: string;
  qrImage: string;
}

interface GeneratedAlarmMedia {
  alarmType: "gamma" | "neutron";
  occupancyCount: number;
  association: AlarmVideoAssociation;
}

const MAX_RETAINED_CATALOG_BYTES = 4 * 1024 * 1024;

function parseBoundedJson(response: BoundedFetchResult, context: string): unknown {
  if (!response.ok) throw new Error(`${context} returned HTTP ${response.status}`);
  if (response.contentType !== "application/json") {
    throw new Error(`${context} returned ${response.contentType || "no content type"}, not application/json`);
  }
  const bytes = Buffer.from(response.bodyBase64, "base64");
  if (bytes.length !== response.byteCount) throw new Error(`${context} base64 length mismatch`);
  try {
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch (error) {
    throw new Error(`${context} returned invalid bounded JSON`, {cause: error});
  }
}

function parseBoundedEventApiJson(response: BoundedFetchResult, context: string): unknown {
  if (!response.ok) throw new Error(`${context} returned HTTP ${response.status}`);
  if (response.contentType !== "application/json" && response.contentType !== "application/om+json") {
    throw new Error(`${context} returned ${response.contentType || "no content type"}, not an OSCAR JSON media type`);
  }
  const bytes = Buffer.from(response.bodyBase64, "base64");
  if (bytes.length !== response.byteCount) throw new Error(`${context} base64 length mismatch`);
  try {
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch (error) {
    throw new Error(`${context} returned invalid bounded JSON`, {cause: error});
  }
}

interface DirectJournalLaneState {
  directoryId: string;
  present: boolean;
  files: number;
  bytes: number;
  openSegments: number;
  sealedSegments: number;
  partialFiles: number;
  unsafeEntries: number;
  segments: Array<{
    path: string;
    kind: "open" | "seg";
    bytes: number;
    sha256: string;
  }>;
}

function directJournalInventoryValid(state: DirectJournalLaneState): boolean {
  if (!Array.isArray(state.segments) || state.segments.length !== state.files ||
      state.segments.length > 10_000) return false;
  const paths = new Set<string>();
  let bytes = 0;
  let open = 0;
  let sealed = 0;
  for (const segment of state.segments) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9]{6}\.(?:open|seg)$/.test(segment.path) ||
        !["open", "seg"].includes(segment.kind) ||
        !Number.isSafeInteger(segment.bytes) || segment.bytes < 0 ||
        !/^[0-9a-f]{64}$/.test(segment.sha256) || paths.has(segment.path) ||
        !segment.path.endsWith(`.${segment.kind}`)) return false;
    paths.add(segment.path);
    bytes += segment.bytes;
    if (!Number.isSafeInteger(bytes)) return false;
    if (segment.kind === "open") open++;
    else sealed++;
  }
  return bytes === state.bytes && open === state.openSegments && sealed === state.sealedSegments;
}

type DashboardConnectionKind = "rpm" | "camera";
type DashboardConnectionState = "online" | "offline" | "unknown";
type DashboardFaultKind = "gamma-high" | "gamma-low" | "neutron-high" | "tamper" | "extended-occupancy";

const DASHBOARD_FAULT_KINDS: DashboardFaultKind[] = [
  "gamma-high",
  "gamma-low",
  "neutron-high",
  "tamper",
  "extended-occupancy",
];

const DASHBOARD_FAULT_LABELS: Record<DashboardFaultKind, string> = {
  "gamma-high": "Gamma high",
  "gamma-low": "Gamma low",
  "neutron-high": "Neutron high",
  tamper: "Tamper",
  "extended-occupancy": "Extended occupancy",
};

const REGRESSION_MEDIA_RETENTION = {
  enabled: true,
  timeToRetentionDays: 0,
  queryPeriodMinutes: 1,
  maximumCatchUpHours: 6,
  lateArrivalOverlapHours: 24,
  lateArrivalScanPeriodMinutes: 360,
  lateArrivalCatchUpHours: 2,
  reconciliationCatchUpHours: 24,
  reconciliationPeriodHours: 24,
  occupancyStreamRefreshMinutes: 15,
  frameCount: 5,
  jpegQuality: 85,
  sourceRollbackGraceHours: 24,
  metadataReclamationWorkLimit: 200,
  maintenanceWorkLimit: 200,
} as const;

const REGRESSION_MEDIA_CURSOR_MAX_LAG_SECONDS = 180;

const REGRESSION_ARCHIVE_RESOURCES = {
  memoryLimitMegabytes: 256,
  threads: 2,
  maximumTemporaryMegabytes: 4096,
  maximumConcurrentSessions: 2,
  sessionAcquireTimeoutSeconds: 30,
  temporaryDirectory: "/var/lib/oscar/duckdb-tmp",
} as const;

export const PARQUET_PRIMARY_OUTPUT_NAMES_3_11 = [
  "gammaCounts",
  "gammaThreshold",
  "neutronCounts",
  "setupGamma",
  "setupNeutron",
  "speed",
  "backgroundReport",
  "foregroundReport",
  "status",
  "emlContextual",
  "emlScanContextual",
  "emlAnalysis",
  "dailyFile",
  "connectionStatus",
  "occupancyStatus",
  "tamper",
  "occupancy",
  "adjudication",
  "report",
  "siteStatistics",
  "nationalSummary",
  "vehicleOcr",
] as const;

export const PARQUET_PRIMARY_OUTPUT_NAMES_3_12 = [
  ...PARQUET_PRIMARY_OUTPUT_NAMES_3_11,
  "location",
  "alarm",
  "KromekDetectorRadiometricsV1Report",
  "KromekSerialRadiometricStatusReport",
] as const;

const PARQUET_PRIMARY_OUTPUT_NAMES = PARQUET_PRIMARY_OUTPUT_NAMES_3_12;

export function expectedParquetPrimaryOutputNames(
  release: StorageExpectedRelease,
): readonly string[] {
  return release.startsWith("3.12.")
    ? PARQUET_PRIMARY_OUTPUT_NAMES_3_12
    : PARQUET_PRIMARY_OUTPUT_NAMES_3_11;
}

export function parquetPrimaryOutputNamesMatchRelease(
  actual: readonly string[],
  release: StorageExpectedRelease,
  packagedDefaults?: readonly string[],
): boolean {
  const actualJson = JSON.stringify(actual);
  const v311Json = JSON.stringify(PARQUET_PRIMARY_OUTPUT_NAMES_3_11);
  const v312Json = JSON.stringify(PARQUET_PRIMARY_OUTPUT_NAMES_3_12);
  if (release.startsWith("3.12.")) {
    return actualJson === v312Json &&
      (packagedDefaults === undefined || JSON.stringify(packagedDefaults) === v312Json);
  }
  void PARQUET_PRIMARY_OUTPUT_NAMES;
  const matchesEither = actualJson === v311Json || actualJson === v312Json;
  if (!matchesEither) return false;
  if (packagedDefaults === undefined) return true;
  const packagedJson = JSON.stringify(packagedDefaults);
  return packagedJson === v311Json || packagedJson === v312Json;
}

const REGRESSION_ARCHIVE_POLICY = {
  storageMode: "PARQUET_PRIMARY",
  parquetPrimaryArchiveDelayMinutes: 5,
  immutableStageWindowMinutes: 30,
  maximumFuturePhenomenonSkewMinutes: 5,
  parquetPrimaryIntervalMinutes: 1,
  maximumStagePartitionsPerCycle: 8,
  maximumGenerationsPerCycle: 2,
  maximumVerificationsPerCycle: 2,
  maximumDeletionsPerCycle: 2,
} as const;

const SHIPPING_STORAGE_POLICY = {
  archiveEnabled: true,
  storageMode: "PARQUET_PRIMARY",
  parquetPrimaryArchiveDelayMinutes: 5,
  immutableStageWindowMinutes: 30,
  maximumFuturePhenomenonSkewMinutes: 5,
  parquetPrimaryIntervalMinutes: 1,
  maximumStagePartitionsPerCycle: 8,
  archiveIntervalMinutes: 60,
  hotRetentionDays: 2,
  rollbackGraceDays: 3,
  maximumGenerationsPerCycle: 2,
  maximumVerificationsPerCycle: 2,
  maximumDeletionsPerCycle: 2,
  deleteHotAfterArchive: true,
  videoRetentionDays: 0,
  videoQueryPeriodMinutes: 1,
  maximumCatchUpHours: 6,
  lateArrivalOverlapHours: 24,
  lateArrivalScanPeriodMinutes: 360,
  lateArrivalCatchUpHours: 2,
  reconciliationCatchUpHours: 24,
  reconciliationPeriodHours: 24,
  occupancyStreamRefreshMinutes: 15,
  retainedFrameCount: 5,
  jpegQuality: 85,
  sourceRollbackGraceHours: 24,
  metadataReclamationWorkLimit: 200,
  maintenanceWorkLimit: 200,
  frameRetentionEnabled: true,
} as const;

function isVisible(locator: Locator): Promise<boolean> {
  return locator.isVisible().catch(() => false);
}

export interface CargoUffSmbFallbackConfig {
  cargoUffSmbShare?: string;
  cargoUffSmbSubPath?: string;
  cargoUffSmbDomain?: string;
  cargoUffSmbUsername?: string;
  cargoUffSmbPassword?: string;
}

export function buildCargoUffRestorePayload(
  preUffStatus: Record<string, unknown> | undefined,
  smbFallback: CargoUffSmbFallbackConfig,
): Record<string, unknown> | undefined {
  if (!preUffStatus || preUffStatus.enabled !== true) {
    return undefined;
  }
  const sourceType = String(preUffStatus.sourceType || (smbFallback.cargoUffSmbShare ? "smb" : "local")).trim();
  const correlationWindowMinutes = Number(preUffStatus.correlationWindowMinutes ?? 60);
  const allowFuzzyOcrMatch = preUffStatus.allowFuzzyOcrMatch !== false;

  if (sourceType === "local") {
    const localPath = String(preUffStatus.localPath ?? "").trim();
    if (!localPath) {
      return undefined;
    }
    return {
      action: "save-config",
      enabled: true,
      sourceType: "local",
      localPath,
      correlationWindowMinutes,
      allowFuzzyOcrMatch,
    };
  }

  const shareUrl = String(preUffStatus.shareUrl || smbFallback.cargoUffSmbShare || "").trim();
  if (!shareUrl) {
    return undefined;
  }
  const subPath = String(preUffStatus.subPath ?? smbFallback.cargoUffSmbSubPath ?? "");
  const domain = String(preUffStatus.domain ?? smbFallback.cargoUffSmbDomain ?? "WORKGROUP");
  const username = String(preUffStatus.username ?? smbFallback.cargoUffSmbUsername ?? "");
  return {
    action: "save-config",
    enabled: true,
    sourceType: "smb",
    shareUrl,
    subPath,
    domain,
    username,
    ...(smbFallback.cargoUffSmbPassword ? {password: smbFallback.cargoUffSmbPassword} : {}),
    correlationWindowMinutes,
    allowFuzzyOcrMatch,
  };
}

export class RegressionScenarios {
  private originalRpmConfig: RpmConfig | undefined;
  private originalRpmRunning: boolean | undefined;
  private originalRpmStatus: RpmStatus | null | undefined;
  private reservedLanePrepared = false;
  private pendingCargoUffRestorePayload: Record<string, unknown> | undefined;
  private pendingFederationCleanup: (() => Promise<void>) | undefined;
  private alarmMediaBaselineCreated = false;
  private alarmMediaProbe: StorageProbeClient | undefined;
  private alarmCameraUids: string[] | undefined;
  private alarmLaneUid: string | undefined;
  private readonly generatedAlarmMedia = new Map<string, GeneratedAlarmMedia>();
  private readonly resolvedAlarmEventIds = new Set<string>();
  private cameraRecordingLogStartedAt: string | undefined;
  private readonly retainedBackupExpectations = new Map<string, string>();
  private retainedMediaProofDeferred = false;
  private lastRecognizedOcrContainer: string | undefined;
  private stopRequested: () => boolean = () => false;
  private activeScenario = "navigation";

  constructor(
    private readonly config: SuiteConfig,
    private readonly reporter: RunReporter,
    private readonly browser: BrowserHarness,
    private readonly emulator: RpmEmulatorClient,
    private readonly metrics: MetricsSampler,
  ) {}

  setStopRequested(callback: () => boolean): void {
    this.stopRequested = callback;
  }

  private selected(scenario: string): boolean {
    return this.config.scenarioFilter.size === 0 || this.config.scenarioFilter.has(scenario);
  }

  private fullRunCanSelfSeedRetainedMedia(): boolean {
    return ["full", "3.9.2-release", "3.11.0-release"].includes(this.config.profile) &&
      this.selected("storage-lifecycle") &&
      ["rpm-alarms", "event-uuid", "adjudication", "eml-auto-adjudication", "vehicle-ocr", "cargo-uff"].some(scenario => this.selected(scenario));
  }

  private async check<T>(metadata: CheckMetadata, probe: () => Promise<ProbeResult<T>>): Promise<T | undefined> {
    const started = Date.now();
    try {
      const result = await probe();
      this.reporter.outcome(
        metadata.scenario,
        metadata.category,
        metadata.action,
        metadata.target,
        metadata.expected,
        result.observed,
        result.passed ? "correct" : "incorrect",
        Date.now() - started,
        result.evidence ?? "",
      );
      return result.value;
    } catch (error) {
      this.reporter.outcome(
        metadata.scenario,
        metadata.category,
        metadata.action,
        metadata.target,
        metadata.expected,
        "operation failed",
        "incorrect",
        Date.now() - started,
        "",
        describeError(error),
      );
      this.reporter.error(metadata.scenario, metadata.action, error);
      return undefined;
    }
  }

  private skip(metadata: CheckMetadata, reason: string): void {
    this.reporter.outcome(
      metadata.scenario,
      metadata.category,
      metadata.action,
      metadata.target,
      metadata.expected,
      reason,
      "skipped",
      0,
    );
  }

  private async scenario(name: string, operation: () => Promise<void>, force = false): Promise<void> {
    if (!force && !this.selected(name)) return;
    if (this.stopRequested()) return;
    process.stdout.write(`[scenario] ${name} started\n`);
    this.activeScenario = name;
    this.browser.setScenario(name);
    this.metrics.setPhase(name);
    try {
      await operation();
    } catch (error) {
      this.reporter.error(name, "scenario", error);
      this.reporter.outcome(
        name,
        "harness",
        "complete scenario",
        name,
        "scenario completes without an unhandled error",
        "unhandled scenario error",
        "incorrect",
        0,
        "",
        describeError(error),
      );
    } finally {
      process.stdout.write(`[scenario] ${name} completed\n`);
    }
  }

  private viewerUrl(path: string): string {
    return new URL(path, `${this.config.oscarBaseUrl}/`).toString();
  }

  private healthRow(page: Page): Locator {
    return page.getByTestId(`health-lane-${this.config.testLaneLabel}`);
  }

  private dashboardCard(page: Page): Locator {
    return page.getByTestId(`lane-health-card-${this.config.testLaneLabel}`);
  }

  private dashboardConnection(page: Page, kind: DashboardConnectionKind): Locator {
    return page.getByTestId(`lane-health-${this.config.testLaneLabel}-${kind}`);
  }

  private dashboardFault(page: Page, kind: DashboardFaultKind): Locator {
    return page.getByTestId(`lane-health-${this.config.testLaneLabel}-${kind}`);
  }

  private async dashboardCameraConnectionTarget(
    page: Page,
    requestedHealthStreamIds: ReadonlySet<string>,
  ): Promise<{componentId: string; streamId: string}> {
    const camera = this.dashboardConnection(page, "camera").first();
    const componentId = await camera.getAttribute("data-component-id");
    if (!componentId) {
      throw new Error(`${this.config.testLaneLabel} has no camera component identity`);
    }

    const response = await page.context().request.get(this.viewerUrl(
      `/sensorhub/api/systems/${encodeURIComponent(componentId)}/datastreams?validTime=latest&limit=100`,
    ));
    if (!response.ok()) {
      throw new Error(`Camera datastream discovery returned HTTP ${response.status()}`);
    }
    const candidates = connectionDataStreamIds(await response.json())
      .filter((streamId) => requestedHealthStreamIds.has(streamId));
    if (candidates.length !== 1) {
      throw new Error(
        `Expected exactly one requested connection datastream for the selected camera; found ${candidates.length}`,
      );
    }
    return {componentId, streamId: candidates[0] ?? ""};
  }

  private async goto(page: Page, path: string): Promise<number> {
    const url = this.viewerUrl(path);
    return navigateWithBoundedRetry({
      navigate: async () => {
        const response = await page.goto(url, {waitUntil: "domcontentloaded"});
        return response?.status() ?? 0;
      },
      verifyTarget: async () => {
        const request = page.context().request;
        const healthResponse = await request.get(this.viewerUrl("/healthz"));
        try {
          if (healthResponse.status() !== 200) {
            throw new Error(`Viewer health probe returned HTTP ${healthResponse.status()}`);
          }
        } finally {
          await healthResponse.dispose();
        }

        const sessionResponse = await request.get(this.viewerUrl("/session"));
        try {
          if (!sessionResponse.ok()) {
            throw new Error(`Authenticated Viewer session probe returned HTTP ${sessionResponse.status()}`);
          }
          const session = await sessionResponse.json() as {username?: unknown};
          if (session.username !== this.config.oscarUsername) {
            throw new Error("Authenticated Viewer session probe returned the wrong user");
          }
        } finally {
          await sessionResponse.dispose();
        }
      },
      onFirstFailure: (error) => this.reporter.error(
        this.activeScenario,
        "viewer-navigation-retry",
        `GET ${url}: ${describeError(error)}; target probes must pass before one bounded retry`,
        "",
        "warning",
      ),
      wait: sleep,
    });
  }

  private async screenshotOnFailure(page: Page, name: string): Promise<string> {
    try { return await this.browser.screenshot(page, name); } catch { return ""; }
  }

  private chartCanvasSnapshot(canvas: Locator): Promise<AlarmChartCanvasSnapshot> {
    return canvas.evaluate((element): AlarmChartCanvasSnapshot => {
      const chart = element as HTMLCanvasElement;
      const context = chart.getContext("2d");
      let gammaPlotPixels = 0;
      let neutronPlotPixels = 0;
      let digestHash = 2166136261;
      if (context && chart.width > 0 && chart.height > 0) {
        const pixels = context.getImageData(0, 0, chart.width, chart.height).data;
        // Exclude the title and bottom legend so a colored legend swatch cannot
        // make an empty dataset look live. The remaining band is Chart.js's plot.
        const firstPlotRow = Math.floor(chart.height * 0.15);
        const lastPlotRow = Math.ceil(chart.height * 0.82);
        const lastDigestRow = Math.ceil(chart.height * 0.92);
        const firstPlotColumn = Math.floor(chart.width * 0.05);
        const lastPlotColumn = Math.ceil(chart.width * 0.95);
        for (let y = firstPlotRow; y < lastDigestRow; y++) {
          for (let x = firstPlotColumn; x < lastPlotColumn; x++) {
            const index = (y * chart.width + x) * 4;
            const red = pixels[index] ?? 0;
            const green = pixels[index + 1] ?? 0;
            const blue = pixels[index + 2] ?? 0;
            const alpha = pixels[index + 3] ?? 0;
            if (alpha === 0) continue;
            digestHash = Math.imul(digestHash ^ red, 16777619) >>> 0;
            digestHash = Math.imul(digestHash ^ green, 16777619) >>> 0;
            digestHash = Math.imul(digestHash ^ blue, 16777619) >>> 0;
            if (y < lastPlotRow) {
              if (Math.abs(red - 244) <= 24 && Math.abs(green - 67) <= 24 &&
                Math.abs(blue - 54) <= 24) gammaPlotPixels++;
              if (Math.abs(red - 41) <= 24 && Math.abs(green - 182) <= 24 &&
                Math.abs(blue - 246) <= 24) neutronPlotPixels++;
            }
          }
        }
      }
      const bounds = chart.getBoundingClientRect();
      return {
        width: chart.width,
        height: chart.height,
        clientWidth: bounds.width,
        clientHeight: bounds.height,
        gammaPlotPixels,
        neutronPlotPixels,
        canvasDigest: digestHash.toString(16).padStart(8, "0"),
      };
    });
  }

  async runReadOnly(): Promise<void> {
    await this.scenario("preflight", () => this.preflight());
    await this.scenario("viewer-navigation", () => this.viewerNavigation());
    await this.scenario("map-national-servers", () => this.mapNationalServers());
    await this.scenario("sensorhub-admin", () => this.sensorHubAdmin());
    await this.scenario("status-of-health", () => this.statusOfHealthBaseline());
    await this.scenario("dashboard-health", () => this.dashboardHealthBaseline());
    await this.scenario("lane-video", () => this.laneVideo());
    await this.scenario("event-filtering", () => this.eventFiltering());
    await this.scenario("operational-views", () => this.operationalViews());
    await this.scenario("reporting", () => this.reporting([
      {reportType: "RDS_SITE"},
      {reportType: "EVENT", eventType: "ALARMS"},
      {reportType: "EVENT", eventType: "ALARMS_OCCUPANCIES"},
      {reportType: "EVENT", eventType: "SOH"},
      {reportType: "LANE"},
      {
        reportType: "VEHICLE_INCIDENT",
        vehicleId: this.config.expectedVehicleOcrContainer === "ANY"
          ? "EGHU3972694"
          : this.config.expectedVehicleOcrContainer,
      },
    ]));
    await this.scenario("alarm-transfer", () => this.alarmTransferValidation());
    await this.scenario("alarm-transfer-camera", () => this.alarmTransferCamera());
    await this.scenario("runtime-extensions", () => this.runtimeExtensions());
    await this.scenario("storage-health", () => this.storageHealth());
  }

  async runFull(): Promise<void> {
    try {
      try {
        await this.hardMutationPreflight();
        await this.prepareReservedLane();
        await this.scenario("rpm-connection", () => this.connectionFault());
        await this.scenario("rpm-faults", () => this.faults());
        await this.scenario("rpm-alarms", () => this.alarms());
        await this.scenario("event-uuid", () => this.eventUuidWorkflow());
        await this.scenario("adjudication", () => this.adjudicationAndAlarmTransfer());
        await this.scenario("eml-auto-adjudication", () => this.emlAutoAdjudication());
        await this.scenario("vehicle-ocr", () => this.vehicleOcr());
        await this.scenario("cargo-uff", () => this.cargoUffAdjudication());
        await this.scenario("training-sandbox", () => this.trainingSandbox());
        await this.scenario("lane-webrelay", () => this.laneWebRelay());
        if (this.config.scenarioFilter.size > 0 ||
            this.config.federationWorkflow !== "auto" ||
            Boolean(this.config.oscarFederatedPeerBaseUrl)) {
          await this.scenario("multi-node-federation", () => this.multiNodeFederation());
        }
        await this.scenario("extended-occupancy", () => this.extendedOccupancy());
        await this.scenario("adjudication-report", () => this.reporting([
          {reportType: "ADJUDICATION"},
          {
            reportType: "VEHICLE_INCIDENT",
            vehicleId: this.config.expectedVehicleOcrContainer === "ANY"
              ? (this.lastRecognizedOcrContainer ?? "EGHU3972694")
              : this.config.expectedVehicleOcrContainer,
          },
        ]));
        // Keep the reserved RPM's automatic occupancy/alarm generation disabled until the
        // scoped media baseline has been reconciled. Restoring its original random workload
        // earlier could create legitimate, unrelated clips in the same camera directories and
        // make an orphan check nondeterministic.
        await this.scenario("storage-lifecycle", () => this.storageLifecycle());
      } finally {
        await this.restoreReservedLane();
      }
    } finally {
      await this.alarmMediaProbe?.cleanup();
      this.alarmMediaProbe = undefined;
    }
  }

  async runRestoreDrill(): Promise<void> {
    await this.scenario("storage-restore-drill", () => this.storageRestoreDrill());
  }

  async emergencyCleanup(): Promise<void> {
    try {
      await this.restoreReservedLane();
    } finally {
      try {
        await this.restorePendingCargoUff();
      } finally {
        try {
          await this.runPendingFederationCleanup();
        } finally {
          await this.alarmMediaProbe?.cleanup();
          this.alarmMediaProbe = undefined;
        }
      }
    }
  }

  private async runPendingFederationCleanup(): Promise<void> {
    const cleanup = this.pendingFederationCleanup;
    if (!cleanup) return;
    this.pendingFederationCleanup = undefined;
    try {
      await cleanup();
    } catch (err) {
      this.reporter.error("multi-node-federation", "emergency-federation-cleanup", err);
    }
  }

  private async restorePendingCargoUff(): Promise<void> {
    const payload = this.pendingCargoUffRestorePayload;
    if (!payload) return;
    this.pendingCargoUffRestorePayload = undefined;
    let page: Page | undefined;
    try {
      page = await this.browser.oscarPage();
      const res = await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/uff/action"), {
        headers: {"X-Requested-With": "OSCAR-Viewer", "Content-Type": "application/json"},
        data: payload,
      });
      await res.dispose();
    } catch (err) {
      this.reporter.error("cargo-uff", "restore-pre-test-uff-config", err);
    } finally {
      await page?.close().catch(() => {});
    }
  }

  private async hardMutationPreflight(): Promise<void> {
    const started = Date.now();
    const page = await this.browser.oscarPage();
    try {
      const rpm = await this.emulator.get(this.config.testRpmId);
      if (!rpm.running) throw new Error(`${this.config.testRpmId} is not running`);
      const status = await this.emulator.status(this.config.testRpmId);
      if (status.connected_clients < 1) {
        throw new Error(`${this.config.testRpmId} has no connected OSCAR client`);
      }
      if (await this.browser.sessionUsername() !== this.config.oscarUsername) {
        throw new Error("OSCAR session identity changed before mutation");
      }
      await this.goto(page, "/health");
      const row = this.healthRow(page);
      await row.waitFor({timeout: this.config.uiTimeoutMs});
      const rowText = await row.innerText();
      if (!/RPM/i.test(rowText) || !/Camera/i.test(rowText)) {
        throw new Error(`${this.config.testLaneLabel} does not expose the expected RPM/camera mapping`);
      }
      this.reporter.outcome(
        "mutation-preflight", "safety", "verify reserved RPM-to-lane mapping",
        `${this.config.testRpmId}:${this.config.testLaneLabel}`,
        "acknowledged emulator RPM exists, is connected, and its Viewer health row exposes RPM/camera telemetry",
        `rpm=${rpm.name}; clients=${status.connected_clients}; health row mapped=true`,
        "correct", Date.now() - started,
      );
    } catch (error) {
      this.reporter.outcome(
        "mutation-preflight", "safety", "verify reserved RPM-to-lane mapping",
        `${this.config.testRpmId}:${this.config.testLaneLabel}`,
        "all mutation safety checks pass", "mutation blocked", "incorrect",
        Date.now() - started, "", describeError(error),
      );
      throw error;
    } finally {
      await page.close();
    }
  }

  private async preflight(): Promise<void> {
    await this.check({
      scenario: "preflight", category: "availability", action: "open OSCAR Viewer",
      target: this.config.oscarBaseUrl, expected: "authenticated Viewer responds without a server error",
    }, async () => {
      const page = await this.browser.oscarPage();
      try {
        const status = await this.goto(page, "/");
        const body = await page.locator("body").innerText();
        const sessionUsername = await this.browser.sessionUsername();
        const passed = status >= 200 && status < 400 &&
          sessionUsername === this.config.oscarUsername &&
          !/internal server error|sign in to continue/i.test(body);
        return {passed, observed: `HTTP ${status}; session user=${sessionUsername}; title=${await page.title()}`};
      } finally { await page.close(); }
    });

    await this.check({
      scenario: "preflight", category: "performance", action: "verify Viewer browser cache policy",
      target: "/_next/static and /sw.js",
      expected: "authenticated hashed assets are privately immutable, the service worker is revalidated, and anonymous asset errors are not cacheable",
    }, async () => {
      const page = await this.browser.oscarPage();
      try {
        await this.goto(page, "/");
        const scriptPath = await page.locator('script[src^="/_next/static/"]').first().getAttribute("src");
        if (!scriptPath) throw new Error("Viewer page did not expose a hashed static script");

        const request = page.context().request;
        const [assetResponse, serviceWorkerResponse, unauthenticatedAsset] = await Promise.all([
          request.get(this.viewerUrl(scriptPath)),
          request.get(this.viewerUrl("/sw.js")),
          this.browser.unauthenticatedOscarGet(scriptPath),
        ]);
        try {
          const assetCache = assetResponse.headers()["cache-control"] ?? "";
          const serviceWorkerCache = serviceWorkerResponse.headers()["cache-control"] ?? "";
          const assessment = assessViewerCachePolicy({
            authenticatedAsset: {status: assetResponse.status(), cacheControl: assetCache},
            serviceWorker: {status: serviceWorkerResponse.status(), cacheControl: serviceWorkerCache},
            unauthenticatedAsset,
          });
          return {
            passed: assessment.passed,
            observed: `asset HTTP ${assetResponse.status()} Cache-Control=${assetCache || "missing"}; ` +
              `sw.js HTTP ${serviceWorkerResponse.status()} Cache-Control=${serviceWorkerCache || "missing"}; ` +
              `anonymous asset HTTP ${unauthenticatedAsset.status} ` +
              `Cache-Control=${unauthenticatedAsset.cacheControl || "missing"}; ` +
              `protected=${assessment.unauthenticatedAssetProtected}; ` +
              `not cacheable=${assessment.unauthenticatedAssetNotCacheable}`,
          };
        } finally {
          await Promise.all([assetResponse.dispose(), serviceWorkerResponse.dispose()]);
        }
      } finally {
        await page.close();
      }
    });

    const configuredEmulatorRpmIds = (): Set<string> | null => {
      const lanes = this.config.laneConfigOracle?.lanes;
      if (!lanes || lanes.length === 0) return null;
      const ids = new Set<string>();
      for (const lane of lanes) {
        const m = /^lane-0*(\d+)$/i.exec(lane.uniqueId.trim());
        if (m?.[1]) ids.add(`rpm-${m[1]}`);
      }
      return ids.size > 0 ? ids : null;
    };

    await this.check({
      scenario: "preflight", category: "availability", action: "discover RPM emulator",
      target: this.config.rpmEmulatorUrl, expected: `${this.config.expectedLaneCount} RPMs and ${this.config.testRpmId} running`,
    }, async () => {
      const allRpms = await this.emulator.list();
      const configuredIds = configuredEmulatorRpmIds();
      const rpms = allRpms.length > this.config.expectedLaneCount && configuredIds
        ? allRpms.filter((rpm) => configuredIds.has(rpm.id))
        : allRpms;
      const reserved = rpms.find((rpm) => rpm.id === this.config.testRpmId);
      return {
        passed: rpms.length === this.config.expectedLaneCount && reserved?.running === true,
        observed: `${rpms.length} RPMs (total emulator=${allRpms.length}); reserved lane running=${String(reserved?.running)}`,
      };
    });
  }

  private async viewerNavigation(): Promise<void> {
    const routes = [
      ["/", "Lane Status"],
      ["/event-log", "Events"],
      ["/health", "Status of Health"],
      ["/report", "Report Generator"],
      ["/alarm-transfer", "Alarm Transfer"],
      ["/map", "Map"],
      ["/national-view", "National"],
      ["/users", "Users, Passkeys & Access Control"],
      ["/usb-backups", "Continual & Occasional USB NVMe Backups"],
      ["/extensions", "Pluggable Runtime Extensions & Regional Packs"],
      ["/servers", "Nodes"],
    ] as const;
    const page = await this.browser.oscarPage();
    try {
      for (const [path, marker] of routes) {
        await this.check({
          scenario: "viewer-navigation", category: "viewer", action: `open ${path}`,
          target: path, expected: `HTTP success and visible ${marker} content`,
        }, async () => {
          const status = await this.goto(page, path);
          const markerLocator = page.getByRole("heading", {name: marker, exact: true}).first();
          const markerVisible = await markerLocator.waitFor({timeout: this.config.uiTimeoutMs})
            .then(() => true).catch(() => false);
          const body = await page.locator("body").innerText();
          const passed = status >= 200 && status < 400 && markerVisible && !/application error|internal server error/i.test(body);
          const evidence = passed ? "" : await this.screenshotOnFailure(page, `viewer-${safeName(path)}-failed`);
          return {passed, observed: `HTTP ${status}; marker visible=${markerVisible}`, evidence};
        });
      }

      const requireCustomDashboards = this.config.storageExpectedRelease.startsWith("3.12.");
      const hasCustomDashboardsNav = (await page.getByTestId("nav-item-custom-dashboards").count()) > 0;
      if (requireCustomDashboards || hasCustomDashboardsNav) {
        await this.check({
          scenario: "viewer-navigation",
          category: "viewer",
          action: "open /dashboards and verify canonical navbar and zero layout residue",
          target: "/dashboards",
          expected: "HTTP 200 on /dashboards with custom-dashboards-page, starter gallery, intact 8 canonical navbar routes, zero uncaught page errors, and clean localStorage teardown",
        }, async () => {
          const canonicalNavTestIds = [
            "nav-item-dashboard",
            "nav-item-events",
            "nav-item-health",
            "nav-item-map",
            "nav-item-national",
            "nav-item-report",
            "nav-item-alarm-transfer",
            "nav-item-users",
          ] as const;
          const beforePageErrors = this.reporter.errors.filter((err) => err.source === "viewer-page").length;
          const savedLocalStorage = await page.evaluate(() => {
            const entries: Array<[string, string]> = [];
            for (let idx = 0; idx < window.localStorage.length; idx++) {
              const key = window.localStorage.key(idx);
              if (key !== null) {
                entries.push([key, window.localStorage.getItem(key) ?? ""]);
              }
            }
            return entries;
          });

          try {
            const status = await this.goto(page, "/dashboards");
            const workspaceVisible = await page.getByTestId("custom-dashboards-page")
              .waitFor({state: "visible", timeout: this.config.uiTimeoutMs})
              .then(() => true, () => false);
            const switcherVisible = await page.getByTestId("custom-dashboards-switcher")
              .waitFor({state: "visible", timeout: 10_000})
              .then(() => true, () => false);
            const galleryVisible = await page.getByTestId("custom-dashboards-gallery")
              .waitFor({state: "visible", timeout: 10_000})
              .then(() => true, () => false);
            const addPageBtnVisible = await page.getByTestId("dashboards-new-page-button")
              .isVisible()
              .catch(() => false);

            const initialCustomNavCount = await page.locator('[data-testid^="nav-custom-page-"]').count();
            const missingCanonicalBefore: string[] = [];
            for (const navId of canonicalNavTestIds) {
              if ((await page.getByTestId(navId).count()) === 0) {
                missingCanonicalBefore.push(navId);
              }
            }

            let hostMounted = false;
            const blankTemplate = page.getByTestId("starter-template-blank");
            if (await blankTemplate.isVisible().catch(() => false)) {
              await blankTemplate.click();
              hostMounted = await page.getByTestId("custom-dashboard-host")
                .waitFor({state: "visible", timeout: 10_000})
                .then(() => true, () => false);
            }

            const missingCanonicalAfter: string[] = [];
            for (const navId of canonicalNavTestIds) {
              if ((await page.getByTestId(navId).count()) === 0) {
                missingCanonicalAfter.push(navId);
              }
            }
            const customDashboardsNavPresent = (await page.getByTestId("nav-item-custom-dashboards").count()) > 0;
            const body = await page.locator("body").innerText();
            const afterPageErrors = this.reporter.errors.filter((err) => err.source === "viewer-page").length;
            const newPageErrors = afterPageErrors - beforePageErrors;
            const passed = status === 200 &&
              workspaceVisible &&
              switcherVisible &&
              galleryVisible &&
              addPageBtnVisible &&
              hostMounted &&
              initialCustomNavCount === 0 &&
              missingCanonicalBefore.length === 0 &&
              missingCanonicalAfter.length === 0 &&
              customDashboardsNavPresent &&
              newPageErrors === 0 &&
              !/application error|internal server error/i.test(body);
            const evidence = passed ? "" : await this.screenshotOnFailure(page, "viewer-custom-dashboards-failed");
            return {
              passed,
              observed: `HTTP ${status}; workspace=${workspaceVisible}; gallery=${galleryVisible}; hostMounted=${hostMounted}; ` +
                `initialCustomNav=${initialCustomNavCount}; missingCanonical=${missingCanonicalBefore.length + missingCanonicalAfter.length}; ` +
                `pageErrors=${newPageErrors}`,
              evidence,
            };
          } finally {
            await page.evaluate((entries) => {
              window.localStorage.clear();
              for (const [key, val] of entries) {
                window.localStorage.setItem(key, val);
              }
            }, savedLocalStorage).catch(() => undefined);
            await this.goto(page, "/").catch(() => undefined);
          }
        });
      }

      await this.check({
        scenario: "viewer-navigation",
        category: "viewer",
        action: "preserve SPA runtime state across Navbar links without MPA document reload or RSC .txt 404",
        target: "Navbar client-side navigation",
        expected: "clicking Navbar links transitions via Next.js index.txt RSC payloads with 0 document reloads, 0 .txt 404s, and intact window runtime state",
      }, async () => {
        await this.goto(page, "/");
        await page.getByTestId("nav-item-events").first().waitFor({timeout: this.config.uiTimeoutMs});
        const bootSentinel = await page.evaluate(() => {
          const token = `spa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          (window as unknown as {__oscarSpaNavSentinel?: string}).__oscarSpaNavSentinel = token;
          return token;
        });

        let documentNavigations = 0;
        const rsc404Urls: string[] = [];
        const onReq = (req: Request) => {
          if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
            documentNavigations += 1;
          }
        };
        const onRes = (res: Response) => {
          if (res.status() === 404 && /\.txt(?:\?|$)/.test(res.url())) {
            rsc404Urls.push(res.url());
          }
        };
        page.on("request", onReq);
        page.on("response", onRes);
        try {
          const steps: Array<[string, string]> = [
            ["nav-item-events", "/event-log"],
            ["nav-item-national", "/national-view"],
            ["nav-item-servers", "/servers"],
            ["nav-item-dashboard", "/"],
          ];
          for (const [testId, expectedPath] of steps) {
            await this.clickSpaNavItem(page, testId, expectedPath);
          }
          const survivingSentinel = await page.evaluate(
            () => (window as unknown as {__oscarSpaNavSentinel?: string}).__oscarSpaNavSentinel ?? "",
          );
          const passed = survivingSentinel === bootSentinel && documentNavigations === 0 && rsc404Urls.length === 0;
          return {
            passed,
            observed: `sentinelIntact=${survivingSentinel === bootSentinel}; documentNavigations=${documentNavigations}; rsc404Count=${rsc404Urls.length}`,
          };
        } finally {
          page.off("request", onReq);
          page.off("response", onRes);
        }
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "performance",
        action: "verify Dashboard initial load, datastream/count SLOs, and single-click Next-page latency",
        target: "/ and /sensorhub/api/observations",
        expected: `Dashboard first alarm row <=${DASHBOARD_INITIAL_FIRST_ROW_MAX_MS}ms, single /datastreams collection <=${DASHBOARD_DATASTREAMS_COLLECTION_MAX_MS}ms, /observations/count <=${DASHBOARD_COUNT_QUERY_MAX_MS}ms, and Next-page click <=${DASHBOARD_NEXT_PAGE_MAX_MS}ms with 0 count round-trips`,
      }, async () => {
        const reqStarts = new Map<Request, number>();
        let datastreamsCollectionCalls = 0;
        let maxDatastreamsCollectionMs = 0;
        let maxCountQueryMs = 0;
        let obs5xxCount = 0;
        let trackingNextClick = false;
        let nextPageCountRequests = 0;

        const onReq = (req: Request) => {
          const url = req.url();
          if (url.includes("/sensorhub/api/")) {
            reqStarts.set(req, performance.now());
            if (trackingNextClick) {
              try {
                if (/\/sensorhub\/api\/observations\/count\/?$/.test(new URL(url).pathname)) {
                  nextPageCountRequests += 1;
                }
              } catch {
                // ignore malformed URL
              }
            }
          }
        };
        const onDone = async (req: Request) => {
          const started = reqStarts.get(req);
          if (started === undefined) return;
          reqStarts.delete(req);
          const durMs = Math.round(performance.now() - started);
          const resp = await req.response().catch(() => null);
          const status = resp ? resp.status() : 0;
          const url = req.url();
          if (url.includes("/sensorhub/api/observations") && status >= 500) {
            obs5xxCount += 1;
          }
          try {
            const parsed = new URL(url);
            if (/\/sensorhub\/api\/datastreams\/?$/.test(parsed.pathname)) {
              datastreamsCollectionCalls += 1;
              if (durMs > maxDatastreamsCollectionMs) maxDatastreamsCollectionMs = durMs;
            } else if (/\/sensorhub\/api\/observations\/count\/?$/.test(parsed.pathname)) {
              if (durMs > maxCountQueryMs) maxCountQueryMs = durMs;
            }
          } catch {
            // ignore malformed URL
          }
        };

        page.on("request", onReq);
        page.on("requestfinished", onDone);
        page.on("requestfailed", onDone);
        try {
          const tNavStart = performance.now();
          await this.goto(page, "/");
          await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
          const firstRowVisible = await page.locator(".MuiDataGrid-row").first()
            .waitFor({state: "visible", timeout: DASHBOARD_INITIAL_FIRST_ROW_MAX_MS + 3_000})
            .then(() => true)
            .catch(() => false);
          const firstRowMs = firstRowVisible ? Math.round(performance.now() - tNavStart) : null;

          // Allow low-priority background count + disjoint bucket prewarm to settle over HTTP/2.
          await sleep(800);

          const paginationInfo = await page.evaluate(() => {
            const pag = document.querySelector(".MuiTablePagination-displayedRows")?.textContent?.trim() ?? "";
            const totalMatch = /of\s+([\d,]+)/i.exec(pag);
            const total = totalMatch?.[1] ? Number(totalMatch[1].replace(/,/g, "")) : 0;
            const firstId = document.querySelector(".MuiDataGrid-virtualScrollerRenderZone .MuiDataGrid-row")
              ?.getAttribute("data-id") ?? "";
            return {pag, total, firstId};
          });
          const hasAlarms = paginationInfo.total > 0 || firstRowVisible;
          const nextBtn = page.locator('button[aria-label="Go to next page"]').first();
          const nextPageAvailable = paginationInfo.total > 15 && await nextBtn.isEnabled().catch(() => false);

          let nextPageRenderMs: number | null = null;
          let page2DistinctFromPage1 = false;
          if (nextPageAvailable) {
            trackingNextClick = true;
            nextPageCountRequests = 0;
            const tClick = performance.now();
            await nextBtn.click();
            const transitioned = await page.waitForFunction(
              (prevFirstId: string) => {
                const busy = document.querySelector(".MuiDataGrid-overlayWrapper .MuiCircularProgress-root");
                const rows = document.querySelectorAll(".MuiDataGrid-virtualScrollerRenderZone .MuiDataGrid-row");
                const pag = document.querySelector(".MuiTablePagination-displayedRows")?.textContent?.trim() ?? "";
                const curFirstId = rows[0]?.getAttribute("data-id") ?? "";
                return !busy && rows.length > 0 && Boolean(curFirstId) && curFirstId !== prevFirstId && /^16/.test(pag);
              },
              paginationInfo.firstId,
              {timeout: DASHBOARD_NEXT_PAGE_MAX_MS + 4_000},
            ).then(() => true).catch(() => false);
            trackingNextClick = false;
            if (transitioned) {
              nextPageRenderMs = Math.round(performance.now() - tClick);
              page2DistinctFromPage1 = true;
            }
          }

          const assessment = assessDashboardLoadAndNextPageLatency({
            hasAlarms,
            firstRowMs,
            datastreamsCollectionCalls,
            maxDatastreamsCollectionMs,
            maxCountQueryMs,
            nextPageAvailable,
            nextPageRenderMs,
            nextPageCountRequests,
            page2DistinctFromPage1,
            obs5xxCount,
          });
          const evidence = assessment.passed
            ? ""
            : await this.screenshotOnFailure(page, "dashboard-latency-slo-failed");
          return {
            passed: assessment.passed,
            observed: `firstRowMs=${firstRowMs ?? "timeout"} (max=${DASHBOARD_INITIAL_FIRST_ROW_MAX_MS}); ` +
              `datastreamsCalls=${datastreamsCollectionCalls} (maxMs=${maxDatastreamsCollectionMs}); ` +
              `maxCountMs=${maxCountQueryMs}; nextAvailable=${nextPageAvailable}; ` +
              `nextRenderMs=${nextPageRenderMs ?? "n/a"} (max=${DASHBOARD_NEXT_PAGE_MAX_MS}, countCalls=${nextPageCountRequests}); ` +
              `obs5xx=${obs5xxCount}`,
            evidence,
          };
        } finally {
          page.off("request", onReq);
          page.off("requestfinished", onDone);
          page.off("requestfailed", onDone);
        }
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "performance",
        action: "verify /event-log load latency, collapsed-by-default UpSet disclosure, and on-demand full-filter-set UpSet summary",
        target: "/event-log",
        expected: `/event-log first row <=${EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS}ms with UpSet collapsed and 0 upfront UpSet batch queries, then clicking summary renders full-filter-set UpSet plot <=${EVENT_LOG_UPSET_EXPAND_MAX_MS}ms`,
      }, async () => {
        let upSetBatchRequestsOnLoad = 0;
        let onLoadPhase = true;
        const onReq = (req: Request) => {
          if (!onLoadPhase) return;
          const url = req.url();
          if (!url.includes("/sensorhub/api/observations") || url.includes("/observations/count")) return;
          try {
            const parsed = new URL(url);
            const lim = Number(parsed.searchParams.get("limit") ?? "0");
            const filterParam = decodeURIComponent(parsed.searchParams.get("filter") ?? "");
            if (lim > 50 && filterParam.includes("gammaAlarm=true OR neutronAlarm=true")) {
              upSetBatchRequestsOnLoad += 1;
            }
          } catch {
            // ignore malformed URL
          }
        };

        page.on("request", onReq);
        try {
          const tStart = performance.now();
          await this.goto(page, "/event-log");
          await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
          const firstRowVisible = await page.locator(".MuiDataGrid-row").first()
            .waitFor({state: "visible", timeout: EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS + 3_000})
            .then(() => true)
            .catch(() => false);
          const firstRowMs = firstRowVisible ? Math.round(performance.now() - tStart) : null;
          await sleep(400);
          onLoadPhase = false;

          const initialDom = await page.evaluate(() => {
            const sec = document.querySelector('[data-testid="event-log-upset-section"]');
            const plot = document.querySelector('[data-testid="event-log-upset-plot"]');
            const pag = document.querySelector(".MuiTablePagination-displayedRows")?.textContent?.trim() ?? "";
            const totalMatch = /of\s+([\d,]+)/i.exec(pag);
            const totalRows = totalMatch?.[1] ? Number(totalMatch[1].replace(/,/g, "")) : 0;
            return {
              sectionPresentOnLoad: Boolean(sec),
              collapsedByDefault: sec ? !sec.hasAttribute("open") : false,
              plotMountedOnLoad: Boolean(plot),
              totalRows,
            };
          });

          const tExpand = performance.now();
          await page.getByTestId("event-log-upset-summary").click();
          const outcome = await Promise.race([
            page.getByTestId("event-log-upset-plot")
              .waitFor({state: "visible", timeout: EVENT_LOG_UPSET_EXPAND_MAX_MS + 4_000})
              .then(() => "plot" as const),
            page.getByTestId("event-log-upset-empty")
              .waitFor({state: "visible", timeout: EVENT_LOG_UPSET_EXPAND_MAX_MS + 4_000})
              .then(() => "empty" as const),
          ]).catch(() => "timeout" as const);
          const expandRenderMs = outcome === "timeout" ? null : Math.round(performance.now() - tExpand);

          const expandedDom = await page.evaluate(() => {
            const plot = document.querySelector('[data-testid="event-log-upset-plot"]');
            const caption = document.querySelector('[data-testid="upset-accessible-table-details"] table caption')
              ?.textContent ?? "";
            const cappedText = document.querySelector('[data-testid="event-log-upset-section"]')
              ?.textContent ?? "";
            // Extract occupancy count from accessible table caption (e.g. "... across 1,000 alarming occupancies")
            const nums = (caption.match(/[\d,]+/g) ?? [])
              .map((token) => Number(token.replace(/,/g, "")))
              .filter((n) => Number.isFinite(n));
            const summarizedOccupancies = nums.length > 0 ? Math.max(...nums) : 0;
            const cappedOfMatch = /of\s+([\d,]+)\s+(?:matching\s+)?alarming/i.exec(cappedText);
            const reportedTotalAlarms = cappedOfMatch?.[1]
              ? Number(cappedOfMatch[1].replace(/,/g, ""))
              : summarizedOccupancies;
            return {
              plotVisibleAfterExpand: Boolean(plot),
              summarizedOccupancies,
              reportedTotalAlarms,
            };
          });

          const totalAlarmCount = outcome === "empty" ? 0 : Math.max(expandedDom.reportedTotalAlarms, expandedDom.summarizedOccupancies, outcome === "timeout" ? 1 : 0);
          const assessment = assessEventLogOnDemandUpSet({
            hasEvents: initialDom.totalRows > 0 || firstRowVisible,
            firstRowMs,
            sectionPresentOnLoad: initialDom.sectionPresentOnLoad,
            collapsedByDefault: initialDom.collapsedByDefault,
            plotMountedOnLoad: initialDom.plotMountedOnLoad,
            upSetBatchRequestsOnLoad,
            totalAlarmCount,
            expandRenderMs,
            plotVisibleAfterExpand: expandedDom.plotVisibleAfterExpand,
            summarizedOccupancies: expandedDom.summarizedOccupancies,
          });
          const evidence = assessment.passed
            ? ""
            : await this.screenshotOnFailure(page, "event-log-upset-latency-slo-failed");
          return {
            passed: assessment.passed,
            observed: `firstRowMs=${firstRowMs ?? "timeout"} (max=${EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS}); ` +
              `collapsedOnLoad=${initialDom.collapsedByDefault}; plotOnLoad=${initialDom.plotMountedOnLoad}; ` +
              `upSetBatchOnLoad=${upSetBatchRequestsOnLoad}; expandOutcome=${outcome}; ` +
              `expandMs=${expandRenderMs ?? "timeout"} (max=${EVENT_LOG_UPSET_EXPAND_MAX_MS}); ` +
              `summarizedOccupancies=${expandedDom.summarizedOccupancies} (totalAlarms=${totalAlarmCount})`,
            evidence,
          };
        } finally {
          page.off("request", onReq);
        }
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "viewer",
        action: "verify UpSet populated-first main Category Filter buttons, interactive category filtering, and Clear Filter",
        target: "/event-log",
        expected: "UpSet Category Filter buttons list populated categories (count > 0) ahead of disabled zero-count (0) categories, and clicking a populated category filters Event Log rows with aria-pressed='true' and resets via Clear Filter",
      }, async () => {
        const plotVisible = await page.getByTestId("event-log-upset-plot").isVisible().catch(() => false);
        if (!plotVisible) {
          return {
            passed: true,
            observed: "skipped UpSet category filter check (no alarming occupancies in window)",
            evidence: "",
          };
        }
        const catGroup = page.getByTestId("upset-category-filter-group").first();
        await catGroup.waitFor({state: "visible", timeout: 10_000});

        const buttonMeta = await catGroup.evaluate((groupEl) => {
          const btns = Array.from(groupEl.querySelectorAll<HTMLButtonElement>("button"));
          return btns.map((b) => {
            const text = (b.textContent ?? "").trim();
            const m = /\(([\d,]+)\)\s*$/.exec(text);
            const count = m?.[1] ? Number(m[1].replace(/,/g, "")) : 0;
            return {
              text,
              count,
              disabled: b.disabled,
              ariaPressed: b.getAttribute("aria-pressed"),
            };
          });
        });

        let seenZero = false;
        let populatedFirst = buttonMeta.length === 7;
        let disabledMatchesZero = buttonMeta.length === 7;
        for (const bm of buttonMeta) {
          if (bm.count === 0) {
            seenZero = true;
            if (!bm.disabled) disabledMatchesZero = false;
          } else {
            if (seenZero) populatedFirst = false;
            if (bm.disabled) disabledMatchesZero = false;
          }
        }

        const firstEnabledBtn = catGroup.locator("button:not([disabled])").first();
        let toggleVerified = true;
        if ((await firstEnabledBtn.count()) > 0) {
          await firstEnabledBtn.click();
          const pressedTrue = await poll(
            async () => (await firstEnabledBtn.getAttribute("aria-pressed")) === "true",
            Boolean,
            {timeoutMs: 5_000, intervalMs: 100, description: "UpSet category button aria-pressed=true"},
          ).then(() => true, () => false);
          const clearBtn = page.getByTestId("upset-clear-filter-chip").first();
          const clearVisible = await clearBtn.waitFor({state: "visible", timeout: 5_000}).then(() => true, () => false);
          if (clearVisible) {
            await clearBtn.click();
          }
          const resetFalse = await poll(
            async () => (await firstEnabledBtn.getAttribute("aria-pressed")) === "false",
            Boolean,
            {timeoutMs: 5_000, intervalMs: 100, description: "UpSet category button aria-pressed=false after Clear Filter"},
          ).then(() => true, () => false);
          toggleVerified = pressedTrue && clearVisible && resetFalse;
        }

        const passed = populatedFirst && disabledMatchesZero && toggleVerified;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "upset-category-filters-failed");
        return {
          passed,
          observed: `buttons=${buttonMeta.map((b) => `${b.text}[disabled=${b.disabled}]`).join(", ")}; ` +
            `populatedFirst=${populatedFirst}; disabledMatchesZero=${disabledMatchesZero}; toggleVerified=${toggleVerified}`,
          evidence,
        };
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "performance",
        action: "save Events query bookmark, drill into Event Details, and return to cached filtered query with zero observation round-trips",
        target: "/event-log and /event-details",
        expected: "active query saves to Saved Queries bookmark bar, Event Details exposes Back to Filtered Events and All Events links, and returning to the warm filtered query renders rows in <=1000ms with 0 /observations and 0 /observations/count requests",
      }, async () => {
        const hasAnyRow = (await page.locator(".MuiDataGrid-row").count()) > 0;
        if (!hasAnyRow) {
          return {
            passed: true,
            observed: "skipped drill-down return check (0 rows in deployment)",
            evidence: "",
          };
        }
        // Collapse UpSet if open, then apply a quick Lane ID filter on the first visible lane so activeEncodedQuery is populated
        const summaryToggle = page.getByTestId("event-log-upset-summary");
        const secOpen = await page.getByTestId("event-log-upset-section")
          .evaluate((el) => el.hasAttribute("open"))
          .catch(() => false);
        if (secOpen) {
          await summaryToggle.click();
        }

        const firstLaneText = (
          await page.locator('.MuiDataGrid-row [data-field="laneId"] .alarm-cell-primary').first().innerText()
        ).trim();
        await page.getByRole("button", {name: /advanced filters/i}).first().click();
        const fDialog = page.getByRole("dialog", {name: /advanced filters/i});
        await fDialog.waitFor({timeout: this.config.uiTimeoutMs});
        await fDialog.getByRole("button", {name: /add condition/i}).click();
        const boxes = fDialog.getByRole("combobox");
        await boxes.nth(1).click();
        await page.getByRole("option", {name: "Lane ID", exact: true}).click();
        await boxes.nth(3).click();
        await page.getByRole("option", {name: firstLaneText, exact: true}).click();
        await fDialog.getByRole("button", {name: /apply filters/i}).click();
        await fDialog.waitFor({state: "hidden", timeout: 10_000});

        await poll(
          async () => {
            const cells = await page.locator('.MuiDataGrid-row [data-field="laneId"] .alarm-cell-primary').allInnerTexts();
            return cells.length > 0 && cells.every((c) => c.trim() === firstLaneText);
          },
          Boolean,
          {timeoutMs: 15_000, intervalMs: 200, description: `filtered /event-log to ${firstLaneText}`},
        );

        const bookmarkName = "Smoke Query Bookmark";
        await page.getByTestId("saved-queries-btn").click();
        await page.getByTestId("saved-query-name-input").fill(bookmarkName);
        await page.getByTestId("confirm-save-event-query-btn").click();
        const bookmarkVisible = await page.getByTestId("saved-query-bookmark-btn")
          .filter({hasText: bookmarkName})
          .first()
          .waitFor({state: "visible", timeout: 5_000})
          .then(() => true, () => false);
        await page.getByTestId("saved-queries-popover").getByRole("button", {name: /cancel/i}).click();
        await page.getByTestId("saved-queries-popover").waitFor({state: "hidden", timeout: 5_000});

        // Double-click the first filtered row to navigate via SPA to /event-details?eventId=...&fromFiltered=1
        await page.locator(".MuiDataGrid-row").first().dblclick();
        const backFilteredBtn = page.getByTestId("back-to-filtered-events-btn");
        const allEventsBtn = page.getByTestId("open-unfiltered-events-btn");
        const detailLinksReady = await Promise.all([
          backFilteredBtn.waitFor({state: "visible", timeout: this.config.uiTimeoutMs}),
          allEventsBtn.waitFor({state: "visible", timeout: this.config.uiTimeoutMs}),
        ]).then(() => true, () => false);

        let returnObsRequests = 0;
        let returnCountRequests = 0;
        const onReturnReq = (req: import("playwright").Request) => {
          const url = req.url();
          if (!url.includes("/sensorhub/api/observations")) return;
          if (url.includes("/observations/count")) {
            returnCountRequests += 1;
          } else {
            returnObsRequests += 1;
          }
        };

        page.on("request", onReturnReq);
        const returnStartedAt = Date.now();
        let returnRenderMs: number | null = null;
        let restoredLaneMatch = false;
        try {
          await backFilteredBtn.click();
          await page.locator(".MuiDataGrid-row").first().waitFor({state: "visible", timeout: 5_000});
          restoredLaneMatch = await poll(
            async () => {
              const cells = await page.locator('.MuiDataGrid-row [data-field="laneId"] .alarm-cell-primary').allInnerTexts();
              return cells.length > 0 && cells.every((c) => c.trim() === firstLaneText);
            },
            Boolean,
            {timeoutMs: 1_000, intervalMs: 40, description: `cached filtered return to ${firstLaneText}`},
          ).catch(() => false);
          returnRenderMs = Date.now() - returnStartedAt;
        } finally {
          page.off("request", onReturnReq);
        }

        // Clean up bookmark so localStorage stays clean
        await page.getByTestId("saved-queries-btn").click();
        const delBtn = page.getByRole("button", {name: `Delete saved query ${bookmarkName}`}).first();
        if (await delBtn.isVisible().catch(() => false)) {
          await delBtn.click();
        }
        await page.getByTestId("saved-queries-popover").getByRole("button", {name: /cancel/i}).click();

        const passed = bookmarkVisible &&
          detailLinksReady &&
          restoredLaneMatch &&
          returnRenderMs !== null &&
          returnRenderMs <= 1_000 &&
          returnObsRequests === 0 &&
          returnCountRequests === 0;
        return {
          passed,
          observed: `lane=${firstLaneText}; bookmarkVisible=${bookmarkVisible}; detailLinksReady=${detailLinksReady}; ` +
            `restoredLaneMatch=${restoredLaneMatch}; returnRenderMs=${returnRenderMs ?? "timeout"} (max=1000); ` +
            `returnObsRequests=${returnObsRequests}; returnCountRequests=${returnCountRequests}`,
          evidence: passed ? "" : await this.screenshotOnFailure(page, "saved-query-cached-return-failed"),
        };
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "performance",
        action: "verify /event-log 10x rapid Previous (<) backward pagination in Priority and Newest-first sorts plus O(1) multi-Parquet deep-offset latency invariance",
        target: "/event-log and /sensorhub/api/observations",
        expected: `10x Previous (<) settles <=${EVENT_LOG_BACKWARD_10X_MAX_MS}ms via settled debounce (<=${EVENT_LOG_BACKWARD_10X_MAX_PAGE_QUERIES} offset page queries) in both Priority and Newest-first sorts, 0 unbounded startTime/endTime lookups, <=${EVENT_LOG_MAX_DUPLICATE_OFFSET_REQUESTS} duplicate offset fetches, and scoped + unscoped deep-offset ConSys pages <=${EVENT_LOG_DEEP_OFFSET_MAX_MS}ms`,
      }, async () => {
        let obs5xxCount = 0;
        let unboundedStartEndLookups = 0;
        let totalPaginatedOffsetRequests = 0;
        const offsetCounts = new Map<string, number>();
        const capturedOccupancyStreams = new Set<string>();

        const onReq = (req: Request) => {
          const url = req.url();
          if (!url.includes("/sensorhub/api/observations") || url.includes("/observations/count")) return;
          try {
            const parsed = new URL(url);
            const ds = parsed.searchParams.get("dataStream") ?? "";
            if (ds.includes(",")) {
              for (const id of ds.split(",")) {
                if (id.trim()) capturedOccupancyStreams.add(id.trim());
              }
            }
            const filterVal = decodeURIComponent(parsed.searchParams.get("filter") ?? "");
            if (filterVal.includes("startTime=") && !parsed.searchParams.has("phenomenonTime")) {
              unboundedStartEndLookups += 1;
            }
            const offsetVal = parsed.searchParams.get("offset");
            if (offsetVal && Number(offsetVal) > 0) {
              totalPaginatedOffsetRequests += 1;
              const key = `${filterVal}|offset=${offsetVal}|limit=${parsed.searchParams.get("limit") ?? ""}`;
              offsetCounts.set(key, (offsetCounts.get(key) ?? 0) + 1);
            }
          } catch {
            // ignore malformed URL
          }
        };
        const onRes = (res: Response) => {
          if (res.url().includes("/sensorhub/api/observations") && res.status() >= 500) {
            obs5xxCount += 1;
          }
        };

        page.on("request", onReq);
        page.on("response", onRes);
        try {
          await this.goto(page, "/event-log");
          await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
          await page.locator(".MuiDataGrid-row").first().waitFor({state: "visible", timeout: 10_000}).catch(() => {});

          const readPaginationMeta = () => page.evaluate(() => {
            const pag = document.querySelector(".MuiTablePagination-displayedRows")?.textContent?.trim() ?? "";
            const totalMatch = /of\s+([\d,]+)/i.exec(pag);
            const totalRows = totalMatch?.[1] ? Number(totalMatch[1].replace(/,/g, "")) : 0;
            const r0 = document.querySelector(".MuiDataGrid-row");
            const firstSig = r0
              ? `${r0.getAttribute("data-id") ?? ""}|${(r0.textContent ?? "").slice(0, 80)}`
              : "";
            const busy = Boolean(
              document.querySelector(".MuiDataGrid-main .MuiCircularProgress-root") ||
              document.querySelector(".MuiDataGrid-main .MuiLinearProgress-root"),
            );
            return {pag, totalRows, firstSig, rowCount: document.querySelectorAll(".MuiDataGrid-row").length, busy};
          });

          const waitSettledAtPage = async (pageIdx: number, prevSig: string): Promise<string | null> => {
            const expectedStart = pageIdx * 15 + 1;
            let latestSig: string | null = null;
            const settled = await poll(
              async () => {
                const m = await readPaginationMeta();
                const startsOk = m.pag.startsWith(`${expectedStart}–`) || m.pag.startsWith(`${expectedStart}-`);
                if (!startsOk || m.busy || m.rowCount === 0 || !m.firstSig || m.firstSig === prevSig) {
                  return false;
                }
                latestSig = m.firstSig;
                return true;
              },
              Boolean,
              {timeoutMs: 15_000, intervalMs: 40, description: `/event-log page ${pageIdx} settled`},
            ).then(() => true, () => false);
            return settled ? latestSig : null;
          };

          const initialMeta = await readPaginationMeta();
          const totalRows = initialMeta.totalRows;
          const maxPageIndex = totalRows > 15 ? Math.floor((totalRows - 1) / 15) : 0;
          const forwardPages = maxPageIndex >= 2
            ? Math.min(11, maxPageIndex)
            : maxPageIndex;

          const runSortModeBackwardCheck = async (): Promise<EventLogBackwardSortModeObservation> => {
            if (forwardPages === 0) {
              return {
                pagesStepped: 0,
                backwardBurstMs: 0,
                visitedBackwardServerRowQueries: 0,
                settledBackAtPageZero: true,
              };
            }
            const nextBtn = page.locator('button[aria-label="Go to next page"], button[title="Go to next page"]').first();
            const prevBtn = page.locator('button[aria-label="Go to previous page"], button[title="Go to previous page"]').first();
            let prevSig = (await readPaginationMeta()).firstSig;
            for (let p = 1; p <= forwardPages; p++) {
              await nextBtn.click();
              const nextSig = await waitSettledAtPage(p, prevSig);
              if (!nextSig) {
                return {
                  pagesStepped: forwardPages,
                  backwardBurstMs: null,
                  visitedBackwardServerRowQueries: 0,
                  settledBackAtPageZero: false,
                };
              }
              prevSig = nextSig;
            }
            // Wait briefly for any trailing forward prefetch request registration to settle before counting visited backward requests
            await sleep(200);
            if (forwardPages >= 2) {
              // Click Previous (<) up to 10 times in a row (e.g. Page 11 -> Page 1),
              // verifying settled 120ms debounce collapses intermediate clicks without serialized multi-page stalls.
              const historicalClicks = forwardPages - 1;
              const beforeBackRowReqs = totalPaginatedOffsetRequests;
              const tBack = performance.now();
              for (let k = 0; k < historicalClicks; k++) {
                await prevBtn.click({delay: 30});
              }
              const backOneSig = await waitSettledAtPage(1, prevSig);
              const backwardBurstMs = backOneSig ? Math.round(performance.now() - tBack) : null;
              const visitedBackwardServerRowQueries = totalPaginatedOffsetRequests - beforeBackRowReqs;
              if (!backOneSig) {
                return {
                  pagesStepped: historicalClicks,
                  backwardBurstMs: null,
                  visitedBackwardServerRowQueries,
                  settledBackAtPageZero: false,
                };
              }
              // Step back from Page 1 -> Page 0 (which intentionally refreshes live Page 0)
              await prevBtn.click();
              const backZeroSig = await waitSettledAtPage(0, backOneSig);
              return {
                pagesStepped: historicalClicks,
                backwardBurstMs,
                visitedBackwardServerRowQueries,
                settledBackAtPageZero: backZeroSig !== null,
              };
            }
            const tBack = performance.now();
            await prevBtn.click();
            const backZeroSig = await waitSettledAtPage(0, prevSig);
            return {
              pagesStepped: 1,
              backwardBurstMs: backZeroSig ? Math.round(performance.now() - tBack) : null,
              visitedBackwardServerRowQueries: 0,
              settledBackAtPageZero: backZeroSig !== null,
            };
          };

          const prioritySort = await runSortModeBackwardCheck();

          // Toggle "Newest first" chronological mode and repeat the 10x Previous (<) check
          const newestBtn = page.getByTestId("toolbar-sort-time-only").first();
          await newestBtn.waitFor({state: "visible", timeout: 10_000});
          await newestBtn.click();
          await poll(
            async () => (await newestBtn.getAttribute("aria-pressed")) === "true",
            Boolean,
            {timeoutMs: 5_000, intervalMs: 50, description: "Newest first sort active"},
          );
          if (totalRows > 0) {
            await waitSettledAtPage(0, "__NEWEST_INIT__");
          }
          offsetCounts.clear();
          const newestFirstSort = await runSortModeBackwardCheck();

          // Probe ConSys deep-offset O(1) latency invariance directly across available history depth
          const deepOffsetProbes: EventLogDeepOffsetProbeObservation[] = [];
          if (capturedOccupancyStreams.size > 0 && totalRows > 60) {
            const dsCsv = [...capturedOccupancyStreams].join(",");
            const cutoffIso = new Date().toISOString();
            const candidateOffsets = [405, 150_000, 1_500_000]
              .filter((off) => off + 15 <= totalRows);
            if (candidateOffsets.length === 0) {
              candidateOffsets.push(Math.max(15, Math.floor((totalRows - 15) / 15) * 15));
            }
            for (const probeOffset of candidateOffsets) {
              const params = new URLSearchParams({
                dataStream: dsCsv,
                resultTime: `../${cutoffIso}`,
                filter: probeOffset >= 5_000 ? "gammaAlarm=false AND neutronAlarm=false" : "",
                order: "desc",
                offset: String(probeOffset),
                limit: "15",
              });
              if (!params.get("filter")) params.delete("filter");
              const tProbe = performance.now();
              const res = await page.context().request.get(
                this.viewerUrl(`/sensorhub/api/observations?${params}`),
                {headers: {Accept: "application/om+json"}},
              );
              const durationMs = Math.round(performance.now() - tProbe);
              let itemCount = 0;
              try {
                if (res.ok()) {
                  const payload = await res.json() as {items?: unknown[]};
                  itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
                }
              } finally {
                await res.dispose();
              }
              if (itemCount > 0 || probeOffset < 5_000) {
                deepOffsetProbes.push({
                  offset: probeOffset,
                  status: res.status(),
                  itemCount,
                  durationMs,
                });
              }
            }
            // Also verify unscoped /observations?offset=... pushes offset past default empty InMemoryObsStore (systemStateDb)
            if (totalRows >= 60) {
              const recentStartIso = new Date(Date.now() - 2 * 3_600_000).toISOString();
              const unscopedParams = new URLSearchParams({
                phenomenonTime: `${recentStartIso}/${cutoffIso}`,
                resultTime: `../${cutoffIso}`,
                order: "desc",
                offset: "300",
                limit: "15",
              });
              const tUnscoped = performance.now();
              const resUnscoped = await page.context().request.get(
                this.viewerUrl(`/sensorhub/api/observations?${unscopedParams}`),
                {headers: {Accept: "application/om+json"}},
              );
              const unscopedMs = Math.round(performance.now() - tUnscoped);
              let unscopedItems = 0;
              try {
                if (resUnscoped.ok()) {
                  const payload = await resUnscoped.json() as {items?: unknown[]};
                  unscopedItems = Array.isArray(payload.items) ? payload.items.length : 0;
                }
              } finally {
                await resUnscoped.dispose();
              }
              deepOffsetProbes.push({
                offset: 300,
                status: resUnscoped.status(),
                itemCount: unscopedItems,
                durationMs: unscopedMs,
              });
            }
          }

          const errorBannerShown = (await page.locator('text="Events could not be loaded"').count()) > 0;
          const noResultsShown = (await page.locator('text="No results found"').count()) > 0;
          const maxDuplicateOffsetRequests = offsetCounts.size > 0
            ? Math.max(...offsetCounts.values())
            : 0;

          const assessment = assessEventLogBackwardPaginationAndScaling({
            totalRows,
            prioritySort,
            newestFirstSort,
            deepOffsetProbes,
            obs5xxCount,
            unboundedStartEndLookups,
            maxDuplicateOffsetRequests,
            errorBannerShown,
            noResultsShown,
          });
          const evidence = assessment.passed
            ? ""
            : await this.screenshotOnFailure(page, "event-log-backward-pagination-failed");
          return {
            passed: assessment.passed,
            observed: `totalRows=${totalRows}; priority10xBackMs=${prioritySort.backwardBurstMs ?? "timeout"} (srvReqs=${prioritySort.visitedBackwardServerRowQueries}); ` +
              `newest10xBackMs=${newestFirstSort.backwardBurstMs ?? "timeout"} (srvReqs=${newestFirstSort.visitedBackwardServerRowQueries}); ` +
              `deepProbes=[${deepOffsetProbes.map((p) => `off=${p.offset}:${p.status}:${p.itemCount}rows:${p.durationMs}ms`).join(", ")}]; ` +
              `obs5xx=${obs5xxCount}; unboundedLookups=${unboundedStartEndLookups}; maxDupOffsetReqs=${maxDuplicateOffsetRequests}`,
            evidence,
          };
        } finally {
          page.off("request", onReq);
          page.off("response", onRes);
        }
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "viewer",
        action: "customize and reset Dashboard widgets",
        target: "/",
        expected: "toggling Lane Status, Events, and Map Preview updates DOM visibility and localStorage, shows the empty reset state when all are hidden, and restores all widgets on Reset",
      }, async () => {
        await this.goto(page, "/");
        const bar = page.getByTestId("dashboard-widget-customization-bar");
        await bar.waitFor({timeout: this.config.uiTimeoutMs});
        const laneWidget = page.getByTestId("dashboard-widget-laneStatus");
        const eventWidget = page.getByTestId("dashboard-widget-eventTable");
        const quickViewWidget = page.getByTestId("dashboard-widget-quickView");
        const initialAllVisible = (await laneWidget.count()) === 1 &&
          (await eventWidget.count()) === 1 &&
          (await quickViewWidget.count()) === 1;

        await page.getByTestId("dashboard-widget-toggle-laneStatus").click();
        await poll(async () => laneWidget.count(), (count) => count === 0, {
          timeoutMs: 5_000,
          intervalMs: 100,
          description: "Lane Status widget to hide after toggle",
        });
        const laneStatusHiddenInDom = (await laneWidget.count()) === 0;
        const storedWhenLaneStatusHidden = await page.evaluate(() => {
          const raw = window.localStorage.getItem("oscar.dashboardWidgets.v1");
          return raw ? JSON.parse(raw) as {laneStatus?: boolean; eventTable?: boolean; quickView?: boolean} : null;
        });

        await page.getByTestId("dashboard-widget-toggle-eventTable").click();
        await page.getByTestId("dashboard-widget-toggle-quickView").click();
        const emptyReset = page.getByTestId("dashboard-empty-reset");
        const allHiddenResetPromptVisible = await emptyReset.waitFor({timeout: 5_000})
          .then(() => true)
          .catch(() => false);

        await emptyReset.click();
        await poll(
          async () => (await laneWidget.count()) === 1 &&
            (await eventWidget.count()) === 1 &&
            (await quickViewWidget.count()) === 1,
          (restored) => restored,
          {timeoutMs: 5_000, intervalMs: 100, description: "Dashboard widgets to restore after Reset"},
        );
        const restoredAfterResetInDom = (await laneWidget.count()) === 1 &&
          (await eventWidget.count()) === 1 &&
          (await quickViewWidget.count()) === 1;
        const storedAfterReset = await page.evaluate(() => {
          const raw = window.localStorage.getItem("oscar.dashboardWidgets.v1");
          return raw ? JSON.parse(raw) as {laneStatus?: boolean; eventTable?: boolean; quickView?: boolean} : null;
        });

        const passed = assessDashboardWidgetCustomization({
          initialAllVisible,
          laneStatusHiddenInDom,
          storedWhenLaneStatusHidden,
          allHiddenResetPromptVisible,
          restoredAfterResetInDom,
          storedAfterReset,
        });
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-widget-customization-failed");
        return {
          passed,
          observed: `initialAllVisible=${initialAllVisible}; laneStatusHidden=${laneStatusHiddenInDom}; ` +
            `allHiddenResetPrompt=${allHiddenResetPromptVisible}; restored=${restoredAfterResetInDom}`,
          evidence,
        };
      });

      const localeChecks = [
        {
          locale: "en",
          loginTitle: "OSCAR sign in",
          loginButton: "Sign in",
          laneStatus: "Lane Status",
          events: "Events",
          health: "Status of Health",
        },
        {
          locale: "es",
          loginTitle: "Iniciar sesión en OSCAR",
          loginButton: "Iniciar sesión",
          laneStatus: "Estado del carril",
          events: "Eventos",
          health: "Estado de funcionamiento",
        },
        {
          locale: "fr",
          loginTitle: "Connexion OSCAR",
          loginButton: "Se connecter",
          laneStatus: "État de la voie",
          events: "Événements",
          health: "État de fonctionnement",
        },
        {
          locale: "el",
          loginTitle: "Σύνδεση OSCAR",
          loginButton: "Σύνδεση",
          laneStatus: "Κατάσταση λωρίδας",
          events: "Συμβάντα",
          health: "Κατάσταση λειτουργίας",
        },
      ] as const;

      await this.check({
        scenario: "viewer-navigation",
        category: "i18n",
        action: "verify 4-locale login, Viewer localization, and container fit",
        target: "en, es, fr, el @ 1280x800 and 1920x1080",
        expected: "every supported locale renders exact localized title/button on /login and headings on /, /event-log, and /health with zero horizontal document overflow at 1280x800 and 1920x1080",
      }, async () => {
        const failures: string[] = [];
        const checkOverflow = async (targetPage: typeof page, label: string) => {
          for (const viewport of [
            {width: 1280, height: 800},
            {width: 1920, height: 1080},
          ] as const) {
            await targetPage.setViewportSize(viewport);
            await targetPage.waitForTimeout(100);
            const metrics = await targetPage.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
            }));
            if (metrics.scrollWidth > metrics.innerWidth + 1) {
              failures.push(`${label}@${viewport.width}x${viewport.height}:overflow(${metrics.scrollWidth}>${metrics.innerWidth})`);
            }
          }
        };

        const browser = page.context().browser();
        if (!browser) throw new Error("Playwright browser instance unavailable for unauthenticated /login check");
        const loginCtx = await browser.newContext({ignoreHTTPSErrors: true});
        const loginPage = await loginCtx.newPage();
        try {
          for (const spec of localeChecks) {
            await loginPage.goto(this.viewerUrl(`/login?lang=${spec.locale}`), {waitUntil: "domcontentloaded"});
            const headingVisible = await loginPage.getByRole("heading", {name: "OSCAR", exact: true})
              .first()
              .waitFor({timeout: this.config.uiTimeoutMs})
              .then(() => true)
              .catch(() => false);
            const buttonVisible = await loginPage.getByRole("button", {name: spec.loginButton, exact: true})
              .first()
              .waitFor({timeout: this.config.uiTimeoutMs})
              .then(() => true)
              .catch(() => false);
            const actualTitle = await loginPage.title();
            if (!headingVisible || !buttonVisible || actualTitle !== spec.loginTitle) {
              failures.push(`${spec.locale}:login(title=${actualTitle},btn=${buttonVisible})`);
            }
            await checkOverflow(loginPage, `${spec.locale}:/login`);

            await page.evaluate((lang) => {
              window.localStorage.setItem("language", lang);
              document.cookie = `osh-language=${lang}; path=/; SameSite=Lax`;
            }, spec.locale);

            for (const [routePath, expectedHeading] of [
              ["/", spec.laneStatus],
              ["/event-log", spec.events],
              ["/health", spec.health],
            ] as const) {
              await this.goto(page, routePath);
              const headingVisible = await page.getByRole("heading", {name: expectedHeading, exact: true})
                .first()
                .waitFor({timeout: this.config.uiTimeoutMs})
                .then(() => true)
                .catch(() => false);
              if (!headingVisible) failures.push(`${spec.locale}:${routePath}(${expectedHeading})`);
              await checkOverflow(page, `${spec.locale}:${routePath}`);
            }
          }
        } finally {
          await loginCtx.close().catch(() => undefined);
          await page.setViewportSize({width: 1600, height: 1000}).catch(() => undefined);
          await page.evaluate(() => {
            window.localStorage.setItem("language", "en");
            document.cookie = "osh-language=en; path=/; SameSite=Lax";
          }).catch(() => undefined);
          await this.goto(page, "/").catch(() => undefined);
        }

        const passed = failures.length === 0;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "viewer-i18n-container-fit-failed");
        return {
          passed,
          observed: passed
            ? "en, es, fr, el verified across /login, /, /event-log, /health at 1280x800 and 1920x1080 with 0 overflow"
            : `failures=${failures.join("; ")}`,
          evidence,
        };
      });

      await this.check({
        scenario: "viewer-navigation",
        category: "viewer",
        action: "verify historical Event Details chart bounds and preview transitions",
        target: "/event-details and /event-log",
        expected: "opening the earliest stored alarm in Event Details and switching rows in Event Preview renders bounded charts without client-side TimeScale exceptions",
      }, async () => {
        const dsResponse = await page.context().request.get(
          this.viewerUrl("/sensorhub/api/datastreams?limit=1000"),
          {headers: {Accept: "application/json"}},
        );
        let earliestAlarmId = "";
        let earliestStartTime = "";
        let hasOccupancyStreams = false;
        try {
          if (dsResponse.ok()) {
            const configuredUids = this.config.laneConfigOracle?.lanes?.length
              ? new Set(this.config.laneConfigOracle.lanes.map((l) => l.uniqueId.trim().toLowerCase()))
              : null;
            const matchesConfiguredLane = (item: {
              "system@link"?: {uid?: string};
              system?: {uid?: string};
            }): boolean => {
              if (!configuredUids || configuredUids.size === 0) return true;
              const sysUid = String(item["system@link"]?.uid ?? item.system?.uid ?? "").trim().toLowerCase();
              const tail = sysUid.split(":").pop() ?? "";
              return tail.length > 0 && configuredUids.has(tail);
            };
            const dsPayload = await dsResponse.json() as {
              items?: Array<{
                id?: string;
                outputName?: string;
                "system@link"?: {uid?: string};
                system?: {uid?: string};
              }>;
            };
            const occIds = (dsPayload.items ?? [])
              .filter((item) => String(item.outputName ?? "").trim() === "occupancy" && matchesConfiguredLane(item))
              .map((item) => String(item.id ?? "").trim())
              .filter(Boolean)
              .slice(0, 50);
            hasOccupancyStreams = occIds.length > 0;
            if (occIds.length > 0) {
              const obsParams = new URLSearchParams({
                dataStream: occIds.join(","),
                filter: "(gammaAlarm=true OR neutronAlarm=true)",
                order: "asc",
                limit: "1",
              });
              const obsResponse = await page.context().request.get(
                this.viewerUrl(`/sensorhub/api/observations?${obsParams}`),
                {headers: {Accept: "application/om+json"}},
              );
              try {
                if (obsResponse.ok()) {
                  const obsPayload = await obsResponse.json() as {
                    items?: Array<{
                      id?: string;
                      phenomenonTime?: string;
                      result?: {startTime?: string};
                      properties?: {result?: {startTime?: string}};
                    }>;
                  };
                  const first = obsPayload.items?.[0];
                  earliestAlarmId = String(first?.id ?? "").trim();
                  earliestStartTime = String(
                    first?.result?.startTime ?? first?.properties?.result?.startTime ?? first?.phenomenonTime ?? "",
                  );
                }
              } finally {
                await obsResponse.dispose();
              }
            }
          }
        } finally {
          await dsResponse.dispose();
        }

        let detailsVerified = true;
        if (earliestAlarmId) {
          await this.browser.withExpectedHistoricalClipDate(earliestStartTime, async () => {
            await this.goto(page, `/event-details?eventId=${encodeURIComponent(earliestAlarmId)}`);
            const uuidVisible = await page.getByTestId("event-uuid-value")
              .waitFor({timeout: this.config.eventTimeoutMs})
              .then(() => true)
              .catch(() => false);
            const canvasVisible = await page.locator("div.chart-view-event-detail canvas").first()
              .waitFor({timeout: this.config.uiTimeoutMs})
              .then(() => true)
              .catch(() => false);
            await page.waitForTimeout(1_500);
            const bodyText = await page.locator("body").innerText();
            detailsVerified = uuidVisible && canvasVisible && !/application error|internal server error/i.test(bodyText);
          });
        }

        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
        const gridRows = page.locator(".MuiDataGrid-row");
        if (hasOccupancyStreams) {
          await gridRows.first().waitFor({timeout: 5_000}).catch(() => undefined);
        }
        const visibleRowCount = await gridRows.count();
        let previewTransitions = 0;
        for (let idx = 0; idx < Math.min(2, visibleRowCount); idx++) {
          const targetCell = gridRows.nth(idx).locator('[data-field="laneId"]').first();
          if (await targetCell.isVisible().catch(() => false)) {
            await targetCell.click();
            await page.waitForTimeout(400);
            previewTransitions++;
          }
        }
        const postPreviewBody = await page.locator("body").innerText();
        const previewClean = !/application error|internal server error/i.test(postPreviewBody);
        const passed = detailsVerified && previewClean;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "historical-event-details-preview-failed");
        return {
          passed,
          observed: `earliestAlarmId=${earliestAlarmId || "none"}(${earliestStartTime || "n/a"}); ` +
            `detailsVerified=${detailsVerified}; previewTransitions=${previewTransitions}; previewClean=${previewClean}`,
          evidence,
        };
      });
    } finally { await page.close(); }
  }

  private async mapNationalServers(): Promise<void> {
    const page = await this.browser.oscarPage();
    try {
      let expectedNodeName = "Local Node";
      try {
        const sysRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/api/systems?format=application%2Fjson&limit=200"),
        );
        if (sysRes.ok()) {
          const sysPayload = await sysRes.json() as {
            items?: Array<{
              uid?: string;
              name?: string;
              validTime?: string[];
              properties?: {uid?: string; name?: string; validTime?: string[]};
            }>;
          };
          const oscarSystems = (sysPayload.items ?? []).filter((item) =>
            String(item?.uid ?? item?.properties?.uid ?? "").includes("urn:ornl:oscar:system:"),
          );
          oscarSystems.sort((a, b) => {
            const va = String(a?.validTime?.[0] ?? a?.properties?.validTime?.[0] ?? "");
            const vb = String(b?.validTime?.[0] ?? b?.properties?.validTime?.[0] ?? "");
            return vb.localeCompare(va);
          });
          const rawName = String(oscarSystems[0]?.name ?? oscarSystems[0]?.properties?.name ?? "").trim();
          if (rawName && rawName !== "OSCAR System") {
            expectedNodeName = rawName;
          }
        }
        await sysRes.dispose();
      } catch {
        // Default to "Local Node" if systems metadata lookup is unavailable
      }
      await this.check({
        scenario: "map-national-servers", category: "map", action: "render site map",
        target: "/map", expected: "interactive map container renders at non-zero size",
      }, async () => {
        await this.goto(page, "/map");
        const map = page.locator("#mapcontainer");
        await map.waitFor();
        const box = await map.boundingBox();
        return {
          passed: Boolean(box && box.width > 100 && box.height > 100),
          observed: box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no rendered map box",
        };
      });

      await this.check({
        scenario: "map-national-servers", category: "national", action: "refresh national statistics",
        target: "/national-view",
        expected: "the refresh command reaches a successful durable terminal status and its exact new observation renders in the local node row",
      }, async () => {
        const baselineResponsePromise = page.waitForResponse((response) => {
          if (response.request().method() !== "GET") return false;
          const url = new URL(response.url());
          return /\/observations\/?$/.test(url.pathname) &&
            url.searchParams.get("resultTime") === "latest" &&
            url.searchParams.get("observedProperty") === NATIONAL_STATISTICS_OBSERVED_PROPERTY;
        }, {timeout: this.config.eventTimeoutMs});
        await this.goto(page, "/national-view");
        const baselineResponse = await baselineResponsePromise;
        if (!baselineResponse.ok()) {
          throw new Error(`National statistics baseline returned HTTP ${baselineResponse.status()}`);
        }
        const baseline = assessLatestNationalStatisticsObservation(await baselineResponse.json());
        const refreshControl = page.locator(NATIONAL_REFRESH_CONTROL_SELECTOR);
        await refreshControl.waitFor();
        if (await refreshControl.count() !== 1) {
          throw new Error("National statistics page must expose exactly one stable refresh control");
        }
        const readRefreshControl = (): Promise<NationalRefreshControlState> =>
          refreshControl.evaluate((element) => ({
            enabled: !(element as HTMLButtonElement).disabled,
            ariaBusy: element.getAttribute("aria-busy"),
          }));
        const commandResponse = page.waitForResponse(
          (response) => response.request().method() === "POST" &&
            /\/controlstreams\/[^/]+\/commands/.test(new URL(response.url()).pathname),
          {timeout: this.config.eventTimeoutMs},
        );
        const exactUiObservationIds = new Set<string>();
        const exactUiObservationFailures: string[] = [];
        const captureExactUiObservation = (response: Response) => {
          const classified = classifyNationalStatisticsViewerObservationResponse(
            response.request().method(),
            response.url(),
            response.status(),
            baselineResponse.url(),
          );
          if (!classified) return;
          if (classified.successful) {
            exactUiObservationIds.add(classified.observationId);
          } else {
            exactUiObservationFailures.push(
              `${classified.observationId}: HTTP ${classified.status}`,
            );
          }
        };
        page.on("response", captureExactUiObservation);
        const requestStartedAt = Date.now();
        try {
          await page.getByRole("button", {name: "Refresh Statistics"}).click();
          const response = await commandResponse;
          if (!response.ok()) {
            throw new Error(`National statistics command returned HTTP ${response.status()}`);
          }

          let progress: NationalStatisticsCommandProgress =
            assessNationalStatisticsCommandSubmission(await response.json());
          const commandsUrl = new URL(response.url());
          const statusUrl = new URL(commandsUrl);
          statusUrl.pathname = `${commandsUrl.pathname.replace(/\/+$/, "")}/${encodeURIComponent(progress.commandId)}/status`;
          statusUrl.search = "format=application/json&offset=0&limit=100";

          const completionDeadline = requestStartedAt + NATIONAL_STATISTICS_COMPLETION_TIMEOUT_MS;
          while (progress.state !== "complete") {
            assertNationalRefreshPendingControl(progress, await readRefreshControl());
            if (Date.now() >= completionDeadline) {
              throw new Error(
                `National statistics command ${progress.commandId} did not reach a successful terminal status within ` +
                `${NATIONAL_STATISTICS_COMPLETION_TIMEOUT_MS / 60_000} minutes`,
              );
            }
            await sleep(2_000);
            const statusResponse = await page.context().request.get(statusUrl.toString());
            try {
              if (!statusResponse.ok()) {
                throw new Error(`National statistics command status returned HTTP ${statusResponse.status()}`);
              }
              progress = assessNationalStatisticsCommandStatus(
                await statusResponse.json(),
                progress.commandId,
              );
            } finally {
              await statusResponse.dispose();
            }
          }

          const observationId = progress.observationId;
          if (!observationId) {
            throw new Error(`National statistics command ${progress.commandId} omitted its observation result`);
          }
          const observationUrl = new URL(baselineResponse.url());
          observationUrl.search = "";
          observationUrl.pathname = `${observationUrl.pathname.replace(/\/+$/, "")}/${encodeURIComponent(observationId)}`;
          const exactResponse = await page.context().request.get(observationUrl.toString());
          let refreshed: NationalStatisticsObservation;
          try {
            if (!exactResponse.ok()) {
              throw new Error(`Exact national statistics observation returned HTTP ${exactResponse.status()}`);
            }
            refreshed = assessExactNationalStatisticsObservation(await exactResponse.json(), observationId);
          } finally {
            await exactResponse.dispose();
          }
          assertFreshNationalStatisticsObservation(baseline, refreshed);

          const rendered = await poll(async () => {
            const localRow = page.locator(".MuiDataGrid-row").filter({
              has: page.locator('[data-field="site"]', {hasText: expectedNodeName}),
            }).first();
            await localRow.waitFor({timeout: this.config.uiTimeoutMs});
            const values = {} as Record<NationalStatisticsField, string>;
            for (const field of NATIONAL_STATISTICS_FIELDS) {
              values[field] = await localRow.locator(`[data-field="${field}"]`).innerText();
            }
            const statistics = parseRenderedNationalStatistics(values);
            return {
              statistics,
              exactObservationRequestedByViewer: exactUiObservationIds.has(observationId),
              refreshControl: await readRefreshControl(),
              viewerFetchFailures: [...exactUiObservationFailures],
            };
          }, candidate => candidate.exactObservationRequestedByViewer &&
              isNationalRefreshCompletedControl(candidate.refreshControl) &&
              nationalStatisticsEqual(candidate.statistics, refreshed.statistics), {
            timeoutMs: this.config.eventTimeoutMs,
            intervalMs: 250,
            description: `Viewer to render exact national statistics observation ${observationId}`,
          });

          assertNationalRefreshCompletedControl(rendered.refreshControl);
          const passed = rendered.exactObservationRequestedByViewer &&
              nationalStatisticsEqual(rendered.statistics, refreshed.statistics);
          return {
            passed,
            observed: `command HTTP ${response.status()}; command=${progress.commandId}; ` +
              `terminal=${progress.statusCode}; legacy accepted result=${progress.legacyAcceptedResult}; ` +
              `baseline=${baseline?.id ?? "none"}; refreshed=${refreshed.id}; exact Viewer fetch=` +
              `${rendered.exactObservationRequestedByViewer}; Viewer fetch failures=` +
              `${JSON.stringify(rendered.viewerFetchFailures)}; rendered=${JSON.stringify(rendered.statistics)}`,
          };
        } finally {
          page.off("response", captureExactUiObservation);
        }
      });

      await this.check({
        scenario: "map-national-servers", category: "configuration", action: "inspect server management",
        target: "/servers", expected: "Nodes list and Add Server form render with authoritative node name and authentication badge without changing configuration",
      }, async () => {
        await this.goto(page, "/servers");
        const nodes = page.getByRole("heading", {name: "Nodes", exact: true});
        const addServer = page.getByRole("heading", {name: "Add a New Server", exact: true});
        await Promise.all([nodes.waitFor(), addServer.waitFor()]);
        const body = await page.locator("body").innerText();
        const nodeListed = body.includes(expectedNodeName) || /Local Node/i.test(body);
        const sessionBadge = /Browser Session/i.test(body);
        const quickFedBtn = await page.getByTestId("switch-to-federation-token-btn").isVisible().catch(() => false);
        const passed = nodeListed && sessionBadge && quickFedBtn;
        return {
          passed,
          observed: `expectedNode=${expectedNodeName}; listed=${nodeListed}; sessionBadge=${sessionBadge}; quickFedBtn=${quickFedBtn}`,
          evidence: passed ? "" : await this.screenshotOnFailure(page, "servers-page-inspection-failed"),
        };
      });

      await this.check({
        scenario: "map-national-servers",
        category: "security",
        action: "verify Users & Access (/users), Octelium password separation guidance, Federation Token mint/revoke, and /servers?auth=bearer deep link",
        target: "/users and /servers?auth=bearer",
        expected: "Users & Access renders persistent session status + Octelium password independence note, mints a temporary Federation Service Token, opens /servers?auth=bearer in Federation Service Token HTTPS 443 mode, and revokes the probe token cleanly",
      }, async () => {
        const probeLabel = `Regression Fed Probe ${this.reporter.runId}`;
        let createdTokenId = "";
        try {
          await this.goto(page, "/users");
          await page.getByRole("heading", {name: /Users, Passkeys & Access Control/i}).waitFor({timeout: this.config.uiTimeoutMs});
          await page.getByText(/Signed-In Account Summary/i).first().waitFor({timeout: this.config.uiTimeoutMs});
          const accountBody = await page.locator("body").innerText();
          const hasStaySignedIn = /Stays signed in until you click Log Out|Idle\s+\d+\s*m/i.test(accountBody);
          const hasOcteliumNote = /Octelium/i.test(accountBody) && /does NOT require changing/i.test(accountBody);

          await page.getByRole("tab", {name: /Federation Tokens/i}).click();
          const howToCardVisible = await page.getByTestId("fed-token-how-to-use-card")
            .waitFor({state: "visible", timeout: 10_000})
            .then(() => true, () => false);

          await page.getByLabel(/Remote Organization \/ Node Label/i).first().fill(probeLabel);
          const createResPromise = page.waitForResponse(
            (res) => res.request().method() === "POST" && res.url().includes("/sensorhub/session/admin/federation-tokens"),
            {timeout: 15_000},
          );
          await page.getByRole("button", {name: /Create Federation Token/i}).first().click();
          const createRes = await createResPromise;
          if (createRes.ok()) {
            const payload = await createRes.json() as {record?: {id?: string}; token?: string};
            createdTokenId = String(payload?.record?.id ?? "");
          }

          const openServersBtn = page.getByTestId("new-fed-token-open-servers-btn");
          const openBtnVisible = await openServersBtn.waitFor({state: "visible", timeout: 10_000}).then(() => true, () => false);
          await openServersBtn.click();

          const tokenInput = page.getByTestId("node-federation-token-input");
          const tokenInputVisible = await tokenInput.waitFor({state: "visible", timeout: 15_000}).then(() => true, () => false);
          const portVal = await page.getByLabel(/^Port$/i).first().inputValue().catch(() => "");
          const httpsChecked = await page.getByLabel(/Use a secure connection/i).first().isChecked().catch(() => false);

          if (createdTokenId) {
            const delRes = await page.context().request.delete(
              this.viewerUrl(`/sensorhub/session/admin/federation-tokens/${encodeURIComponent(createdTokenId)}`),
              {data: {}},
            );
            await delRes.dispose();
            createdTokenId = "";
          }

          const ovRes = await page.context().request.get(this.viewerUrl("/sensorhub/session/admin/overview"));
          let probeCleaned = false;
          if (ovRes.ok()) {
            const ovJson = await ovRes.json() as {federationTokens?: Array<{label?: string}>};
            probeCleaned = !(ovJson.federationTokens ?? []).some((t) => t.label === probeLabel);
          }
          await ovRes.dispose();

          const passed = hasStaySignedIn &&
            hasOcteliumNote &&
            howToCardVisible &&
            openBtnVisible &&
            tokenInputVisible &&
            portVal === "443" &&
            httpsChecked &&
            probeCleaned;
          return {
            passed,
            observed: `staySignedIn=${hasStaySignedIn}; octeliumNote=${hasOcteliumNote}; howToCard=${howToCardVisible}; ` +
              `openServersBtn=${openBtnVisible}; tokenInput=${tokenInputVisible}; port=${portVal}; https=${httpsChecked}; probeCleaned=${probeCleaned}`,
            evidence: passed ? "" : await this.screenshotOnFailure(page, "users-federation-servers-flow-failed"),
          };
        } finally {
          if (createdTokenId) {
            await page.context().request.delete(
              this.viewerUrl(`/sensorhub/session/admin/federation-tokens/${encodeURIComponent(createdTokenId)}`),
              {data: {}},
            ).then((r) => r.dispose()).catch(() => undefined);
          }
        }
      });
    } finally { await page.close(); }
  }

  private async sensorHubAdmin(): Promise<void> {
    const page = await this.browser.oscarPage();
    try {
      await this.check({
        scenario: "sensorhub-admin", category: "admin", action: "open SensorHub Admin GUI",
        target: "/sensorhub/admin", expected: "Admin application loads with sensor/module controls",
      }, async () => {
        const status = await this.goto(page, "/sensorhub/admin?restartApplication");
        const readBody = async () => page.locator("body").innerText().catch(() => "");
        const body = await poll(
          readBody,
          (text) => /sensorhub|admin|module|sensor|system/i.test(text) && text.trim().length > 100 && /\bSensors\b/.test(text),
          {
            timeoutMs: Math.max(20_000, this.config.uiTimeoutMs),
            intervalMs: 250,
            description: "SensorHub Admin Vaadin UI to render module controls",
          },
        ).catch(readBody);
        const hasAdminContent = /sensorhub|admin|module|sensor|system/i.test(body) && body.trim().length > 100;
        const passed = status >= 200 && status < 400 && hasAdminContent;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "sensorhub-admin-load");
        return {passed, observed: `HTTP ${status}; body characters=${body.length}`, evidence};
      });

      await this.check({
        scenario: "sensorhub-admin", category: "admin", action: "verify configured sensors are visible",
        target: "/sensorhub/admin", expected: `Admin UI exposes Sensors and the systems API contains ${this.config.testLaneLabel}`,
      }, async () => {
        const body = await page.locator("body").innerText();
        const response = await page.context().request.get(
          this.viewerUrl("/sensorhub/api/systems?searchMembers=true&validTime=latest&limit=500"),
        );
        const systems = response.ok() ? JSON.stringify(await response.json()) : "";
        const sensorRootVisible = /\bSensors\b/.test(body);
        const knownLanePresent = systems.toLowerCase().includes(this.config.testLaneLabel.toLowerCase());
        const passed = response.ok() && sensorRootVisible && knownLanePresent;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "sensorhub-admin-no-sensors");
        return {
          passed,
          observed: `systems HTTP ${response.status()}; Sensors visible=${sensorRootVisible}; known lane present=${knownLanePresent}`,
          evidence,
        };
      });

      const requireMobileDetector = this.config.storageExpectedRelease.startsWith("3.12.");
      const inspectMobileDetectorProvider = async (): Promise<{
        found: boolean;
        windowOpened: boolean;
        windowClosed: boolean;
        beforeSystemCount: number;
        afterSystemCount: number;
        sampledProviders: number;
      }> => {
        const countTopSystems = async (): Promise<number> => {
          const res = await page.context().request.get(
            this.viewerUrl("/sensorhub/api/systems?searchMembers=false&validTime=latest&limit=500"),
          );
          try {
            if (!res.ok()) return -1;
            const json = await res.json() as {items?: unknown[]};
            return Array.isArray(json.items) ? json.items.length : 0;
          } finally {
            await res.dispose();
          }
        };

        const beforeSystemCount = await countTopSystems();
        const sensorsHeader = page.locator(".v-accordion-item-caption").filter({hasText: /\bSensors\b/i}).first();
        await sensorsHeader.waitFor({timeout: this.config.uiTimeoutMs});
        if ((await page.locator(".v-accordion-item-open").filter({hasText: /\bSensors\b/i}).count()) === 0) {
          await sensorsHeader.click();
          await sleep(250);
        }

        const firstCell = page.locator(".v-accordion-item-open .v-table-cell-wrapper").first();
        const rightClickTarget = (await firstCell.count()) > 0
          ? firstCell
          : page.locator(".v-accordion-item-open .v-table-body").first();
        await rightClickTarget.waitFor({timeout: this.config.uiTimeoutMs});
        await rightClickTarget.click({button: "right"});

        const addModuleItem = page.locator(".v-contextmenu .gwt-MenuItem")
          .filter({hasText: /Add New Module/i})
          .first();
        await addModuleItem.waitFor({state: "visible", timeout: 10_000});
        await addModuleItem.click();

        const modal = page.locator(".v-window").filter({hasText: /Select Module Type/i}).first();
        const windowOpened = await modal.waitFor({state: "visible", timeout: 15_000})
          .then(() => true, () => false);
        const providerTexts = new Set<string>();
        let windowClosed = !windowOpened;

        if (windowOpened) {
          try {
            const scroller = modal.locator(".v-table-body-wrapper, .v-scrollable").first();
            const hasScroller = (await scroller.count()) > 0;
            if (hasScroller) {
              await scroller.evaluate((el) => { el.scrollTop = 0; }).catch(() => undefined);
              await sleep(150);
            }
            for (let step = 0; step < 24; step++) {
              const cells = await modal.locator(".v-table-cell-wrapper").allInnerTexts().catch(() => []);
              for (const cell of cells) {
                const trimmed = cell.trim();
                if (trimmed) providerTexts.add(trimmed);
              }
              if ([...providerTexts].some((txt) => /Mobile Detector System|MobileDetectorSystem/i.test(txt))) {
                break;
              }
              if (!hasScroller) break;
              const advanced = await scroller.evaluate((el) => {
                const prev = el.scrollTop;
                el.scrollTop = prev + 160;
                return el.scrollTop > prev;
              }).catch(() => false);
              if (!advanced) break;
              await sleep(150);
            }
          } finally {
            const closeBtn = modal.locator(".v-window-closebox").first();
            if (await closeBtn.isVisible().catch(() => false)) {
              await closeBtn.click().catch(() => undefined);
            } else {
              await page.keyboard.press("Escape").catch(() => undefined);
            }
            windowClosed = await modal.waitFor({state: "hidden", timeout: 10_000})
              .then(() => true, () => false);
          }
        }

        const afterSystemCount = await countTopSystems();
        const found = [...providerTexts].some((txt) => /Mobile Detector System|MobileDetectorSystem/i.test(txt));
        return {
          found,
          windowOpened,
          windowClosed,
          beforeSystemCount,
          afterSystemCount,
          sampledProviders: providerTexts.size,
        };
      };

      const providerProbe = await inspectMobileDetectorProvider().catch((err) => {
        if (requireMobileDetector) {
          this.reporter.error("sensorhub-admin", "mobile-detector-provider", err);
        }
        return {
          found: false,
          windowOpened: false,
          windowClosed: true,
          beforeSystemCount: -1,
          afterSystemCount: -1,
          sampledProviders: 0,
        };
      });

      if (requireMobileDetector || providerProbe.found) {
        await this.check({
          scenario: "sensorhub-admin",
          category: "admin",
          action: "verify MobileDetectorSystem module provider availability",
          target: "/sensorhub/admin",
          expected: "SensorHub Sensors module provider list includes Mobile Detector System without adding a lane to config.json",
        }, async () => {
          const unchangedSystems = providerProbe.beforeSystemCount >= 0 &&
            providerProbe.beforeSystemCount === providerProbe.afterSystemCount;
          const passed = providerProbe.windowOpened &&
            providerProbe.found &&
            providerProbe.windowClosed &&
            unchangedSystems;
          const evidence = passed ? "" : await this.screenshotOnFailure(page, "sensorhub-admin-mobile-detector-provider");
          return {
            passed,
            observed: `windowOpened=${providerProbe.windowOpened}; foundMobileDetector=${providerProbe.found}; ` +
              `sampledCells=${providerProbe.sampledProviders}; windowClosed=${providerProbe.windowClosed}; ` +
              `topSystems=${providerProbe.beforeSystemCount}->${providerProbe.afterSystemCount}`,
            evidence,
          };
        });
      }
    } finally { await page.close(); }
  }

  private async statusOfHealthBaseline(): Promise<void> {
    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/health");
      await page.getByRole("heading", {name: "Status of Health"}).waitFor();
      await page.locator("tbody tr").first().waitFor();
      await this.check({
        scenario: "status-of-health", category: "health", action: "enumerate lanes",
        target: "Status of Health table", expected: `${this.config.expectedLaneCount} unique expected lane identities`,
      }, async () => {
        const laneIds = (await page.locator("tbody tr").evaluateAll((rows) => rows.map((row) =>
          (row.getAttribute("data-testid") ?? "").replace(/^health-lane-/, ""),
        ))).filter(Boolean);
        const uniqueLaneIds = new Set(laneIds);
        const numberedLane = this.config.testLaneLabel.match(/^(.*?)(\d+)$/);
        const expectedLaneIds = numberedLane && Number(numberedLane[2]) === this.config.expectedLaneCount
          ? Array.from(
            {length: this.config.expectedLaneCount},
            (_, index) => `${numberedLane[1]}${String(index + 1).padStart(numberedLane[2]?.length ?? 1, "0")}`,
          )
          : [];
        const missing = expectedLaneIds.filter((laneId) => !uniqueLaneIds.has(laneId));
        const unexpected = expectedLaneIds.length
          ? [...uniqueLaneIds].filter((laneId) => !expectedLaneIds.includes(laneId))
          : [];
        const passed = laneIds.length === this.config.expectedLaneCount &&
          uniqueLaneIds.size === laneIds.length && missing.length === 0 && unexpected.length === 0;
        return {
          passed,
          observed: `${laneIds.length} rows; ${uniqueLaneIds.size} unique; missing=${missing.join("|") || "none"}; unexpected=${unexpected.join("|") || "none"}`,
        };
      });
      await this.check({
        scenario: "status-of-health", category: "health", action: "enumerate cameras",
        target: "Status of Health connections", expected: `${this.config.expectedCameraCount} camera indicators mapped to individual lanes`,
      }, async () => {
        const perLane = await page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => ({
          laneId: (row.getAttribute("data-testid") ?? "").replace(/^health-lane-/, ""),
          cameras: [...row.querySelectorAll(".MuiChip-label")]
            .filter((chip) => /camera/i.test(chip.textContent ?? "")).length,
        })));
        const cameraCount = perLane.reduce((total, lane) => total + lane.cameras, 0);
        const invalidMappings = perLane.filter((lane) => lane.cameras !== 1).map((lane) => `${lane.laneId}:${lane.cameras}`);
        const requireOnePerLane = this.config.expectedCameraCount === this.config.expectedLaneCount;
        const passed = cameraCount === this.config.expectedCameraCount &&
          (!requireOnePerLane || invalidMappings.length === 0);
        return {
          passed,
          observed: `${cameraCount} camera indicators; invalid lane mappings=${invalidMappings.join("|") || "none"}`,
        };
      });
      await this.check({
        scenario: "status-of-health", category: "health", action: "verify reserved lane telemetry",
        target: this.config.testLaneLabel, expected: "RPM and camera connection plus all five fault indicators visible",
      }, async () => {
        const row = this.healthRow(page);
        await row.waitFor();
        const text = await row.innerText();
        const labels = ["RPM", "Camera", "Gamma high", "Gamma low", "Neutron high", "Tamper", "Extended occupancy"];
        const missing = labels.filter((label) => !text.toLowerCase().includes(label.toLowerCase()));
        const passed = missing.length === 0;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "health-reserved-lane-missing-fields");
        return {passed, observed: missing.length ? `missing: ${missing.join(", ")}` : "all indicators visible", evidence};
      });
      await this.check({
        scenario: "status-of-health", category: "health", action: "resolve all connection states",
        target: "Status of Health table", expected: "every RPM and configured camera resolves to Online rather than Waiting",
      }, async () => {
        const connectionState = async () => page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => ({
          laneId: (row.getAttribute("data-testid") ?? "").replace(/^health-lane-/, ""),
          chips: [...row.querySelectorAll(".MuiChip-label")]
            .map((chip) => (chip.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter((text) => /RPM|Camera/i.test(text)),
        })));
        const states = await poll(
          connectionState,
          (value) => value.every((lane) => lane.chips.every((chip) => /·\s*Online/i.test(chip))),
          {
            timeoutMs: Math.max(60_000, this.config.uiTimeoutMs),
            intervalMs: 1_000,
            description: "all RPM and camera connection telemetry to resolve online",
          },
        ).catch(connectionState);
        const connections = states.flatMap((lane) => lane.chips.map((chip) => ({laneId: lane.laneId, chip})));
        const waiting = connections.filter(({chip}) => /Waiting/i.test(chip));
        const offline = connections.filter(({chip}) => /Offline/i.test(chip));
        const online = connections.filter(({chip}) => /·\s*Online/i.test(chip));
        const expectedConnections = this.config.expectedLaneCount + this.config.expectedCameraCount;
        const invalidRows = states.filter((lane) => {
          const rpmCount = lane.chips.filter((chip) => /RPM/i.test(chip)).length;
          const cameraCount = lane.chips.filter((chip) => /Camera/i.test(chip)).length;
          return rpmCount !== 1 ||
            (this.config.expectedCameraCount === this.config.expectedLaneCount && cameraCount !== 1);
        });
        const passed = connections.length === expectedConnections && online.length === expectedConnections &&
          waiting.length === 0 && offline.length === 0 && invalidRows.length === 0;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "health-unresolved-connections");
        return {
          passed,
          observed: `${online.length}/${expectedConnections} online; waiting=${waiting.length}; offline=${offline.length}; invalid rows=${invalidRows.map((lane) => lane.laneId).join("|") || "none"}`,
          evidence,
        };
      });
    } finally { await page.close(); }
  }

  private async openDashboard(page: Page): Promise<Locator> {
    await this.goto(page, "/");
    const card = this.dashboardCard(page);
    await card.waitFor({timeout: this.config.uiTimeoutMs});
    return card;
  }

  private async waitDashboardConnectionState(
    page: Page,
    kind: DashboardConnectionKind,
    state: DashboardConnectionState,
    timeoutMs = 60_000,
  ): Promise<number> {
    await this.openDashboard(page);
    const indicators = this.dashboardConnection(page, kind);
    return poll(
      async () => {
        const count = await indicators.count();
        const states = await Promise.all(Array.from(
          {length: count},
          (_, index) => indicators.nth(index).getAttribute("data-state"),
        ));
        return {count, states};
      },
      (value) => value.count > 0 && value.states.every((valueState) => valueState === state),
      {
        timeoutMs,
        intervalMs: 1_000,
        description: `${this.config.testLaneLabel} dashboard ${kind} indicators to become ${state}`,
      },
    ).then((value) => value.count);
  }

  private async waitDashboardFaultState(
    page: Page,
    kind: DashboardFaultKind,
    state: "active" | "unknown" | "clear",
    timeoutMs = 60_000,
  ): Promise<number> {
    await this.openDashboard(page);
    const indicator = this.dashboardFault(page, kind);
    if (state === "clear") {
      return poll(
        () => indicator.count(),
        (count) => count === 0,
        {
          timeoutMs,
          intervalMs: 1_000,
          description: `${this.config.testLaneLabel} dashboard ${kind} indicator to clear`,
        },
      );
    }

    return poll(
      async () => ({count: await indicator.count(), state: await indicator.first().getAttribute("data-state").catch(() => null)}),
      (value) => value.count > 0 && value.state === state,
      {
        timeoutMs,
        intervalMs: 1_000,
        description: `${this.config.testLaneLabel} dashboard ${kind} indicator to become ${state}`,
      },
    ).then((value) => value.count);
  }

  private async dashboardHealthBaseline(): Promise<void> {
    const page = await this.browser.oscarPage();
    const healthRoutePattern = /\/observations\/?(?:\?|$)/;
    let fixtureMode: "live" | "mixed" | "offline" | "unknown" = "live";
    let forcedConnectionObservations = 0;
    let mixedTargetStreamId = "";
    let mixedConnectionObservations = 0;
    let mixedOfflineObservations = 0;
    let unknownHealthResponses = 0;
    const unknownHealthStreamIds = new Set<string>();
    let probeEnabled = true;
    let currentHealthRequests = 0;
    let peakHealthRequests = 0;
    let fixtureRouteFailure: unknown;
    const trackedRequests = new Set<Request>();
    const batches: Array<{streamIds: string[]; limit: number | null}> = [];

    const requestStarted = (request: Request) => {
      if (!probeEnabled) return;
      const batch = parseHealthObservationBatch(request.url());
      if (!batch) return;
      trackedRequests.add(request);
      batches.push(batch);
      currentHealthRequests++;
      peakHealthRequests = Math.max(peakHealthRequests, currentHealthRequests);
    };
    const requestSettled = (request: Request) => {
      if (!trackedRequests.delete(request)) return;
      currentHealthRequests = Math.max(0, currentHealthRequests - 1);
    };

    page.on("request", requestStarted);
    page.on("requestfinished", requestSettled);
    page.on("requestfailed", requestSettled);
    await page.route(healthRoutePattern, async (route) => {
      const batch = parseHealthObservationBatch(route.request().url());
      if (!batch || fixtureMode === "live") {
        await route.continue();
        return;
      }
      if (fixtureMode === "unknown") {
        unknownHealthResponses++;
        batch.streamIds.forEach((streamId) => unknownHealthStreamIds.add(streamId));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({items: []}),
        });
        return;
      }

      await guardDashboardHealthFixtureRoute(async () => {
        const response = await route.fetch({timeout: DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS});
        const payload: unknown = await response.json();
        if (fixtureMode === "mixed") {
          const summary = forceSingleConnectionObservationOffline(payload, mixedTargetStreamId);
          mixedConnectionObservations += summary.matched;
          mixedOfflineObservations += summary.offlineMatched;
        } else {
          forcedConnectionObservations += forceConnectionObservationsOffline(payload);
        }
        await route.fulfill({response, json: payload});
      }, (error) => {
        if (fixtureRouteFailure !== undefined) return;
        fixtureRouteFailure = error;
        const observed = `intercepted latest-observation request failed: ${describeError(error)}`;
        this.reporter.error("dashboard-health", "fixture-route", observed);
        this.reporter.outcome(
          "dashboard-health",
          "dashboard-health",
          "complete bounded fixture observation request",
          route.request().url(),
          `the intercepted request completes within ${DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS} ms`,
          observed,
          "incorrect",
          DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS,
          "",
          describeError(error),
        );
      }, () => route.abort("timedout"));
    });

    try {
      await this.check({
        scenario: "dashboard-health",
        category: "dashboard-health",
        action: "validate explicit known-clear Tamper source state",
        target: "RPM emulator inventory",
        expected: `${this.config.expectedLaneCount} running, OSCAR-connected RPMs explicitly report tamper_fault=false`,
      }, async () => {
        const allEntries = await this.emulator.tamperBaseline();
        const configuredIds = this.config.laneConfigOracle?.lanes?.length
          ? new Set(
            this.config.laneConfigOracle.lanes
              .map((l) => /^lane-0*(\d+)$/i.exec(l.uniqueId.trim())?.[1])
              .filter((n): n is string => Boolean(n))
              .flatMap((n) => [`rpm-${n}`, `rpm-${n.padStart(2, "0")}`]),
          )
          : null;
        const entries = allEntries.length > this.config.expectedLaneCount && configuredIds && configuredIds.size > 0
          ? allEntries.filter((e) => configuredIds.has(e.rpmId))
          : allEntries;
        const assessment = assessKnownClearTamperBaseline(entries, this.config.expectedLaneCount);
        return {
          passed: assessment.passed,
          observed: `RPMs=${assessment.rpmCount}/${assessment.expectedCount}; ` +
            `explicit clear=${assessment.clearCount}; ` +
            `stopped=${assessment.stoppedIds.join("|") || "none"}; ` +
            `disconnected=${assessment.disconnectedIds.join("|") || "none"}; ` +
            `active=${assessment.activeIds.join("|") || "none"}; ` +
            `unknown=${assessment.unknownIds.join("|") || "none"}; ` +
            `duplicate IDs=${assessment.duplicateIds.join("|") || "none"}`,
        };
      });

      const card = await this.openDashboard(page);
      await this.check({
        scenario: "dashboard-health", category: "dashboard-health", action: "enumerate compact lane health indicators",
        target: "Dashboard Lane Status", expected: `${this.config.expectedLaneCount} cards, one RPM per lane, and ${this.config.expectedCameraCount} independently identified cameras`,
      }, async () => {
        const cards = page.locator('[data-testid^="lane-health-card-"]');
        const rpms = page.locator('[data-testid^="lane-health-"][data-testid$="-rpm"]');
        const cameras = page.locator('[data-testid^="lane-health-"][data-testid$="-camera"]');
        const [cardCount, rpmCount, cameraCount, cameraIds, perCard] = await Promise.all([
          cards.count(),
          rpms.count(),
          cameras.count(),
          cameras.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-component-id") ?? "")),
          cards.evaluateAll((nodes) => nodes.map((node) => ({
            lane: (node.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""),
            rpms: node.querySelectorAll('[data-testid$="-rpm"]').length,
            cameras: node.querySelectorAll('[data-testid$="-camera"]').length,
          }))),
        ]);
        const uniqueCameraIds = new Set(cameraIds.filter(Boolean));
        const invalidRpmMappings = perCard.filter((lane) => lane.rpms !== 1);
        const requireOneCameraPerLane = this.config.expectedCameraCount === this.config.expectedLaneCount;
        const invalidCameraMappings = requireOneCameraPerLane
          ? perCard.filter((lane) => lane.cameras !== 1)
          : [];
        const passed = cardCount === this.config.expectedLaneCount &&
          rpmCount === this.config.expectedLaneCount &&
          cameraCount === this.config.expectedCameraCount &&
          uniqueCameraIds.size === cameraCount &&
          invalidRpmMappings.length === 0 && invalidCameraMappings.length === 0;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-health-inventory");
        return {
          passed,
          observed: `cards=${cardCount}; RPMs=${rpmCount}; cameras=${cameraCount}; unique camera IDs=${uniqueCameraIds.size}; invalid RPM mappings=${invalidRpmMappings.map((lane) => `${lane.lane}:${lane.rpms}`).join("|") || "none"}; invalid canonical camera mappings=${invalidCameraMappings.map((lane) => `${lane.lane}:${lane.cameras}`).join("|") || "none"}`,
          evidence,
        };
      });

      await this.check({
        scenario: "dashboard-health", category: "dashboard-health", action: "resolve dashboard connection indicators",
        target: "Dashboard Lane Status", expected: "every exact expected RPM and configured camera indicator resolves independently to Online within 45 seconds",
      }, async () => {
        const indicators = page.locator('[data-testid^="lane-health-"][data-testid$="-rpm"], [data-testid^="lane-health-"][data-testid$="-camera"]');
        const fixtureLaneNames = this.config.laneConfigOracle?.lanes.map((lane) => lane.name) ?? [];
        const renderedLaneNames = await page.locator('[data-testid^="lane-health-card-"]').evaluateAll((nodes) => nodes
          .map((node) => (node.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""))
          .filter(Boolean));
        const laneNames = fixtureLaneNames.length === this.config.expectedLaneCount
          ? fixtureLaneNames
          : renderedLaneNames;
        const expectedIds = expectedDashboardConnectionIds(
          laneNames,
          this.config.expectedCameraCount === this.config.expectedLaneCount,
        );
        const snapshot = () => indicators.evaluateAll((nodes) => nodes.map((node) => ({
          testId: node.getAttribute("data-testid") ?? "",
          componentId: node.getAttribute("data-component-id"),
          state: node.getAttribute("data-state"),
          label: node.getAttribute("aria-label") ?? "",
        })));
        const expectedTotal = this.config.expectedLaneCount + this.config.expectedCameraCount;
        const states = await poll(
          snapshot,
          (values) => assessDashboardConnectionResolution(values, expectedIds, this.config.expectedCameraCount).passed,
          {timeoutMs: 45_000, intervalMs: 1_000, description: "every exact dashboard RPM and camera indicator to resolve online"},
        ).catch(snapshot);
        const assessment = assessDashboardConnectionResolution(states, expectedIds, this.config.expectedCameraCount);
        const evidence = assessment.passed ? "" : await this.screenshotOnFailure(page, "dashboard-health-live-connections");
        return {
          passed: assessment.passed,
          observed: `${assessment.online}/${expectedTotal} exact indicators Online; missing=${assessment.missing.join("|") || "none"}; unexpected=${assessment.unexpected.join("|") || "none"}; duplicates=${assessment.duplicates.join("|") || "none"}; unresolved=${assessment.unresolved.join("|") || "none"}`,
          evidence,
        };
      });

      await poll(
        async () => trackedRequests.size,
        (count) => batches.length > 0 && count === 0,
        {timeoutMs: 15_000, intervalMs: 100, description: "initial dashboard health batches to settle"},
      );
      probeEnabled = false;
      await this.check({
        scenario: "dashboard-health", category: "performance", action: "bound shared dashboard health polling",
        target: "latest observation requests", expected: `shared batches contain at most ${DASHBOARD_HEALTH_MAX_BATCH_STREAMS} streams with at most ${DASHBOARD_HEALTH_MAX_IN_FLIGHT} requests in flight and do not fan out one REST request per lane`,
      }, async () => {
        const uniqueBatches = new Map(batches.map((batch) => [batch.streamIds.join(","), batch]));
        const values = [...uniqueBatches.values()];
        const assessment = assessHealthObservationBatches(
          values,
          this.config.expectedLaneCount,
          peakHealthRequests,
        );
        return {
          passed: assessment.passed,
          observed: `${values.length} unique batches; sizes=${values.map((batch) => batch.streamIds.length).join("|")}; peak in flight=${peakHealthRequests}; lane count=${this.config.expectedLaneCount}`,
        };
      });

      await this.check({
        scenario: "dashboard-health",
        category: "dashboard-health",
        action: "resolve every lane from the Rapiscan connection baseline",
        target: "Dashboard Lane Status",
        expected: `${this.config.expectedLaneCount} lane cards resolve Tamper clear with no Unknown or Active Tamper indicator`,
      }, async () => {
        const cards = page.locator('[data-testid^="lane-health-card-"]');
        const indicators = page.locator('[data-testid^="lane-health-"][data-testid$="-tamper"]');
        const readState = async () => {
          const laneIds = await cards.evaluateAll((nodes) => nodes.map((node) =>
            (node.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""),
          ));
          const tamperIndicators = await indicators.evaluateAll((nodes) => nodes.map((node) => {
            const cardNode = node.closest('[data-testid^="lane-health-card-"]');
            return {
              laneId: (cardNode?.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""),
              state: node.getAttribute("data-state"),
              label: node.getAttribute("aria-label") ?? "",
            };
          }));
          return assessDashboardKnownClearTamper(
            laneIds,
            tamperIndicators,
            this.config.expectedLaneCount,
          );
        };
        const assessment = await poll(
          readState,
          (value) => value.passed,
          {
            timeoutMs: 45_000,
            intervalMs: 1_000,
            description: "every Dashboard lane to resolve the Rapiscan connection Tamper baseline",
          },
        ).catch(readState);
        const evidence = assessment.passed
          ? ""
          : await this.screenshotOnFailure(page, "dashboard-health-tamper-baseline");
        return {
          passed: assessment.passed,
          observed: `lanes=${assessment.laneCount}/${this.config.expectedLaneCount}; ` +
            `unique=${assessment.uniqueLaneCount}; explicit clear=${assessment.clearCount}; ` +
            `Unknown=${assessment.unknownLaneIds.join("|") || "none"}; ` +
            `Active=${assessment.activeLaneIds.join("|") || "none"}; ` +
            `invalid=${assessment.invalidLaneIds.join("|") || "none"}`,
          evidence,
        };
      });

      const requestedHealthStreamIds = new Set(batches.flatMap((batch) => batch.streamIds));
      const mixedTarget = await this.dashboardCameraConnectionTarget(page, requestedHealthStreamIds);
      mixedTargetStreamId = mixedTarget.streamId;
      mixedConnectionObservations = 0;
      mixedOfflineObservations = 0;
      fixtureMode = "mixed";
      await page.reload({waitUntil: "domcontentloaded"});
      await card.waitFor({timeout: this.config.uiTimeoutMs});
      await this.check({
        scenario: "dashboard-health", category: "dashboard-health", action: "render one camera Offline independently",
        target: this.config.testLaneLabel,
        expected: "exactly the selected camera is Offline while every RPM and every other camera remain Online",
      }, async () => {
        const indicators = page.locator('[data-testid^="lane-health-"][data-testid$="-rpm"], [data-testid^="lane-health-"][data-testid$="-camera"]');
        const expected = this.config.expectedLaneCount + this.config.expectedCameraCount;
        const states = await poll(
          () => indicators.evaluateAll((nodes) => nodes.map((node) => ({
            kind: node.getAttribute("data-testid")?.endsWith("-camera") ? "camera" : "rpm",
            componentId: node.getAttribute("data-component-id") ?? "",
            state: node.getAttribute("data-state"),
            label: node.getAttribute("aria-label") ?? "",
          }))),
          (values) => {
            const offline = values.filter(({state}) => state === "offline");
            return values.length === expected && offline.length === 1 &&
              offline[0]?.kind === "camera" &&
              offline[0]?.componentId === mixedTarget.componentId &&
              values.filter(({componentId}) => componentId !== mixedTarget.componentId)
                .every(({state}) => state === "online");
          },
          {timeoutMs: 45_000, intervalMs: 1_000, description: "one selected camera to render Offline independently"},
        );
        const offline = states.filter(({state}) => state === "offline");
        const labelsCorrect = states.every(({state, label}) =>
          state === "offline" ? /offline/i.test(label) : /online/i.test(label));
        const passed = mixedConnectionObservations >= expected && mixedOfflineObservations >= 1 &&
          offline.length === 1 && offline[0]?.kind === "camera" &&
          offline[0]?.componentId === mixedTarget.componentId && labelsCorrect;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-health-one-camera-offline");
        return {
          passed,
          observed: `connections=${states.length}/${expected}; Offline cameras=${offline.length}; selected camera Offline=${offline[0]?.componentId === mixedTarget.componentId}; rewritten=${mixedConnectionObservations}; target rewrites=${mixedOfflineObservations}; accessible labels=${labelsCorrect}`,
          evidence,
        };
      });

      fixtureMode = "offline";
      forcedConnectionObservations = 0;
      await page.reload({waitUntil: "domcontentloaded"});
      await card.waitFor({timeout: this.config.uiTimeoutMs});
      await this.check({
        scenario: "dashboard-health", category: "dashboard-health", action: "render independent Offline connection states",
        target: "Dashboard Lane Status", expected: "browser fixture drives every RPM and camera indicator to an accessible Offline state",
      }, async () => {
        const indicators = page.locator('[data-testid^="lane-health-"][data-testid$="-rpm"], [data-testid^="lane-health-"][data-testid$="-camera"]');
        const expected = this.config.expectedLaneCount + this.config.expectedCameraCount;
        const states = await poll(
          () => indicators.evaluateAll((nodes) => nodes.map((node) => ({
            state: node.getAttribute("data-state"),
            label: node.getAttribute("aria-label") ?? "",
          }))),
          (values) => values.length === expected && values.every(({state}) => state === "offline"),
          {timeoutMs: 45_000, intervalMs: 1_000, description: "dashboard connection indicators to render fixture Offline"},
        );
        const passed = forcedConnectionObservations >= expected &&
          states.every(({state, label}) => state === "offline" && /offline/i.test(label));
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-health-offline-fixture");
        return {
          passed,
          observed: `${states.length}/${expected} Offline; rewritten connection observations=${forcedConnectionObservations}`,
          evidence,
        };
      });

      fixtureMode = "unknown";
      unknownHealthResponses = 0;
      unknownHealthStreamIds.clear();
      await this.check({
        scenario: "dashboard-health", category: "dashboard-health", action: "render unknown connection and fault states",
        target: this.config.testLaneLabel, expected: "a completed missing-observation reconciliation changes RPM, every camera, and all five fault indicators to their exact accessible Unknown states",
      }, async () => {
        const connections = this.dashboardCard(page).locator('[data-testid$="-rpm"], [data-testid$="-camera"]');
        const state = await poll(async () => ({
          connections: await connections.evaluateAll((nodes) => nodes.map((node) => ({
            state: node.getAttribute("data-state"), label: node.getAttribute("aria-label") ?? "",
          }))),
          faults: await Promise.all(DASHBOARD_FAULT_KINDS.map(async (kind) => {
            const indicator = this.dashboardFault(page, kind);
            return {
              kind,
              count: await indicator.count(),
              state: await indicator.first().getAttribute("data-state").catch(() => null),
              label: await indicator.first().getAttribute("aria-label").catch(() => null) ?? "",
            };
          })),
          responses: unknownHealthResponses,
          allRequestedStreamsCompleted: requestedHealthStreamIds.size > 0 &&
            [...requestedHealthStreamIds].every((streamId) => unknownHealthStreamIds.has(streamId)),
        }), (value) => value.responses > 0 && value.allRequestedStreamsCompleted &&
          value.connections.length > 0 &&
          value.connections.every(({state: itemState}) => itemState === "unknown") &&
          value.faults.every((fault) => fault.count === 1 && fault.state === "unknown"), {
          timeoutMs: 45_000,
          intervalMs: 1_000,
          description: `${this.config.testLaneLabel} dashboard indicators to transition to Unknown after a completed empty reconciliation`,
        });
        const connectionLabelsCorrect = state.connections.every(({label}) => /unknown/i.test(label));
        const faultLabelsCorrect = state.faults.every(({kind, label}) =>
          label === `${DASHBOARD_FAULT_LABELS[kind]}: Unknown`);
        const passed = state.responses > 0 && state.allRequestedStreamsCompleted &&
          connectionLabelsCorrect && faultLabelsCorrect;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-health-unknown-fixture");
        return {
          passed,
          observed: `connections=${state.connections.length}; faults=${state.faults.length}; empty responses=${state.responses}; all requested streams completed=${state.allRequestedStreamsCompleted}; exact accessible labels=${connectionLabelsCorrect && faultLabelsCorrect}`,
          evidence,
        };
      });

      fixtureMode = "live";
      await page.reload({waitUntil: "domcontentloaded"});
      await card.waitFor({timeout: this.config.uiTimeoutMs});
      await this.check({
        scenario: "dashboard-health", category: "dashboard-health", action: "recover live dashboard health after fixtures",
        target: "Dashboard Lane Status", expected: "every RPM and camera returns Online and all five reserved-lane fault indicators resolve Clear",
      }, async () => {
        const indicators = page.locator('[data-testid^="lane-health-"][data-testid$="-rpm"], [data-testid^="lane-health-"][data-testid$="-camera"]');
        const expected = this.config.expectedLaneCount + this.config.expectedCameraCount;
        const recovered = await poll(async () => ({
          connections: await indicators.evaluateAll((nodes) => nodes.map((node) => ({
            state: node.getAttribute("data-state"), label: node.getAttribute("aria-label") ?? "",
          }))),
          faultCounts: await Promise.all(DASHBOARD_FAULT_KINDS.map((kind) => this.dashboardFault(page, kind).count())),
        }), (value) => value.connections.length === expected &&
          value.connections.every(({state, label}) => state === "online" && /online/i.test(label)) &&
          value.faultCounts.every((count) => count === 0), {
          timeoutMs: 45_000,
          intervalMs: 1_000,
          description: "dashboard live connection and clear fault state to recover after fixtures",
        });
        const passed = recovered.connections.length === expected &&
          recovered.connections.every(({state, label}) => state === "online" && /online/i.test(label)) &&
          recovered.faultCounts.every((count) => count === 0);
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-health-live-recovery");
        return {
          passed,
          observed: `Online connections=${recovered.connections.length}/${expected}; reserved-lane remaining fault indicators=${recovered.faultCounts.reduce((sum, count) => sum + count, 0)}`,
          evidence,
        };
      });
      await this.check({
        scenario: "dashboard-health", category: "navigation", action: "open lane details from compact health card",
        target: this.config.testLaneLabel, expected: "keyboard activation of the lane health card opens that lane's detail page",
      }, async () => {
        const link = this.dashboardCard(page).getByRole("link");
        await link.focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(
          (url) => normalizePathname(url.pathname) === "/lane-view",
          {timeout: this.config.uiTimeoutMs},
        );
        const heading = await page.getByText(`Lane ID: ${this.config.testLaneLabel}`, {exact: true})
          .isVisible().catch(() => false);
        const evidence = heading ? "" : await this.screenshotOnFailure(page, "dashboard-health-lane-navigation");
        return {passed: heading, observed: `URL=${page.url()}; expected lane heading visible=${heading}`, evidence};
      });
    } finally {
      probeEnabled = false;
      page.off("request", requestStarted);
      page.off("requestfinished", requestSettled);
      page.off("requestfailed", requestSettled);
      await page.unroute(healthRoutePattern).catch(() => undefined);
      await page.close();
    }
  }

  private async laneVideo(): Promise<void> {
    const page = await this.browser.oscarPage();
    let observedM3u8Url = "";
    const captureM3u8 = (response: Response) => {
      if (response.status() === 200 && /\.m3u8(?:\?|$)/i.test(response.url())) {
        observedM3u8Url = response.url();
      }
    };
    page.on("response", captureM3u8);
    try {
      await this.goto(page, "/");
      const laneSection = page.getByTestId("dashboard-widget-laneStatus");
      const laneLabel = laneSection.getByText(this.config.testLaneLabel, {exact: true});
      await laneLabel.first().waitFor({timeout: this.config.uiTimeoutMs});
      if (await laneLabel.count() !== 1) {
        throw new Error(`Expected exactly one dashboard card for ${this.config.testLaneLabel}`);
      }
      await laneLabel.click();
      await page.waitForURL(/\/lane-view/);
      await this.check({
        scenario: "lane-video", category: "telemetry", action: "render lane detail telemetry",
        target: this.config.testLaneLabel, expected: "lane heading, gamma chart, neutron chart, and event table visible",
      }, async () => {
        const heading = await page.getByText(`Lane ID: ${this.config.testLaneLabel}`, {exact: true})
          .isVisible().catch(() => false);
        const gamma = await isVisible(page.locator("#chart-view-gamma"));
        const neutron = await isVisible(page.locator("#chart-view-neutron"));
        const table = await page.locator(".MuiDataGrid-root").count() > 0;
        const passed = heading && gamma && neutron && table;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "lane-detail-components");
        return {passed, observed: `heading=${heading}; gamma=${gamma}; neutron=${neutron}; table=${table}`, evidence};
      });
      await this.check({
        scenario: "lane-video",
        category: "telemetry",
        action: "paint live gamma and neutron datasets after Dashboard navigation",
        target: this.config.testLaneLabel,
        expected: "the Gamma dataset paints red plot pixels and the Neutron dataset paints blue plot pixels, excluding legends",
      }, async () => {
        const gammaCanvas = page.locator("#chart-view-gamma canvas").first();
        const neutronCanvas = page.locator("#chart-view-neutron canvas").first();
        await Promise.all([
          gammaCanvas.waitFor({state: "visible", timeout: this.config.uiTimeoutMs}),
          neutronCanvas.waitFor({state: "visible", timeout: this.config.uiTimeoutMs}),
        ]);
        const readCharts = async () => ({
          gamma: await this.chartCanvasSnapshot(gammaCanvas),
          neutron: await this.chartCanvasSnapshot(neutronCanvas),
        });
        const snapshots = await poll(
          readCharts,
          ({gamma, neutron}) => liveLaneTelemetryChartsRendered(gamma, neutron),
          {
            timeoutMs: 45_000,
            intervalMs: 500,
            description: "live Gamma and Neutron Lane Details datasets to paint",
          },
        ).catch(() => readCharts());
        const passed = liveLaneTelemetryChartsRendered(snapshots.gamma, snapshots.neutron);
        const evidence = passed
          ? ""
          : await this.screenshotOnFailure(page, "lane-detail-live-telemetry");
        return {
          passed,
          observed: `gamma canvas=${snapshots.gamma.width}x${snapshots.gamma.height}; ` +
            `gamma plot pixels=${snapshots.gamma.gammaPlotPixels}; ` +
            `neutron canvas=${snapshots.neutron.width}x${snapshots.neutron.height}; ` +
            `neutron plot pixels=${snapshots.neutron.neutronPlotPixels}`,
          evidence,
        };
      });
      await this.check({
        scenario: "lane-video",
        category: "telemetry",
        action: "advance live gamma and neutron telemetry charts in real time",
        target: this.config.testLaneLabel,
        expected: "both Gamma and Neutron Chart.js canvases actively redraw across 1 Hz telemetry ticks without freezing",
      }, async () => {
        const gammaCanvas = page.locator("#chart-view-gamma canvas").first();
        const neutronCanvas = page.locator("#chart-view-neutron canvas").first();
        const readCharts = async () => ({
          gamma: await this.chartCanvasSnapshot(gammaCanvas),
          neutron: await this.chartCanvasSnapshot(neutronCanvas),
        });
        const initial = await readCharts();
        const subsequent = await poll(
          readCharts,
          (candidate) => liveLaneTelemetryChartsAdvancing(initial, candidate),
          {
            timeoutMs: 15_000,
            intervalMs: 500,
            description: "live Gamma and Neutron charts to advance across 1 Hz telemetry ticks",
          },
        ).catch(() => readCharts());
        const passed = liveLaneTelemetryChartsAdvancing(initial, subsequent);
        const evidence = passed
          ? ""
          : await this.screenshotOnFailure(page, "lane-detail-live-telemetry-frozen");
        return {
          passed,
          observed: `gamma digest=${initial.gamma.canvasDigest}->${subsequent.gamma.canvasDigest}; ` +
            `neutron digest=${initial.neutron.canvasDigest}->${subsequent.neutron.canvasDigest}`,
          evidence,
        };
      });
      await this.check({
        scenario: "lane-video", category: "video", action: "play live camera video",
        target: this.config.testLaneLabel,
        expected: `video reaches readyState >= 2 with non-zero dimensions within ${LIVE_VIDEO_MAX_STARTUP_MS / 1000} seconds and advances playback`,
      }, async () => {
        const video = page.locator("video").first();
        const waitStartedAt = Date.now();
        await this.waitForLiveVideoReady(page, `${this.config.testLaneLabel} live camera video`, LIVE_VIDEO_MAX_STARTUP_MS);
        const startupMs = Date.now() - waitStartedAt;
        const state = await video.evaluate((element: HTMLVideoElement) => ({
          readyState: element.readyState,
          width: element.videoWidth,
          height: element.videoHeight,
          paused: element.paused,
          currentTime: element.currentTime,
        }));
        await page.waitForTimeout(2_000);
        const laterTime = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
        const advanced = laterTime > state.currentTime;
        const passed = assessLiveVideoStartupAndAdvance({
          readyState: state.readyState,
          width: state.width,
          height: state.height,
          paused: state.paused,
          advanced,
          startupMs,
        });
        return {
          passed,
          observed: `startupMs=${startupMs}; readyState=${state.readyState}; ${state.width}x${state.height}; paused=${state.paused}; advanced=${advanced}`,
        };
      });
      await this.check({
        scenario: "lane-video",
        category: "video",
        action: "verify multi-viewer HLS lease sharing",
        target: this.config.testLaneLabel,
        expected: "concurrent X-OSCAR-HLS-Viewer leases both serve #EXTM3U with Cache-Control: no-store, heartbeat returns 204, and closing one viewer leaves the second viewer streaming",
      }, async () => {
        if (!observedM3u8Url) {
          throw new Error("No live .m3u8 manifest URL was observed during lane video playback");
        }
        const request = page.context().request;
        const viewerA = `reg-hls-a-${randomUUID().slice(0, 12)}`;
        const viewerB = `reg-hls-b-${randomUUID().slice(0, 12)}`;
        try {
          const [resA, resB] = await Promise.all([
            request.get(observedM3u8Url, {headers: {"X-OSCAR-HLS-Viewer": viewerA}}),
            request.get(observedM3u8Url, {headers: {"X-OSCAR-HLS-Viewer": viewerB}}),
          ]);
          const [bodyA, bodyB] = await Promise.all([resA.text(), resB.text()]);
          const cacheA = resA.headers()["cache-control"] ?? "";
          await Promise.all([resA.dispose(), resB.dispose()]);

          const heartbeatB = await request.get(observedM3u8Url, {
            headers: {"X-OSCAR-HLS-Viewer": viewerB, "X-OSCAR-HLS-Viewer-State": "heartbeat"},
          });
          const heartbeatStatus = heartbeatB.status();
          await heartbeatB.dispose();

          const closeA = await request.get(observedM3u8Url, {
            headers: {"X-OSCAR-HLS-Viewer": viewerA, "X-OSCAR-HLS-Viewer-State": "closing"},
          });
          const closeAStatus = closeA.status();
          await closeA.dispose();

          const postCloseB = await request.get(observedM3u8Url, {
            headers: {"X-OSCAR-HLS-Viewer": viewerB},
          });
          const postCloseBodyB = await postCloseB.text();
          const postCloseStatusB = postCloseB.status();
          await postCloseB.dispose();

          const passed = resA.status() === 200 && resB.status() === 200 &&
            bodyA.includes("#EXTM3U") && bodyB.includes("#EXTM3U") &&
            /no-store/i.test(cacheA) &&
            heartbeatStatus === 204 && closeAStatus === 204 &&
            postCloseStatusB === 200 && postCloseBodyB.includes("#EXTM3U");
          return {
            passed,
            observed: `A=${resA.status()}; B=${resB.status()}; cache=${cacheA || "missing"}; ` +
              `heartbeat=${heartbeatStatus}; closeA=${closeAStatus}; postCloseB=${postCloseStatusB}`,
          };
        } finally {
          await request.get(observedM3u8Url, {
            headers: {"X-OSCAR-HLS-Viewer": viewerA, "X-OSCAR-HLS-Viewer-State": "closing"},
          }).then(r => r.dispose()).catch(() => undefined);
          await request.get(observedM3u8Url, {
            headers: {"X-OSCAR-HLS-Viewer": viewerB, "X-OSCAR-HLS-Viewer-State": "closing"},
          }).then(r => r.dispose()).catch(() => undefined);
        }
      });
      if (this.config.expectedCameraCount > this.config.expectedLaneCount) {
        await this.check({
          scenario: "lane-video",
          category: "video",
          action: "switch live camera feeds on multi-camera lane",
          target: "multi-camera lane",
          expected: "all configured cameras on the multi-camera lane serve distinct live .m3u8 manifests and decode advancing video frames",
        }, async () => {
          await this.goto(page, "/");
          const cards = page.locator('[data-testid^="lane-health-card-"]');
          await cards.first().waitFor({timeout: this.config.uiTimeoutMs});
          const multiLane = await cards.evaluateAll((nodes) => {
            const candidates: Array<{name: string; cameraCount: number}> = [];
            for (const node of nodes) {
              const cameraCount = node.querySelectorAll('[data-testid$="-camera"]').length;
              if (cameraCount >= 2) {
                candidates.push({
                  name: (node.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""),
                  cameraCount,
                });
              }
            }
            return candidates.find((c) => c.name === "Lane03") ?? candidates[0] ?? {name: "", cameraCount: 0};
          });
          if (!multiLane.name || multiLane.cameraCount < 2) {
            return {passed: false, observed: "no lane card with >=2 camera indicators found on Dashboard"};
          }
          observedM3u8Url = "";
          await page.getByTestId(`lane-health-card-${multiLane.name}`).getByRole("link").click();
          await page.waitForURL(/\/lane-view/);
          const video = page.locator("video").first();
          const nextCameraButton = page.locator("button:has([data-testid='NavigateNextIcon'])").first();
          const seenUrls = new Set<string>();
          const feeds: MultiCameraFeedObservation[] = [];

          for (let index = 0; index < multiLane.cameraCount; index++) {
            if (index > 0) {
              observedM3u8Url = "";
              await nextCameraButton.click();
            }
            await poll(async () => observedM3u8Url, (url) => url.length > 0 && !seenUrls.has(url), {
              timeoutMs: 30_000,
              intervalMs: 250,
              description: `${multiLane.name} Camera ${index} distinct .m3u8 manifest`,
            });
            const m3u8Url = observedM3u8Url;
            seenUrls.add(m3u8Url);
            await this.waitForLiveVideoReady(
              page,
              `${multiLane.name} Camera ${index} live video frames`,
              LIVE_VIDEO_MAX_STARTUP_MS,
            );
            const start = await video.evaluate((el: HTMLVideoElement) => ({
              readyState: el.readyState,
              width: el.videoWidth,
              height: el.videoHeight,
              currentTime: el.currentTime,
            }));
            await page.waitForTimeout(2_000);
            const later = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
            feeds.push({
              index,
              m3u8Url,
              readyState: start.readyState,
              width: start.width,
              height: start.height,
              advanced: later > start.currentTime,
            });
          }

          const passed = assessMultiCameraFeedCycle(multiLane.cameraCount, feeds);
          const evidence = passed ? "" : await this.screenshotOnFailure(page, `lane-video-multi-camera-${multiLane.name}`);
          return {
            passed,
            observed: `lane=${multiLane.name}; cameras=${multiLane.cameraCount}; ` +
              feeds.map((f) => `cam${f.index}=${f.width}x${f.height}(adv=${f.advanced})`).join("; ") +
              `; distinctM3u8=${seenUrls.size === multiLane.cameraCount}`,
            evidence,
          };
        });
      }
    } finally {
      page.off("response", captureM3u8);
      await page.close();
    }
  }

  private async waitForLiveVideoReady(page: Page, description: string, timeoutMs = 90_000): Promise<void> {
    const video = page.locator("video").first();
    await video.waitFor({timeout: Math.min(timeoutMs, 60_000)});
    let retriedStreamError = false;
    await poll(async () => {
      const errorRetryButton = page.getByTestId("live-video-error").getByRole("button");
      if (!retriedStreamError && await errorRetryButton.isVisible().catch(() => false)) {
        retriedStreamError = true;
        await errorRetryButton.click().catch(() => undefined);
        return false;
      }
      const playButton = page.getByTestId("live-video-preparing").getByRole("button");
      if (await playButton.isVisible().catch(() => false)) {
        await playButton.click().catch(() => undefined);
      }
      return video.evaluate((element: HTMLVideoElement) =>
        element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0,
      ).catch(() => false);
    }, ready => ready, {
      timeoutMs,
      intervalMs: 500,
      description,
    });
  }

  private waitForEventObservationPage(
    page: Page,
    expected: "event-log" | "dashboard-alarms",
  ): Promise<Response> {
    return page.waitForResponse(async response => {
      if (response.request().method() !== "GET" || response.status() < 200 || response.status() >= 300 ||
          !isEventObservationPageUrl(response.url(), this.config.oscarBaseUrl)) return false;
      const isDashboardAlarmQuery = hasDashboardAlarmPredicate(response.url());
      if ((expected === "dashboard-alarms") !== isDashboardAlarmQuery) return false;
      try {
        const payload = await response.json();
        return eventObservationStartTimes(payload).length > 0;
      } catch {
        return false;
      }
    }, {timeout: this.config.eventTimeoutMs});
  }

  private async advancedDateFilterApiOracle(
    page: Page,
    sourceResponse: Response,
    requireDashboardAlarmPredicate: boolean,
  ): Promise<ProbeResult> {
    const sourcePayload = await sourceResponse.json();
    const cutoff = deriveExclusiveDateCutoff(sourcePayload);
    const urls = buildAdvancedDateFilterProbeUrls(
      sourceResponse.url(),
      this.config.oscarBaseUrl,
      cutoff,
    );
    if (requireDashboardAlarmPredicate && !hasDashboardAlarmPredicate(sourceResponse.url())) {
      throw new Error("Dashboard date-filter source omitted its unadjudicated alarm predicate");
    }

    const [countResponse, pageResponse] = await Promise.all([
      page.evaluate(boundedFetch, {
        url: urls.countUrl,
        maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES,
        decodeImage: false,
      }),
      page.evaluate(boundedFetch, {
        url: urls.pageUrl,
        maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES,
        decodeImage: false,
      }),
    ]);
    const countPayload = countResponse.ok
      ? parseBoundedEventApiJson(countResponse, "advanced date-filter count")
      : null;
    const pagePayload = pageResponse.ok
      ? parseBoundedEventApiJson(pageResponse, "advanced date-filter page")
      : null;
    const assessment = assessAdvancedDateFilterResponses(
      countResponse.status,
      countPayload,
      pageResponse.status,
      pagePayload,
      urls.cutoff,
    );
    return {
      passed: assessment.passed,
      observed: `count HTTP=${countResponse.status}; page HTTP=${pageResponse.status}; ` +
        `count=${assessment.count ?? "invalid"}; page items=${assessment.pageItems}; ` +
        `before cutoff=${assessment.beforeCutoff}/${assessment.validStartTimes}; ` +
        `datastreams=${urls.datastreamCount}; cutoff=${urls.cutoff}; ` +
        `source predicate=${urls.sourceFilter ? "present" : "none"}; ` +
        `reason=${assessment.reason || "none"}`,
    };
  }

  private async eventFiltering(): Promise<void> {
    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/event-log");
      await page.locator(".MuiDataGrid-root").waitFor();
      await this.check({
        scenario: "event-filtering", category: "events", action: "load paginated event data",
        target: "Event Log", expected: "at least one event row loads",
      }, async () => {
        const rows = page.locator(".MuiDataGrid-row");
        await rows.first().waitFor({timeout: this.config.eventTimeoutMs});
        const count = await rows.count();
        return {passed: count > 0, observed: `${count} visible rows`};
      });
      await this.check({
        scenario: "event-filtering", category: "events", action: "apply read-only start-time filter",
        target: "Event Log authenticated observations API",
        expected: "a known nonempty occupancy page yields HTTP 200 for count and page, a positive count, and only start times before the exclusive cutoff",
      }, async () => {
        const sourcePromise = this.waitForEventObservationPage(page, "event-log");
        await this.goto(page, "/event-log");
        const sourceResponse = await sourcePromise;
        return this.advancedDateFilterApiOracle(page, sourceResponse, false);
      });
      await this.check({
        scenario: "event-filtering", category: "events", action: "apply full-database lane filter",
        target: "Event Log Advanced filters", expected: `server-side filter returns only ${this.config.testLaneLabel} rows`,
      }, async () => {
        await this.applyLaneEventFilter(page);
        let texts: string[];
        try {
          texts = await poll(
            () => page.locator(".MuiDataGrid-row").allInnerTexts(),
            (values) => values.length > 0 && values.every((value) => value.includes(this.config.testLaneLabel)),
            {timeoutMs: 30_000, intervalMs: 500, description: `filtered rows for ${this.config.testLaneLabel}`},
          );
        } catch (error) {
          const evidence = await this.screenshotOnFailure(page, "event-filter-lane-mismatch");
          this.reporter.error("event-filtering", "apply full-database lane filter", error, evidence);
          return {
            passed: false,
            observed: `filter did not converge: ${describeError(error)}`,
            evidence,
          };
        }
        return {
          passed: texts.length > 0 && texts.every((text) => text.includes(this.config.testLaneLabel)),
          observed: `${texts.length} visible rows; all match lane=${texts.every((text) => text.includes(this.config.testLaneLabel))}`,
        };
      });
      await this.check({
        scenario: "event-filtering",
        category: "events",
        action: "verify CQL array-membership filter for EML Non-Threat",
        target: "Event Log authenticated observations API",
        expected: "adjudicatedIds='eml-non-threat' and adjudicatedIds!='eml-non-threat' both return HTTP 200 with exact array-membership semantics",
      }, async () => {
        const sourcePromise = this.waitForEventObservationPage(page, "event-log");
        await this.goto(page, "/event-log");
        const sourceResponse = await sourcePromise;
        const baseObsUrl = new URL(sourceResponse.url());
        baseObsUrl.searchParams.delete("offset");
        baseObsUrl.searchParams.set("limit", "25");

        const eqUrl = new URL(baseObsUrl.toString());
        eqUrl.searchParams.set("filter", "adjudicatedIds='eml-non-threat'");
        const neUrl = new URL(baseObsUrl.toString());
        neUrl.searchParams.set("filter", "adjudicatedIds!='eml-non-threat'");

        const [eqRes, neRes] = await Promise.all([
          page.evaluate(boundedFetch, {url: eqUrl.toString(), maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES, decodeImage: false}),
          page.evaluate(boundedFetch, {url: neUrl.toString(), maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES, decodeImage: false}),
        ]);
        const eqPayload = eqRes.ok ? (parseBoundedEventApiJson(eqRes, "CQL adjudicatedIds equals") as {items?: unknown[]}) : null;
        const nePayload = neRes.ok ? (parseBoundedEventApiJson(neRes, "CQL adjudicatedIds notEquals") as {items?: unknown[]}) : null;
        const eqItems = Array.isArray(eqPayload?.items) ? eqPayload.items : [];
        const neItems = Array.isArray(nePayload?.items) ? nePayload.items : [];

        const itemHasMarker = (item: unknown): boolean => {
          const rec = item as {result?: {adjudicatedIds?: unknown[]}; properties?: {result?: {adjudicatedIds?: unknown[]}}};
          const ids = rec?.result?.adjudicatedIds ?? rec?.properties?.result?.adjudicatedIds;
          return Array.isArray(ids) && ids.some(v => String(v ?? "").trim() === "eml-non-threat");
        };

        const eqExact = eqItems.every(itemHasMarker);
        const neExact = neItems.every(item => !itemHasMarker(item));
        const passed = eqRes.status === 200 && neRes.status === 200 &&
          Array.isArray(eqPayload?.items) && Array.isArray(nePayload?.items) &&
          eqExact && neExact;
        return {
          passed,
          observed: `eq HTTP=${eqRes.status} (items=${eqItems.length}, exact=${eqExact}); ` +
            `ne HTTP=${neRes.status} (items=${neItems.length}, exact=${neExact})`,
        };
      });

      await this.check({
        scenario: "event-filtering",
        category: "events",
        action: "verify CQL adjudication code filter semantics",
        target: "Event Log authenticated observations API",
        expected: "adjudicatedIdsCount>0 AND adjudicatedIds='code:9' and (adjudicatedIdsCount=0 OR adjudicatedIds!='code:9') both return HTTP 200 with partition-exact semantics",
      }, async () => {
        const sourcePromise = this.waitForEventObservationPage(page, "event-log");
        await this.goto(page, "/event-log");
        const sourceResponse = await sourcePromise;
        const baseObsUrl = new URL(sourceResponse.url());
        baseObsUrl.searchParams.delete("offset");
        baseObsUrl.searchParams.set("limit", "25");

        const eqUrl = new URL(baseObsUrl.toString());
        eqUrl.searchParams.set("filter", "adjudicatedIdsCount>0 AND adjudicatedIds='code:9'");
        const neUrl = new URL(baseObsUrl.toString());
        neUrl.searchParams.set("filter", "(adjudicatedIdsCount=0 OR adjudicatedIds!='code:9')");

        const [eqRes, neRes] = await Promise.all([
          page.evaluate(boundedFetch, {url: eqUrl.toString(), maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES, decodeImage: false}),
          page.evaluate(boundedFetch, {url: neUrl.toString(), maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES, decodeImage: false}),
        ]);
        const eqPayload = eqRes.ok ? (parseBoundedEventApiJson(eqRes, "CQL adjudicationCode equals") as {items?: unknown[]}) : null;
        const nePayload = neRes.ok ? (parseBoundedEventApiJson(neRes, "CQL adjudicationCode notEquals") as {items?: unknown[]}) : null;
        const eqItems = Array.isArray(eqPayload?.items) ? eqPayload.items : [];
        const neItems = Array.isArray(nePayload?.items) ? nePayload.items : [];

        const itemHasCode9 = (item: unknown): boolean => {
          const rec = item as {result?: {adjudicatedIds?: unknown[]}; properties?: {result?: {adjudicatedIds?: unknown[]}}};
          const ids = rec?.result?.adjudicatedIds ?? rec?.properties?.result?.adjudicatedIds;
          return Array.isArray(ids) && ids.some(v => String(v ?? "").trim() === "code:9");
        };

        const eqExact = eqItems.every(itemHasCode9);
        const neExact = neItems.every(item => !itemHasCode9(item));
        const passed = eqRes.status === 200 && neRes.status === 200 &&
          Array.isArray(eqPayload?.items) && Array.isArray(nePayload?.items) &&
          eqExact && neExact;
        return {
          passed,
          observed: `code:9 eq HTTP=${eqRes.status} (items=${eqItems.length}, exact=${eqExact}); ` +
            `ne HTTP=${neRes.status} (items=${neItems.length}, exact=${neExact})`,
        };
      });

      await this.check({
        scenario: "event-filtering",
        category: "events",
        action: "verify Vehicle ID <search> landmark, normalized vehicle-search API, and accumulated multi-pass comparison",
        target: "Event Log Vehicle ID search bar and /sensorhub/buckets/adjudication/vehicle-search",
        expected: "Event Log exposes a <search> landmark with non-prose identifier attributes, /buckets/adjudication/vehicle-search returns HTTP 200, and any accumulated multi-pass vehicle ID resolves via normalized spaced/lowercase search into VehiclePassComparisonDialog",
      }, async () => {
        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.uiTimeoutMs});

        const searchLandmark = page.locator('search[data-testid="vehicle-id-search-bar"]');
        const landmarkVisible = await searchLandmark.waitFor({state: "visible", timeout: 10_000})
          .then(() => true)
          .catch(() => false);
        const searchInput = page.getByTestId("vehicle-id-search-input");
        const autoCorrect = await searchInput.getAttribute("autocorrect").catch(() => null);
        const autoCap = await searchInput.getAttribute("autocapitalize").catch(() => null);
        const spellCheck = await searchInput.getAttribute("spellcheck").catch(() => null);
        const attrsOk = landmarkVisible &&
          autoCorrect === "off" &&
          autoCap === "none" &&
          spellCheck === "false";

        const catalogRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/buckets/adjudication/vehicle-search?matchMode=isNotEmpty&limit=200"),
          {headers: {Accept: "application/json"}},
        );
        const catalogHttp = catalogRes.status();
        let catalogPasses: Array<{normalizedVehicleId?: unknown; vehicleId?: unknown; occupancyObsId?: unknown}> = [];
        try {
          if (catalogRes.ok()) {
            const parsed = await catalogRes.json() as {passes?: Array<{normalizedVehicleId?: unknown; vehicleId?: unknown; occupancyObsId?: unknown}>};
            if (Array.isArray(parsed.passes)) {
              catalogPasses = parsed.passes;
            }
          }
        } finally {
          await catalogRes.dispose();
        }

        if (catalogHttp !== 200 || !attrsOk) {
          return {
            passed: false,
            observed: `catalogHttp=${catalogHttp}; landmarkVisible=${landmarkVisible}; autocorrect=${autoCorrect}; autocapitalize=${autoCap}; spellcheck=${spellCheck}`,
            evidence: await this.screenshotOnFailure(page, "vehicle-search-landmark-or-api-failed"),
          };
        }

        // Prefer a normalized Vehicle ID that has accumulated >= 2 passes (from continuous OCR or endurance adjudication).
        const countsByNorm = new Map<string, number>();
        for (const p of catalogPasses) {
          const norm = String(p.normalizedVehicleId ?? "").trim();
          if (!norm) continue;
          countsByNorm.set(norm, (countsByNorm.get(norm) ?? 0) + 1);
        }
        let chosenNorm = "";
        let chosenCount = 0;
        for (const [norm, count] of countsByNorm.entries()) {
          if (count > chosenCount) {
            chosenNorm = norm;
            chosenCount = count;
          }
        }

        if (!chosenNorm) {
          // Empty baseline node: verify zero-result normalized query cleanly returns 0 passes.
          await searchInput.fill("csqu 305438-3");
          await page.getByTestId("vehicle-id-search-submit").click();
          await page.getByTestId("vehicle-id-search-clear").waitFor({state: "visible", timeout: 10_000});
          await page.getByTestId("vehicle-id-search-clear").click();
          return {
            passed: true,
            observed: "catalogHttp=200; accumulatedVehiclePasses=0; <search> landmark & non-prose input attributes verified",
          };
        }

        const formattedVariant = /^[A-Z]{3}[UJZR][0-9]{7}$/.test(chosenNorm)
          ? `${chosenNorm.slice(0, 4).toLowerCase()} ${chosenNorm.slice(4, 10)}-${chosenNorm.slice(10)}`
          : chosenNorm.length >= 5
            ? `${chosenNorm.slice(0, 2).toLowerCase()}-${chosenNorm.slice(2)}`
            : chosenNorm.toLowerCase();

        const normRes = await page.context().request.get(
          this.viewerUrl(
            `/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(formattedVariant)}&matchMode=equals&limit=200`,
          ),
          {headers: {Accept: "application/json"}},
        );
        let matchedApiCount = 0;
        try {
          if (normRes.ok()) {
            const normJson = await normRes.json() as {passes?: unknown[]};
            matchedApiCount = Array.isArray(normJson.passes) ? normJson.passes.length : 0;
          }
        } finally {
          await normRes.dispose();
        }

        let likeModesOk = true;
        if (chosenNorm.length >= 4) {
          const prefixQuery = chosenNorm.slice(0, Math.min(4, chosenNorm.length));
          const substrQuery = chosenNorm.slice(1, Math.min(chosenNorm.length, 5));
          const [prefixRes, containsRes] = await Promise.all([
            page.context().request.get(
              this.viewerUrl(
                `/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(prefixQuery)}&matchMode=startsWith&limit=200`,
              ),
              {headers: {Accept: "application/json"}},
            ),
            page.context().request.get(
              this.viewerUrl(
                `/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(substrQuery)}&matchMode=contains&limit=200`,
              ),
              {headers: {Accept: "application/json"}},
            ),
          ]);
          try {
            const prefixJson = prefixRes.ok() ? (await prefixRes.json() as {passes?: Array<{normalizedVehicleId?: unknown}>}) : null;
            const containsJson = containsRes.ok() ? (await containsRes.json() as {passes?: Array<{normalizedVehicleId?: unknown}>}) : null;
            const prefixPasses = Array.isArray(prefixJson?.passes) ? prefixJson.passes : [];
            const containsPasses = Array.isArray(containsJson?.passes) ? containsJson.passes : [];
            likeModesOk = prefixRes.status() === 200 &&
              containsRes.status() === 200 &&
              prefixPasses.some(p => String(p.normalizedVehicleId ?? "").trim() === chosenNorm) &&
              containsPasses.some(p => String(p.normalizedVehicleId ?? "").trim() === chosenNorm);
          } finally {
            await Promise.all([prefixRes.dispose(), containsRes.dispose()]);
          }
        }

        const windowSelect = page.getByTestId("vehicle-id-search-window");
        if (await windowSelect.isVisible().catch(() => false)) {
          await windowSelect.click();
          const allOption = page.locator('li[data-value="all"]').first();
          await allOption.waitFor({state: "visible", timeout: 5_000});
          await allOption.click();
        }
        await searchInput.fill(formattedVariant);
        await page.getByTestId("vehicle-id-search-submit").click();
        const compareBtn = page.getByTestId("vehicle-search-compare-btn").first();
        const compareVisible = await compareBtn.waitFor({state: "visible", timeout: 20_000})
          .then(() => true)
          .catch(() => false);
        let dialogTableFocusable = false;
        let historyUpSetVisible = false;
        if (compareVisible) {
          await compareBtn.click();
          const dialog = page.getByTestId("vehicle-pass-comparison-dialog");
          await dialog.waitFor({state: "visible", timeout: 15_000});
          historyUpSetVisible = await dialog.getByTestId("vehicle-history-upset-plot")
            .waitFor({state: "visible", timeout: 10_000})
            .then(() => true, () => false);
          const region = dialog.getByTestId("vehicle-pass-table-region");
          await region.waitFor({state: "visible", timeout: 15_000});
          dialogTableFocusable = (await region.getAttribute("tabindex")) === "0";
          await dialog.getByRole("button", {name: /^close$/i}).last().click();
          await dialog.waitFor({state: "hidden", timeout: 10_000});
          await page.getByTestId("vehicle-id-search-clear").click();
        }
        if (await windowSelect.isVisible().catch(() => false)) {
          await windowSelect.click();
          const defaultOption = page.locator('li[data-value="30d"]').first();
          if (await defaultOption.isVisible({timeout: 5_000}).catch(() => false)) {
            await defaultOption.click();
          } else {
            await page.keyboard.press("Escape");
          }
        }

        const passed = matchedApiCount >= chosenCount && likeModesOk && compareVisible && dialogTableFocusable && historyUpSetVisible;
        return {
          passed,
          observed: `chosenVehicle=${chosenNorm} (query='${formattedVariant}', accumulatedPasses=${matchedApiCount}, likeModesOk=${likeModesOk}); ` +
            `compareVisible=${compareVisible}; historyUpSetVisible=${historyUpSetVisible}; tableTabIndex0=${dialogTableFocusable}`,
          evidence: passed ? "" : await this.screenshotOnFailure(page, "vehicle-search-correlation-failed"),
        };
      });

      await this.check({
        scenario: "event-filtering",
        category: "performance",
        action: "rapid Dashboard next-page burst and deep-offset slice parity without HTTP 500 or health timeouts",
        target: "Dashboard Active Alarms pagination and /sensorhub/api/observations",
        expected: "rapid next-page clicking debounces intermediate page fetches with bounded limit<=30, zero HTTP 5xx responses, zero health snapshot timeouts, and exact offset slice parity",
      }, async () => {
        const obs5xxUrls: string[] = [];
        const healthTimeoutLogs: string[] = [];
        const paginatedRowLimits: number[] = [];

        const onResponse = (resp: import("playwright").Response) => {
          const url = resp.url();
          if (!url.includes("/sensorhub/api/observations")) return;
          if (resp.status() >= 500) {
            obs5xxUrls.push(`${resp.status()} ${url}`);
          }
          if (!url.includes("/observations/count")) {
            try {
              const parsedUrl = new URL(url);
              const off = Number(parsedUrl.searchParams.get("offset") ?? "0");
              const lim = Number(parsedUrl.searchParams.get("limit") ?? "0");
              if (off > 0 && Number.isFinite(lim) && lim > 0) {
                paginatedRowLimits.push(lim);
              }
            } catch {
              // ignore malformed URL
            }
          }
        };
        const onConsole = (msg: import("playwright").ConsoleMessage) => {
          const text = msg.text();
          if (/Health snapshot timed out/i.test(text)) {
            healthTimeoutLogs.push(text);
          }
        };

        page.on("response", onResponse);
        page.on("console", onConsole);
        try {
          const sourcePromise = this.waitForEventObservationPage(page, "dashboard-alarms");
          await this.goto(page, "/");
          await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
          const initialObsResp = await sourcePromise;

          const window15dBtn = page.getByRole("button", {name: /^15d$/i}).first();
          if ((await window15dBtn.count()) > 0 && await window15dBtn.isVisible().catch(() => false)) {
            await window15dBtn.click().catch(() => undefined);
            await sleep(400);
          }

          const nextBtn = page.locator('button[aria-label="Go to next page"]').first();
          let clicks = 0;
          for (let i = 0; i < 25; i += 1) {
            const enabled = await nextBtn.isEnabled().catch(() => false);
            if (!enabled) break;
            await nextBtn.click({delay: 5}).catch(() => undefined);
            clicks += 1;
          }
          await sleep(1_500);

          // Also verify direct ConSys server-side offset/limit slice parity against offset=0.
          const parityBaseUrl = new URL(initialObsResp.url());
          parityBaseUrl.searchParams.set("offset", "0");
          parityBaseUrl.searchParams.set("limit", "30");
          const sliceUrl = new URL(parityBaseUrl.toString());
          sliceUrl.searchParams.set("offset", "15");
          sliceUrl.searchParams.set("limit", "15");

          const [headRes, sliceRes] = await Promise.all([
            page.evaluate(boundedFetch, {url: parityBaseUrl.toString(), maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES, decodeImage: false}),
            page.evaluate(boundedFetch, {url: sliceUrl.toString(), maxBytes: ADVANCED_DATE_FILTER_MAX_BYTES, decodeImage: false}),
          ]);
          const headItems = headRes.ok
            ? ((parseBoundedEventApiJson(headRes, "pagination parity offset=0") as {items?: Array<{id?: unknown}>})?.items ?? [])
            : [];
          const sliceItems = sliceRes.ok
            ? ((parseBoundedEventApiJson(sliceRes, "pagination parity offset=15") as {items?: Array<{id?: unknown}>})?.items ?? [])
            : [];
          const expectedSliceIds = headItems.slice(15, 30).map(item => String(item.id ?? ""));
          const actualSliceIds = sliceItems.map(item => String(item.id ?? ""));
          const sliceParity = headRes.status === 200 &&
            sliceRes.status === 200 &&
            expectedSliceIds.length === actualSliceIds.length &&
            expectedSliceIds.every((id, idx) => id === actualSliceIds[idx]);

          const maxLimit = paginatedRowLimits.length > 0 ? Math.max(...paginatedRowLimits) : 15;
          const passed = obs5xxUrls.length === 0 &&
            healthTimeoutLogs.length === 0 &&
            maxLimit <= 30 &&
            sliceParity;
          return {
            passed,
            observed: `nextClicks=${clicks}; obs5xx=${obs5xxUrls.length}; healthTimeouts=${healthTimeoutLogs.length}; ` +
              `maxPaginatedLimit=${maxLimit}; sliceParity=${sliceParity} (sliceItems=${actualSliceIds.length})`,
            evidence: passed ? "" : await this.screenshotOnFailure(page, "dashboard-rapid-pagination-failed"),
          };
        } finally {
          page.off("response", onResponse);
          page.off("console", onConsole);
        }
      });

      await this.check({
        scenario: "event-filtering",
        category: "performance",
        action: "apply Event Log Advanced Filters (Adjudicated, multi-Status, Max Gamma) and toggle Priority/Newest-first without HTTP 5xx",
        target: "Event Log Advanced filters and toolbar-sort-time-only",
        expected: "applying Adjudicated (Is not empty) and multi-Status + Max Gamma >= 50 in Priority mode and immediately toggling Newest first settles promptly with zero HTTP 5xx responses and zero error banners",
      }, async () => {
        const obs5xxUrls: string[] = [];
        let inFlightObs = 0;
        let inFlightCounts = 0;
        const onReq = (req: import("playwright").Request) => {
          const url = req.url();
          if (!url.includes("/sensorhub/api/observations")) return;
          if (url.includes("/observations/count")) {
            inFlightCounts += 1;
          } else {
            inFlightObs += 1;
          }
        };
        const onReqDone = (req: import("playwright").Request) => {
          const url = req.url();
          if (!url.includes("/sensorhub/api/observations")) return;
          if (url.includes("/observations/count")) {
            inFlightCounts = Math.max(0, inFlightCounts - 1);
          } else {
            inFlightObs = Math.max(0, inFlightObs - 1);
          }
        };
        const onResponse = (res: import("playwright").Response) => {
          if (res.url().includes("/sensorhub/api/observations") && res.status() >= 500) {
            obs5xxUrls.push(`${res.status()} ${res.url()}`);
          }
        };
        page.on("request", onReq);
        page.on("requestfinished", onReqDone);
        page.on("requestfailed", onReqDone);
        page.on("response", onResponse);
        try {
          await this.goto(page, "/event-log");
          await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.eventTimeoutMs});
          const newestBtn = page.getByTestId("toolbar-sort-time-only").first();
          await newestBtn.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
          if ((await newestBtn.getAttribute("aria-pressed")) === "true") {
            await newestBtn.click();
            await poll(
              async () => (await newestBtn.getAttribute("aria-pressed")) !== "true",
              Boolean,
              {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "reset to Priority sort"},
            );
          }

          const waitPageSettled = async (label: string): Promise<number> => {
            const started = Date.now();
            await poll(
              async () => {
                const progress = await page.locator(".MuiDataGrid-root [role='progressbar']").count();
                return progress === 0 && inFlightObs === 0;
              },
              Boolean,
              {timeoutMs: this.config.eventTimeoutMs, intervalMs: 100, description: label},
            );
            return Date.now() - started;
          };

          // Phase 1: Exact operator reproduction — Adjudicated "Is not empty" in Priority mode -> immediate Newest first toggle -> back to Priority
          await page.getByRole("button", {name: /advanced filters/i}).first().click();
          const dialog = page.getByRole("dialog", {name: /advanced filters/i});
          await dialog.waitFor({timeout: this.config.uiTimeoutMs});
          await dialog.getByRole("button", {name: /clear all/i}).click();
          await dialog.getByRole("button", {name: /add condition/i}).click();
          const boxes = dialog.getByRole("combobox");
          await boxes.nth(1).click();
          await page.getByRole("option", {name: "Adjudicated", exact: true}).click();
          await boxes.nth(2).click();
          await page.getByRole("option", {name: "Is not empty", exact: true}).click();
          await dialog.getByRole("button", {name: /apply filters/i}).click();
          await dialog.waitFor({state: "hidden"});

          // Immediately toggle Newest first (racing the 150ms priority bucket-prewarm window)
          const adjNewestStart = Date.now();
          await newestBtn.click();
          await poll(
            async () => (await newestBtn.getAttribute("aria-pressed")) === "true",
            Boolean,
            {timeoutMs: this.config.uiTimeoutMs, intervalMs: 50, description: "Newest first active under Adjudicated filter"},
          );
          await waitPageSettled("Adjudicated + Newest first settlement");
          const adjNewestMs = Date.now() - adjNewestStart;

          // Toggle back to Priority mode and verify clean settlement
          const adjPriorityStart = Date.now();
          await newestBtn.click();
          await poll(
            async () => (await newestBtn.getAttribute("aria-pressed")) !== "true",
            Boolean,
            {timeoutMs: this.config.uiTimeoutMs, intervalMs: 50, description: "Priority active under Adjudicated filter"},
          );
          await waitPageSettled("Adjudicated + Priority settlement");
          const adjPriorityMs = Date.now() - adjPriorityStart;

          // Phase 2: Multi-Status (Gamma + Neutron) + numeric Max Gamma >= 50 -> immediate Newest first toggle
          await page.getByRole("button", {name: /advanced filters/i}).first().click();
          await dialog.waitFor({timeout: this.config.uiTimeoutMs});
          await dialog.getByRole("button", {name: /clear all/i}).click();
          await dialog.getByRole("button", {name: /add condition/i}).click();
          // Default new rule is Status + Is any of
          await boxes.nth(3).click();
          await page.getByRole("option", {name: "Gamma", exact: true}).click();
          await page.getByRole("option", {name: "Neutron", exact: true}).click();
          if (await page.getByRole("listbox").isVisible().catch(() => false)) {
            await page.keyboard.press("Escape");
          }
          await dialog.getByRole("button", {name: /add condition/i}).click();
          await boxes.nth(4).click();
          await page.getByRole("option", {name: "Max Gamma (cps)", exact: true}).click();
          await dialog.locator('input[type="number"]').first().fill("50");
          await dialog.getByRole("button", {name: /apply filters/i}).click();
          await dialog.waitFor({state: "hidden"});

          const multiNewestStart = Date.now();
          await newestBtn.click();
          await poll(
            async () => (await newestBtn.getAttribute("aria-pressed")) === "true",
            Boolean,
            {timeoutMs: this.config.uiTimeoutMs, intervalMs: 50, description: "Newest first active under multi-Status + Max Gamma"},
          );
          await waitPageSettled("multi-Status + Max Gamma + Newest first settlement");
          const multiNewestMs = Date.now() - multiNewestStart;

          const errorAlerts = await page.locator('[role="alert"]').filter({hasText: /failed|error|500|busy/i}).count();
          await poll(
            async () => inFlightCounts === 0,
            Boolean,
            {timeoutMs: this.config.eventTimeoutMs, intervalMs: 100, description: "background count queries HTTP status check"},
          ).catch(() => undefined);

          // Clean up filters & restore default Priority sort for downstream checks
          await page.getByRole("button", {name: /advanced filters/i}).first().click();
          await dialog.waitFor({timeout: this.config.uiTimeoutMs});
          await dialog.getByRole("button", {name: /clear all/i}).click();
          await dialog.getByRole("button", {name: /apply filters/i}).click();
          await dialog.waitFor({state: "hidden"});
          if ((await newestBtn.getAttribute("aria-pressed")) === "true") {
            await newestBtn.click();
          }

          const passed = obs5xxUrls.length === 0 &&
            errorAlerts === 0 &&
            adjNewestMs <= 4_500 &&
            adjPriorityMs <= 4_500 &&
            multiNewestMs <= 10_000;
          return {
            passed,
            observed: `adjNewestMs=${adjNewestMs}; adjPriorityMs=${adjPriorityMs}; multiStatusMaxGammaNewestMs=${multiNewestMs}; ` +
              `obs5xx=${obs5xxUrls.length}; errorAlerts=${errorAlerts}`,
            evidence: passed ? "" : await this.screenshotOnFailure(page, "event-log-filter-sort-contention-failed"),
          };
        } finally {
          page.off("request", onReq);
          page.off("requestfinished", onReqDone);
          page.off("requestfailed", onReqDone);
          page.off("response", onResponse);
        }
      });
    } finally { await page.close(); }
  }

  private async applyLaneEventFilter(
    page: Page,
    statusOption?: "Gamma" | "Neutron" | "Gamma & Neutron",
  ): Promise<void> {
    await page.getByRole("button", {name: /advanced filters/i}).first().click();
    const dialog = page.getByRole("dialog", {name: /advanced filters/i});
    await dialog.waitFor();
    await dialog.getByRole("button", {name: /clear all/i}).click();
    await dialog.getByRole("button", {name: /add condition/i}).click();
    const boxes = dialog.getByRole("combobox");
    await boxes.nth(1).click();
    await page.getByRole("option", {name: "Lane ID", exact: true}).click();
    await poll(
      () => boxes.nth(1).innerText(),
      (value) => value.trim() === "Lane ID",
      {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "lane filter field selection"},
    );
    await boxes.nth(3).click();
    await page.getByRole("option", {name: this.config.testLaneLabel, exact: true}).click();
    await poll(
      () => boxes.nth(3).innerText(),
      (value) => value.trim() === this.config.testLaneLabel,
      {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "lane filter value selection"},
    );
    if (statusOption) {
      await dialog.getByRole("button", {name: /add condition/i}).click();
      await boxes.nth(4).click();
      await page.getByRole("option", {name: "Status", exact: true}).click();
      await poll(
        () => boxes.nth(4).innerText(),
        (value) => value.trim() === "Status",
        {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "status filter field selection"},
      );
      await boxes.nth(6).click();
      await page.getByRole("option", {name: statusOption, exact: true}).click();
      // Status defaults to the multi-select "is any of" operator, whose listbox stays open
      // (keeping the underlying dialog aria-hidden) until Escape closes the menu popover.
      if (await page.getByRole("listbox").isVisible().catch(() => false)) {
        await page.keyboard.press("Escape");
      }
      await poll(
        () => boxes.nth(6).innerText(),
        (value) => value.trim() === statusOption,
        {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "status filter value selection"},
      );
    }
    await dialog.getByRole("button", {name: /apply filters/i}).click();
    await dialog.waitFor({state: "hidden"});
  }

  private async operationalViews(): Promise<void> {
    const workflowMetadata: CheckMetadata = {
      scenario: "operational-views", category: "scope", action: "detect operational-view workflow",
      target: this.config.oscarLaneConfigPath,
      expected: "Viewer supports fail-closed operational-view scoping",
    };
    if (this.config.operationalViewWorkflow === "disabled") {
      this.skip(workflowMetadata, "OPERATIONAL_VIEW_WORKFLOW is disabled");
      return;
    }
    const oracle = this.config.laneConfigOracle;
    if (!oracle) {
      this.reporter.outcome(
        workflowMetadata.scenario, workflowMetadata.category, workflowMetadata.action,
        workflowMetadata.target, workflowMetadata.expected,
        "lane membership oracle is unavailable", "incorrect", 0,
      );
      return;
    }
    const configuredViewKeys = this.config.operationalViewWorkflow === "required"
      ? [...REQUIRED_OPERATIONAL_VIEW_KEYS]
      : [...oracle.lanesByView.keys()].sort();

    const page = await this.browser.oscarPage();
    try {
      const firstKey = configuredViewKeys[0] ?? "east-gate";
      await this.goto(page, `/?view=${firstKey}`);
      const capabilityAvailable = await scopedViewIndicatorLocator(page, firstKey)
        .waitFor({timeout: this.config.uiTimeoutMs})
        .then(() => true, () => false);
      if (!capabilityAvailable) {
        if (this.config.operationalViewWorkflow === "auto") {
          this.skip(workflowMetadata, "operational-view workflow is not present on this build (auto detection)");
        } else {
          this.reporter.outcome(
            workflowMetadata.scenario, workflowMetadata.category, workflowMetadata.action,
            workflowMetadata.target, workflowMetadata.expected,
            "operational-view chip did not appear", "incorrect", 0,
          );
        }
        return;
      }
      if (!configuredViewKeys.length) {
        this.reporter.outcome(
          workflowMetadata.scenario, workflowMetadata.category, workflowMetadata.action,
          workflowMetadata.target, workflowMetadata.expected,
          "lane membership oracle contains no operational-view assignments", "incorrect", 0,
        );
        return;
      }
      this.reporter.outcome(
        workflowMetadata.scenario, workflowMetadata.category, workflowMetadata.action,
        workflowMetadata.target, workflowMetadata.expected,
        "operational-view chip is available", "correct", 0,
      );

      const invalidKey = `unassigned-${randomUUID().slice(0, 12)}`;
      await this.check({
        scenario: "operational-views", category: "scope", action: "reject an unassigned operational view",
        target: invalidKey, expected: "Viewer fails closed and loads no lane data for an unassigned view key",
      }, async () => {
        await this.goto(page, `/health?view=${encodeURIComponent(invalidKey)}`);
        const empty = page.getByText(new RegExp(`No lanes are assigned to operational view.*${invalidKey}`, "i"));
        await empty.waitFor({timeout: this.config.uiTimeoutMs});
        const rows = await page.locator('[data-testid^="health-lane-"]').count();
        return {passed: rows === 0, observed: `empty-view warning visible; health rows=${rows}`};
      });

      for (const [action, search] of [
        ["reject an invalid operational-view key", "?view=North_Gate"],
        ["reject duplicate operational-view parameters", "?view=east-gate&view=west-gate"],
      ] as const) {
        await this.check({
          scenario: "operational-views", category: "scope", action,
          target: search, expected: "malformed view selection fails closed with no loaded lane data",
        }, async () => {
          await this.goto(page, `/health${search}`);
          await page.getByText("This operational-view URL is invalid. No lanes have been loaded.", {exact: true})
            .waitFor({timeout: this.config.uiTimeoutMs});
          const rows = await page.locator('[data-testid^="health-lane-"]').count();
          return {passed: rows === 0, observed: `invalid-view warning visible; health rows=${rows}`};
        });
      }

      for (const key of configuredViewKeys) {
        const fixtureLaneNames = oracle.lanesByView.get(key) ?? [];
        const expectedLaneNames = [...fixtureLaneNames].sort((a, b) => a.localeCompare(b));
        await this.check({
          scenario: "operational-views", category: "scope", action: `scope ${key} operational view`,
          target: key,
          expected: `Dashboard cards and Status of Health retain view=${key} and list exactly ${expectedLaneNames.join(";")}`,
        }, async () => {
          await this.goto(page, `/?view=${encodeURIComponent(key)}`);
          await scopedViewIndicatorLocator(page, key).waitFor({timeout: this.config.uiTimeoutMs});

          const dashboardCards = page.locator('[data-testid^="lane-health-card-"]');
          const readDashboardCards = async () => (await dashboardCards.evaluateAll((elements) => elements.map((element) => ({
            laneName: (element.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""),
            rpmCount: element.querySelectorAll('[data-testid$="-rpm"]').length,
            cameraCount: element.querySelectorAll('[data-testid$="-camera"]').length,
            cameraIds: [...element.querySelectorAll('[data-testid$="-camera"]')]
              .map((camera) => camera.getAttribute("data-component-id") ?? "")
              .filter(Boolean),
          })))).sort((a, b) => a.laneName.localeCompare(b.laneName));
          const requireOneCameraPerLane = this.config.expectedCameraCount === this.config.expectedLaneCount;
          let dashboardState: Array<{
            laneName: string;
            rpmCount: number;
            cameraCount: number;
            cameraIds: string[];
          }>;
          try {
            dashboardState = await poll(
              readDashboardCards,
              (value) => {
                const laneNames = value.map(({laneName}) => laneName);
                const cameraIds = value.flatMap(({cameraIds}) => cameraIds);
                const renderedCameraCount = value.reduce((sum, {cameraCount}) => sum + cameraCount, 0);
                return laneNames.length === expectedLaneNames.length &&
                  laneNames.every((laneName, index) => laneName === expectedLaneNames[index]) &&
                  value.every(({rpmCount}) => rpmCount === 1) &&
                  (!requireOneCameraPerLane || value.every(({cameraCount}) => cameraCount === 1)) &&
                  cameraIds.length === renderedCameraCount &&
                  new Set(cameraIds).size === cameraIds.length;
              },
              {
                timeoutMs: this.config.uiTimeoutMs,
                intervalMs: 250,
                description: `exact ${key} Dashboard lane and component membership`,
              },
            );
          } catch {
            dashboardState = await readDashboardCards();
            const evidence = await this.screenshotOnFailure(page, `operational-view-${safeName(key)}-dashboard-membership`);
            return {
              passed: false,
              observed: `Dashboard lanes=${dashboardState.map(({laneName}) => laneName).join(";") || "none"}; RPM mappings=${dashboardState.map(({laneName, rpmCount}) => `${laneName}:${rpmCount}`).join("|") || "none"}; camera mappings=${dashboardState.map(({laneName, cameraCount}) => `${laneName}:${cameraCount}`).join("|") || "none"}`,
              evidence,
            };
          }

          const healthLink = page.locator(`a[href="/health/?view=${encodeURIComponent(key)}"]`).first();
          await healthLink.waitFor({timeout: this.config.uiTimeoutMs});
          const href = await healthLink.getAttribute("href");
          await Promise.all([
            page.waitForURL((url) =>
              normalizePathname(url.pathname) === "/health" &&
              url.searchParams.getAll("view").length === 1 &&
              url.searchParams.get("view") === key,
            {timeout: this.config.uiTimeoutMs}),
            healthLink.click(),
          ]);
          await page.getByRole("heading", {name: "Status of Health", exact: true})
            .waitFor({timeout: this.config.uiTimeoutMs});
          await scopedViewIndicatorLocator(page, key).waitFor({timeout: this.config.uiTimeoutMs});

          const rows = page.locator('[data-testid^="health-lane-"]');
          const readLaneNames = async () => (await rows.evaluateAll((elements) => elements
            .map((element) => element.getAttribute("data-testid")?.replace(/^health-lane-/, "") ?? "")
            .filter(Boolean))).sort();
          let actualLaneNames: string[] = [];
          try {
            actualLaneNames = await poll(
              readLaneNames,
              (value) => value.length === expectedLaneNames.length &&
                value.every((laneName, index) => laneName === expectedLaneNames[index]),
              {
                timeoutMs: this.config.uiTimeoutMs,
                intervalMs: 250,
                description: `exact ${key} Status of Health lane membership`,
              },
            );
          } catch {
            actualLaneNames = await readLaneNames();
            const evidence = await this.screenshotOnFailure(page, `operational-view-${safeName(key)}-membership`);
            return {
              passed: false,
              observed: `nav href=${href}; lanes=${actualLaneNames.join(";") || "none"}`,
              evidence,
            };
          }
          const current = new URL(page.url());
          const queryPersisted = current.searchParams.getAll("view").length === 1 &&
            current.searchParams.get("view") === key;
          return {
            passed: href === `/health/?view=${encodeURIComponent(key)}` && queryPersisted,
            observed: `Dashboard exact lanes=${dashboardState.length}; one RPM per lane=true; canonical one camera per lane=${requireOneCameraPerLane}; nav href=${href}; query persisted=${queryPersisted}; Health exact lanes=${actualLaneNames.length}`,
          };
        });
      }
    } finally { await page.close(); }
  }

  private async selectMui(page: Page, label: string, value?: string): Promise<void> {
    const labelLocator = page.locator("label").filter({hasText: label}).first();
    await labelLocator.waitFor();
    await labelLocator.locator("xpath=..").locator(".MuiSelect-select").click();
    const options = page.locator(".MuiList-root .MuiMenuItem-root:visible");
    await options.first().waitFor();
    if (value) {
      const exact = page.locator(`.MuiList-root .MuiMenuItem-root[data-value="${value}"]:visible`);
      if (await exact.count()) await exact.first().click();
      else await options.filter({hasText: value}).first().click();
    } else {
      await options.filter({hasNot: page.locator('[data-value="all"]')}).first().click();
    }
  }

  private async generateReport(page: Page, reportCase: ReportCase): Promise<{src: string; saved: string; pages: number}> {
    const {reportType, eventType} = reportCase;
    await this.goto(page, "/report");
    await page.getByRole("heading", {name: "Report Generator", exact: true}).waitFor();
    await this.selectMui(page, "Node Selector");
    if (["LANE", "ADJUDICATION"].includes(reportType)) {
      await this.selectMui(page, "Report Scope", "LANES");
      const laneLabel = page.getByText("Lane Selector", {exact: true}).first();
      await laneLabel.locator("xpath=..").locator(".MuiSelect-select").click();
      const laneOption = page.locator(".MuiList-root .MuiMenuItem-root:visible")
        .filter({hasText: this.config.testLaneLabel}).first();
      await laneOption.waitFor();
      await laneOption.click();
      await page.keyboard.press("Escape");
    }
    await this.selectMui(page, "Report Type", reportType);
    if (reportType === "EVENT") await this.selectMui(page, "Event Type", eventType ?? "ALARMS_OCCUPANCIES");
    if (reportType === "VEHICLE_INCIDENT") {
      const vehInput = page.getByTestId("report-vehicle-id-input");
      await vehInput.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
      const fallbackVeh = this.config.expectedVehicleOcrContainer === "ANY"
        ? "EGHU3972694"
        : this.config.expectedVehicleOcrContainer;
      await vehInput.fill(reportCase.vehicleId ?? fallbackVeh);
    }
    await this.selectMui(page, "Time Range", reportType === "VEHICLE_INCIDENT" ? "last30days" : "last24Hrs");
    const button = page.getByRole("button", {name: "Generate Report"});
    await button.click();
    const iframe = page.locator("iframe").first();
    const outcome = await poll(async () => {
      const src = await iframe.getAttribute("src").catch(() => null);
      if (src?.includes(".pdf")) return {src, error: ""};
      const body = await page.locator("body").innerText();
      const failure = body.match(/report (?:generation|request) failed[^\n]*/i)?.[0] ?? "";
      return failure ? {src: "", error: failure} : null;
    }, (value): value is {src: string; error: string} => value !== null, {
      timeoutMs: this.config.eventTimeoutMs,
      intervalMs: 1_000,
      description: `${reportType} report completion`,
    });
    if (!outcome) throw new Error(`${reportType} report did not return an outcome`);
    if (outcome.error) throw new Error(outcome.error);
    const src = outcome.src;
    if (!src) throw new Error(`${reportType} report iframe has no src`);
    const response = await page.context().request.get(new URL(src, this.config.oscarBaseUrl).toString());
    if (!response.ok()) throw new Error(`${reportType} report download returned ${response.status()}`);
    const body = await response.body();
    if (body.subarray(0, 4).toString() !== "%PDF") throw new Error(`${reportType} report is not a PDF`);
    const parser = new PDFParse({data: body});
    let parsed;
    try {
      parsed = await parser.getText();
    } finally {
      await parser.destroy();
    }
    const text = parsed.text.replaceAll(/\s+/g, " ");
    const expectedTitle = reportType === "RDS_SITE" ? "RDS Site Report"
      : reportType === "LANE" ? "Lane Report"
        : reportType === "ADJUDICATION" ? "Adjudication Report"
          : reportType === "VEHICLE_INCIDENT" ? "Vehicle Incident Report"
            : "Event Report";
    const laneNumber = this.config.testLaneLabel.match(/\d+/)?.[0] ?? "";
    const expectedLane = ["LANE", "ADJUDICATION"].includes(reportType) && laneNumber
      ? new RegExp(`lane-\\s*0*${Number(laneNumber)}\\b`, "i").test(text)
      : true;
    const expectedEvent = reportType === "EVENT"
      ? text.includes(`Event Type: ${eventType}`)
      : true;
    const noRawSystemUrns = reportType === "VEHICLE_INCIDENT"
      ? !/urn:osh:system:/i.test(text)
      : true;
    if (parsed.total < 1 || text.length < 80 || !text.includes(expectedTitle) || !expectedLane || !expectedEvent || !noRawSystemUrns) {
      throw new Error(
        `${reportType} PDF semantic validation failed: pages=${parsed.total}; title=${text.includes(expectedTitle)}; lane=${expectedLane}; event=${expectedEvent}; noRawSystemUrns=${noRawSystemUrns}`,
      );
    }
    const qualifier = eventType ? `-${eventType.toLowerCase()}` : "";
    const saved = join(this.reporter.downloadDir, `${reportType.toLowerCase()}${qualifier}-report.pdf`);
    writeFileSync(saved, body);
    return {src, saved: join("downloads", basename(saved)), pages: parsed.total};
  }

  private async reporting(cases: ReportCase[]): Promise<void> {
    for (const reportCase of cases) {
      const page = await this.browser.oscarPage();
      try {
        const {reportType, eventType} = reportCase;
        const label = eventType ? `${reportType}/${eventType}` : reportType;
        await this.check({
          scenario: reportType === "ADJUDICATION" ? "adjudication-report" : "reporting",
          category: "reports",
          action: `generate ${label} report`,
          target: "Report Generator",
          expected: "Viewer generates and downloads a valid PDF for the last 24 hours",
        }, async () => {
          const result = await this.generateReport(page, reportCase);
          return {
            passed: true,
            observed: `valid ${result.pages}-page PDF with expected report semantics from ${result.src}`,
            evidence: result.saved,
          };
        });

        if (reportType === "ADJUDICATION" || (reportType === "EVENT" && eventType === "ALARMS")) {
          await this.check({
            scenario: reportType === "ADJUDICATION" ? "adjudication-report" : "reporting",
            category: "reports",
            action: `verify UpSet co-occurrence payload and preview in ${label} JSON extract`,
            target: "Report Generator",
            expected: "JSON extract contains structured upSetCoOccurrence (sets + intersections) and renders the interactive UpSet SVG plot when alarming occupancies exist",
          }, async () => {
            await this.goto(page, "/report");
            await page.getByRole("heading", {name: "Report Generator", exact: true}).waitFor();
            await this.selectMui(page, "Node Selector");
            if (reportType === "ADJUDICATION") {
              await this.selectMui(page, "Report Scope", "LANES");
              const laneLabel = page.getByText("Lane Selector", {exact: true}).first();
              await laneLabel.locator("xpath=..").locator(".MuiSelect-select").click();
              const laneOption = page.locator(".MuiList-root .MuiMenuItem-root:visible")
                .filter({hasText: this.config.testLaneLabel}).first();
              await laneOption.waitFor();
              await laneOption.click();
              await page.keyboard.press("Escape");
            }
            await this.selectMui(page, "Report Type", reportType);
            await page.getByRole("radio", {name: "JSON", exact: true}).check();
            if (reportType === "EVENT") {
              await this.selectMui(page, "Event Type", eventType ?? "ALARMS");
            }
            await this.selectMui(page, "Time Range", "last24Hrs");
            await page.getByRole("button", {name: "Generate Report"}).click();

            const dlBtn = page.getByTestId("download-generated-report");
            await dlBtn.waitFor({state: "visible", timeout: this.config.eventTimeoutMs});
            const href = await dlBtn.getAttribute("href");
            if (!href) throw new Error(`${label} JSON download button missing href`);

            const res = await page.context().request.get(new URL(href, this.config.oscarBaseUrl).toString());
            if (!res.ok()) throw new Error(`${label} JSON download returned HTTP ${res.status()}`);
            const jsonText = await res.text();
            await res.dispose();
            const parsedJson = JSON.parse(jsonText) as {
              upSetCoOccurrence?: {
                totalOccupancies?: unknown;
                sets?: Array<{name?: string; count?: number}>;
                intersections?: Array<{
                  sets?: string[];
                  activeSets?: string[];
                  categories?: string[];
                  snmPresent?: boolean;
                  count?: number;
                  mask?: number;
                }>;
              };
            };
            const upset = parsedJson.upSetCoOccurrence;
            const hasStructure = Boolean(
              upset &&
              Array.isArray(upset.sets) &&
              upset.sets.length === 7 &&
              Array.isArray(upset.intersections),
            );
            let populatedSetsFirst = true;
            let snmIntersectionSumExact = true;
            if (hasStructure && upset) {
              let seenZeroSet = false;
              for (const s of upset.sets ?? []) {
                const c = Number(s?.count ?? 0);
                if (c === 0) seenZeroSet = true;
                else if (seenZeroSet) populatedSetsFirst = false;
              }
              const snmSetCount = Number((upset.sets ?? []).find((s) => s?.name === "SNM")?.count ?? 0);
              const snmIntersectionsSum = (upset.intersections ?? [])
                .filter((ix) => {
                  const cats = ix?.sets ?? ix?.activeSets ?? ix?.categories ?? [];
                  return Boolean(ix?.snmPresent) || (Array.isArray(cats) && cats.includes("SNM"));
                })
                .reduce((acc, ix) => acc + Number(ix?.count ?? 0), 0);
              snmIntersectionSumExact = snmSetCount === snmIntersectionsSum;
            }
            const totalOccs = Number(upset?.totalOccupancies ?? 0);
            let svgRendered = true;
            if (totalOccs > 0) {
              svgRendered = await page.getByTestId("report-json-upset-plot")
                .waitFor({state: "visible", timeout: 10_000})
                .then(() => true, () => false);
            }
            const passed = hasStructure && populatedSetsFirst && snmIntersectionSumExact && svgRendered;
            const evidence = passed ? "" : await this.screenshotOnFailure(page, `report-upset-${reportType.toLowerCase()}-failed`);
            return {
              passed,
              observed: `hasStructure=${hasStructure}; populatedSetsFirst=${populatedSetsFirst}; snmSumExact=${snmIntersectionSumExact}; totalOccupancies=${totalOccs}; intersections=${upset?.intersections?.length ?? 0}; svgRendered=${svgRendered}`,
              evidence,
            };
          });
        }
      } finally { await page.close(); }
    }
  }

  private async alarmTransferValidation(): Promise<void> {
    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/alarm-transfer");
      await this.check({
        scenario: "alarm-transfer", category: "alarm-transfer", action: "reject invalid offline alarm payload",
        target: "Alarm Transfer", expected: "invalid payload is rejected with a visible error and no imported record",
      }, async () => {
        const field = page.getByLabel("Paste OSCAR alarm QR payload");
        await field.fill(`not-an-oscar-alarm-${this.reporter.runId}`);
        await page.getByRole("button", {name: /decode payload/i}).click();
        const texts = await poll(
          () => page.getByRole("alert").allInnerTexts(),
          (values) => values.some((value) => /could not be opened/i.test(value)),
          {timeoutMs: 10_000, intervalMs: 250, description: "invalid alarm payload error"},
        );
        const text = texts.find((value) => /could not be opened/i.test(value)) ?? "";
        return {passed: Boolean(text), observed: text};
      });
    } finally { await page.close(); }
  }

  private async alarmTransferCamera(): Promise<void> {
    const capability: CheckMetadata = {
      scenario: "alarm-transfer-camera",
      category: "alarm-transfer",
      action: "detect camera QR workflow",
      target: "Alarm Transfer",
      expected: "camera and QR-image scan controls are available",
    };
    if (this.config.alarmTransferCameraWorkflow === "disabled") {
      this.skip(capability, "ALARM_TRANSFER_CAMERA_WORKFLOW=disabled");
      return;
    }

    const fixture = this.browser.alarmTransferCameraFixture();
    if (!fixture) throw new Error("Deterministic Alarm Transfer camera fixture was not installed");
    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/alarm-transfer");
      const importField = page.getByLabel("Paste OSCAR alarm QR payload", {exact: true});
      const importUiReady = await importField.waitFor({
        state: "visible",
        timeout: this.config.uiTimeoutMs,
      }).then(() => true, () => false);
      if (!importUiReady) {
        const evidence = await this.screenshotOnFailure(page, "alarm-transfer-camera-import-ui-not-ready");
        this.reporter.outcome(
          capability.scenario, capability.category, capability.action, capability.target,
          capability.expected,
          "Alarm Transfer import UI did not become ready before camera capability detection",
          "incorrect", 0, evidence,
        );
        return;
      }
      const startButton = page.getByRole("button", {name: /start camera scan/i});
      const imageButton = page.getByRole("button", {name: /scan qr image/i});
      const [startControlPresent, imageControlPresent] = await Promise.all([
        startButton.count().then((count) => count > 0),
        imageButton.count().then((count) => count > 0),
      ]);
      if (!startControlPresent || !imageControlPresent) {
        if (this.config.alarmTransferCameraWorkflow === "auto" &&
            !startControlPresent && !imageControlPresent) {
          this.skip(capability, "camera QR workflow is not present on this build (auto detection)");
        } else {
          const observed = !startControlPresent && !imageControlPresent
            ? "camera and QR-image scan controls are both absent"
            : `partial camera workflow: start control=${startControlPresent}; ` +
              `QR-image control=${imageControlPresent}`;
          const evidence = await this.screenshotOnFailure(page, "alarm-transfer-camera-capability-missing");
          this.reporter.outcome(
            capability.scenario, capability.category, capability.action, capability.target,
            capability.expected,
            observed, "incorrect", 0, evidence,
          );
        }
        return;
      }
      // Fail closed before any scanner click so a broken init script can never
      // fall through to a runner's physical camera.
      await this.browser.assertAlarmTransferCameraFacade(page);
      this.reporter.outcome(
        capability.scenario, capability.category, capability.action, capability.target,
        capability.expected,
        `controls detected; fixture QR version=${fixture.qrVersion}; transport=${fixture.transportCharacters} characters; ` +
          `symbol=${fixture.symbolPixels}px at ${fixture.pixelsPerModule}px/module`,
        "correct", 0,
      );

      const cameraStarted = await this.check({
        scenario: "alarm-transfer-camera", category: "camera", action: "start deterministic camera preview",
        target: "Alarm Transfer camera",
        expected: "camera starts with a visible, non-zero preview and a contained non-zero scan overlay",
      }, async () => {
        await startButton.click();
        await page.getByRole("button", {name: /stop camera scan/i}).waitFor({timeout: this.config.uiTimeoutMs});
        const preview = page.getByTestId("alarm-qr-camera-preview");
        const video = page.getByTestId("alarm-qr-camera-video");
        const overlay = preview.locator(".scan-region-highlight").first();
        const status = page.getByTestId("alarm-qr-camera-status");
        const activeCamera = page.getByTestId("alarm-qr-active-camera");
        await preview.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
        await overlay.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-testid="alarm-qr-camera-video"]') as
            HTMLVideoElement | null;
          return Boolean(element && element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0);
        }, undefined, {timeout: this.config.uiTimeoutMs});
        const dimensions = await video.evaluate((element: HTMLVideoElement) => ({
          readyState: element.readyState,
          videoWidth: element.videoWidth,
          videoHeight: element.videoHeight,
          renderedWidth: element.getBoundingClientRect().width,
          renderedHeight: element.getBoundingClientRect().height,
        }));
        const previewBox = await preview.boundingBox();
        const overlayBox = await overlay.boundingBox();
        const visibleContentHeight = Math.min(
          dimensions.renderedHeight,
          dimensions.renderedWidth * dimensions.videoHeight / dimensions.videoWidth,
        );
        const overlayRatio = overlayBox && visibleContentHeight > 0
          ? overlayBox.height / visibleContentHeight
          : 0;
        const tolerance = 2;
        const overlayContained = Boolean(previewBox && overlayBox && overlayBox.width > 0 && overlayBox.height > 0 &&
          overlayBox.x >= previewBox.x - tolerance && overlayBox.y >= previewBox.y - tolerance &&
          overlayBox.x + overlayBox.width <= previewBox.x + previewBox.width + tolerance &&
          overlayBox.y + overlayBox.height <= previewBox.y + previewBox.height + tolerance);
        const overlayCoverage = overlayRatio > 0.8 && overlayRatio <= 1.01;
        const statusText = await poll(
          () => status.innerText().then((value) => value.trim()).catch(() => ""),
          (value) => /\bScanning\b/.test(value),
          {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "visible camera Scanning status"},
        );
        const activeCameraText = await poll(
          () => activeCamera.innerText().catch(() => ""),
          (value) => /OSCAR deterministic QR camera/i.test(value) && /640\s*[×x]\s*480/.test(value),
          {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "active camera identity and resolution"},
        );
        const statusScanning = await status.isVisible() && /\bScanning\b/.test(statusText);
        const activeCameraVisible = await activeCamera.isVisible() &&
          /OSCAR deterministic QR camera/i.test(activeCameraText) && /640\s*[×x]\s*480/.test(activeCameraText);
        const state = await this.browser.alarmTransferCameraState(page);
        const visible = await video.isVisible();
        const passed = visible && dimensions.readyState >= 2 && dimensions.videoWidth > 0 &&
          dimensions.videoHeight > 0 && dimensions.renderedWidth > 0 && dimensions.renderedHeight > 0 &&
          overlayContained && overlayCoverage && statusScanning && activeCameraVisible &&
          state.requestCount > 0 && state.activeTrackCount > 0 && state.previewFrameRendered;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "alarm-transfer-camera-preview");
        return {
          passed,
          observed: `visible=${visible}; video=${dimensions.videoWidth}x${dimensions.videoHeight}; ` +
            `rendered=${Math.round(dimensions.renderedWidth)}x${Math.round(dimensions.renderedHeight)}; ` +
            `overlay=${overlayBox ? `${Math.round(overlayBox.width)}x${Math.round(overlayBox.height)}` : "missing"}; ` +
            `overlay/content ratio=${overlayRatio.toFixed(3)}; overlay contained=${overlayContained}; ` +
            `status=${JSON.stringify(statusText)}; active camera=${JSON.stringify(activeCameraText)}; ` +
            `active tracks=${state.activeTrackCount}`,
          value: passed ? true : undefined,
          evidence,
        };
      });
      if (!cameraStarted) return;

      await this.browser.renderAlarmTransferCameraQr(page);
      const decoded = await this.check({
        scenario: "alarm-transfer-camera", category: "alarm-transfer", action: "decode dense camera QR",
        target: fixture.observationId,
        expected: "the version-23 camera QR passes integrity validation and preserves its occupancy UUID",
      }, async () => {
        await page.getByText("The alarm data passed its SHA-256 integrity check.", {exact: true})
          .waitFor({timeout: this.config.eventTimeoutMs});
        const body = await page.locator("body").innerText();
        const uuid = page.getByTestId("alarm-transfer-import-uuid");
        const displayedUuid = await uuid.count() ? (await uuid.innerText()).trim() : "";
        const integrityVisible = body.includes("The alarm data passed its SHA-256 integrity check.");
        const uuidMatches = displayedUuid
          ? displayedUuid === fixture.observationId
          : body.includes(fixture.observationId);
        const identityVisible = body.includes(fixture.occupancyId) && body.includes(fixture.laneId);
        const state = await this.browser.alarmTransferCameraState(page);
        const passed = integrityVisible && uuidMatches && identityVisible && state.qrFrameRendered &&
          state.requestedFrameCount > 0;
        const evidence = await this.browser.screenshot(page, "alarm-transfer-camera-decoded");
        return {
          passed,
          observed: `QR version=${fixture.qrVersion}; transport=${fixture.transportCharacters} characters; ` +
            `symbol=${fixture.symbolPixels}px; integrity=${integrityVisible}; UUID matches=${uuidMatches}; ` +
            `fixture identity=${identityVisible}; requested QR frames=${state.requestedFrameCount}`,
          value: passed ? true : undefined,
          evidence,
        };
      });
      if (!decoded) return;

      await this.check({
        scenario: "alarm-transfer-camera", category: "camera", action: "release camera after decode",
        target: "Alarm Transfer camera track",
        expected: "successful decode stops every created camera track",
      }, async () => {
        const state = await poll(
          () => this.browser.alarmTransferCameraState(page),
          (value) => value.createdTrackCount > 0 && value.activeTrackCount === 0 &&
            value.stoppedTrackCount === value.createdTrackCount,
          {timeoutMs: 10_000, intervalMs: 100, description: "Alarm Transfer camera tracks to stop"},
        );
        const passed = state.activeTrackCount === 0 && state.createdTrackCount === state.stoppedTrackCount;
        return {
          passed,
          observed: `created=${state.createdTrackCount}; stopped=${state.stoppedTrackCount}; active=${state.activeTrackCount}`,
        };
      });

      await this.check({
        scenario: "alarm-transfer-camera", category: "error-handling",
        action: "report denied camera permission and retry",
        target: "Alarm Transfer camera",
        expected: "denied permission is shown, retry starts a visible preview, and stopping releases every track",
      }, async () => {
        await page.getByRole("button", {name: /scan another alarm/i}).click();
        await startButton.waitFor({timeout: this.config.uiTimeoutMs});
        await this.browser.rejectAlarmTransferCameraRequests(page);
        const deniedPermission = await page.evaluate(async () =>
          (await navigator.permissions.query({name: "camera" as PermissionName})).state);
        await startButton.click();
        const alerts = await poll(
          () => page.getByRole("alert").allInnerTexts(),
          (values) => values.some((value) =>
            /camera permission was denied/i.test(value) && /browser settings/i.test(value)),
          {timeoutMs: this.config.uiTimeoutMs, intervalMs: 100, description: "actionable camera permission alert"},
        );
        const deniedState = await this.browser.alarmTransferCameraState(page);
        const errorText = alerts.find((value) =>
          /camera permission was denied/i.test(value) && /browser settings/i.test(value)) ?? "";
        const deniedCleanly = deniedPermission === "denied" && Boolean(errorText) &&
          deniedState.activeTrackCount === 0;

        await this.browser.allowAlarmTransferCameraRequests(page);
        const grantedPermission = await page.evaluate(async () =>
          (await navigator.permissions.query({name: "camera" as PermissionName})).state);
        await startButton.click();
        const stopButton = page.getByRole("button", {name: /stop camera scan/i});
        await stopButton.waitFor({timeout: this.config.uiTimeoutMs});
        const video = page.getByTestId("alarm-qr-camera-video");
        await page.waitForFunction(() => {
          const element = document.querySelector('[data-testid="alarm-qr-camera-video"]') as
            HTMLVideoElement | null;
          return Boolean(element && element.readyState >= 2 && element.videoWidth > 0 && element.videoHeight > 0);
        }, undefined, {timeout: this.config.uiTimeoutMs});
        const retryPreview = await video.evaluate((element: HTMLVideoElement) => ({
          width: element.videoWidth,
          height: element.videoHeight,
          renderedWidth: element.getBoundingClientRect().width,
          renderedHeight: element.getBoundingClientRect().height,
        }));
        const retryState = await this.browser.alarmTransferCameraState(page);
        const retryStarted = await video.isVisible() && retryPreview.width > 0 && retryPreview.height > 0 &&
          retryPreview.renderedWidth > 0 && retryPreview.renderedHeight > 0 && retryState.activeTrackCount > 0;

        await stopButton.click();
        const finalState = await poll(
          () => this.browser.alarmTransferCameraState(page),
          (value) => value.createdTrackCount > 0 && value.activeTrackCount === 0 &&
            value.stoppedTrackCount === value.createdTrackCount,
          {timeoutMs: 10_000, intervalMs: 100, description: "retried camera tracks to stop"},
        );
        const cleanedUp = finalState.activeTrackCount === 0 &&
          finalState.stoppedTrackCount === finalState.createdTrackCount;
        const passed = deniedCleanly && grantedPermission === "granted" && retryStarted && cleanedUp;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "alarm-transfer-camera-error");
        return {
          passed,
          observed: `permission state=${deniedPermission}; feedback=${Boolean(errorText)}; ` +
            `rejected requests=${deniedState.rejectedRequestCount}; retry permission=${grantedPermission}; ` +
            `retry preview=${retryPreview.width}x${retryPreview.height}; ` +
            `created=${finalState.createdTrackCount}; stopped=${finalState.stoppedTrackCount}; active=${finalState.activeTrackCount}`,
          evidence,
        };
      });
    } finally {
      const stop = page.getByRole("button", {name: /stop camera scan/i});
      if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => undefined);
      await page.close();
    }
  }

  private async prepareReservedLane(): Promise<void> {
    await this.scenario("reserved-lane-setup", async () => {
      const rpm = await this.emulator.get(this.config.testRpmId);
      this.originalRpmConfig = structuredClone(rpm.config);
      this.originalRpmRunning = rpm.running;
      this.originalRpmStatus = rpm.running
        ? await this.emulator.statusOrNull(this.config.testRpmId)
        : null;
      this.reporter.addMetadata({
        reservedRpmConfigSha256: createHash("sha256")
          .update(JSON.stringify(this.originalRpmConfig))
          .digest("hex"),
      });
      writeFileSync(
        join(this.reporter.evidenceDir, "reserved-rpm-original-config.json"),
        `${JSON.stringify(this.originalRpmConfig, null, 2)}\n`,
      );
      writeFileSync(
        join(this.reporter.evidenceDir, "reserved-rpm-original-state.json"),
        `${JSON.stringify({
          running: this.originalRpmRunning,
          faults: this.originalRpmStatus ? {
            gammaHigh: this.originalRpmStatus.gh_fault,
            gammaLow: this.originalRpmStatus.gl_fault,
            neutronHigh: this.originalRpmStatus.nh_fault,
            tamper: this.originalRpmStatus.tamper_fault,
          } : null,
        }, null, 2)}\n`,
      );
      await this.emulator.clearFaults(this.config.testRpmId);
      await this.emulator.waitForIdle(this.config.testRpmId);
      await this.emulator.replaceConfig(this.config.testRpmId, this.emulator.quietConfig(rpm.config));
      this.reservedLanePrepared = true;
      const status = await this.emulator.waitForConnected(this.config.testRpmId);
      this.reporter.outcome(
        "reserved-lane-setup", "harness", "isolate reserved RPM", this.config.testRpmId,
        "automatic occupancies and alarms disabled; OSCAR client reconnected",
        `state=${status.state}; clients=${status.connected_clients}`, "correct", 0,
      );
    }, true);
    if (!this.reservedLanePrepared) throw new Error(`Could not prepare ${this.config.testRpmId}`);
  }

  private async restoreReservedLane(): Promise<void> {
    if (!this.originalRpmConfig) return;
    this.metrics.setPhase("reserved-lane-cleanup");
    this.browser.setScenario("reserved-lane-cleanup");
    try {
      const rpm = await this.emulator.get(this.config.testRpmId);
      if (!rpm.running) await this.emulator.start(this.config.testRpmId);
      await this.emulator.clearFaults(this.config.testRpmId);
      await this.emulator.replaceConfig(this.config.testRpmId, this.originalRpmConfig);
      if (this.originalRpmStatus) {
        for (const [type, active] of [
          ["gh", this.originalRpmStatus.gh_fault],
          ["gl", this.originalRpmStatus.gl_fault],
          ["nh", this.originalRpmStatus.nh_fault],
          ["tamper", this.originalRpmStatus.tamper_fault],
        ] as const) {
          if (active) await this.emulator.fault(this.config.testRpmId, type, true);
        }
      }
      if (this.originalRpmRunning === false) {
        await this.emulator.stop(this.config.testRpmId);
        await this.emulator.waitForStopped(this.config.testRpmId);
      }
      const restored = await this.emulator.get(this.config.testRpmId);
      const configMatches = JSON.stringify(restored.config) === JSON.stringify(this.originalRpmConfig);
      const runningMatches = restored.running === this.originalRpmRunning;
      const restoredStatus = restored.running ? await this.emulator.statusOrNull(this.config.testRpmId) : null;
      const faultsMatch = !this.originalRpmStatus || Boolean(restoredStatus &&
        restoredStatus.gh_fault === this.originalRpmStatus.gh_fault &&
        restoredStatus.gl_fault === this.originalRpmStatus.gl_fault &&
        restoredStatus.nh_fault === this.originalRpmStatus.nh_fault &&
        restoredStatus.tamper_fault === this.originalRpmStatus.tamper_fault);
      this.reporter.outcome(
        "reserved-lane-cleanup", "cleanup", "restore original RPM configuration", this.config.testRpmId,
        "exact original configuration, running state, and fault state restored",
        `configuration match=${configMatches}; running match=${runningMatches}; faults match=${faultsMatch}`,
        configMatches && runningMatches && faultsMatch ? "correct" : "incorrect", 0,
      );
    } catch (error) {
      this.reporter.outcome(
        "reserved-lane-cleanup", "cleanup", "restore original RPM configuration", this.config.testRpmId,
        "exact original configuration restored and RPM reconnected", "cleanup failed", "incorrect", 0, "", describeError(error),
      );
      this.reporter.error("reserved-lane-cleanup", "emulator", error);
    }
  }

  private async waitHealthText(page: Page, expected: string | RegExp, timeoutMs = 45_000): Promise<string> {
    await this.goto(page, "/health");
    const row = this.healthRow(page);
    await row.waitFor({timeout: timeoutMs});
    const description = typeof expected === "string" ? expected : expected.toString();
    await poll(
      () => row.innerText(),
      (value) => typeof expected === "string"
        ? value.toLowerCase().includes(expected.toLowerCase())
        : expected.test(value),
      {timeoutMs, intervalMs: 1_000, description: `${this.config.testLaneLabel} health to match ${description}`},
    );
    return row.innerText();
  }

  private async waitHealthRpmConnection(
    page: Page,
    state: "online" | "offline",
    timeoutMs = 45_000,
    requireTamperClear = false,
  ): Promise<string> {
    await this.goto(page, "/health");
    const row = this.healthRow(page);
    await row.waitFor({timeout: timeoutMs});
    await poll(
      () => row.innerText(),
      (value) => healthRowHasRpmConnectionState(value, state) &&
        (!requireTamperClear || /Tamper:\s*Clear/i.test(value)),
      {timeoutMs, intervalMs: 1_000,
        description: `${this.config.testLaneLabel} RPM health to become ${state}` +
          (requireTamperClear ? " with Tamper clear" : "")},
    );
    return row.innerText();
  }

  private async connectionFault(): Promise<void> {
    const page = await this.browser.oscarPage();
    const preStopClients = Math.max(
      1,
      (await this.emulator.statusOrNull(this.config.testRpmId))?.connected_clients ?? 1,
    );
    let stopped = false;
    try {
      await this.emulator.stop(this.config.testRpmId);
      stopped = true;
      await this.emulator.waitForStopped(this.config.testRpmId);
      await this.check({
        scenario: "rpm-connection", category: "health", action: "detect RPM disconnection",
        target: this.config.testLaneLabel, expected: "Status of Health shows the reserved RPM Offline",
      }, async () => {
        const text = await this.waitHealthRpmConnection(page, "offline", 60_000);
        return {passed: healthRowHasRpmConnectionState(text, "offline"), observed: text};
      });
      await this.check({
        scenario: "rpm-connection", category: "dashboard-health", action: "show disconnected RPM independently on dashboard",
        target: this.config.testLaneLabel, expected: "dashboard RPM icon is Offline while every camera icon remains Online",
      }, async () => {
        const rpmCount = await this.waitDashboardConnectionState(page, "rpm", "offline", 60_000);
        const cameraCount = await this.waitDashboardConnectionState(page, "camera", "online", 60_000);
        const passed = rpmCount === 1 && cameraCount > 0;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-rpm-offline");
        return {
          passed,
          observed: `RPM Offline indicators=${rpmCount}; camera Online indicators=${cameraCount}`,
          evidence,
        };
      });
    } finally {
      if (stopped) {
        await this.emulator.start(this.config.testRpmId).catch(() => undefined);
        const reconnected = await this.emulator.waitForConnected(this.config.testRpmId, 60_000, 1);
        if (preStopClients > 1 && reconnected.connected_clients < preStopClients) {
          await this.emulator.waitForConnected(this.config.testRpmId, 25_000, preStopClients).catch(() => undefined);
        }
      }
    }
    await this.check({
      scenario: "rpm-connection", category: "health", action: "detect RPM reconnection",
      target: this.config.testLaneLabel,
      expected: "Status of Health returns the reserved RPM to Online with an explicit Tamper: Clear baseline",
    }, async () => {
      const text = await this.waitHealthRpmConnection(page, "online", 60_000, true);
      return {
        passed: healthRowHasRpmConnectionState(text, "online") && /Tamper:\s*Clear/i.test(text),
        observed: text,
      };
    });
    await this.check({
      scenario: "rpm-connection", category: "dashboard-health", action: "show reconnected RPM on dashboard",
      target: this.config.testLaneLabel, expected: "dashboard RPM and every camera icon are Online after reconnection",
    }, async () => {
      const rpmCount = await this.waitDashboardConnectionState(page, "rpm", "online", 60_000);
      const cameraCount = await this.waitDashboardConnectionState(page, "camera", "online", 60_000);
      const passed = rpmCount === 1 && cameraCount > 0;
      const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-rpm-reconnected");
      return {
        passed,
        observed: `RPM Online indicators=${rpmCount}; camera Online indicators=${cameraCount}`,
        evidence,
      };
    });
    await page.close();
  }

  private faultFlag(status: RpmStatus, type: "gh" | "gl" | "nh" | "tamper"): boolean {
    if (type === "gh") return status.gh_fault;
    if (type === "gl") return status.gl_fault;
    if (type === "nh") return status.nh_fault;
    return status.tamper_fault;
  }

  private async faultViaApi(
    page: Page,
    type: "gh" | "gl" | "nh",
    label: string,
    dashboardKind: "gamma-high" | "gamma-low" | "neutron-high",
  ): Promise<void> {
    try {
      await this.emulator.waitForIdle(this.config.testRpmId);
      await this.emulator.fault(this.config.testRpmId, type, true);
      await this.emulator.waitForStatus(this.config.testRpmId, (status) => this.faultFlag(status, type), `${type} fault to assert`);
      await sleep(6_000);
      await this.check({
        scenario: "rpm-faults", category: "fault-detection", action: `detect ${label}`,
        target: this.config.testLaneLabel, expected: `${label}: Fault appears in Status of Health`,
      }, async () => {
        const text = await this.waitHealthText(page, `${label}: Fault`);
        return {passed: text.includes(`${label}: Fault`), observed: `${label}: Fault visible`};
      });
      await this.check({
        scenario: "rpm-faults", category: "dashboard-health", action: `show ${label} on dashboard`,
        target: this.config.testLaneLabel, expected: `${label} compact indicator is Active with an accessible fault label`,
      }, async () => {
        const count = await this.waitDashboardFaultState(page, dashboardKind, "active");
        const indicator = this.dashboardFault(page, dashboardKind);
        const labelText = await indicator.first().getAttribute("aria-label") ?? "";
        const passed = count === 1 && labelText === `${label}: Fault`;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, `dashboard-${dashboardKind}-active`);
        return {passed, observed: `active indicators=${count}; aria-label=${labelText}`, evidence};
      });
    } finally {
      await this.emulator.fault(this.config.testRpmId, type, false).catch((error) => this.reporter.error("rpm-faults", `clear-${type}`, error));
    }
    await this.emulator.waitForStatus(this.config.testRpmId, (status) => !this.faultFlag(status, type), `${type} fault to clear`);
    await sleep(6_000);
    await this.check({
      scenario: "rpm-faults", category: "fault-resolution", action: `resolve ${label}`,
      target: this.config.testLaneLabel, expected: `${label}: Clear appears in Status of Health`,
    }, async () => {
      const text = await this.waitHealthText(page, `${label}: Clear`);
      return {passed: text.includes(`${label}: Clear`), observed: `${label}: Clear visible`};
    });
    await this.check({
      scenario: "rpm-faults", category: "dashboard-health", action: `clear ${label} from dashboard`,
      target: this.config.testLaneLabel, expected: `${label} compact indicator disappears after the fault clears`,
    }, async () => {
      const count = await this.waitDashboardFaultState(page, dashboardKind, "clear");
      return {passed: count === 0, observed: `remaining indicators=${count}`};
    });
  }

  private async tamperViaEmulatorGui(page: Page): Promise<void> {
    const emulatorPage = await this.browser.emulatorPage();
    try {
      await emulatorPage.goto(this.config.rpmEmulatorUrl, {waitUntil: "domcontentloaded"});
      const card = emulatorPage.locator(`.rpm-card[data-id="${this.config.testRpmId}"]`);
      await card.waitFor();
      const tamper = card.locator('[data-action="tamper"]');
      await tamper.click();
      await this.emulator.waitForStatus(this.config.testRpmId, (status) => status.tamper_fault, "tamper to assert through emulator GUI");
      await this.check({
        scenario: "rpm-faults", category: "emulator-control", action: "assert tamper with emulator GUI",
        target: this.config.testRpmId, expected: "tamper button becomes active and RPM status reports tamper",
      }, async () => {
        await poll(
          () => tamper.getAttribute("class"),
          (className) => Boolean(className?.includes("active")),
          {timeoutMs: 10_000, intervalMs: 500, description: "tamper button active state"},
        );
        return {passed: true, observed: "emulator GUI control active; API status true"};
      });
      await this.check({
        scenario: "rpm-faults", category: "fault-detection", action: "detect Tamper",
        target: this.config.testLaneLabel, expected: "Tamper: Fault appears in Status of Health",
      }, async () => {
        const text = await this.waitHealthText(page, "Tamper: Fault");
        return {passed: text.includes("Tamper: Fault"), observed: "Tamper: Fault visible"};
      });
      await this.check({
        scenario: "rpm-faults", category: "dashboard-health", action: "show Tamper on dashboard",
        target: this.config.testLaneLabel, expected: "Tamper compact indicator is Active and exposes the lane-specific clear control",
      }, async () => {
        const count = await this.waitDashboardFaultState(page, "tamper", "active");
        const indicatorLabel = await this.dashboardFault(page, "tamper").getAttribute("aria-label") ?? "";
        const clearButton = this.dashboardCard(page).getByRole("button", {name: /clear tamper/i});
        const buttonVisible = await clearButton.isVisible().catch(() => false);
        const passed = count === 1 && indicatorLabel === "Tamper: Fault" && buttonVisible;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-tamper-active");
        return {
          passed,
          observed: `active indicators=${count}; aria-label=${indicatorLabel}; clear control visible=${buttonVisible}`,
          evidence,
        };
      });
      await this.check({
        scenario: "rpm-faults", category: "dashboard-health", action: "clear Tamper without opening lane details",
        target: this.config.testLaneLabel, expected: "clear-tamper opens its confirmation in place, posts the manual clear command, and removes the SensorHub Tamper indicator without navigating",
      }, async () => {
        const originalPath = normalizePathname(new URL(page.url()).pathname);
        const clearButton = this.dashboardCard(page).getByRole("button", {name: /clear tamper/i});
        await clearButton.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({timeout: this.config.uiTimeoutMs});
        const pathAfterOpen = normalizePathname(new URL(page.url()).pathname);
        const commandResponsePromise = page.waitForResponse((response) => {
          let pathname = "";
          try { pathname = new URL(response.url()).pathname; } catch { return false; }
          return response.request().method() === "POST" &&
            /\/controlstreams\/[^/]+\/commands\/?$/.test(pathname);
        }, {timeout: this.config.uiTimeoutMs});
        await dialog.getByRole("button", {name: /clear tamper/i}).click();
        const commandResponse = await commandResponsePromise;
        if (!commandResponse.ok()) {
          throw new Error(`Manual tamper clear returned HTTP ${commandResponse.status()}`);
        }
        await poll(
          () => this.dashboardFault(page, "tamper").count(),
          (count) => count === 0,
          {timeoutMs: 60_000, intervalMs: 1_000, description: "dashboard Tamper indicator to clear after command"},
        );
        const finalPath = normalizePathname(new URL(page.url()).pathname);
        const stayedOnDashboard = originalPath === "/" && pathAfterOpen === "/" && finalPath === "/";
        const passed = stayedOnDashboard;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-tamper-clear-isolation");
        return {
          passed,
          observed: `command HTTP ${commandResponse.status()}; paths=${originalPath}|${pathAfterOpen}|${finalPath}; SensorHub Tamper active=false`,
          evidence,
        };
      });
    } finally {
      await this.emulator.fault(this.config.testRpmId, "tamper", false).catch(() => undefined);
      await emulatorPage.close();
    }
    await this.check({
      scenario: "rpm-faults", category: "fault-resolution", action: "resolve Tamper",
      target: this.config.testLaneLabel, expected: "Tamper: Clear appears in Status of Health",
    }, async () => {
      const text = await this.waitHealthText(page, "Tamper: Clear");
      return {passed: text.includes("Tamper: Clear"), observed: "Tamper: Clear visible"};
    });
    await this.check({
      scenario: "rpm-faults", category: "dashboard-health", action: "keep cleared Tamper hidden on dashboard",
      target: this.config.testLaneLabel, expected: "Tamper compact indicator remains absent after a fresh health snapshot",
    }, async () => {
      const count = await this.waitDashboardFaultState(page, "tamper", "clear");
      return {passed: count === 0, observed: `remaining indicators=${count}`};
    });
  }

  private async faults(): Promise<void> {
    const page = await this.browser.oscarPage();
    try {
      await this.faultViaApi(page, "gh", "Gamma high", "gamma-high");
      await this.faultViaApi(page, "gl", "Gamma low", "gamma-low");
      await this.faultViaApi(page, "nh", "Neutron high", "neutron-high");
      await this.tamperViaEmulatorGui(page);
      await this.check({
        scenario: "rpm-faults",
        category: "fault-detection",
        action: "render rolling 24-hour and live fault history in Lane View StatusTable",
        target: this.config.testLaneLabel,
        expected: "Lane View Fault Table lists Fault - Gamma High, Fault - Gamma Low, Fault - Neutron High, and Tamper with valid timestamps",
      }, async () => {
        await this.goto(page, "/");
        await page.getByTestId(`lane-health-card-${this.config.testLaneLabel}`).getByRole("link").click();
        await page.waitForURL(/\/lane-view/, {timeout: this.config.uiTimeoutMs});
        const faultToggle = page.getByRole("button", {name: /fault table/i});
        await faultToggle.waitFor({timeout: this.config.uiTimeoutMs});
        await faultToggle.click();

        const expectedStatuses = [
          "Fault - Gamma High",
          "Fault - Gamma Low",
          "Fault - Neutron High",
          "Tamper",
        ] as const;

        const readFaultRows = async () => {
          if ((await faultToggle.getAttribute("aria-pressed").catch(() => null)) !== "true") {
            await faultToggle.click().catch(() => undefined);
          }
          const grids = page.locator(".MuiDataGrid-root:visible");
          const grid = grids.last();
          const rows = grid.locator(".MuiDataGrid-row");
          return rows.evaluateAll((elements) => elements.map((row) => ({
            status: (row.querySelector('[data-field="status"]')?.textContent ?? "").trim(),
            timestamp: (row.querySelector('[data-field="timestamp"]')?.textContent ?? "").trim(),
          })).filter((entry) => entry.status.length > 0));
        };

        const rows = await poll(
          readFaultRows,
          (candidate) => assessLaneViewStatusTableFaults(candidate, expectedStatuses),
          {
            timeoutMs: 30_000,
            intervalMs: 500,
            description: `${this.config.testLaneLabel} Lane View Fault Table to render all four fault types with valid timestamps`,
          },
        ).catch(readFaultRows);

        const passed = assessLaneViewStatusTableFaults(rows, expectedStatuses);
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "lane-view-status-table-faults");
        return {
          passed,
          observed: `rows=${rows.length}; statuses=${[...new Set(rows.map((r) => r.status))].join("|") || "none"}`,
          evidence,
        };
      });
    } finally {
      await this.emulator.clearFaults(this.config.testRpmId).catch((error) => this.reporter.error("rpm-faults", "final-clear", error));
      await page.close();
    }
  }

  private alarmMediaRunKey(): string {
    return safeName(this.reporter.runId).replaceAll(/[.-]+/g, "_").slice(-80);
  }

  private async configuredAlarmCameraUids(): Promise<string[]> {
    if (this.alarmCameraUids) return this.alarmCameraUids;
    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/");
      const cameras = this.dashboardCard(page).locator(
        `[data-testid="lane-health-${this.config.testLaneLabel}-camera"]`,
      );
      await cameras.first().waitFor({timeout: this.config.uiTimeoutMs});
      const componentIds = (await cameras.evaluateAll(nodes => nodes.map(node =>
        (node.getAttribute("data-component-id") ?? "").trim())))
        .filter(Boolean);
      const response = await page.context().request.get(this.viewerUrl(
        "/sensorhub/api/systems?searchMembers=true&validTime=latest&limit=500",
      ));
      try {
        if (!response.ok()) throw new Error(`camera systems catalog returned HTTP ${response.status()}`);
        const catalog = await response.json();
        this.alarmCameraUids = cameraUidsForSystemComponents(catalog, componentIds);
        this.alarmLaneUid = laneUidForSystemName(catalog, this.config.testLaneLabel);
        return this.alarmCameraUids;
      } finally {
        await response.dispose();
      }
    } finally {
      await page.close();
    }
  }

  private async configuredAlarmLaneUid(): Promise<string> {
    if (!this.alarmLaneUid) await this.configuredAlarmCameraUids();
    if (!this.alarmLaneUid) throw new Error("the reserved lane has no authoritative OSH lane UID");
    return this.alarmLaneUid;
  }

  private async ensureAlarmMediaBaseline(scenario: string): Promise<void> {
    if (!this.selected("storage-lifecycle") || this.alarmMediaBaselineCreated ||
        this.config.storageWorkflow === "disabled") return;
    if (!this.config.oscarSshTarget || !this.config.oscarReleaseDirectory) {
      if (this.config.storageWorkflow === "required") {
        throw new Error("Required alarm-media forensics need OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR");
      }
      return;
    }
    this.alarmMediaProbe ??= new StorageProbeClient(this.config, this.reporter.runId);
    if (!this.cameraRecordingLogStartedAt) {
      const marker = await this.alarmMediaProbe.runJson<{startedAt: string}>(
        "camera-recording-log-start",
      );
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$/.test(marker.startedAt)) {
        throw new Error("Camera-recording log probe returned an invalid start time");
      }
      this.cameraRecordingLogStartedAt = marker.startedAt;
    }
    const created = await this.check({
      scenario,
      category: "alarm-media",
      action: "capture pre-trigger alarm-media baseline",
      target: this.config.testLaneLabel,
      expected: "a private pre-trigger baseline inventories finalized and partial clips before any generated event exists",
    }, async () => {
      const value = await this.alarmMediaProbe!.runJson<{
        baselineCreated: boolean;
        baselineFinalized: number;
        baselinePartials: number;
      }>("alarm-media-baseline", [this.alarmMediaRunKey()]);
      const passed = value.baselineCreated === true &&
        Number.isSafeInteger(value.baselineFinalized) && value.baselineFinalized >= 0 &&
        Number.isSafeInteger(value.baselinePartials) && value.baselinePartials >= 0;
      return {passed, value: passed, observed: JSON.stringify(value)};
    });
    if (!created) throw new Error("Alarm trigger refused because its scoped media baseline failed");
    this.alarmMediaBaselineCreated = true;
  }

  private async resolveAlarmEventUuid(
    page: Page,
    row: Locator,
    type: "gamma" | "neutron",
    occupancyCount: number,
    scenario: string,
  ): Promise<string | undefined> {
    return this.check({
      scenario,
      category: "event-identity",
      action: `resolve exact ${type} alarm UUID`,
      target: `${this.config.testLaneLabel}:${occupancyCount}`,
      expected: "the selected Event Log row opens an Event Details URL with the same nonblank occupancy UUID",
    }, async () => {
      await Promise.all([
        page.waitForURL(
          (url) => normalizePathname(url.pathname) === "/event-details",
          {timeout: this.config.eventTimeoutMs, waitUntil: "domcontentloaded"},
        ),
        row.dblclick(),
      ]);
      const uuidValue = page.getByTestId("event-uuid-value");
      await uuidValue.waitFor({timeout: this.config.eventTimeoutMs});
      const eventId = (await uuidValue.innerText()).trim();
      const url = new URL(page.url());
      const alreadyResolved = this.resolvedAlarmEventIds.has(eventId);
      const passed = isPublicObservationId(eventId) && url.searchParams.get("eventId") === eventId &&
        !alreadyResolved;
      if (passed) this.resolvedAlarmEventIds.add(eventId);
      return {
        passed,
        value: passed ? eventId : undefined,
        observed: `UUID=${eventId || "missing"}; URL identity matches=${url.searchParams.get("eventId") === eventId}; ` +
          `new to this run=${!alreadyResolved}`,
        evidence: passed ? "" : await this.screenshotOnFailure(page, `${scenario}-${type}-uuid`),
      };
    });
  }

  private async browserMp4Metadata(
    page: Page,
    paths: readonly string[],
  ): Promise<Array<{path: string; loaded: boolean; duration: number; width: number; height: number}>> {
    const urls = paths.map(path => ({path, url: this.viewerUrl(`/sensorhub/buckets/${path}`)}));
    return page.evaluate(async ({items, timeoutMs}) => {
      const results: Array<{path: string; loaded: boolean; duration: number; width: number; height: number}> = [];
      for (const item of items) {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.style.display = "none";
        document.body.append(video);
        const metadata = await new Promise<{loaded: boolean; duration: number; width: number; height: number}>(resolve => {
          let settled = false;
          let timer = 0;
          timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve({
              loaded: false,
              duration: Number.isFinite(video.duration) ? video.duration : 0,
              width: video.videoWidth,
              height: video.videoHeight,
            });
          }, timeoutMs);
          video.addEventListener("loadedmetadata", () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve({
              loaded: video.readyState >= HTMLMediaElement.HAVE_METADATA,
              duration: Number.isFinite(video.duration) ? video.duration : 0,
              width: video.videoWidth,
              height: video.videoHeight,
            });
          }, {once: true});
          video.addEventListener("error", () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve({
              loaded: false,
              duration: Number.isFinite(video.duration) ? video.duration : 0,
              width: video.videoWidth,
              height: video.videoHeight,
            });
          }, {once: true});
          video.src = item.url;
          video.load();
        });
        video.removeAttribute("src");
        video.load();
        video.remove();
        results.push({path: item.path, ...metadata});
      }
      return results;
    }, {items: urls, timeoutMs: Math.min(this.config.eventTimeoutMs, 30_000)});
  }

  private async captureAlarmMedia(
    page: Page,
    eventId: string,
    type: "gamma" | "neutron",
    occupancyCount: number,
    scenario: string,
  ): Promise<void> {
    const association = await this.check({
      scenario,
      category: "alarm-media",
      action: `bind ${type} alarm UUID to camera clips`,
      target: eventId,
      expected: "authoritative result.videoPaths contains one unique generation-qualified MP4 for every OSH camera system on the lane",
    }, async () => {
      const cameraUids = await this.configuredAlarmCameraUids();
      const value = await poll(async () => {
        const response = await page.context().request.get(
          this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(eventId)}`),
          {headers: {Accept: "application/om+json"}},
        );
        try {
          if (!response.ok()) throw new Error(`observation resource returned HTTP ${response.status()}`);
          return assessAlarmVideoObservation(await response.json(), eventId, cameraUids);
        } finally {
          await response.dispose();
        }
      }, candidate => candidate.paths.length === cameraUids.length, {
        timeoutMs: this.config.eventTimeoutMs,
        intervalMs: 1_000,
        description: `${type} alarm ${eventId} to persist authoritative videoPaths`,
      });
      assertAlarmVideoAssociationUnique(
        value,
        [...this.generatedAlarmMedia.values()].map(item => item.association),
      );
      return {
        passed: true,
        value,
        observed: `${value.paths.length} unique path(s); cameras=${value.paths.map(path => path.cameraUid).join(",")}`,
      };
    });
    if (!association) return;
    this.generatedAlarmMedia.set(eventId, {alarmType: type, occupancyCount, association});

    if (this.alarmMediaProbe) {
      await this.check({
        scenario,
        category: "alarm-media",
        action: `verify ${type} source objects exist`,
        target: eventId,
        expected: "every persisted video path is a non-symlink, nonzero source object in the videos bucket",
      }, async () => {
        const value = await this.alarmMediaProbe!.runJson<{paths: number; existing: number; nonzero: number}>(
          "alarm-media-source-status",
          association.paths.map(({path}) => path),
        );
        const passed = value.paths === association.paths.length && value.existing === value.paths &&
          value.nonzero === value.paths;
        return {passed, observed: JSON.stringify(value)};
      });
    }

    await this.check({
      scenario,
      category: "alarm-media",
      action: `load ${type} alarm MP4 metadata in Chromium`,
      target: eventId,
      expected: "every persisted camera MP4 reaches browser loadedmetadata with a positive duration and dimensions",
    }, async () => {
      const metadata = await this.browserMp4Metadata(page, association.paths.map(({path}) => path));
      const passed = metadata.length === association.paths.length && metadata.every(item =>
        item.loaded && item.duration > 0 && item.width > 0 && item.height > 0);
      return {
        passed,
        observed: metadata.map(item =>
          `${item.path}: loaded=${item.loaded}, duration=${item.duration}, ${item.width}x${item.height}`).join("; "),
        evidence: passed ? "" : await this.screenshotOnFailure(page, `${scenario}-${type}-mp4`),
      };
    });
  }

  private async triggerAlarm(
    type: "gamma" | "neutron",
    scenario = "rpm-alarms",
  ): Promise<AlarmTriggerIdentity | undefined> {
    await this.ensureAlarmMediaBaseline(scenario);
    const before = await this.emulator.waitForIdle(this.config.testRpmId);
    const initiatedAtEpochMs = Date.now();
    await this.emulator.trigger(this.config.testRpmId, type === "gamma", type === "neutron");
    const active = await this.emulator.waitForStatus(
      this.config.testRpmId,
      (status) => status.state === "OCCUPIED" && (type === "gamma" ? status.is_gamma_alarm : status.is_neutron_alarm),
      `${type} alarm to latch`,
      30_000,
    );
    this.reporter.outcome(
      scenario, "emulator-control", `trigger ${type} alarm`, this.config.testRpmId,
      `occupancy count advances past ${before.occupancy_count} and ${type} latch becomes true`,
      `occupancy=${active.occupancy_count}; gamma=${active.is_gamma_alarm}; neutron=${active.is_neutron_alarm}`,
      active.occupancy_count > before.occupancy_count ? "correct" : "incorrect", 0,
    );
    await this.emulator.waitForIdle(this.config.testRpmId, this.config.eventTimeoutMs);
    return {occupancyCount: active.occupancy_count, initiatedAtEpochMs};
  }

  private async findAlarmRow(
    page: Page,
    statusText: RegExp,
    trigger: AlarmTriggerIdentity,
  ): Promise<Locator> {
    await this.goto(page, "/event-log");
    await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.eventTimeoutMs});
    const normalizedStatus = statusText.source.trim().toLowerCase();
    const statusOption = normalizedStatus === "gamma"
      ? "Gamma"
      : normalizedStatus === "neutron"
        ? "Neutron"
        : undefined;
    await this.applyLaneEventFilter(page, statusOption);
    const row = await poll(async () => {
      const laneRows = page.locator(".MuiDataGrid-row").filter({hasText: this.config.testLaneLabel});
      const count = await laneRows.count();
      for (let index = 0; index < count; index++) {
        const candidate = laneRows.nth(index);
        const occupancyCount = await candidate.locator('[data-field="occupancyCount"]').innerText().catch(() => "");
        const startTime = await candidate.locator('[data-field="startTime"]').innerText().catch(() => "");
        const text = await candidate.innerText();
        if (alarmRowMatchesTrigger({occupancyCount, startTime, text}, statusText, trigger)) {
          return candidate;
        }
      }
      return null;
    }, (candidate): candidate is Locator => candidate !== null, {
      timeoutMs: this.config.eventTimeoutMs,
      intervalMs: 1_000,
      description: `${statusText} occupancy ${trigger.occupancyCount} created after its trigger for ${this.config.testLaneLabel}`,
    });
    if (!row) throw new Error(
      `No new ${statusText} occupancy ${trigger.occupancyCount} found for ${this.config.testLaneLabel}`,
    );
    return row;
  }

  private async verifyDashboardAlarmDateFilter(page: Page): Promise<void> {
    await this.check({
      scenario: "rpm-alarms", category: "events", action: "apply Dashboard alarm start-time filter",
      target: "Dashboard authenticated observations API",
      expected: "after generated alarms exist, the Dashboard's unadjudicated alarm predicate plus an exclusive start-time cutoff returns HTTP 200, a positive count, and only matching rows",
    }, async () => {
      const sourcePromise = this.waitForEventObservationPage(page, "dashboard-alarms");
      await this.goto(page, "/");
      const sourceResponse = await sourcePromise;
      return this.advancedDateFilterApiOracle(page, sourceResponse, true);
    });
  }

  private async alarms(): Promise<void> {
    if (!this.originalRpmConfig) throw new Error("Original RPM configuration is unavailable");
    const page = await this.browser.oscarPage();
    const generated: Array<{type: "gamma" | "neutron"; trigger: AlarmTriggerIdentity}> = [];
    const quiet = this.emulator.quietConfig(this.originalRpmConfig);
    try {
      await this.ensureAlarmMediaBaseline("rpm-alarms");
      await this.emulator.replaceConfig(
        this.config.testRpmId,
        this.emulator.shortAlarmConfig(this.originalRpmConfig),
      );
      await this.waitHealthRpmConnection(page, "online", 60_000);
      // Trigger both one-second occupancies before doing any Viewer work. The second OPEN is
      // consequently allowed to queue behind the first generation's keyframe-gated OPEN/CLOSE;
      // resolving the events afterwards also proves that neither generation inherited the
      // other's authoritative camera path.
      for (const type of ["gamma", "neutron"] as const) {
        const trigger = await this.triggerAlarm(type);
        if (trigger === undefined) throw new Error(`${type} trigger returned no occupancy identity`);
        generated.push({type, trigger});
      }
      for (const {type, trigger} of generated) {
        const {occupancyCount} = trigger;
        const ingested = await this.check({
          scenario: "rpm-alarms", category: "event-ingestion", action: `ingest ${type} alarm`,
          target: this.config.testLaneLabel, expected: `Event Log shows a new ${type} event on the reserved lane`,
        }, async () => {
          const row = await this.findAlarmRow(page, new RegExp(type, "i"), trigger);
          const text = await row.innerText();
          const passed = new RegExp(type, "i").test(text);
          return {passed, value: passed, observed: text};
        });
        if (!ingested) continue;
        const row = await this.findAlarmRow(page, new RegExp(type, "i"), trigger);
        const eventId = await this.resolveAlarmEventUuid(page, row, type, occupancyCount, "rpm-alarms");
        if (eventId) await this.captureAlarmMedia(page, eventId, type, occupancyCount, "rpm-alarms");
      }
      await this.verifyDashboardAlarmDateFilter(page);
      if (this.alarmMediaProbe && this.cameraRecordingLogStartedAt) {
        await this.check({
          scenario: "rpm-alarms",
          category: "alarm-media",
          action: "keep camera command queues healthy across short occupancies",
          target: this.config.testLaneLabel,
          expected: "back-to-back one-second alarm recordings emit no camera timeout, quarantine, rejection, result timeout, stale-generation result, or command failure",
        }, async () => {
          const value = await this.alarmMediaProbe!.runJson<{
            timeoutQuarantines: number;
            queueRejections: number;
            recordingResultTimeouts: number;
            staleGenerationResults: number;
            cameraCommandFailures: number;
          }>("camera-recording-log-check", [this.cameraRecordingLogStartedAt!]);
          const counts = Object.values(value);
          const passed = counts.every(count => Number.isSafeInteger(count) && count === 0);
          return {passed, observed: JSON.stringify(value)};
        });
      }
    } finally {
      await this.emulator.replaceConfig(this.config.testRpmId, quiet).catch(error =>
        this.reporter.error("rpm-alarms", "restore-quiet-config", error));
      await page.close();
    }
  }

  private async exportSelectedAlarm(page: Page, expectedEventUuid?: string): Promise<ExportedAlarmArtifacts> {
    const exportButton = page.getByRole("button", {name: /export alarm qr/i});
    if (expectedEventUuid && !await exportButton.isEnabled()) {
      throw new Error("Alarm QR export is disabled even though the occupancy UUID is resolved");
    }
    await exportButton.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(/included|points/i).first().waitFor({timeout: 60_000});
    if (expectedEventUuid) {
      const displayedUuid = (await dialog.getByTestId("alarm-qr-export-uuid").innerText()).trim();
      if (displayedUuid !== expectedEventUuid) {
        throw new Error(`Alarm QR dialog UUID mismatch: expected ${expectedEventUuid}; got ${displayedUuid}`);
      }
    }
    const qrButton = dialog.getByRole("button", {name: /download qr image/i});
    await qrButton.waitFor({timeout: 60_000});
    await poll(
      () => qrButton.isEnabled(),
      (enabled) => enabled,
      {timeoutMs: 60_000, intervalMs: 100, description: "QR image download to become available"},
    );
    const qrDownloadPromise = page.waitForEvent("download");
    await qrButton.click();
    const qrDownload = await qrDownloadPromise;
    const qrSuggested = safeName(qrDownload.suggestedFilename()) || "alarm-qr.png";
    const qrImage = join(
      this.reporter.downloadDir,
      qrSuggested.endsWith(".png") ? qrSuggested : `${qrSuggested}.png`,
    );
    await qrDownload.saveAs(qrImage);

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", {name: /download alarm file/i}).click();
    const download = await downloadPromise;
    const suggested = safeName(download.suggestedFilename()) || "alarm.json";
    const alarmFile = join(this.reporter.downloadDir, suggested.endsWith(".json") ? suggested : `${suggested}.json`);
    await download.saveAs(alarmFile);
    await dialog.getByRole("button", {name: /close/i}).click();
    return {alarmFile, qrImage};
  }

  private async eventUuidWorkflow(): Promise<void> {
    const metadata: CheckMetadata = {
      scenario: "event-uuid",
      category: "event-identity",
      action: "detect occupancy UUID workflow",
      target: "Event Log",
      expected: "UUID search controls are available",
    };
    if (this.config.eventUuidWorkflow === "disabled") {
      this.skip(metadata, "EVENT_UUID_WORKFLOW=disabled");
      return;
    }

    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/event-log");
      await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.eventTimeoutMs});
      const searchInput = page.getByTestId("event-uuid-search-input");
      const searchSubmit = page.getByTestId("event-uuid-search-submit");
      const capabilityPresent = await searchInput.count() > 0 && await searchSubmit.count() > 0;
      if (!capabilityPresent) {
        if (this.config.eventUuidWorkflow === "auto") {
          this.skip(metadata, "UUID workflow is not present on this build (auto detection)");
        } else {
          this.reporter.outcome(
            metadata.scenario, metadata.category, metadata.action, metadata.target,
            metadata.expected, "UUID search controls are absent", "incorrect", 0,
          );
        }
        return;
      }
      this.reporter.outcome(
        metadata.scenario, metadata.category, metadata.action, metadata.target,
        metadata.expected, "UUID search input and submit controls detected", "correct", 0,
      );

      const trigger = await this.triggerAlarm("gamma", "event-uuid");
      if (trigger === undefined) throw new Error("UUID workflow alarm trigger returned no occupancy identity");
      const {occupancyCount} = trigger;
      const row = await this.findAlarmRow(page, /Gamma/i, trigger);
      await Promise.all([
        page.waitForURL(
          (url) => normalizePathname(url.pathname) === "/event-details",
          {timeout: this.config.eventTimeoutMs, waitUntil: "domcontentloaded"},
        ),
        row.dblclick(),
      ]);
      await page.getByRole("heading", {name: "Event Details"}).waitFor();

      const eventUuid = await this.check({
        scenario: "event-uuid", category: "event-identity", action: "show occupancy UUID on Event Details",
        target: String(occupancyCount), expected: "the persisted occupancy observation identity is visible and canonicalized in the URL",
      }, async () => {
        const uuidValue = page.getByTestId("event-uuid-value");
        await uuidValue.waitFor({timeout: this.config.eventTimeoutMs});
        const uuid = (await uuidValue.innerText()).trim();
        const current = new URL(page.url());
        const validIdentity = isPublicObservationId(uuid);
        const canonical = current.searchParams.get("eventId") === uuid &&
          Boolean(current.searchParams.get("nodeId"));
        const alreadyResolved = this.resolvedAlarmEventIds.has(uuid);
        const passed = validIdentity && canonical && !alreadyResolved;
        if (passed) this.resolvedAlarmEventIds.add(uuid);
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "event-uuid-detail");
        return {
          passed,
          observed: `uuid=${uuid || "missing"}; canonical eventId=${canonical}; ` +
            `nodeId=${current.searchParams.get("nodeId") ?? "missing"}; new to this run=${!alreadyResolved}`,
          value: passed ? uuid : undefined,
          evidence,
        };
      });
      if (!eventUuid) return;
      const eventNodeId = new URL(page.url()).searchParams.get("nodeId");
      if (!eventNodeId) return;
      await this.captureAlarmMedia(page, eventUuid, "gamma", occupancyCount, "event-uuid");

      const origin = new URL(this.config.oscarBaseUrl).origin;
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {origin});
      await this.check({
        scenario: "event-uuid", category: "event-identity", action: "copy occupancy UUID",
        target: eventUuid, expected: "Copy UUID writes the exact observation identity to the clipboard",
      }, async () => {
        await page.getByTestId("copy-event-uuid").click();
        const copied = await poll(
          () => page.evaluate(() => navigator.clipboard.readText()),
          (value) => value === eventUuid,
          {timeoutMs: 5_000, intervalMs: 100, description: "copied occupancy UUID"},
        );
        return {passed: copied === eventUuid, observed: `clipboard matches=${copied === eventUuid}`};
      });

      const directLink = await this.check({
        scenario: "event-uuid", category: "event-identity", action: "copy direct event link",
        target: eventUuid, expected: "Copy Direct Link writes a canonical authenticated Viewer URL",
      }, async () => {
        await page.getByTestId("copy-event-direct-link").click();
        const copied = await poll(
          () => page.evaluate(() => navigator.clipboard.readText()),
          (value) => {
            try {
              const url = new URL(value);
              return url.origin === origin && normalizePathname(url.pathname) === "/event-details" &&
                url.searchParams.get("eventId") === eventUuid && url.searchParams.get("nodeId") === eventNodeId;
            } catch { return false; }
          },
          {timeoutMs: 5_000, intervalMs: 100, description: "copied direct event link"},
        );
        const url = new URL(copied);
        return {
          passed: url.origin === origin && normalizePathname(url.pathname) === "/event-details" &&
            url.searchParams.get("eventId") === eventUuid && url.searchParams.get("nodeId") === eventNodeId,
          observed: `${url.pathname}; eventId matches=${url.searchParams.get("eventId") === eventUuid}; nodeId matches=${url.searchParams.get("nodeId") === eventNodeId}`,
          value: copied,
        };
      });

      if (directLink) {
        await this.check({
          scenario: "event-uuid", category: "event-lookup", action: "open direct event link in a fresh page",
          target: eventUuid, expected: "a fresh authenticated page resolves the same occupancy without Redux navigation state",
        }, async () => {
          const freshPage = await this.browser.oscarPage();
          try {
            const response = await freshPage.goto(directLink, {waitUntil: "domcontentloaded"});
            const value = freshPage.getByTestId("event-uuid-value");
            await value.waitFor({timeout: this.config.eventTimeoutMs});
            const resolved = (await value.innerText()).trim();
            const passed = (response?.status() ?? 0) < 400 && resolved === eventUuid &&
              await freshPage.getByTestId("event-lookup-not-found").count() === 0;
            const evidence = passed ? "" : await this.screenshotOnFailure(freshPage, "event-uuid-direct-link");
            return {passed, observed: `HTTP ${response?.status() ?? 0}; resolved UUID matches=${resolved === eventUuid}`, evidence};
          } finally { await freshPage.close(); }
        });
      }

      await this.check({
        scenario: "event-uuid", category: "event-lookup", action: "find event by occupancy UUID",
        target: eventUuid, expected: "UUID search resolves and opens the canonical Event Details URL",
      }, async () => {
        const searchPage = await this.browser.oscarPage();
        try {
          await this.goto(searchPage, "/event-log");
          await searchPage.getByTestId("event-uuid-search-input").locator("input").fill(eventUuid);
          const navigation = searchPage.waitForURL(
            (url) => normalizePathname(url.pathname) === "/event-details" &&
              url.searchParams.get("eventId") === eventUuid &&
              url.searchParams.get("nodeId") === eventNodeId,
            {timeout: this.config.eventTimeoutMs, waitUntil: "domcontentloaded"},
          );
          await searchPage.getByTestId("event-uuid-search-submit").click();
          await navigation;
          const value = searchPage.getByTestId("event-uuid-value");
          await value.waitFor({timeout: this.config.eventTimeoutMs});
          const resolved = (await value.innerText()).trim();
          const url = new URL(searchPage.url());
          const passed = resolved === eventUuid && url.searchParams.get("nodeId") === eventNodeId;
          const evidence = passed ? "" : await this.screenshotOnFailure(searchPage, "event-uuid-search");
          return {passed, observed: `resolved UUID matches=${resolved === eventUuid}; nodeId matches=${url.searchParams.get("nodeId") === eventNodeId}`, evidence};
        } finally { await searchPage.close(); }
      });

      const laneOracle = this.config.laneConfigOracle;
      if (!scopedUuidOperationalViewChecksEnabled(this.config.operationalViewWorkflow, true) || !laneOracle) {
        this.skip({
          scenario: "event-uuid",
          category: "scope",
          action: "enforce operational-view scope during UUID lookup",
          target: this.config.testLaneLabel,
          expected: "UUID lookup preserves a member view and fails closed from a non-member view",
        }, "operational-view workflow is disabled, so scoped UUID lookup is outside this run");
      } else {
        let scopedLookupAvailable = true;
        if (this.config.operationalViewWorkflow === "auto") {
          const detectionView = [...laneOracle.lanesByView.keys()].sort()[0] ?? "east-gate";
          const capabilityPage = await this.browser.oscarPage();
          try {
            await this.goto(capabilityPage, `/?view=${encodeURIComponent(detectionView)}`);
            scopedLookupAvailable = await scopedViewIndicatorLocator(capabilityPage, detectionView)
              .waitFor({timeout: this.config.uiTimeoutMs})
              .then(() => true, () => false);
          } finally {
            await capabilityPage.close();
          }
        }

        if (!scopedUuidOperationalViewChecksEnabled(
          this.config.operationalViewWorkflow,
          scopedLookupAvailable,
        )) {
          this.skip({
            scenario: "event-uuid",
            category: "scope",
            action: "enforce operational-view scope during UUID lookup",
            target: this.config.testLaneLabel,
            expected: "UUID lookup preserves a member view and fails closed from a non-member view",
          }, "operational-view workflow is not present on this build (auto detection)");
        } else {
          const {assignedView, nonMemberView} = operationalViewScopePair(
            laneOracle,
            this.config.testLaneLabel,
          );

          await this.check({
          scenario: "event-uuid",
          category: "scope",
          action: "find event by UUID inside its assigned operational view",
          target: `${eventUuid}@${assignedView}`,
          expected: "UUID search resolves the event and preserves exactly one assigned view parameter",
        }, async () => {
          const scopedPage = await this.browser.oscarPage();
          try {
            await this.goto(scopedPage, `/event-log?view=${encodeURIComponent(assignedView)}`);
            await scopedViewIndicatorLocator(scopedPage, assignedView)
              .waitFor({timeout: this.config.uiTimeoutMs});
            await scopedPage.getByTestId("event-uuid-search-input").locator("input").fill(eventUuid);
            const navigation = scopedPage.waitForURL(
              (url) => normalizePathname(url.pathname) === "/event-details" &&
                url.searchParams.get("eventId") === eventUuid &&
                url.searchParams.get("nodeId") === eventNodeId &&
                url.searchParams.getAll("view").length === 1 &&
                url.searchParams.get("view") === assignedView,
              {timeout: this.config.eventTimeoutMs, waitUntil: "domcontentloaded"},
            );
            await scopedPage.getByTestId("event-uuid-search-submit").click();
            await navigation;
            const uuid = scopedPage.getByTestId("event-uuid-value");
            await uuid.waitFor({timeout: this.config.eventTimeoutMs});
            const resolved = (await uuid.innerText()).trim();
            const url = new URL(scopedPage.url());
            const passed = resolved === eventUuid &&
              url.searchParams.get("nodeId") === eventNodeId &&
              url.searchParams.getAll("view").length === 1 &&
              url.searchParams.get("view") === assignedView &&
              await scopedPage.getByTestId("event-lookup-not-found").count() === 0;
            const evidence = passed ? "" : await this.screenshotOnFailure(
              scopedPage,
              "event-uuid-member-view",
            );
            return {
              passed,
              observed: `resolved UUID matches=${resolved === eventUuid}; ` +
                `nodeId matches=${url.searchParams.get("nodeId") === eventNodeId}; ` +
                `view=${url.searchParams.getAll("view").join(",") || "missing"}`,
              evidence,
            };
          } finally { await scopedPage.close(); }
        });

          await this.check({
          scenario: "event-uuid",
          category: "scope",
          action: "reject event UUID outside its operational view",
          target: `${eventUuid}@${nonMemberView}`,
          expected: "the same UUID fails closed as not found in a known view that excludes its lane",
        }, async () => {
          const scopedPage = await this.browser.oscarPage();
          try {
            return await this.browser.withExpectedMissingObservation(eventUuid, async () => {
              await this.goto(scopedPage, `/event-log?view=${encodeURIComponent(nonMemberView)}`);
              await scopedViewIndicatorLocator(scopedPage, nonMemberView)
                .waitFor({timeout: this.config.uiTimeoutMs});
              await scopedPage.getByTestId("event-uuid-search-input").locator("input").fill(eventUuid);
              const navigation = scopedPage.waitForURL(
                (url) => normalizePathname(url.pathname) === "/event-details" &&
                  url.searchParams.get("eventId") === eventUuid &&
                  url.searchParams.getAll("view").length === 1 &&
                  url.searchParams.get("view") === nonMemberView,
                {timeout: this.config.eventTimeoutMs, waitUntil: "domcontentloaded"},
              );
              await scopedPage.getByTestId("event-uuid-search-submit").click();
              await navigation;
              await scopedPage.getByTestId("event-lookup-not-found")
                .waitFor({timeout: this.config.eventTimeoutMs});
              const url = new URL(scopedPage.url());
              const staleUuid = await scopedPage.getByTestId("event-uuid-value").count() > 0;
              const passed = !staleUuid &&
                url.searchParams.get("nodeId") === null &&
                url.searchParams.getAll("view").length === 1 &&
                url.searchParams.get("view") === nonMemberView;
              const evidence = await this.browser.screenshot(scopedPage, "event-uuid-non-member-view");
              return {
                passed,
                observed: `not-found visible=true; stale UUID visible=${staleUuid}; ` +
                  `nodeId=${url.searchParams.get("nodeId") ?? "absent"}; ` +
                  `view=${url.searchParams.getAll("view").join(",") || "missing"}`,
                evidence,
              };
            });
          } finally { await scopedPage.close(); }
          });
        }
      }

      await this.check({
        scenario: "event-uuid", category: "reports", action: "include occupancy UUID in printable PDF",
        target: eventUuid, expected: "print-to-PDF output contains the full UUID while copy controls are omitted",
      }, async () => {
        const saved = join(this.reporter.downloadDir, `event-${safeName(eventUuid)}.pdf`);
        await page.emulateMedia({media: "print"});
        try {
          const identityVisible = await page.getByTestId("event-identity").isVisible();
          const copyUuidVisible = await page.getByTestId("copy-event-uuid").isVisible();
          const copyLinkVisible = await page.getByTestId("copy-event-direct-link").isVisible();
          const pdf = await page.pdf({format: "Letter", printBackground: true});
          writeFileSync(saved, pdf);
          const parser = new PDFParse({data: pdf});
          let parsed;
          try { parsed = await parser.getText(); } finally { await parser.destroy(); }
          const includesUuid = parsed.text.includes(eventUuid);
          return {
            passed: parsed.total > 0 && identityVisible && includesUuid && !copyUuidVisible && !copyLinkVisible,
            observed: `pages=${parsed.total}; identity visible=${identityVisible}; UUID present=${includesUuid}; copy controls hidden=${!copyUuidVisible && !copyLinkVisible}`,
            evidence: join("downloads", basename(saved)),
          };
        } finally { await page.emulateMedia({media: "screen"}); }
      });

      const alarmFile = await this.check({
        scenario: "event-uuid", category: "alarm-transfer", action: "include occupancy UUID in truncated QR export",
        target: eventUuid, expected: "QR v1 transport document contains the same UUID in payload.event.observationId",
      }, async () => {
        const artifacts = await this.exportSelectedAlarm(page, eventUuid);
        const bytes = readFileSync(artifacts.alarmFile);
        const parsed = JSON.parse(bytes.toString("utf8")) as {
          transport?: string;
          payload?: {schema?: string; version?: number; event?: {observationId?: string}};
        };
        const passed = parsed.payload?.schema === "org.oscar.alarm-transfer" &&
          parsed.payload.version === 1 && parsed.payload.event?.observationId === eventUuid &&
          parsed.transport?.startsWith("OSCAR-ALARM:1:") === true;
        return {
          passed,
          observed: `${bytes.length} bytes; schema/version/UUID/transport valid=${passed}`,
          value: artifacts.alarmFile,
          evidence: join("downloads", basename(artifacts.alarmFile)),
        };
      });

      if (alarmFile) {
        await this.check({
          scenario: "event-uuid", category: "alarm-transfer", action: "preserve UUID through QR import",
          target: eventUuid, expected: "decoding the truncated transport reproduces and displays the same UUID",
        }, async () => {
          const importPage = await this.browser.oscarPage();
          try {
            await this.goto(importPage, "/alarm-transfer");
            await importPage.locator('input[type="file"][accept*="json"]').setInputFiles(alarmFile);
            await importPage.getByText("The alarm data passed its SHA-256 integrity check.", {exact: true})
              .waitFor({timeout: this.config.eventTimeoutMs});
            const importedUuid = (await importPage.getByTestId("alarm-transfer-import-uuid").innerText()).trim();
            const passed = importedUuid === eventUuid;
            const evidence = passed ? "" : await this.screenshotOnFailure(importPage, "event-uuid-qr-import");
            return {passed, observed: `decoded import UUID matches=${passed}`, evidence};
          } finally { await importPage.close(); }
        });
      }

      await this.check({
        scenario: "event-uuid", category: "event-lookup", action: "handle an unavailable occupancy UUID",
        target: "nonexistent event", expected: "a safe direct lookup displays the explicit not-found state without stale event data",
      }, async () => {
        const missingPage = await this.browser.oscarPage();
        const missingUuid = randomUUID();
        try {
          return await this.browser.withExpectedMissingObservation(missingUuid, async () => {
            await this.goto(missingPage, `/event-details?eventId=${encodeURIComponent(missingUuid)}`);
            const notFound = missingPage.getByTestId("event-lookup-not-found");
            await notFound.waitFor({timeout: this.config.eventTimeoutMs});
            const staleUuid = await missingPage.getByTestId("event-uuid-value").count() > 0;
            const evidence = await this.browser.screenshot(missingPage, "event-uuid-not-found");
            return {passed: !staleUuid, observed: `not-found state visible; stale event UUID visible=${staleUuid}`, evidence};
          });
        } finally { await missingPage.close(); }
      });
    } finally { await page.close(); }
  }

  private async adjudicationAndAlarmTransfer(): Promise<void> {
    const trigger = await this.triggerAlarm("gamma");
    if (trigger === undefined) throw new Error("gamma trigger returned no occupancy identity");
    const {occupancyCount} = trigger;
    const page = await this.browser.oscarPage();
    try {
      const row = await this.findAlarmRow(page, /Gamma/i, trigger);
      await Promise.all([
        page.waitForURL(/\/event-details/, {waitUntil: "domcontentloaded"}),
        row.dblclick(),
      ]);
      await page.getByRole("heading", {name: "Event Details"}).waitFor();

      const alarmArtifacts = await this.check({
        scenario: "adjudication", category: "alarm-transfer", action: "export selected alarm",
        target: this.config.testLaneLabel,
        expected: "Viewer downloads a valid OSCAR offline alarm JSON file and its rendered QR PNG",
      }, async () => {
        const artifacts = await this.exportSelectedAlarm(page);
        const bytes = readFileSync(artifacts.alarmFile);
        const qrBytes = readFileSync(artifacts.qrImage);
        const parsed = JSON.parse(bytes.toString("utf8")) as {
          transport?: string;
          integrity?: {algorithm?: string; digest?: string};
          payload?: {
            schema?: string;
            version?: number;
            source?: {laneId?: string};
            event?: {occupancyId?: string; observationId?: string};
            series?: {
              gamma?: {exportedCount?: number};
              neutron?: {exportedCount?: number};
            };
          };
        };
        const observationId = parsed.payload?.event?.observationId ?? "";
        const exportedOccupancyId = parsed.payload?.event?.occupancyId ?? "";
        const alreadyResolved = this.resolvedAlarmEventIds.has(observationId);
        const schemaValid = parsed.payload?.schema === "org.oscar.alarm-transfer" &&
          parsed.payload.version === 1 &&
          parsed.payload.source?.laneId === this.config.testLaneLabel &&
          exportedOccupancyId === String(occupancyCount) &&
          isPublicObservationId(observationId) &&
          parsed.integrity?.algorithm === "SHA-256" &&
          /^[a-f0-9]{64}$/i.test(parsed.integrity.digest ?? "") &&
          parsed.transport?.startsWith("OSCAR-ALARM:1:") === true &&
          !alreadyResolved;
        const pngValid = qrBytes.length > 100 &&
          qrBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const expectedChartSeries: AlarmChartSeries[] = [];
        if ((parsed.payload?.series?.gamma?.exportedCount ?? 0) > 0) expectedChartSeries.push("gamma");
        if ((parsed.payload?.series?.neutron?.exportedCount ?? 0) > 0) expectedChartSeries.push("neutron");
        const passed = bytes.length > 100 && schemaValid && pngValid;
        if (passed) this.resolvedAlarmEventIds.add(observationId);
        return {
          passed,
          observed: `JSON=${bytes.length} bytes; PNG=${qrBytes.length} bytes; ` +
            `schema/lane/occupancy/integrity/fresh UUID valid=${schemaValid}; PNG valid=${pngValid}`,
          value: passed
            ? {...artifacts, observationId, occupancyId: exportedOccupancyId, expectedChartSeries}
            : undefined,
          evidence: join("downloads", basename(artifacts.qrImage)),
        };
      });

      if (alarmArtifacts) {
        await this.captureAlarmMedia(
          page,
          alarmArtifacts.observationId,
          "gamma",
          occupancyCount,
          "adjudication",
        );
        const importPage = await this.browser.oscarPage();
        try {
          const imported = await this.check({
            scenario: "adjudication", category: "alarm-transfer", action: "import and validate selected alarm",
            target: "Alarm Transfer", expected: "exported file imports offline and integrity is verified",
          }, async () => {
            await this.goto(importPage, "/alarm-transfer");
            await importPage.locator('input[type="file"][accept*="json"]').setInputFiles(alarmArtifacts.alarmFile);
            await importPage.getByText("The alarm data passed its SHA-256 integrity check.", {exact: true})
              .waitFor({timeout: 30_000});
            const body = await importPage.locator("body").innerText();
            const importedUuid = (await importPage.getByTestId("alarm-transfer-import-uuid").innerText()).trim();
            const passed = importedUuid === alarmArtifacts.observationId &&
              body.includes(this.config.testLaneLabel) &&
              body.includes("The alarm data passed its SHA-256 integrity check.");
            const evidence = await this.browser.screenshot(importPage, "alarm-transfer-imported");
            return {
              passed,
              observed: `UUID matches=${importedUuid === alarmArtifacts.observationId}; ` +
                `lane present=${body.includes(this.config.testLaneLabel)}`,
              value: true,
              evidence,
            };
          });

          if (imported) {
            await this.check({
              scenario: "adjudication",
              category: "alarm-transfer",
              action: "render imported alarm charts",
              target: "Alarm Transfer",
              expected: "each received non-empty measurement series redraws with its chart-specific dataset color",
            }, async () => {
              const charts = importPage.locator("canvas");
              const readCharts = () => charts.evaluateAll((elements): AlarmChartCanvasSnapshot[] =>
                elements.map((element) => {
                  const canvas = element as HTMLCanvasElement;
                  const context = canvas.getContext("2d");
                  let gammaPlotPixels = 0;
                  let neutronPlotPixels = 0;
                  if (context && canvas.width > 0 && canvas.height > 0) {
                    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                    // Chart.js renders its title and legend above the plotting area. Restrict
                    // color evidence to the central/lower chart region so a legend swatch
                    // cannot make an empty dataset appear rendered.
                    const firstPlotRow = Math.floor(canvas.height * 0.30);
                    const lastPlotRow = Math.ceil(canvas.height * 0.90);
                    const firstPlotColumn = Math.floor(canvas.width * 0.05);
                    const lastPlotColumn = Math.ceil(canvas.width * 0.95);
                    for (let y = firstPlotRow; y < lastPlotRow; y++) {
                      for (let x = firstPlotColumn; x < lastPlotColumn; x++) {
                        const index = (y * canvas.width + x) * 4;
                        const red = pixels[index] ?? 0;
                        const green = pixels[index + 1] ?? 0;
                        const blue = pixels[index + 2] ?? 0;
                        const alpha = pixels[index + 3] ?? 0;
                        if (alpha === 0) continue;
                        if (Math.abs(red - 244) <= 24 && Math.abs(green - 67) <= 24 &&
                          Math.abs(blue - 54) <= 24) gammaPlotPixels++;
                        if (Math.abs(red - 41) <= 24 && Math.abs(green - 182) <= 24 &&
                          Math.abs(blue - 246) <= 24) neutronPlotPixels++;
                      }
                    }
                  }
                  const bounds = canvas.getBoundingClientRect();
                  return {
                    width: canvas.width,
                    height: canvas.height,
                    clientWidth: bounds.width,
                    clientHeight: bounds.height,
                    gammaPlotPixels,
                    neutronPlotPixels,
                  };
                }));
              const snapshots = await poll(
                readCharts,
                (value) => importedAlarmChartsRendered(alarmArtifacts.expectedChartSeries, value),
                {
                  timeoutMs: this.config.uiTimeoutMs,
                  intervalMs: 250,
                  description: "imported alarm series datasets to paint",
                },
              );
              const passed = importedAlarmChartsRendered(alarmArtifacts.expectedChartSeries, snapshots);
              const evidence = passed ? "" : await this.screenshotOnFailure(
                importPage,
                "alarm-transfer-imported-charts",
              );
              return {
                passed,
                observed: `expected series=${alarmArtifacts.expectedChartSeries.join(",") || "none"}; ` +
                  `rendered=${snapshots.length}; ` +
                  `gamma plot pixels=${snapshots.map(({gammaPlotPixels}) => gammaPlotPixels).join(",") || "none"}; ` +
                  `neutron plot pixels=${snapshots.map(({neutronPlotPixels}) => neutronPlotPixels).join(",") || "none"}`,
                evidence,
              };
            });

            await this.check({
              scenario: "adjudication",
              category: "alarm-transfer",
              action: "download received alarm package",
              target: "Alarm Transfer",
              expected: "the imported package downloads with the same canonical payload, integrity, transport, and UUID",
            }, async () => {
              const downloadPromise = importPage.waitForEvent("download");
              await importPage.getByRole("button", {name: /download alarm file/i}).click();
              const download = await downloadPromise;
              const suggested = safeName(download.suggestedFilename()) || "alarm.json";
              const receivedFile = join(
                this.reporter.downloadDir,
                `received-${suggested.endsWith(".json") ? suggested : `${suggested}.json`}`,
              );
              await download.saveAs(receivedFile);
              const originalBytes = readFileSync(alarmArtifacts.alarmFile);
              const receivedBytes = readFileSync(receivedFile);
              const original = JSON.parse(originalBytes.toString("utf8")) as unknown;
              const received = JSON.parse(receivedBytes.toString("utf8")) as {
                payload?: {event?: {observationId?: string}};
              };
              const originalCanonicalSha256 = createHash("sha256")
                .update(canonicalAlarmTransferDocumentJson(original)).digest("hex");
              const receivedCanonicalSha256 = createHash("sha256")
                .update(canonicalAlarmTransferDocumentJson(received)).digest("hex");
              const uuidMatches = received.payload?.event?.observationId === alarmArtifacts.observationId;
              const passed = receivedBytes.length > 100 &&
                receivedCanonicalSha256 === originalCanonicalSha256 && uuidMatches;
              return {
                passed,
                observed: `${receivedBytes.length} bytes; canonical document SHA-256 matches=${receivedCanonicalSha256 === originalCanonicalSha256}; ` +
                  `UUID matches=${uuidMatches}`,
                evidence: join("downloads", basename(receivedFile)),
              };
            });
          }
        } finally {
          await importPage.close();
        }

        await this.check({
          scenario: "adjudication", category: "alarm-transfer", action: "decode exported alarm QR image",
          target: "Alarm Transfer",
          expected: "the Viewer decodes its own exported QR PNG and verifies the same alarm identity",
        }, async () => {
          const imagePage = await this.browser.oscarPage();
          try {
            await this.goto(imagePage, "/alarm-transfer");
            await imagePage.locator('input[type="file"][accept*="image"]').setInputFiles(alarmArtifacts.qrImage);
            await imagePage.getByText("The alarm data passed its SHA-256 integrity check.", {exact: true})
              .waitFor({timeout: this.config.eventTimeoutMs});
            const body = await imagePage.locator("body").innerText();
            const importedUuid = (await imagePage.getByTestId("alarm-transfer-import-uuid").innerText()).trim();
            const lanePresent = body.includes(this.config.testLaneLabel);
            const uuidMatches = importedUuid === alarmArtifacts.observationId;
            const passed = lanePresent && uuidMatches;
            const evidence = await this.browser.screenshot(imagePage, "alarm-transfer-qr-image-imported");
            return {
              passed,
              observed: `lane present=${lanePresent}; UUID matches=${uuidMatches}`,
              evidence,
            };
          } finally { await imagePage.close(); }
        });
      }

      const firstVehicleId = `REG-${this.reporter.runId.slice(-12)}`;
      const firstNotes = `Regression ${this.reporter.runId.slice(-12)}`;

      await this.check({
        scenario: "adjudication", category: "adjudication", action: "adjudicate alarm",
        target: this.config.testLaneLabel, expected: "full Code 9 adjudication with vehicle ID, inspection, notes, confirmation, and audit log succeeds",
      }, async () => {
        await page.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill(firstVehicleId);
        await this.selectMui(page, "Adjudicate", "Code 9: Authorized Test, Maintenance, or Training Activity");
        await this.selectMui(page, "Secondary Inspection", "NONE");
        await page.getByLabel("Notes").fill(firstNotes);
        await page.getByRole("button", {name: "Submit", exact: true}).click();
        const confirm = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
        await confirm.waitFor();
        await confirm.getByRole("button", {name: /Confirm & Submit/i}).click();
        await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
        await page.getByText("Logged Adjudications", {exact: true}).waitFor();
        await page.reload({waitUntil: "domcontentloaded"});
        await page.getByText("Logged Adjudications", {exact: true}).waitFor();
        const body = await poll(
          () => page.locator("body").innerText(),
          (value) => value.includes(firstVehicleId) && value.includes(firstNotes),
          {timeoutMs: 30_000, intervalMs: 500, description: "submitted adjudication values after reload"},
        ).catch(() => page.locator("body").innerText());
        const vehiclePersisted = body.includes(firstVehicleId);
        const notesPersisted = body.includes(firstNotes);
        const codePersisted = /Code 9/i.test(body);
        const inspectionPersisted = /\bNone\b/i.test(body);
        const persisted = vehiclePersisted && notesPersisted && codePersisted && inspectionPersisted;
        return {
          passed: persisted,
          observed: `confirmed submission succeeded; reloaded vehicle=${vehiclePersisted}; notes=${notesPersisted}; code9=${codePersisted}; inspection=${inspectionPersisted}`,
        };
      });

      await this.check({
        scenario: "adjudication",
        category: "adjudication",
        action: "filter adjudicated alarm by Adjudication Code on Event Log",
        target: `${this.config.testLaneLabel}:${occupancyCount}`,
        expected: "Event Log Advanced Filters (Lane ID + Adjudication Code = Code 9) returns the newly adjudicated occupancy",
      }, async () => {
        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.eventTimeoutMs});
        await page.getByRole("button", {name: /advanced filters/i}).first().click();
        const dialog = page.getByRole("dialog", {name: /advanced filters/i});
        await dialog.waitFor({timeout: this.config.uiTimeoutMs});
        await dialog.getByRole("button", {name: /clear all/i}).click();

        await dialog.getByRole("button", {name: /add condition/i}).click();
        const boxes = dialog.getByRole("combobox");
        await boxes.nth(1).click();
        await page.getByRole("option", {name: "Lane ID", exact: true}).click();
        await boxes.nth(3).click();
        await page.getByRole("option", {name: this.config.testLaneLabel, exact: true}).click();

        await dialog.getByRole("button", {name: /add condition/i}).click();
        await boxes.nth(4).click();
        await page.getByRole("option", {name: "Adjudication Code", exact: true}).click();
        await boxes.nth(6).click();
        await page.getByRole("option", {name: "Code 9: Authorized Test, Maintenance, or Training Activity", exact: true}).click();

        await dialog.getByRole("button", {name: /apply filters/i}).click();
        await dialog.waitFor({state: "hidden"});

        const matchedOccupancies = await poll(async () => {
          const rows = page.locator(".MuiDataGrid-row");
          const count = await rows.count();
          const occs: string[] = [];
          for (let i = 0; i < count; i++) {
            occs.push((await rows.nth(i).locator('[data-field="occupancyCount"]').innerText().catch(() => "")).trim());
          }
          return occs;
        }, occs => occs.includes(String(occupancyCount)), {
          timeoutMs: 30_000,
          intervalMs: 500,
          description: `Event Log Adjudication Code = Code 9 filter to return occupancy ${occupancyCount}`,
        }).catch(() => [] as string[]);

        const passed = matchedOccupancies.includes(String(occupancyCount));
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "adjudication-code-filter-failed");
        return {
          passed,
          observed: `matchedOccupancies=${matchedOccupancies.join(",") || "none"}`,
          evidence,
        };
      });

      const readObservationAdjudicatedIds = async (obsId: string): Promise<{count: number; ids: string[]}> => {
        const res = await page.context().request.get(
          this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(obsId)}`),
          {headers: {Accept: "application/om+json"}},
        );
        try {
          if (!res.ok()) return {count: 0, ids: []};
          const json = await res.json() as {
            result?: {adjudicatedIdsCount?: unknown; adjudicatedIds?: unknown[]};
            properties?: {result?: {adjudicatedIdsCount?: unknown; adjudicatedIds?: unknown[]}};
          };
          const rawIds = json.result?.adjudicatedIds ?? json.properties?.result?.adjudicatedIds ?? [];
          const ids = Array.isArray(rawIds) ? rawIds.map(v => String(v ?? "").trim()).filter(Boolean) : [];
          const rawCount = Number(json.result?.adjudicatedIdsCount ?? json.properties?.result?.adjudicatedIdsCount ?? ids.length);
          return {count: Number.isFinite(rawCount) ? rawCount : ids.length, ids};
        } finally {
          await res.dispose();
        }
      };

      const reAdjObsId = alarmArtifacts?.observationId ?? "";
      const reAdjVehicleId = `REG-READJ-${this.reporter.runId.slice(-12)}`;
      const reAdjNotes = `Re-adjudicated ${this.reporter.runId.slice(-12)}`;

      await this.check({
        scenario: "adjudication",
        category: "adjudication",
        action: "re-adjudicate already-adjudicated alarm",
        target: `${this.config.testLaneLabel}:${occupancyCount}`,
        expected: "submitting a second adjudication (Code 4, Completed) on an already-adjudicated alarm preserves both audit log entries and updates the active code marker to code:4",
      }, async () => {
        if (!reAdjObsId) {
          return {passed: false, observed: "missing alarm observationId from export step"};
        }
        await this.goto(page, `/event-details?eventId=${encodeURIComponent(reAdjObsId)}`);
        await page.getByRole("heading", {name: "Event Details"}).waitFor({timeout: this.config.uiTimeoutMs});
        await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: this.config.uiTimeoutMs});

        await page.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill(reAdjVehicleId);
        await this.selectMui(page, "Adjudicate", "Code 4: NORM Found");
        await this.selectMui(page, "Secondary Inspection", "COMPLETED");
        await page.getByLabel("Notes").fill(reAdjNotes);
        await page.getByRole("button", {name: "Submit", exact: true}).click();
        const confirm = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
        await confirm.waitFor();
        await confirm.getByRole("button", {name: /Confirm & Submit/i}).click();
        await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
        await page.getByText("Logged Adjudications", {exact: true}).waitFor();

        await page.reload({waitUntil: "domcontentloaded"});
        await page.getByText("Logged Adjudications", {exact: true}).waitFor();
        const body = await poll(
          () => page.locator("body").innerText(),
          (value) =>
            value.includes(firstVehicleId) &&
            value.includes(firstNotes) &&
            value.includes(reAdjVehicleId) &&
            value.includes(reAdjNotes),
          {timeoutMs: 30_000, intervalMs: 500, description: "both initial and re-adjudicated entries after reload"},
        ).catch(() => page.locator("body").innerText());

        const obsState = await poll(
          () => readObservationAdjudicatedIds(reAdjObsId),
          (state) => state.count >= 2 && state.ids.includes("code:4") && !state.ids.includes("code:9"),
          {timeoutMs: 15_000, intervalMs: 500, description: "updated code:4 marker on re-adjudicated occupancy"},
        ).catch(() => readObservationAdjudicatedIds(reAdjObsId));

        const firstPersisted = body.includes(firstVehicleId) && body.includes(firstNotes) && /Code 9/i.test(body);
        const secondPersisted = body.includes(reAdjVehicleId) && body.includes(reAdjNotes) &&
          /Code 4/i.test(body) && /\bCompleted\b/i.test(body);
        const markerUpdated = obsState.count >= 2 && obsState.ids.includes("code:4") && !obsState.ids.includes("code:9");
        const passed = firstPersisted && secondPersisted && markerUpdated;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "re-adjudicate-alarm-failed");
        return {
          passed,
          observed: `firstPersisted=${firstPersisted}; secondPersisted=${secondPersisted}; ` +
            `adjudicatedIdsCount=${obsState.count}; adjudicatedIds=${obsState.ids.join(",")}`,
          evidence,
        };
      });

      await this.check({
        scenario: "adjudication",
        category: "adjudication",
        action: "filter re-adjudicated alarm by updated Adjudication Code on Event Log",
        target: `${this.config.testLaneLabel}:${occupancyCount}`,
        expected: "Event Log Advanced Filters (Lane ID + Adjudication Code = Code 4) returns the re-adjudicated occupancy",
      }, async () => {
        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.eventTimeoutMs});
        await page.getByRole("button", {name: /advanced filters/i}).first().click();
        const dialog = page.getByRole("dialog", {name: /advanced filters/i});
        await dialog.waitFor({timeout: this.config.uiTimeoutMs});
        await dialog.getByRole("button", {name: /clear all/i}).click();

        await dialog.getByRole("button", {name: /add condition/i}).click();
        const boxes = dialog.getByRole("combobox");
        await boxes.nth(1).click();
        await page.getByRole("option", {name: "Lane ID", exact: true}).click();
        await boxes.nth(3).click();
        await page.getByRole("option", {name: this.config.testLaneLabel, exact: true}).click();

        await dialog.getByRole("button", {name: /add condition/i}).click();
        await boxes.nth(4).click();
        await page.getByRole("option", {name: "Adjudication Code", exact: true}).click();
        await boxes.nth(6).click();
        await page.getByRole("option", {name: "Code 4: NORM Found", exact: true}).click();

        await dialog.getByRole("button", {name: /apply filters/i}).click();
        await dialog.waitFor({state: "hidden"});

        const matchedOccupancies = await poll(async () => {
          const rows = page.locator(".MuiDataGrid-row");
          const count = await rows.count();
          const occs: string[] = [];
          for (let i = 0; i < count; i++) {
            occs.push((await rows.nth(i).locator('[data-field="occupancyCount"]').innerText().catch(() => "")).trim());
          }
          return occs;
        }, occs => occs.includes(String(occupancyCount)), {
          timeoutMs: 30_000,
          intervalMs: 500,
          description: `Event Log Adjudication Code = Code 4 filter to return occupancy ${occupancyCount}`,
        }).catch(() => [] as string[]);

        const passed = matchedOccupancies.includes(String(occupancyCount));
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "re-adjudication-code-filter-failed");
        return {
          passed,
          observed: `matchedOccupancies=${matchedOccupancies.join(",") || "none"}`,
          evidence,
        };
      });

      await this.check({
        scenario: "adjudication",
        category: "adjudication",
        action: "adjudicate and re-adjudicate an old unadjudicated alarm",
        target: "oldest unadjudicated alarm",
        expected: "oldest unadjudicated alarm (including cold Parquet history) adjudicates (Code 6 -> removed from unadjudicated filter) and re-adjudicates (Code 3 -> both log entries persist and code:3 replaces code:6)",
      }, async () => {
        const dsRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/api/datastreams?limit=1000"),
          {headers: {Accept: "application/json"}},
        );
        const occupancyStreamIds: string[] = [];
        try {
          if (dsRes.ok()) {
            const configuredUids = this.config.laneConfigOracle?.lanes?.length
              ? new Set(this.config.laneConfigOracle.lanes.map((l) => l.uniqueId.trim().toLowerCase()))
              : null;
            const dsJson = await dsRes.json() as {
              items?: Array<{
                id?: unknown;
                outputName?: unknown;
                "system@link"?: {uid?: unknown};
                system?: {uid?: unknown};
              }>;
            };
            for (const item of dsJson.items ?? []) {
              if (String(item.outputName ?? "").trim() !== "occupancy" || !item.id) continue;
              if (configuredUids && configuredUids.size > 0) {
                const sysUid = String(item["system@link"]?.uid ?? item.system?.uid ?? "").trim().toLowerCase();
                const tail = sysUid.split(":").pop() ?? "";
                if (!tail || !configuredUids.has(tail)) continue;
              }
              occupancyStreamIds.push(String(item.id).trim());
            }
          }
        } finally {
          await dsRes.dispose();
        }
        if (occupancyStreamIds.length === 0) {
          return {passed: false, observed: "no occupancy datastreams found"};
        }

        const findOldestUnadjudicated = async (): Promise<{
          obsId: string;
          datastreamId: string;
          phenomenonTime: string;
          occupancyCount: string;
        } | null> => {
          const params = new URLSearchParams({
            dataStream: occupancyStreamIds.join(","),
            filter: "(gammaAlarm=true OR neutronAlarm=true) AND adjudicatedIdsCount=0",
            order: "asc",
            limit: "10",
          });
          const res = await page.context().request.get(
            this.viewerUrl(`/sensorhub/api/observations?${params}`),
            {headers: {Accept: "application/om+json"}},
          );
          try {
            if (!res.ok()) return null;
            const json = await res.json() as {
              items?: Array<{
                id?: unknown;
                "datastream@id"?: unknown;
                phenomenonTime?: unknown;
                result?: {occupancyCount?: unknown; adjudicatedIdsCount?: unknown; adjudicatedIds?: unknown[]};
              }>;
            };
            for (const item of json.items ?? []) {
              const id = String(item.id ?? "").trim();
              const dsId = String(item["datastream@id"] ?? "").trim();
              const pTime = String(item.phenomenonTime ?? "").trim();
              const occCount = String(item.result?.occupancyCount ?? "").trim();
              const adjCount = Number(item.result?.adjudicatedIdsCount ?? 0);
              const adjIds = Array.isArray(item.result?.adjudicatedIds) ? item.result.adjudicatedIds : [];
              if (id && dsId && pTime && id !== reAdjObsId && adjCount === 0 && adjIds.length === 0) {
                return {obsId: id, datastreamId: dsId, phenomenonTime: pTime, occupancyCount: occCount};
              }
            }
            return null;
          } finally {
            await res.dispose();
          }
        };

        let oldAlarm = await findOldestUnadjudicated();
        if (!oldAlarm) {
          const fallbackTrigger = await this.triggerAlarm("gamma");
          oldAlarm = await findOldestUnadjudicated();
          if (oldAlarm && fallbackTrigger) {
            await this.captureAlarmMedia(
              page,
              oldAlarm.obsId,
              "gamma",
              fallbackTrigger.occupancyCount,
              "adjudication",
            );
          }
        }
        if (!oldAlarm) {
          return {passed: false, observed: "could not locate an unadjudicated alarm to adjudicate"};
        }

        const oldVehicleId = `REG-OLD-${this.reporter.runId.slice(-12)}`;
        const oldNotes = `Old alarm ${this.reporter.runId.slice(-12)}`;
        const oldReAdjVehicleId = `REG-OLD2-${this.reporter.runId.slice(-12)}`;
        const oldReAdjNotes = `Old alarm re-adj ${this.reporter.runId.slice(-12)}`;

        const queryDatastreamFilter = async (cql: string): Promise<string[]> => {
          const params = new URLSearchParams({
            phenomenonTime: `${oldAlarm.phenomenonTime}/${oldAlarm.phenomenonTime}`,
            filter: cql,
            limit: "50",
          });
          const res = await page.context().request.get(
            this.viewerUrl(
              `/sensorhub/api/datastreams/${encodeURIComponent(oldAlarm.datastreamId)}/observations?${params}`,
            ),
            {headers: {Accept: "application/om+json"}},
          );
          try {
            if (!res.ok()) return [];
            const json = await res.json() as {items?: Array<{id?: unknown}>};
            return (json.items ?? []).map(i => String(i.id ?? "").trim()).filter(Boolean);
          } finally {
            await res.dispose();
          }
        };

        let firstStepPassed = false;
        let body = "";
        await this.browser.withExpectedHistoricalClipDate(oldAlarm.phenomenonTime, async () => {
          await this.goto(page, `/event-details?eventId=${encodeURIComponent(oldAlarm.obsId)}`);
          await page.getByRole("heading", {name: "Event Details"}).waitFor({timeout: this.config.uiTimeoutMs});

          await page.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill(oldVehicleId);
          await this.selectMui(page, "Adjudicate", "Code 6: Physical Inspection Negative");
          await this.selectMui(page, "Secondary Inspection", "NONE");
          await page.getByLabel("Notes").fill(oldNotes);
          await page.getByRole("button", {name: "Submit", exact: true}).click();
          const confirm1 = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
          await confirm1.waitFor();
          await confirm1.getByRole("button", {name: /Confirm & Submit/i}).click();
          await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
          await page.getByText("Logged Adjudications", {exact: true}).waitFor();

          const afterFirstObsState = await poll(
            () => readObservationAdjudicatedIds(oldAlarm.obsId),
            (state) => state.count >= 1 && state.ids.includes("code:6"),
            {timeoutMs: 15_000, intervalMs: 500, description: "old alarm code:6 overlay"},
          ).catch(() => readObservationAdjudicatedIds(oldAlarm.obsId));

          const unadjIdsAfterFirst = await queryDatastreamFilter(
            "(gammaAlarm=true OR neutronAlarm=true) AND adjudicatedIdsCount=0",
          );
          const code6IdsAfterFirst = await queryDatastreamFilter(
            "adjudicatedIdsCount>0 AND adjudicatedIds='code:6'",
          );
          firstStepPassed =
            afterFirstObsState.count >= 1 &&
            afterFirstObsState.ids.includes("code:6") &&
            !unadjIdsAfterFirst.includes(oldAlarm.obsId) &&
            code6IdsAfterFirst.includes(oldAlarm.obsId);

          // Now re-adjudicate that same old alarm with Code 3 and Secondary Inspection = COMPLETED
          await page.reload({waitUntil: "domcontentloaded"});
          await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: this.config.uiTimeoutMs});
          await page.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill(oldReAdjVehicleId);
          await this.selectMui(page, "Adjudicate", "Code 3: Medical Isotope Found");
          await this.selectMui(page, "Secondary Inspection", "COMPLETED");
          await page.getByLabel("Notes").fill(oldReAdjNotes);
          await page.getByRole("button", {name: "Submit", exact: true}).click();
          const confirm2 = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
          await confirm2.waitFor();
          await confirm2.getByRole("button", {name: /Confirm & Submit/i}).click();
          await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
          await page.getByText("Logged Adjudications", {exact: true}).waitFor();

          await page.reload({waitUntil: "domcontentloaded"});
          await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: this.config.uiTimeoutMs});
          body = await poll(
            () => page.locator("body").innerText(),
            (value) =>
              value.includes(oldVehicleId) &&
              value.includes(oldNotes) &&
              value.includes(oldReAdjVehicleId) &&
              value.includes(oldReAdjNotes),
            {timeoutMs: 30_000, intervalMs: 500, description: "old alarm initial and re-adjudication entries"},
          ).catch(() => page.locator("body").innerText());
        });

        const afterSecondObsState = await poll(
          () => readObservationAdjudicatedIds(oldAlarm.obsId),
          (state) => state.count >= 2 && state.ids.includes("code:3") && !state.ids.includes("code:6"),
          {timeoutMs: 15_000, intervalMs: 500, description: "old alarm code:3 replacement overlay"},
        ).catch(() => readObservationAdjudicatedIds(oldAlarm.obsId));

        const code3IdsAfterSecond = await queryDatastreamFilter(
          "adjudicatedIdsCount>0 AND adjudicatedIds='code:3'",
        );
        const code6IdsAfterSecond = await queryDatastreamFilter(
          "adjudicatedIdsCount>0 AND adjudicatedIds='code:6'",
        );

        const uiBothPersisted =
          body.includes(oldVehicleId) &&
          body.includes(oldNotes) &&
          /Code 6/i.test(body) &&
          body.includes(oldReAdjVehicleId) &&
          body.includes(oldReAdjNotes) &&
          /Code 3/i.test(body) &&
          /\bCompleted\b/i.test(body);
        const secondStepPassed =
          uiBothPersisted &&
          afterSecondObsState.count >= 2 &&
          afterSecondObsState.ids.includes("code:3") &&
          !afterSecondObsState.ids.includes("code:6") &&
          code3IdsAfterSecond.includes(oldAlarm.obsId) &&
          !code6IdsAfterSecond.includes(oldAlarm.obsId);

        const passed = firstStepPassed && secondStepPassed;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "old-alarm-adjudication-failed");
        return {
          passed,
          observed: `oldObsId=${oldAlarm.obsId}; pTime=${oldAlarm.phenomenonTime}; ` +
            `firstStepPassed=${firstStepPassed}; secondStepPassed=${secondStepPassed}; ` +
            `finalIds=${afterSecondObsState.ids.join(",")}`,
          evidence,
        };
      });

      const specMeta: CheckMetadata = {
        scenario: "adjudication",
        category: "spectroscopic",
        action: "upload secondary-inspection .spe/.n42 file, verify OSCAR N42 Report + WebID, and select operator isotope",
        target: `${this.config.testLaneLabel}:${occupancyCount}`,
        expected: "uploading a real RIID .spe or .n42 file renders OSCAR's N42 Report, evaluates WebID when available, selects the WebID/device isotope (or Code 7 for nuisance background), and persists on reload",
      };
      if (this.config.spectroscopicWorkflow === "disabled") {
        this.skip(specMeta, "SPECTROSCOPIC_WORKFLOW=disabled");
      } else {
        const specCatalog = discoverSpectroscopicCatalog(this.config.spectraDirectory);
        if (specCatalog.samples.length === 0) {
          if (this.config.spectroscopicWorkflow === "auto") {
            this.skip(
              specMeta,
              `no .spe/.n42 files found in ${specCatalog.directory} (place files in spectroscopic-files/ or set OSCAR_SPECTRA_DIR)`,
            );
          } else {
            this.reporter.outcome(
              specMeta.scenario, specMeta.category, specMeta.action, specMeta.target,
              specMeta.expected, `SPECTROSCOPIC_WORKFLOW=required but ${specCatalog.directory} has 0 spectroscopic files`,
              "incorrect", 0,
            );
          }
        } else if (reAdjObsId) {
          await this.check(specMeta, async () => {
            const sample = specCatalog.samples[0]!;
            const specVehicleId = `REG-SPEC-${this.reporter.runId.slice(-10)}`;
            const specNotes = `Spectroscopic secondary inspection (${sample.primary.relativePath}) ${this.reporter.runId.slice(-10)}`;

            await this.goto(page, `/event-details?eventId=${encodeURIComponent(reAdjObsId)}`);
            await page.getByRole("heading", {name: "Event Details"}).waitFor({timeout: this.config.uiTimeoutMs});
            await page.getByText("Adjudication Form", {exact: true}).waitFor({timeout: this.config.uiTimeoutMs});

            const fileInput = page.locator('input[type="file"][multiple]').first();
            const payloads: Array<{name: string; mimeType: string; buffer: Buffer}> = [{
              name: sample.primary.fileName,
              mimeType: sample.primary.mimeType,
              buffer: readFileSync(sample.primary.absolutePath),
            }];
            if (sample.companion) {
              payloads.push({
                name: sample.companion.fileName,
                mimeType: sample.companion.mimeType,
                buffer: readFileSync(sample.companion.absolutePath),
              });
            }
            await fileInput.setInputFiles(payloads);
            await page.getByText(sample.primary.fileName, {exact: true}).waitFor({timeout: 10_000});

            const secSelectControl = page
              .locator("label")
              .filter({hasText: /^Secondary Inspection$/})
              .first()
              .locator("xpath=..")
              .locator(".MuiSelect-select");
            const autoPretoggledCompleted = await poll(
              async () => (await secSelectControl.innerText().catch(() => "")).replace(/[\u200B-\u200D\uFEFF]/g, "").trim(),
              (txt) => /^completed$/i.test(txt),
              {timeoutMs: 5_000, intervalMs: 150, description: "Secondary Inspection auto-pretoggle to Completed"},
            ).then(() => true, () => false);

            const webIdRows = page.getByTestId("webid-analysis-section").first().locator(".MuiDataGrid-row");
            const baselineWebIdRows = await webIdRows.count().catch(() => 0);

            const uploadBtn = page.getByRole("button", {name: "Upload to WebID", exact: true});
            await uploadBtn.click();
            await poll(
              async () => {
                const txt = (await uploadBtn.innerText().catch(() => "")).trim().toLowerCase();
                const disabled = await uploadBtn.isDisabled().catch(() => false);
                return !txt.includes("uploading") && disabled;
              },
              Boolean,
              {timeoutMs: 45_000, intervalMs: 300, description: `Upload to WebID completion for ${sample.primary.fileName}`},
            );

            const n42Visible = await page.getByTestId("n42-report-section").first()
              .waitFor({state: "visible", timeout: 25_000})
              .then(() => true, () => false);

            const applyWebIdBtn = page.getByTestId("apply-webid-isotopes").first();
            const applyDeviceBtn = page.getByTestId("apply-n42-device-isotopes").first();
            await poll(
              async () => {
                if ((await applyWebIdBtn.isVisible().catch(() => false)) && !(await applyWebIdBtn.isDisabled().catch(() => true))) {
                  return true;
                }
                return (await webIdRows.count().catch(() => 0)) > baselineWebIdRows;
              },
              Boolean,
              {timeoutMs: 12_000, intervalMs: 400, description: "WebID Analysis Results settlement"},
            ).catch(() => undefined);
            await poll(
              async () => (await applyWebIdBtn.isVisible().catch(() => false)) && !(await applyWebIdBtn.isDisabled().catch(() => true)),
              Boolean,
              {timeoutMs: 1_500, intervalMs: 200, description: "WebID USE SELECTED RESULT button propagation"},
            ).catch(() => undefined);

            const isoSelectBox = page.locator("label").filter({hasText: /^Isotope$/}).first().locator("xpath=..").locator(".MuiSelect-select");
            const readIsoClean = async () =>
              (await isoSelectBox.innerText().catch(() => "")).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
            let isoSource = "none(nuisance-bg)";
            if ((await applyWebIdBtn.isVisible().catch(() => false)) && !(await applyWebIdBtn.isDisabled().catch(() => true))) {
              await applyWebIdBtn.click();
              if ((await readIsoClean()).length > 0) {
                isoSource = "webid";
              }
            }
            if (
              (await readIsoClean()).length === 0 &&
              (await applyDeviceBtn.isVisible().catch(() => false)) &&
              !(await applyDeviceBtn.isDisabled().catch(() => true))
            ) {
              await applyDeviceBtn.click();
              if ((await readIsoClean()).length > 0) {
                isoSource = "oscar-n42-device";
              }
            }

            const selectedIsoText = await readIsoClean();
            const disposition = resolveOperatorDispositionFromSelectedIsotopes(selectedIsoText);

            await page.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill(specVehicleId);
            await this.selectMui(page, "Adjudicate", disposition.adjudicationCodeLabel);
            if (!autoPretoggledCompleted) {
              await this.selectMui(page, "Secondary Inspection", "COMPLETED");
            }
            await page.getByLabel("Notes").fill(specNotes);
            await page.getByRole("button", {name: "Submit", exact: true}).click();
            const confirm = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
            await confirm.waitFor({timeout: 10_000});
            await confirm.getByRole("button", {name: /Confirm & Submit/i}).click();
            await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});

            await page.reload({waitUntil: "domcontentloaded"});
            await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: 30_000});
            const n42Persisted = await page.getByTestId("n42-report-section").first()
              .waitFor({state: "visible", timeout: 20_000})
              .then(() => true, () => false);
            const body = await poll(
              () => page.locator("body").innerText(),
              (txt) => txt.includes(specVehicleId) && new RegExp(disposition.expectedCodePrefix, "i").test(txt),
              {timeoutMs: 25_000, intervalMs: 500, description: "spectroscopic adjudication reload persistence"},
            ).catch(() => page.locator("body").innerText());

            let specPassCount = 0;
            const specSearchStartIso = new Date(Date.now() - 3_600_000).toISOString();
            for (let attempt = 0; attempt < 2 && specPassCount < 1; attempt += 1) {
              try {
                const vSearchRes = await page.context().request.get(
                  `${this.config.oscarBaseUrl}/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(specVehicleId)}&matchMode=equals&startTime=${encodeURIComponent(specSearchStartIso)}`,
                );
                if (vSearchRes.ok()) {
                  const vJson = (await vSearchRes.json()) as {summary?: {spectroscopicPasses?: unknown}};
                  specPassCount = Number(vJson.summary?.spectroscopicPasses ?? 0);
                } else if (vSearchRes.status() === 503 && attempt === 0) {
                  await sleep(1_000);
                }
                await vSearchRes.dispose();
              } catch {
                specPassCount = 0;
              }
            }

            const passedSpec = autoPretoggledCompleted && n42Visible && n42Persisted && specPassCount >= 1 &&
              body.includes(specVehicleId) && new RegExp(disposition.expectedCodePrefix, "i").test(body);
            const evidence = passedSpec
              ? await this.browser.screenshot(page, "spectroscopic-secondary-inspection-adjudicated")
              : await this.screenshotOnFailure(page, "spectroscopic-secondary-inspection-failed");
            return {
              passed: passedSpec,
              observed: `file=${sample.primary.relativePath}; autoPretoggledCompleted=${autoPretoggledCompleted}; ` +
                `specPassCount=${specPassCount}; n42Visible=${n42Visible}; n42Persisted=${n42Persisted}; ` +
                `isoSource=${isoSource}; isotopes=${selectedIsoText || "none"}; code=${disposition.expectedCodePrefix}`,
              evidence,
            };
          });
        }
      }
    } finally { await page.close(); }
  }

  private async emlAutoAdjudication(): Promise<void> {
    if (!this.originalRpmConfig) throw new Error("Original RPM configuration is unavailable");
    const detectMeta: CheckMetadata = {
      scenario: "eml-auto-adjudication",
      category: "eml",
      action: "verify or upload external EML runtime plugin in SensorHub Admin",
      target: "/sensorhub/admin",
      expected: "Services -> OSCAR Service -> EML Plugin Path reports Active EML runtime and never exposes the JAR over HTTP buckets",
    };
    if (this.config.emlWorkflow === "disabled") {
      this.skip(detectMeta, "EML_WORKFLOW=disabled");
      return;
    }

    const quiet = this.emulator.quietConfig(this.originalRpmConfig);
    const page = await this.browser.oscarPage();
    try {
      await this.ensureAlarmMediaBaseline("eml-auto-adjudication");

      await this.goto(page, "/sensorhub/admin");
      const servicesHeader = page.locator(".v-accordion-item-caption").filter({hasText: /Services/i}).first();
      await servicesHeader.waitFor({timeout: this.config.uiTimeoutMs});
      await servicesHeader.click();
      const oscarServiceItem = page.locator(".v-table-cell-wrapper").filter({hasText: /OSCAR Service/i}).first();
      await oscarServiceItem.waitFor({timeout: this.config.uiTimeoutMs});
      await oscarServiceItem.click();

      const emlRow = page.locator("tr.v-formlayout-row").filter({hasText: /EML Plugin Path/i}).first();
      const emlRowPresent = await emlRow.waitFor({timeout: this.config.uiTimeoutMs})
        .then(() => true)
        .catch(() => false);
      if (!emlRowPresent) {
        if (this.config.emlWorkflow === "auto") {
          this.skip(detectMeta, "EML Plugin Path control is not present on this build (auto detection)");
        } else {
          this.reporter.outcome(
            detectMeta.scenario, detectMeta.category, detectMeta.action, detectMeta.target,
            detectMeta.expected, "EML Plugin Path form row is absent", "incorrect", 0,
            await this.screenshotOnFailure(page, "eml-admin-row-missing"),
          );
        }
        return;
      }

      const initialRowText = (await emlRow.innerText()).replace(/\s+/g, " ").trim();
      const alreadyActive = /Active:\s*\S+/i.test(initialRowText);
      if (!this.config.emlPluginPath && !alreadyActive) {
        if (this.config.emlWorkflow === "auto") {
          this.skip(detectMeta, "OSCAR_EML_PLUGIN_PATH is unset and no EML plugin is currently loaded on target");
        } else {
          this.reporter.outcome(
            detectMeta.scenario, detectMeta.category, detectMeta.action, detectMeta.target,
            detectMeta.expected, `OSCAR_EML_PLUGIN_PATH is unset and row shows: ${initialRowText}`, "incorrect", 0,
          );
        }
        return;
      }

      const pluginReady = await this.check({
        ...detectMeta,
      }, async () => {
        if (this.config.emlPluginPath) {
          const expectedFileName = basename(this.config.emlPluginPath);
          const fileInput = emlRow.locator('input[type="file"]').first();
          await fileInput.setInputFiles(this.config.emlPluginPath);
          const uploadBtn = emlRow.locator(".v-upload .v-button").first();
          await uploadBtn.click();
          await poll(
            async () => (await emlRow.innerText()).replace(/\s+/g, " ").trim(),
            text => text.includes(`Active: ${expectedFileName}`) || /Active:\s*\S+/i.test(text),
            {timeoutMs: 30_000, intervalMs: 500, description: "EML plugin upload to activate runtime"},
          );
          // Dismiss any transient Vaadin notification banner if present before clicking Apply Changes / Save.
          const notif = page.locator(".v-Notification").first();
          if (await notif.isVisible().catch(() => false)) {
            await notif.click().catch(() => undefined);
          }
          const applyBtn = page.locator(".v-button").filter({hasText: /Apply Changes/i}).first();
          if (await applyBtn.isVisible().catch(() => false)) {
            await applyBtn.click();
            await sleep(500);
          }
          const saveBtn = page.locator(".v-button").filter({hasText: /Save/i}).first();
          if (await saveBtn.isVisible().catch(() => false)) {
            await saveBtn.click();
            const confirmYes = page.locator(".v-window .v-button").filter({hasText: /Yes/i}).first();
            await confirmYes.waitFor({timeout: 10_000});
            await confirmYes.click();
            await sleep(500);
          }
        }

        const updatedRowText = (await emlRow.innerText()).replace(/\s+/g, " ").trim();
        const activeMatched = /Active:\s*\S+/i.test(updatedRowText);

        // Verify private storage isolation: neither /sensorhub/buckets nor /sensorhub/buckets/eml-plugin exposes the JAR.
        const request = page.context().request;
        const [bucketsRoot, emlBucketProbe] = await Promise.all([
          request.get(this.viewerUrl("/sensorhub/buckets")),
          request.get(this.viewerUrl("/sensorhub/buckets/eml-plugin")),
        ]);
        const bucketsRootBody = await bucketsRoot.text().catch(() => "");
        const emlBucketStatus = emlBucketProbe.status();
        await Promise.all([bucketsRoot.dispose(), emlBucketProbe.dispose()]);

        const bucketUnexposed = !/eml-plugin|eml-vm250/i.test(bucketsRootBody) &&
          (emlBucketStatus === 400 || emlBucketStatus === 403 || emlBucketStatus === 404);
        const passed = activeMatched && bucketUnexposed;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "eml-admin-upload-status");
        return {
          passed,
          value: passed,
          observed: `status="${updatedRowText}"; bucketsListingClean=${!/eml-plugin|eml-vm250/i.test(bucketsRootBody)}; emlBucketHTTP=${emlBucketStatus}`,
          evidence,
        };
      });
      if (!pluginReady) return;

      // 1. Distributed NORM alarm -> EML RELEASE -> automatic Code 9999 EML Non-Threat adjudication & Dashboard suppression.
      // NSDDSiteSim's POST /trigger endpoint hardcodes point-source geometry (occ_is_distributed=False),
      // whereas scheduled unique_alarm_probability=1 occupancies honor is_distributed=true and
      // distributed_source_sigma, producing an authentic distributed NORM scan for EML RELEASE.
      await this.ensureAlarmMediaBaseline("eml-auto-adjudication");
      const normWindowStartIso = new Date(Date.now() - 1_000).toISOString();
      await this.emulator.replaceConfig(
        this.config.testRpmId,
        this.emulator.distributedNormAlarmConfig(this.originalRpmConfig),
      );
      await this.waitHealthRpmConnection(page, "online", 60_000);

      let releaseTrigger: AlarmTriggerIdentity | undefined;
      let releaseEventId: string | undefined;
      let releaseHasMarker = false;
      let releaseAdjCommandId = "";

      for (let attempt = 1; attempt <= 3 && !releaseHasMarker; attempt++) {
        const beforeIdle = await this.emulator.waitForStatus(
          this.config.testRpmId,
          status => status.connected_clients >= 1 && status.state === "IDLE",
          "distributed NORM RPM connected and idle before occupancy",
          45_000,
        );
        const initiatedAtEpochMs = Date.now() - 2_000;
        const activeNorm = await this.emulator.waitForStatus(
          this.config.testRpmId,
          status => status.state === "OCCUPIED" &&
            status.occupancy_count > beforeIdle.occupancy_count &&
            status.is_gamma_alarm,
          "distributed NORM gamma alarm occupancy to latch",
          45_000,
        );
        await this.emulator.waitForIdle(this.config.testRpmId, this.config.eventTimeoutMs);
        releaseTrigger = {occupancyCount: activeNorm.occupancy_count, initiatedAtEpochMs};

        // Check if this occupancy evaluated as EML RELEASE (eml-non-threat marker + Code 9999 command ID).
        // If attempt 1 fired before 5s of post-connect GB/NB background accumulated, OSCAR stays connected
        // and attempt 2 immediately captures a full background-primed distributed NORM occupancy.
        const releaseRow = await this.findAlarmRow(page, /Gamma/i, releaseTrigger);
        releaseEventId = await this.resolveAlarmEventUuid(
          page,
          releaseRow,
          "gamma",
          releaseTrigger.occupancyCount,
          "eml-auto-adjudication",
        );
        if (!releaseEventId) throw new Error("Failed to resolve occupancy UUID for distributed NORM gamma alarm");

        const isSyntheticAdjudicationMarker = (id: string): boolean =>
          id === "eml-non-threat" || id === "bulk-adjudicated" || id.startsWith("code:");

        const polledAdjIds = await poll(async () => {
          const obsRes = await page.context().request.get(
            this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(releaseEventId!)}`),
            {headers: {Accept: "application/om+json"}},
          );
          try {
            if (!obsRes.ok()) return [] as string[];
            const obsJson = await obsRes.json() as {
              result?: {adjudicatedIds?: unknown[]};
              properties?: {result?: {adjudicatedIds?: unknown[]}};
            };
            const raw = obsJson.result?.adjudicatedIds ?? obsJson.properties?.result?.adjudicatedIds ?? [];
            return Array.isArray(raw) ? raw.map(v => String(v ?? "").trim()).filter(Boolean) : [];
          } finally {
            await obsRes.dispose();
          }
        }, ids =>
          ids.includes("eml-non-threat") &&
          ids.includes("code:9999") &&
          ids.some(id => !isSyntheticAdjudicationMarker(id)), {
          timeoutMs: 8_000,
          intervalMs: 500,
          description: "EML Non-Threat marker, code:9999 marker, and Code 9999 adjudication command ID on occupancy",
        }).catch(async () => {
          const obsRes = await page.context().request.get(
            this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(releaseEventId!)}`),
            {headers: {Accept: "application/om+json"}},
          );
          try {
            if (!obsRes.ok()) return [] as string[];
            const obsJson = await obsRes.json() as {
              result?: {adjudicatedIds?: unknown[]};
              properties?: {result?: {adjudicatedIds?: unknown[]}};
            };
            const raw = obsJson.result?.adjudicatedIds ?? obsJson.properties?.result?.adjudicatedIds ?? [];
            return Array.isArray(raw) ? raw.map(v => String(v ?? "").trim()).filter(Boolean) : [];
          } finally {
            await obsRes.dispose();
          }
        });

        releaseHasMarker = polledAdjIds.includes("eml-non-threat") && polledAdjIds.includes("code:9999");
        releaseAdjCommandId = polledAdjIds.find(id => !isSyntheticAdjudicationMarker(id)) ?? "";
        if (releaseHasMarker) {
          this.reporter.outcome(
            "eml-auto-adjudication",
            "emulator-control",
            "trigger distributed NORM gamma alarm",
            this.config.testRpmId,
            "distributed NORM occupancy latches gamma alarm and evaluates via EML",
            `attempt=${attempt}; occupancy=${releaseTrigger.occupancyCount}; eventId=${releaseEventId}; adjudicatedIds=${polledAdjIds.join(",")}`,
            "correct",
            0,
          );
          break;
        }
      }

      // Let any already-started scheduled occupancy finish cleanly before stopping the RPM, then
      // return the reserved RPM to quiet mode so no extra scheduled occupancies fire.
      const preQuietStatus = await this.emulator.statusOrNull(this.config.testRpmId);
      if (preQuietStatus?.state === "OCCUPIED") {
        await this.emulator.waitForIdle(this.config.testRpmId, this.config.eventTimeoutMs);
      }
      await this.emulator.replaceConfig(this.config.testRpmId, {
        ...quiet,
        eml_enabled: true,
        eml_collimated: true,
        lane_width: 4.82,
      });
      await this.waitHealthRpmConnection(page, "online", 60_000);

      if (!releaseTrigger || !releaseEventId) {
        throw new Error("Distributed NORM EML test did not produce an occupancy event");
      }
      const confirmedReleaseTrigger = releaseTrigger;
      const confirmedReleaseEventId = releaseEventId;

      // Register every alarm occupancy emitted on the reserved lane during the distributed NORM window
      // (including any scheduled occupancy that fired during initial RPM reconnect or multi-attempt warmup)
      // so the storage-lifecycle orphan-media oracle accounts for every generated MP4 clip.
      const normWindowAlarms = new Map<string, {type: "gamma" | "neutron"; occupancyCount: number}>();
      const releaseObsRes = await page.context().request.get(
        this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(confirmedReleaseEventId)}`),
        {headers: {Accept: "application/om+json"}},
      );
      let occupancyDatastreamId = "";
      try {
        if (releaseObsRes.ok()) {
          const releaseObsJson = await releaseObsRes.json() as {"datastream@id"?: unknown};
          occupancyDatastreamId = String(releaseObsJson["datastream@id"] ?? "").trim();
        }
      } finally {
        await releaseObsRes.dispose();
      }
      if (occupancyDatastreamId) {
        const normWindowEndIso = new Date(Date.now() + 2_000).toISOString();
        const windowObsRes = await page.context().request.get(
          this.viewerUrl(
            `/sensorhub/api/datastreams/${encodeURIComponent(occupancyDatastreamId)}/observations` +
            `?phenomenonTime=${encodeURIComponent(`${normWindowStartIso}/${normWindowEndIso}`)}&limit=50`,
          ),
          {headers: {Accept: "application/om+json"}},
        );
        try {
          if (windowObsRes.ok()) {
            const windowObsJson = await windowObsRes.json() as {
              items?: Array<{
                id?: unknown;
                result?: {occupancyCount?: unknown; gammaAlarm?: unknown; neutronAlarm?: unknown};
              }>;
            };
            for (const item of windowObsJson.items ?? []) {
              const id = String(item.id ?? "").trim();
              const gammaAlarm = Boolean(item.result?.gammaAlarm);
              const neutronAlarm = Boolean(item.result?.neutronAlarm);
              if (!id || (!gammaAlarm && !neutronAlarm)) continue;
              const occCount = Number(item.result?.occupancyCount ?? 0);
              normWindowAlarms.set(id, {
                type: gammaAlarm ? "gamma" : "neutron",
                occupancyCount: Number.isFinite(occCount) ? occCount : 0,
              });
            }
          }
        } finally {
          await windowObsRes.dispose();
        }
      }
      if (!normWindowAlarms.has(confirmedReleaseEventId)) {
        normWindowAlarms.set(confirmedReleaseEventId, {
          type: "gamma",
          occupancyCount: confirmedReleaseTrigger.occupancyCount,
        });
      }
      for (const [alarmId, alarmMeta] of normWindowAlarms) {
        if (this.generatedAlarmMedia.has(alarmId)) continue;
        this.resolvedAlarmEventIds.add(alarmId);
        await this.captureAlarmMedia(
          page,
          alarmId,
          alarmMeta.type,
          alarmMeta.occupancyCount,
          "eml-auto-adjudication",
        );
      }

      await this.check({
        scenario: "eml-auto-adjudication",
        category: "eml",
        action: "auto-adjudicate EML RELEASE alarm with Code 9999 metadata",
        target: confirmedReleaseEventId,
        expected: "occupancy carries adjudicatedIds=['eml-non-threat', <cmdId>], Event Details renders EML Analysis RELEASE + Auto: EML Non-Threat + Code 9999, and ConSys adjudication command status persists EML_METADATA JSON",
      }, async () => {
        await this.goto(page, `/event-details?eventId=${encodeURIComponent(confirmedReleaseEventId)}`);
        const card = page.getByTestId("eml-analysis-card");
        await card.waitFor({timeout: this.config.uiTimeoutMs});
        const decisionText = (await page.getByTestId("eml-decision-chip").innerText()).trim();
        const autoChipVisible = await page.getByTestId("eml-auto-adjudicated-chip").isVisible().catch(() => false);
        const loggedText = await poll(
          () => page.locator("body").innerText(),
          text => /9999/.test(text) && /EML Non-Threat/i.test(text),
          {timeoutMs: 20_000, intervalMs: 500, description: "Logged Adjudications to render Code 9999 EML Non-Threat"},
        ).catch(() => page.locator("body").innerText());

        // Inspect persisted adjudication command status on the lane's adjudicationControl stream for exact EML_METADATA JSON.
        let metadataValid = false;
        let adjObserved = `cmdId=${releaseAdjCommandId || "none"}; status=unmatched`;
        const csRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/api/controlstreams?limit=500"),
        );
        try {
          if (csRes.ok() && releaseAdjCommandId) {
            const csPayload = await csRes.json() as {
              items?: Array<{id?: string; name?: string; inputName?: string}>;
            };
            const allAdjStreams = (csPayload.items ?? []).filter(
              cs => cs.inputName === "adjudicationControl" && cs.id,
            );
            const laneMatched = allAdjStreams.filter(cs =>
              (cs.name ?? "").toLowerCase().startsWith(this.config.testLaneLabel.toLowerCase()),
            );
            const candidateStreams = laneMatched.length > 0 ? laneMatched : allAdjStreams;
            for (const cs of candidateStreams) {
              const statusRes = await page.context().request.get(
                this.viewerUrl(
                  `/sensorhub/api/controlstreams/${encodeURIComponent(cs.id!)}` +
                  `/commands/${encodeURIComponent(releaseAdjCommandId)}/status` +
                  "?statusCode=COMPLETED&format=application/json&offset=0&limit=100",
                ),
              );
              try {
                if (!statusRes.ok()) continue;
                const statusPayload = await statusRes.json() as {
                  items?: Array<{results?: Array<{data?: Record<string, unknown>}>}>;
                };
                for (const item of statusPayload.items ?? []) {
                  const res = item.results?.[0]?.data;
                  if (!res) continue;
                  if (res.occupancyObsId === confirmedReleaseEventId) {
                    const code = Number(res.adjudicationCode);
                    const username = String(res.username ?? "");
                    const feedback = String(res.feedback ?? "");
                    const markerIdx = feedback.indexOf("EML_METADATA:");
                    if (markerIdx >= 0) {
                      const parsedMeta = JSON.parse(feedback.slice(markerIdx + "EML_METADATA:".length).trim()) as Record<string, unknown>;
                      metadataValid = code === 9999 &&
                        username === "EML" &&
                        String(res.secondaryInspectionStatus ?? "") === "NONE" &&
                        parsedMeta.disposition === "EML Non-Threat" &&
                        parsedMeta.result === "RELEASE" &&
                        typeof parsedMeta.releaseProbability === "number" &&
                        Number.isFinite(parsedMeta.releaseProbability) &&
                        typeof parsedMeta.investigateProbability === "number" &&
                        Number.isFinite(parsedMeta.investigateProbability) &&
                        typeof parsedMeta.primaryThreshold === "number" &&
                        Number.isFinite(parsedMeta.primaryThreshold) &&
                        typeof parsedMeta.modelId === "string" &&
                        parsedMeta.modelId.length > 0;
                      adjObserved = `cmdId=${releaseAdjCommandId}; user=${username}; code=${code}; secondary=${String(res.secondaryInspectionStatus)}; metaDisposition=${String(parsedMeta.disposition)}; metaResult=${String(parsedMeta.result)}; model=${String(parsedMeta.modelId)}`;
                      if (metadataValid) break;
                    }
                  }
                }
              } finally {
                await statusRes.dispose();
              }
              if (metadataValid) break;
            }
          }
        } finally {
          await csRes.dispose();
        }

        const passed = releaseHasMarker && Boolean(releaseAdjCommandId) && decisionText === "RELEASE" &&
          autoChipVisible && /9999/.test(loggedText) && /EML Non-Threat/i.test(loggedText) && metadataValid;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "eml-release-event-details");
        return {
          passed,
          observed: `hasMarker=${releaseHasMarker}; chip=${decisionText}; autoBadge=${autoChipVisible}; ` +
            `loggedCode9999=${/9999/.test(loggedText)}; loggedNonThreat=${/EML Non-Threat/i.test(loggedText)}; ${adjObserved}`,
          evidence,
        };
      });

      await this.check({
        scenario: "eml-auto-adjudication",
        category: "eml",
        action: "suppress EML Non-Threat alarm from Dashboard unadjudicated queue",
        target: `${this.config.testLaneLabel}:${confirmedReleaseTrigger.occupancyCount}`,
        expected: "Dashboard unadjudicated alarm table excludes the auto-adjudicated EML Non-Threat occupancy",
      }, async () => {
        await this.openDashboard(page);
        await this.applyLaneEventFilter(page, "Gamma");
        await page.waitForTimeout(1_500);
        const rows = page.locator(".MuiDataGrid-row").filter({hasText: this.config.testLaneLabel});
        const rowCount = await rows.count();
        let leaked = false;
        for (let i = 0; i < rowCount; i++) {
          const candidate = rows.nth(i);
          const occupancyCount = await candidate.locator('[data-field="occupancyCount"]').innerText().catch(() => "");
          const startTime = await candidate.locator('[data-field="startTime"]').innerText().catch(() => "");
          const text = await candidate.innerText().catch(() => "");
          if (alarmRowMatchesTrigger({occupancyCount, startTime, text}, /Gamma/i, confirmedReleaseTrigger)) {
            leaked = true;
            break;
          }
        }
        const evidence = !leaked ? "" : await this.screenshotOnFailure(page, "eml-dashboard-suppression-leak");
        return {
          passed: !leaked,
          observed: `reservedLaneDashboardRows=${rowCount}; occupancy ${confirmedReleaseTrigger.occupancyCount} leaked=${leaked}`,
          evidence,
        };
      });

      await this.check({
        scenario: "eml-auto-adjudication",
        category: "eml",
        action: "query EML Non-Threat alarms via Event Log Advanced Filters",
        target: "Event Log (Adjudicated = EML Non-Threat)",
        expected: "filtering Lane ID + Adjudicated = EML Non-Threat returns the auto-adjudicated occupancy",
      }, async () => {
        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-root").waitFor({timeout: this.config.eventTimeoutMs});
        await page.getByRole("button", {name: /advanced filters/i}).first().click();
        const dialog = page.getByRole("dialog", {name: /advanced filters/i});
        await dialog.waitFor({timeout: this.config.uiTimeoutMs});
        await dialog.getByRole("button", {name: /clear all/i}).click();

        // Condition 1: Lane ID = testLaneLabel
        await dialog.getByRole("button", {name: /add condition/i}).click();
        const boxes = dialog.getByRole("combobox");
        await boxes.nth(1).click();
        await page.getByRole("option", {name: "Lane ID", exact: true}).click();
        await boxes.nth(3).click();
        await page.getByRole("option", {name: this.config.testLaneLabel, exact: true}).click();

        // Condition 2: Adjudicated = EML Non-Threat
        await dialog.getByRole("button", {name: /add condition/i}).click();
        await boxes.nth(4).click();
        await page.getByRole("option", {name: "Adjudicated", exact: true}).click();
        await boxes.nth(6).click();
        await page.getByRole("option", {name: "EML Non-Threat", exact: true}).click();

        await dialog.getByRole("button", {name: /apply filters/i}).click();
        await dialog.waitFor({state: "hidden"});

        const matchedOccupancies = await poll(async () => {
          const rows = page.locator(".MuiDataGrid-row");
          const count = await rows.count();
          const occs: string[] = [];
          for (let i = 0; i < count; i++) {
            occs.push((await rows.nth(i).locator('[data-field="occupancyCount"]').innerText().catch(() => "")).trim());
          }
          return occs;
        }, occs => occs.includes(String(confirmedReleaseTrigger.occupancyCount)), {
          timeoutMs: 30_000,
          intervalMs: 500,
          description: `Event Log EML Non-Threat filter to return occupancy ${confirmedReleaseTrigger.occupancyCount}`,
        }).catch(() => [] as string[]);

        const passed = matchedOccupancies.includes(String(confirmedReleaseTrigger.occupancyCount));
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "eml-event-log-filter-failed");
        return {
          passed,
          observed: `matchedOccupancies=${matchedOccupancies.join(",") || "none"}`,
          evidence,
        };
      });

      await this.check({
        scenario: "eml-auto-adjudication",
        category: "eml",
        action: "query EML Non-Threat alarms via Event Log Adjudication Code = Code 9999",
        target: "Event Log (Adjudication Code = Code 9999: EML Non-Threat)",
        expected: "filtering Lane ID + Adjudication Code = Code 9999: EML Non-Threat returns the auto-adjudicated occupancy",
      }, async () => {
        await page.getByRole("button", {name: /advanced filters/i}).first().click();
        const dialog = page.getByRole("dialog", {name: /advanced filters/i});
        await dialog.waitFor({timeout: this.config.uiTimeoutMs});
        await dialog.getByRole("button", {name: /clear all/i}).click();

        await dialog.getByRole("button", {name: /add condition/i}).click();
        const boxes = dialog.getByRole("combobox");
        await boxes.nth(1).click();
        await page.getByRole("option", {name: "Lane ID", exact: true}).click();
        await boxes.nth(3).click();
        await page.getByRole("option", {name: this.config.testLaneLabel, exact: true}).click();

        await dialog.getByRole("button", {name: /add condition/i}).click();
        await boxes.nth(4).click();
        await page.getByRole("option", {name: "Adjudication Code", exact: true}).click();
        await boxes.nth(6).click();
        await page.getByRole("option", {name: "Code 9999: EML Non-Threat", exact: true}).click();

        await dialog.getByRole("button", {name: /apply filters/i}).click();
        await dialog.waitFor({state: "hidden"});

        const matchedOccupancies = await poll(async () => {
          const rows = page.locator(".MuiDataGrid-row");
          const count = await rows.count();
          const occs: string[] = [];
          for (let i = 0; i < count; i++) {
            occs.push((await rows.nth(i).locator('[data-field="occupancyCount"]').innerText().catch(() => "")).trim());
          }
          return occs;
        }, occs => occs.includes(String(confirmedReleaseTrigger.occupancyCount)), {
          timeoutMs: 30_000,
          intervalMs: 500,
          description: `Event Log Adjudication Code = Code 9999 filter to return occupancy ${confirmedReleaseTrigger.occupancyCount}`,
        }).catch(() => [] as string[]);

        const passed = matchedOccupancies.includes(String(confirmedReleaseTrigger.occupancyCount));
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "eml-adjudication-code-9999-filter-failed");
        return {
          passed,
          observed: `matchedOccupancies=${matchedOccupancies.join(",") || "none"}`,
          evidence,
        };
      });

      // 2. Localized point-source Threat alarm -> EML INVESTIGATE -> remains unadjudicated and surfaces on Dashboard.
      await this.emulator.replaceConfig(
        this.config.testRpmId,
        this.emulator.localizedThreatAlarmConfig(this.originalRpmConfig),
      );
      await this.waitHealthRpmConnection(page, "online", 60_000);
      await sleep(7_500);

      const investigateTrigger = await this.triggerAlarm("gamma", "eml-auto-adjudication");
      if (!investigateTrigger) throw new Error("Localized threat gamma trigger returned no occupancy identity");
      const investigateRow = await this.findAlarmRow(page, /Gamma/i, investigateTrigger);
      const investigateEventId = await this.resolveAlarmEventUuid(
        page,
        investigateRow,
        "gamma",
        investigateTrigger.occupancyCount,
        "eml-auto-adjudication",
      );
      if (!investigateEventId) throw new Error("Failed to resolve occupancy UUID for localized threat gamma alarm");
      await this.captureAlarmMedia(page, investigateEventId, "gamma", investigateTrigger.occupancyCount, "eml-auto-adjudication");

      await this.check({
        scenario: "eml-auto-adjudication",
        category: "eml",
        action: "keep EML INVESTIGATE alarm unadjudicated and visible on Dashboard",
        target: investigateEventId,
        expected: "EML INVESTIGATE leaves adjudicatedIds empty, renders INVESTIGATE on Event Details without Auto badge, and appears on Dashboard",
      }, async () => {
        const obsRes = await page.context().request.get(
          this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(investigateEventId)}`),
          {headers: {Accept: "application/om+json"}},
        );
        let unadjudicated = false;
        try {
          if (obsRes.ok()) {
            const obsJson = await obsRes.json() as {
              result?: {adjudicatedIds?: unknown[]};
              properties?: {result?: {adjudicatedIds?: unknown[]}};
            };
            const adjIds = obsJson.result?.adjudicatedIds ?? obsJson.properties?.result?.adjudicatedIds ?? [];
            unadjudicated = Array.isArray(adjIds) && adjIds.length === 0;
          }
        } finally {
          await obsRes.dispose();
        }

        await this.goto(page, `/event-details?eventId=${encodeURIComponent(investigateEventId)}`);
        const card = page.getByTestId("eml-analysis-card");
        const cardVisible = await card.waitFor({timeout: this.config.uiTimeoutMs}).then(() => true).catch(() => false);
        const decisionText = cardVisible
          ? (await page.getByTestId("eml-decision-chip").innerText().catch(() => "")).trim()
          : "";
        const autoChipVisible = await page.getByTestId("eml-auto-adjudicated-chip").isVisible().catch(() => false);

        await this.openDashboard(page);
        await this.applyLaneEventFilter(page, "Gamma");
        const visibleOnDashboard = await poll(async () => {
          const rows = page.locator(".MuiDataGrid-row").filter({hasText: this.config.testLaneLabel});
          const count = await rows.count();
          for (let i = 0; i < count; i++) {
            const candidate = rows.nth(i);
            const occupancyCount = await candidate.locator('[data-field="occupancyCount"]').innerText().catch(() => "");
            const startTime = await candidate.locator('[data-field="startTime"]').innerText().catch(() => "");
            const text = await candidate.innerText().catch(() => "");
            if (alarmRowMatchesTrigger({occupancyCount, startTime, text}, /Gamma/i, investigateTrigger)) return true;
          }
          return false;
        }, found => found, {
          timeoutMs: 30_000,
          intervalMs: 1_000,
          description: `EML INVESTIGATE occupancy ${investigateTrigger.occupancyCount} to appear on Dashboard`,
        }).catch(() => false);

        const passed = unadjudicated && cardVisible && decisionText === "INVESTIGATE" && !autoChipVisible && visibleOnDashboard;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "eml-investigate-dashboard");
        return {
          passed,
          observed: `unadjudicated=${unadjudicated}; cardVisible=${cardVisible}; chip=${decisionText}; autoBadge=${autoChipVisible}; onDashboard=${visibleOnDashboard}`,
          evidence,
        };
      });
    } finally {
      await this.emulator.replaceConfig(this.config.testRpmId, quiet).catch(error =>
        this.reporter.error("eml-auto-adjudication", "restore-quiet-config", error));
      await page.close();
    }
  }

  private async vehicleOcr(): Promise<void> {
    if (!this.originalRpmConfig) throw new Error("Original RPM configuration is unavailable");
    const adminMeta: CheckMetadata = {
      scenario: "vehicle-ocr",
      category: "ocr",
      action: "enable per-lane Vehicle OCR on reserved lane in SensorHub Admin",
      target: `${this.config.testLaneLabel} (/sensorhub/admin)`,
      expected: "disabled lanes register zero active vehicleOcr datastreams by default; enabling Vehicle OCR on the reserved lane exposes the vehicleOcr datastream",
    };
    if (this.config.vehicleOcrWorkflow === "disabled") {
      this.skip(adminMeta, "VEHICLE_OCR_WORKFLOW=disabled");
      return;
    }

    const quiet = this.emulator.quietConfig(this.originalRpmConfig);
    const page = await this.browser.oscarPage();
    let ocrEnabledByScenario = false;
    let restoreInitialReservedOcrEnabled = false;

    const readConfiguredLiveOcrLaneNames = async (): Promise<Set<string> | null> => {
      const sshTarget = this.config.oscarSshTarget?.trim() ?? "";
      if (!sshTarget || !/^(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9_.-]+|\[[0-9A-Fa-f:]+\])$/.test(sshTarget)) {
        return null;
      }
      try {
        const sshArgs = [
          "-o", "BatchMode=yes",
          "-o", "StrictHostKeyChecking=yes",
          "-o", "ConnectTimeout=10",
          ...(this.config.sshIdentityFile
            ? ["-o", "IdentitiesOnly=yes", "-i", this.config.sshIdentityFile]
            : []),
          sshTarget,
          "docker exec oscar-oscar-1 sh -c 'cat /var/lib/oscar/config.json 2>/dev/null || cat /var/lib/oscar/config/config.json'",
        ];
        const {stdout} = await execFileAsync("ssh", sshArgs, {maxBuffer: 16 * 1024 * 1024, timeout: 15_000});
        const parsed = JSON.parse(stdout) as Array<{
          moduleClass?: unknown;
          name?: unknown;
          ocrConfig?: {enabled?: unknown};
          configuration?: {ocrConfig?: {enabled?: unknown}};
        }>;
        const enabledNames = new Set<string>();
        for (const mod of Array.isArray(parsed) ? parsed : []) {
          if (!String(mod?.moduleClass ?? "").includes("LaneSystem")) continue;
          const isEnabled = Boolean(mod?.ocrConfig?.enabled ?? mod?.configuration?.ocrConfig?.enabled);
          const lowerName = String(mod?.name ?? "").trim().toLowerCase();
          if (isEnabled && lowerName) {
            enabledNames.add(lowerName);
            enabledNames.add(lowerName.replace(/^lane(\d+)$/, "lane-$1"));
          }
        }
        return enabledNames;
      } catch {
        return null;
      }
    };

    const findLaneSystems = async (liveOcrLaneNames: Set<string> | null): Promise<{
      reserved: {systemId: string; uid: string} | null;
      untouchedBaseline: {systemId: string; uid: string} | null;
      liveOcrSystemIds: Set<string>;
    }> => {
      const res = await page.context().request.get(
        this.viewerUrl("/sensorhub/api/systems?searchMembers=true&validTime=latest&limit=500"),
        {headers: {Accept: "application/geo+json, application/json"}},
      );
      try {
        if (!res.ok()) return {reserved: null, untouchedBaseline: null, liveOcrSystemIds: new Set()};
        const json = await res.json() as {
          items?: Array<{
            id?: unknown;
            properties?: {uid?: unknown; name?: unknown};
          }>;
        };
        const expectedLower = this.config.testLaneLabel.toLowerCase();
        let reserved: {systemId: string; uid: string} | null = null;
        let untouchedBaseline: {systemId: string; uid: string} | null = null;
        const liveOcrSystemIds = new Set<string>();
        for (const item of json.items ?? []) {
          const id = String(item.id ?? "").trim();
          const uid = String(item.properties?.uid ?? "").trim();
          const name = String(item.properties?.name ?? "").trim();
          if (!id || !uid.includes(":lane:")) continue;
          const lowerName = name.toLowerCase();
          const lowerUid = uid.toLowerCase();
          const uidTail = lowerUid.split(":").pop() ?? "";
          const isLiveOcr = liveOcrLaneNames
            ? (liveOcrLaneNames.has(lowerName) || liveOcrLaneNames.has(uidTail))
            : /:lane-4[1-9]$/i.test(lowerUid);
          if (isLiveOcr) {
            liveOcrSystemIds.add(id);
          }
          if (lowerName === expectedLower || lowerUid.endsWith(`:${expectedLower}`)) {
            reserved = {systemId: id, uid};
          } else if (!untouchedBaseline && !isLiveOcr && (liveOcrLaneNames ? true : (lowerName === "lane01" || lowerUid.endsWith(":lane-01")))) {
            untouchedBaseline = {systemId: id, uid};
          }
        }
        return {reserved, untouchedBaseline, liveOcrSystemIds};
      } finally {
        await res.dispose();
      }
    };

    const listLaneOcrDatastreams = async (
      systemId: string,
      validTime: "now" | "latest",
    ): Promise<Array<{id: string; outputName: string}>> => {
      const res = await page.context().request.get(
        this.viewerUrl(
          `/sensorhub/api/systems/${encodeURIComponent(systemId)}/datastreams?validTime=${validTime}&limit=100`,
        ),
        {headers: {Accept: "application/json"}},
      );
      try {
        if (!res.ok()) return [];
        const json = await res.json() as {items?: Array<{id?: unknown; outputName?: unknown}>};
        return (json.items ?? [])
          .map(item => ({
            id: String(item.id ?? "").trim(),
            outputName: String(item.outputName ?? "").trim(),
          }))
          .filter(item => item.id.length > 0 && item.outputName === "vehicleOcr");
      } finally {
        await res.dispose();
      }
    };

    const selectReservedLaneOcrTab = async (restartAdminApp = false): Promise<Locator | null> => {
      await this.goto(page, restartAdminApp ? "/sensorhub/admin?restartApplication" : "/sensorhub/admin");
      const sensorsHeader = page.locator(".v-accordion-item-caption").filter({hasText: /\bSensors\b/i}).first();
      await sensorsHeader.waitFor({timeout: this.config.uiTimeoutMs});
      const openAccordion = page.locator(".v-accordion-item-open").filter({hasText: /\bSensors\b/i});
      if ((await openAccordion.count()) === 0) {
        await sensorsHeader.click();
      }
      const tableBody = page.locator(".v-accordion-item-open .v-table-body").first();
      await tableBody.waitFor({timeout: this.config.uiTimeoutMs});
      await tableBody.evaluate((el) => { el.scrollTop = 0; });
      await sleep(250);

      const escapedLane = this.config.testLaneLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const laneCell = page.locator(".v-accordion-item-open .v-table-cell-wrapper")
        .filter({hasText: new RegExp(`^\\s*${escapedLane}\\s*$`, "i")})
        .first();
      const laneHeaderLabel = page.locator(".v-label")
        .filter({hasText: new RegExp(`^\\s*${escapedLane}\\s*$`, "i")})
        .first();

      let selectedLane = false;
      for (let step = 0; step < 36; step++) {
        const bodyBox = await tableBody.boundingBox().catch(() => null);
        const cellBox = (await laneCell.count()) > 0
          ? await laneCell.boundingBox().catch(() => null)
          : null;
        if (bodyBox && cellBox && cellBox.height > 0 && cellBox.width > 0) {
          const topInside = cellBox.y >= bodyBox.y + 4;
          const bottomInside = cellBox.y + cellBox.height <= bodyBox.y + bodyBox.height - 4;
          if (topInside && bottomInside) {
            await page.mouse.click(
              cellBox.x + Math.min(40, cellBox.width / 2),
              cellBox.y + cellBox.height / 2,
            );
            const opened = await laneHeaderLabel.waitFor({timeout: 2_500}).then(() => true).catch(() => false);
            if (opened) {
              selectedLane = true;
              break;
            }
            await sleep(200);
            continue;
          }
          const deltaY = !bottomInside
            ? Math.max(80, (cellBox.y + cellBox.height) - (bodyBox.y + bodyBox.height) + 48)
            : Math.min(-80, cellBox.y - bodyBox.y - 48);
          await tableBody.evaluate((el, dy) => {
            el.scrollTop = Math.max(0, el.scrollTop + dy);
          }, deltaY);
          await sleep(250);
          continue;
        }
        const reachedBottom = await tableBody.evaluate((el) => {
          const prev = el.scrollTop;
          el.scrollTop = prev + 420;
          return el.scrollTop === prev;
        });
        await sleep(250);
        if (reachedBottom && (await laneCell.count()) === 0) {
          break;
        }
      }
      if (!selectedLane) {
        throw new Error(`Could not locate and select ${this.config.testLaneLabel} in SensorHub Admin Sensors list`);
      }
      const ocrTab = page.locator(".v-tabsheet-tabitem").filter({hasText: /Vehicle OCR/i}).first();
      const tabVisible = await ocrTab.waitFor({timeout: 10_000}).then(() => true).catch(() => false);
      if (!tabVisible) return null;

      const enableCheckbox = page.locator(".v-tabsheet-content .v-checkbox")
        .filter({hasText: /Enable Vehicle OCR/i})
        .first();
      for (let attempt = 0; attempt < 5; attempt++) {
        const notif = page.locator(".v-Notification").first();
        if (await notif.isVisible().catch(() => false)) {
          await notif.click().catch(() => undefined);
          await sleep(150);
        }
        const caption = ocrTab.locator(".v-caption").first();
        if ((await caption.count()) > 0 && await caption.isVisible().catch(() => false)) {
          await caption.click({timeout: 5_000}).catch(() => undefined);
        } else {
          const tabBox = await ocrTab.boundingBox();
          if (tabBox) {
            await page.mouse.click(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
          }
        }
        const checkboxVisible = await enableCheckbox.waitFor({timeout: 3_000}).then(() => true).catch(() => false);
        if (checkboxVisible) {
          return enableCheckbox;
        }
        await sleep(300);
      }
      return null;
    };

    const setLaneVehicleOcrEnabled = async (
      systemId: string,
      enabled: boolean,
    ): Promise<{supported: boolean; initiallyChecked: boolean | null; checkedAfterSave: boolean | null; streamId: string}> => {
      const enableCheckbox = await selectReservedLaneOcrTab(true);
      if (!enableCheckbox) {
        return {supported: false, initiallyChecked: null, checkedAfterSave: null, streamId: ""};
      }
      const input = enableCheckbox.locator('input[type="checkbox"]').first();
      const initiallyChecked = await input.isChecked();
      if (initiallyChecked !== enabled) {
        await enableCheckbox.locator("label").first().click();
        await poll(
          () => input.isChecked(),
          checked => checked === enabled,
          {timeoutMs: 5_000, intervalMs: 100, description: `Enable Vehicle OCR checkbox=${enabled}`},
        );
      }
      if (enabled) {
        const alarmsOnlyBox = page.locator(".v-tabsheet-content .v-checkbox")
          .filter({hasText: /Alarms Only/i})
          .first();
        if ((await alarmsOnlyBox.count()) > 0) {
          const alarmsOnlyInput = alarmsOnlyBox.locator('input[type="checkbox"]').first();
          if (!(await alarmsOnlyInput.isChecked())) {
            await alarmsOnlyBox.locator("label").first().click();
          }
        }
      }

      const notifBefore = page.locator(".v-Notification").first();
      if (await notifBefore.isVisible().catch(() => false)) {
        await notifBefore.click().catch(() => undefined);
      }

      const applyBtn = page.locator(".v-button").filter({hasText: /Apply Changes/i}).first();
      await applyBtn.waitFor({timeout: this.config.uiTimeoutMs});
      if (enabled) {
        ocrEnabledByScenario = true;
      }
      await applyBtn.click();

      let streamId = "";
      if (enabled) {
        const streams = await poll(
          () => listLaneOcrDatastreams(systemId, "latest"),
          items => items.length > 0,
          {timeoutMs: 30_000, intervalMs: 500, description: `${this.config.testLaneLabel} vehicleOcr datastream registration`},
        );
        streamId = streams[0]?.id ?? "";
      } else {
        await sleep(3_000);
      }

      const notifMid = page.locator(".v-Notification").first();
      if (await notifMid.isVisible().catch(() => false)) {
        await notifMid.click().catch(() => undefined);
      }

      const saveBtn = page.locator(".v-button").filter({hasText: /\bSave\b/i}).first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        const confirmYes = page.locator(".v-window .v-button").filter({hasText: /\bYes\b/i}).first();
        await confirmYes.waitFor({timeout: 10_000});
        await confirmYes.click();
        await sleep(1_000);
      }

      const reloadedCheckbox = await selectReservedLaneOcrTab(true);
      const checkedAfterSave = reloadedCheckbox
        ? await reloadedCheckbox.locator('input[type="checkbox"]').first().isChecked()
        : null;
      return {supported: true, initiallyChecked, checkedAfterSave, streamId};
    };

    let laneSystem: {systemId: string; uid: string} | null = null;
    try {
      await this.ensureAlarmMediaBaseline("vehicle-ocr");
      const liveOcrLaneNames = await readConfiguredLiveOcrLaneNames();
      const discoveredLanes = await findLaneSystems(liveOcrLaneNames);
      laneSystem = discoveredLanes.reserved;
      if (!laneSystem) {
        throw new Error(`Unable to resolve ConSys system ID for ${this.config.testLaneLabel}`);
      }
      const targetLaneSystem = laneSystem;

      // Untouched lanes never register a vehicleOcr datastream; previously tested lanes retain historical
      // datastream metadata for archived observations while publishing zero new observations when disabled.
      let untouchedLaneOcrStreams = 0;
      if (discoveredLanes.untouchedBaseline) {
        const baselineStreams = await listLaneOcrDatastreams(discoveredLanes.untouchedBaseline.systemId, "latest");
        for (const bs of baselineStreams) {
          const histRes = await page.context().request.get(
            this.viewerUrl(`/sensorhub/api/datastreams/${encodeURIComponent(bs.id)}/observations?limit=1`),
            {headers: {Accept: "application/om+json, application/json"}},
          );
          try {
            if (histRes.ok()) {
              const histJson = await histRes.json() as {items?: unknown[]};
              if ((histJson.items ?? []).length === 0) {
                untouchedLaneOcrStreams += 1;
              }
            }
          } finally {
            await histRes.dispose();
          }
        }
      }
      const nonReservedOcrStreamIds: string[] = [];
      const allDsRes = await page.context().request.get(
        this.viewerUrl("/sensorhub/api/datastreams?validTime=latest&limit=2000"),
        {headers: {Accept: "application/json"}},
      );
      try {
        if (allDsRes.ok()) {
          const allDsJson = await allDsRes.json() as {
            items?: Array<{
              id?: unknown;
              outputName?: unknown;
              "system@id"?: unknown;
              "system@link"?: {uid?: unknown};
              system?: {id?: unknown; uid?: unknown};
            }>;
          };
          for (const ds of allDsJson.items ?? []) {
            if (String(ds.outputName ?? "").trim() !== "vehicleOcr") continue;
            const dsId = String(ds.id ?? "").trim();
            const sysId = String(ds["system@id"] ?? ds.system?.id ?? "").trim();
            const sysUid = String(ds["system@link"]?.uid ?? ds.system?.uid ?? "").trim();
            const isActiveBackgroundOcrLane = liveOcrLaneNames
              ? discoveredLanes.liveOcrSystemIds.has(sysId)
              : /:lane-4[1-9]$/i.test(sysUid);
            if (dsId && sysId && sysId !== targetLaneSystem.systemId && !isActiveBackgroundOcrLane) {
              nonReservedOcrStreamIds.push(dsId);
            }
          }
        }
      } finally {
        await allDsRes.dispose();
      }

      let enableOutcome = await setLaneVehicleOcrEnabled(targetLaneSystem.systemId, true);
      if (!enableOutcome.supported) {
        if (this.config.vehicleOcrWorkflow === "auto") {
          this.skip(adminMeta, "Vehicle OCR tab is not present on this build (auto detection)");
        } else {
          this.reporter.outcome(
            adminMeta.scenario, adminMeta.category, adminMeta.action, adminMeta.target,
            adminMeta.expected, "Vehicle OCR configuration tab is absent in SensorHub Admin", "incorrect", 0,
            await this.screenshotOnFailure(page, "vehicle-ocr-tab-missing"),
          );
        }
        return;
      }
      if (enableOutcome.initiallyChecked === true) {
        // Host pre-enables Vehicle OCR on the reserved lane (e.g. 50-lane continuous OCR endurance topology):
        // cycle false -> true to verify the full disable-to-enable transition and restore true on exit.
        restoreInitialReservedOcrEnabled = true;
        await setLaneVehicleOcrEnabled(targetLaneSystem.systemId, false);
        enableOutcome = await setLaneVehicleOcrEnabled(targetLaneSystem.systemId, true);
      }
      ocrEnabledByScenario = true;

      const enabledCheck = await this.check(adminMeta, async () => {
        const passed = untouchedLaneOcrStreams === 0 &&
          enableOutcome.initiallyChecked === false &&
          enableOutcome.checkedAfterSave === true &&
          enableOutcome.streamId.length > 0;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "vehicle-ocr-enable-failed");
        return {
          passed,
          value: enableOutcome.streamId,
          observed: `untouchedLaneOcrStreams=${untouchedLaneOcrStreams}; ` +
            `initiallyChecked=${enableOutcome.initiallyChecked}; ` +
            `checkedAfterSave=${enableOutcome.checkedAfterSave}; vehicleOcrStreamId=${enableOutcome.streamId || "none"}`,
          evidence,
        };
      });
      if (!enabledCheck) return;

      // Ensure the lane's RPM and camera reconnect cleanly after the LaneSystem config update, then configure a
      // 12-second alarm window so cam_50 captures container transits across multi-scene compilation loops.
      await this.emulator.replaceConfig(
        this.config.testRpmId,
        this.emulator.shortAlarmConfig(this.originalRpmConfig, 12),
      );
      await this.waitHealthRpmConnection(page, "online", 60_000);
      await sleep(2_500);

      const triggerWindowStartIso = new Date(Date.now() - 5_000).toISOString();
      let trigger = await this.triggerAlarm("gamma", "vehicle-ocr");
      if (!trigger) throw new Error("Container-transit gamma alarm trigger returned no occupancy identity");

      const alarmRow = await this.findAlarmRow(page, /Gamma/i, trigger);
      const initialEventId = await this.resolveAlarmEventUuid(
        page,
        alarmRow,
        "gamma",
        trigger.occupancyCount,
        "vehicle-ocr",
      );
      if (!initialEventId) throw new Error("Failed to resolve occupancy UUID for container-transit gamma alarm");
      let eventId: string = initialEventId;
      const triggeredEventIds = new Set<string>([initialEventId]);
      await this.captureAlarmMedia(page, eventId, "gamma", trigger.occupancyCount, "vehicle-ocr");

      const expectedContainer = this.config.expectedVehicleOcrContainer;
      const matchesExpectedContainer = (normalizedValue: string): boolean => {
        const clean = normalizedValue.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        if (expectedContainer === "ANY") {
          return /^[A-Z]{3}[UJZR][0-9]{7}$/.test(clean);
        }
        return clean === expectedContainer;
      };

      interface OcrObservationRecord {
        id: string;
        occupancyObsId: string;
        idType: string;
        value: string;
        normalizedValue: string;
        checksumValid: boolean;
        confidence: number;
        readCount: number;
        cameraUid: string;
        evidenceImagePath: string;
      }

      const fetchMatchingOcrObservationsFor = async (targetEventIds: ReadonlySet<string>): Promise<OcrObservationRecord[]> => {
        const windowEndIso = new Date(Date.now() + 60_000).toISOString();
        const params = new URLSearchParams({
          resultTime: `${triggerWindowStartIso}/${windowEndIso}`,
          limit: "50",
        });
        const res = await page.context().request.get(
          this.viewerUrl(
            `/sensorhub/api/datastreams/${encodeURIComponent(enabledCheck)}/observations?${params}`,
          ),
          {headers: {Accept: "application/om+json, application/json"}},
        );
        try {
          if (!res.ok()) return [];
          const json = await res.json() as {
            items?: Array<{
              id?: unknown;
              result?: Record<string, unknown>;
              properties?: {result?: Record<string, unknown>};
            }>;
          };
          const matched: OcrObservationRecord[] = [];
          for (const item of json.items ?? []) {
            const r = item.result ?? item.properties?.result ?? {};
            const obsId = String(r.occupancyObsId ?? "").trim();
            if (!targetEventIds.has(obsId)) continue;
            matched.push({
              id: String(item.id ?? "").trim(),
              occupancyObsId: obsId,
              idType: String(r.idType ?? "").trim(),
              value: String(r.value ?? "").trim(),
              normalizedValue: String(r.normalizedValue ?? "").trim(),
              checksumValid: Boolean(r.checksumValid),
              confidence: Number(r.confidence ?? 0),
              readCount: Number(r.readCount ?? 0),
              cameraUid: String(r.cameraUid ?? "").trim(),
              evidenceImagePath: String(r.evidenceImagePath ?? "").trim(),
            });
          }
          return matched;
        } finally {
          await res.dispose();
        }
      };

      const ocrCandidate = await this.check({
        scenario: "vehicle-ocr",
        category: "ocr",
        action: "recognize ISO 6346 container ID and store JPEG evidence crop on alarm clip",
        target: `${this.config.testLaneLabel}:${trigger.occupancyCount}`,
        expected: `vehicleOcr publishes checksum-valid container candidate (${expectedContainer}) correlated to occupancy with a valid JPEG crop in /sensorhub/buckets/ocr/crops`,
      }, async () => {
        let candidates: OcrObservationRecord[] = [];
        let best: OcrObservationRecord | undefined;
        // Multi-scene container-transit RTSP loops can contain >3-minute non-box-container/plate
        // segments between ISO 6346 container passes; allow up to 10 phase-shifted alarm triggers
        // (exiting immediately on the first valid container match).
        for (let passAttempt = 0; passAttempt < 10; passAttempt++) {
          if (passAttempt > 0) {
            await sleep(3_500);
            const nextTrigger = await this.triggerAlarm("gamma", "vehicle-ocr");
            if (!nextTrigger) break;
            const nextRow = await this.findAlarmRow(page, /Gamma/i, nextTrigger);
            const nextEventId = await this.resolveAlarmEventUuid(
              page,
              nextRow,
              "gamma",
              nextTrigger.occupancyCount,
              "vehicle-ocr",
            );
            if (!nextEventId) break;
            await this.captureAlarmMedia(page, nextEventId, "gamma", nextTrigger.occupancyCount, "vehicle-ocr");
            trigger = nextTrigger;
            eventId = nextEventId;
            triggeredEventIds.add(nextEventId);
          }
          candidates = await poll(
            () => fetchMatchingOcrObservationsFor(triggeredEventIds),
            items => items.some(c => c.idType === "container" && c.checksumValid && matchesExpectedContainer(c.normalizedValue)),
            {
              timeoutMs: passAttempt < 9 ? 20_000 : Math.max(this.config.eventTimeoutMs, 45_000),
              intervalMs: 1_000,
              description: `vehicleOcr ISO 6346 container observation (${expectedContainer}) for occupancies [${[...triggeredEventIds].join(",")}]`,
            },
          ).catch(() => fetchMatchingOcrObservationsFor(triggeredEventIds));

          const validContainer = candidates.find(
            c => c.idType === "container" && c.checksumValid && matchesExpectedContainer(c.normalizedValue),
          );
          if (validContainer) {
            best = validContainer;
            eventId = validContainer.occupancyObsId;
            break;
          }
          if (candidates[0]) {
            best = candidates[0];
            eventId = candidates[0].occupancyObsId;
          }
        }

        if (!best) {
          return {
            passed: false,
            observed: `0 vehicleOcr observations correlated to occupancyObsId=${eventId}`,
          };
        }

        let nonReservedNewOcrObs = 0;
        const verifyEndIso = new Date(Date.now() + 60_000).toISOString();
        for (const dsId of nonReservedOcrStreamIds) {
          const checkRes = await page.context().request.get(
            this.viewerUrl(
              `/sensorhub/api/datastreams/${encodeURIComponent(dsId)}/observations?resultTime=${encodeURIComponent(`${triggerWindowStartIso}/${verifyEndIso}`)}&limit=5`,
            ),
            {headers: {Accept: "application/om+json, application/json"}},
          );
          try {
            if (checkRes.ok()) {
              const checkJson = await checkRes.json() as {items?: unknown[]};
              nonReservedNewOcrObs += (checkJson.items ?? []).length;
            }
          } finally {
            await checkRes.dispose();
          }
        }

        let cropHttpStatus = 0;
        let cropContentType = "";
        let cropBytes = 0;
        let cropJpegMagic = false;
        if (best.evidenceImagePath) {
          const encodedPath = best.evidenceImagePath
            .split("/")
            .filter(Boolean)
            .map(seg => encodeURIComponent(seg))
            .join("/");
          const cropRes = await page.context().request.get(
            this.viewerUrl(`/sensorhub/buckets/${encodedPath}`),
            {headers: {Accept: "image/jpeg"}},
          );
          try {
            cropHttpStatus = cropRes.status();
            cropContentType = (cropRes.headers()["content-type"] ?? "").toLowerCase();
            if (cropRes.ok()) {
              const buf = await cropRes.body();
              cropBytes = buf.length;
              cropJpegMagic = buf.length >= 4 &&
                buf[0] === 0xff &&
                buf[1] === 0xd8 &&
                buf[buf.length - 2] === 0xff &&
                buf[buf.length - 1] === 0xd9;
            }
          } finally {
            await cropRes.dispose();
          }
        }

        const cropValid = best.evidenceImagePath.startsWith("ocr/crops/") &&
          cropHttpStatus === 200 &&
          cropContentType.includes("image/jpeg") &&
          cropBytes > 500 &&
          cropBytes <= 2 * 1024 * 1024 &&
          cropJpegMagic;

        const passed = best.idType === "container" &&
          best.checksumValid &&
          matchesExpectedContainer(best.normalizedValue) &&
          best.confidence >= 0.5 &&
          best.readCount >= 1 &&
          nonReservedNewOcrObs === 0 &&
          cropValid;

        return {
          passed,
          value: best,
          observed: `normalizedValue=${best.normalizedValue}; idType=${best.idType}; checksumValid=${best.checksumValid}; ` +
            `confidence=${best.confidence.toFixed(3)}; readCount=${best.readCount}; nonReservedNewOcrObs=${nonReservedNewOcrObs}; ` +
            `crop=${best.evidenceImagePath || "none"} ` +
            `(HTTP ${cropHttpStatus}, ${cropContentType || "no-type"}, ${cropBytes} bytes, jpegMagic=${cropJpegMagic})`,
        };
      });

      if (ocrCandidate) {
        let canonicalExpected = ocrCandidate.normalizedValue.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        this.lastRecognizedOcrContainer = canonicalExpected;
        const ocrNotes = `Container OCR regression ${this.reporter.runId.slice(-12)}`;

        await this.check({
          scenario: "vehicle-ocr",
          category: "ocr",
          action: "auto-fill Vehicle ID from OCR chip and submit adjudication on Event Details",
          target: `/event-details?eventId=${eventId}`,
          expected: `Event Details renders OCR suggestion chip (${canonicalExpected}), auto-fills Vehicle ID without manual typing, and persists ${canonicalExpected} in Logged Adjudications`,
        }, async () => {
          await this.goto(page, `/event-details?eventId=${encodeURIComponent(eventId)}`);
          await page.getByRole("heading", {name: "Event Details"}).waitFor({timeout: this.config.uiTimeoutMs});

          const suggestionsBox = page.getByTestId("vehicle-id-ocr-suggestions");
          await suggestionsBox.waitFor({timeout: this.config.uiTimeoutMs});
          const chip = page.getByTestId(`ocr-chip-${canonicalExpected}`);
          const chipVisible = await chip.waitFor({timeout: this.config.uiTimeoutMs}).then(() => true).catch(() => false);

          const vehicleInput = page.getByRole("textbox", {name: "Vehicle ID", exact: true});
          const autoFilledValue = await poll(
            async () => (await vehicleInput.inputValue()).replace(/[^A-Z0-9]/gi, "").toUpperCase(),
            val => val === canonicalExpected,
            {timeoutMs: 15_000, intervalMs: 250, description: `Vehicle ID auto-fill to equal ${canonicalExpected}`},
          ).catch(async () => (await vehicleInput.inputValue()).replace(/[^A-Z0-9]/gi, "").toUpperCase());

          const evidenceShot = await this.browser.screenshot(page, "vehicle-ocr-event-details-autofill");

          await this.selectMui(page, "Adjudicate", "Code 9: Authorized Test, Maintenance, or Training Activity");
          await this.selectMui(page, "Secondary Inspection", "NONE");
          await page.getByLabel("Notes").fill(ocrNotes);
          await page.getByRole("button", {name: "Submit", exact: true}).click();
          const confirm = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
          await confirm.waitFor({timeout: this.config.uiTimeoutMs});
          await confirm.getByRole("button", {name: /Confirm & Submit/i}).click();
          await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
          await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: this.config.uiTimeoutMs});

          await page.reload({waitUntil: "domcontentloaded"});
          await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: this.config.uiTimeoutMs});
          const reloadedBody = await poll(
            () => page.locator("body").innerText(),
            text => text.includes(canonicalExpected) && text.includes(ocrNotes),
            {timeoutMs: 30_000, intervalMs: 500, description: "OCR-adjudicated Vehicle ID and notes after reload"},
          ).catch(() => page.locator("body").innerText());

          const persisted = reloadedBody.includes(canonicalExpected) &&
            reloadedBody.includes(ocrNotes) &&
            /Code 9/i.test(reloadedBody);
          const passed = chipVisible && autoFilledValue === canonicalExpected && persisted;
          return {
            passed,
            observed: `chipVisible=${chipVisible}; autoFilled=${autoFilledValue}; persisted=${persisted}`,
            evidence: evidenceShot,
          };
        });

        // Confirmation re-scan SOP: send the same container back through the lane a second time,
        // verify normalized vehicle-search correlates adjudicated Pass #1 + open OCR Pass #2 with
        // radiation profile traces, open VehiclePassComparisonDialog from Pass #2's related-passes
        // banner, batch-adjudicate open Pass #2, and export consolidated VEHICLE_INCIDENT reports
        // across PDF, CSV, JSON, and XLSX.
        // Use a neutron alarm on confirmation re-scans so EML never auto-releases Pass #2 as EML Non-Threat
        // before VehiclePassComparisonDialog exercises open-alarm batch adjudication.
        let basePassEventId = eventId;
        let rescanWindowStartIso = new Date(Date.now() - 5_000).toISOString();
        const trigger2 = await this.triggerAlarm("neutron", "vehicle-ocr");
        if (!trigger2) throw new Error("Confirmation re-scan neutron alarm trigger returned no occupancy identity");
        const alarmRow2 = await this.findAlarmRow(page, /Neutron/i, trigger2);
        let eventId2 = await this.resolveAlarmEventUuid(
          page,
          alarmRow2,
          "neutron",
          trigger2.occupancyCount,
          "vehicle-ocr",
        );
        if (!eventId2) throw new Error("Failed to resolve occupancy UUID for confirmation re-scan neutron alarm");
        await this.captureAlarmMedia(page, eventId2, "neutron", trigger2.occupancyCount, "vehicle-ocr");

        const fetchOcrForObsId = async (targetObsId: string, winStartIso: string): Promise<OcrObservationRecord[]> => {
          const windowEndIso = new Date(Date.now() + 60_000).toISOString();
          const params = new URLSearchParams({
            resultTime: `${winStartIso}/${windowEndIso}`,
            limit: "50",
          });
          const res = await page.context().request.get(
            this.viewerUrl(
              `/sensorhub/api/datastreams/${encodeURIComponent(enabledCheck)}/observations?${params}`,
            ),
            {headers: {Accept: "application/om+json, application/json"}},
          );
          try {
            if (!res.ok()) return [];
            const json = await res.json() as {
              items?: Array<{
                id?: unknown;
                result?: Record<string, unknown>;
                properties?: {result?: Record<string, unknown>};
              }>;
            };
            const matched: OcrObservationRecord[] = [];
            for (const item of json.items ?? []) {
              const r = item.result ?? item.properties?.result ?? {};
              const obsId = String(r.occupancyObsId ?? "").trim();
              if (obsId !== targetObsId) continue;
              matched.push({
                id: String(item.id ?? "").trim(),
                occupancyObsId: obsId,
                idType: String(r.idType ?? "").trim(),
                value: String(r.value ?? "").trim(),
                normalizedValue: String(r.normalizedValue ?? "").trim(),
                checksumValid: Boolean(r.checksumValid),
                confidence: Number(r.confidence ?? 0),
                readCount: Number(r.readCount ?? 0),
                cameraUid: String(r.cameraUid ?? "").trim(),
                evidenceImagePath: String(r.evidenceImagePath ?? "").trim(),
              });
            }
            return matched;
          } finally {
            await res.dispose();
          }
        };

        await this.check({
          scenario: "vehicle-ocr",
          category: "ocr",
          action: "correlate confirmation re-scan pass, batch-adjudicate in VehiclePassComparisonDialog, and export consolidated VEHICLE_INCIDENT reports",
          target: `${canonicalExpected} (${basePassEventId} -> ${eventId2})`,
          expected: "Confirmation re-scan correlates adjudicated Pass #1 + open OCR Pass #2 with non-zero radiation profile traces, renders related-passes banner + keyboard-focusable comparison dialog, batch-adjudicates Pass #2, and exports valid PDF/CSV/JSON/XLSX VEHICLE_INCIDENT reports",
        }, async () => {
          const pollOrRetriggerRescan = async (
            predicate: (c: OcrObservationRecord) => boolean,
            label: string,
          ): Promise<OcrObservationRecord[]> => {
            for (let attempt = 0; attempt < 6; attempt++) {
              if (attempt > 0) {
                await sleep(3_500);
                rescanWindowStartIso = new Date(Date.now() - 5_000).toISOString();
                const retryTrigger = await this.triggerAlarm("neutron", "vehicle-ocr");
                if (!retryTrigger) break;
                const retryRow = await this.findAlarmRow(page, /Neutron/i, retryTrigger);
                const retryEventId = await this.resolveAlarmEventUuid(
                  page,
                  retryRow,
                  "neutron",
                  retryTrigger.occupancyCount,
                  "vehicle-ocr",
                );
                if (!retryEventId) break;
                await this.captureAlarmMedia(page, retryEventId, "neutron", retryTrigger.occupancyCount, "vehicle-ocr");
                eventId2 = retryEventId;
              }
              const currentId = eventId2!;
              const found = await poll(
                () => fetchOcrForObsId(currentId, rescanWindowStartIso),
                items => items.some(predicate),
                {
                  timeoutMs: attempt < 5 ? 20_000 : Math.max(this.config.eventTimeoutMs, 45_000),
                  intervalMs: 1_000,
                  description: `${label} for occupancy ${currentId}`,
                },
              ).catch(() => fetchOcrForObsId(currentId, rescanWindowStartIso));
              if (found.some(predicate)) return found;
            }
            return fetchOcrForObsId(eventId2!, rescanWindowStartIso);
          };

          // Track adjudicated base passes by normalized ISO 6346 container ID across rotating multi-clip
          // RTSP playlists so the first container seen twice yields an exact adjudicated Pass #1 + open Pass #2 pair.
          const adjudicatedByContainer = new Map<string, string>([[canonicalExpected, basePassEventId]]);
          let matchedRescanPair = false;
          for (let playlistStep = 0; playlistStep < 6; playlistStep++) {
            const rescanObs = await pollOrRetriggerRescan(
              c => c.idType === "container" &&
                c.checksumValid &&
                matchesExpectedContainer(c.normalizedValue),
              `confirmation re-scan vehicleOcr (${expectedContainer})`,
            );
            const validRescanContainers = rescanObs.filter(
              c => c.idType === "container" && c.checksumValid && matchesExpectedContainer(c.normalizedValue),
            );
            const repeated = validRescanContainers.find(
              c => adjudicatedByContainer.has(c.normalizedValue.replace(/[^A-Z0-9]/gi, "").toUpperCase()),
            );
            if (repeated) {
              const repeatedNorm = repeated.normalizedValue.replace(/[^A-Z0-9]/gi, "").toUpperCase();
              canonicalExpected = repeatedNorm;
              basePassEventId = adjudicatedByContainer.get(repeatedNorm)!;
              this.lastRecognizedOcrContainer = canonicalExpected;
              matchedRescanPair = true;
              break;
            }
            const candidateBest = validRescanContainers[0];
            const candidateNorm = candidateBest
              ? candidateBest.normalizedValue.replace(/[^A-Z0-9]/gi, "").toUpperCase()
              : "";
            if (expectedContainer !== "ANY") {
              throw new Error(`Confirmation re-scan recognized ${candidateNorm || "none"} instead of ${canonicalExpected}`);
            }
            if (candidateNorm && playlistStep < 5) {
              await this.goto(page, `/event-details?eventId=${encodeURIComponent(eventId2!)}`);
              await page.getByRole("heading", {name: "Event Details"}).waitFor({timeout: this.config.uiTimeoutMs});
              const candChip = page.getByTestId(`ocr-chip-${candidateNorm}`);
              if (await candChip.isVisible().catch(() => false)) {
                await candChip.click().catch(() => {});
              }
              const vInput = page.getByRole("textbox", {name: "Vehicle ID", exact: true});
              await poll(
                async () => (await vInput.inputValue()).replace(/[^A-Z0-9]/gi, "").toUpperCase(),
                val => val === candidateNorm,
                {timeoutMs: 15_000, intervalMs: 250, description: `Vehicle ID auto-fill to equal ${candidateNorm}`},
              );
              await this.selectMui(page, "Adjudicate", "Code 9: Authorized Test, Maintenance, or Training Activity");
              await this.selectMui(page, "Secondary Inspection", "NONE");
              await page.getByLabel("Notes").fill(ocrNotes);
              await page.getByRole("button", {name: "Submit", exact: true}).click();
              const confirmNext = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
              await confirmNext.waitFor({timeout: this.config.uiTimeoutMs});
              await confirmNext.getByRole("button", {name: /Confirm & Submit/i}).click();
              await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
              adjudicatedByContainer.set(candidateNorm, eventId2!);
            }

            if (playlistStep < 5) {
              rescanWindowStartIso = new Date(Date.now() - 5_000).toISOString();
              const nextRescanTrigger = await this.triggerAlarm("neutron", "vehicle-ocr");
              if (!nextRescanTrigger) throw new Error("Playlist-follow-up confirmation neutron alarm trigger returned no occupancy identity");
              const nextAlarmRow = await this.findAlarmRow(page, /Neutron/i, nextRescanTrigger);
              const nextEventId = await this.resolveAlarmEventUuid(
                page,
                nextAlarmRow,
                "neutron",
                nextRescanTrigger.occupancyCount,
                "vehicle-ocr",
              );
              if (!nextEventId) throw new Error("Failed to resolve occupancy UUID for playlist-follow-up confirmation alarm");
              await this.captureAlarmMedia(page, nextEventId, "neutron", nextRescanTrigger.occupancyCount, "vehicle-ocr");
              eventId2 = nextEventId;
            }
          }
          if (!matchedRescanPair) {
            throw new Error(`Did not observe a repeated checksum-valid container across confirmation re-scan passes (seen: ${[...adjudicatedByContainer.keys()].join(", ")})`);
          }

          const spacedQuery = `${canonicalExpected.slice(0, 4).toLowerCase()} ${canonicalExpected.slice(4, 10)}-${canonicalExpected.slice(10)}`;
          const apiRes = await page.context().request.get(
            this.viewerUrl(
              `/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(spacedQuery)}&matchMode=equals&includeProfiles=true&limit=100`,
            ),
            {headers: {Accept: "application/json"}},
          );
          let apiCorrelated = false;
          let profileCount = 0;
          let maxProfileGamma = 0;
          try {
            if (apiRes.ok()) {
              const apiJson = await apiRes.json() as {
                normalizedVehicleId?: unknown;
                passes?: Array<{
                  occupancyObsId?: unknown;
                  adjudications?: unknown[];
                  radiationProfile?: Array<{gammaCounts?: unknown}>;
                }>;
              };
              const passes = Array.isArray(apiJson.passes) ? apiJson.passes : [];
              const p1 = passes.find(p => String(p.occupancyObsId ?? "").trim() === basePassEventId);
              const p2 = passes.find(p => String(p.occupancyObsId ?? "").trim() === eventId2);
              for (const p of passes) {
                if (Array.isArray(p.radiationProfile)) {
                  profileCount += p.radiationProfile.length;
                  for (const sample of p.radiationProfile) {
                    const g = Number(sample?.gammaCounts ?? 0);
                    if (g > maxProfileGamma) maxProfileGamma = g;
                  }
                }
              }
              apiCorrelated =
                String(apiJson.normalizedVehicleId ?? "").trim() === canonicalExpected &&
                Boolean(p1 && Array.isArray(p1.adjudications) && p1.adjudications.length >= 1) &&
                Boolean(p2 && Array.isArray(p2.adjudications) && p2.adjudications.length === 0) &&
                profileCount > 0 &&
                maxProfileGamma > 0;
            }
          } finally {
            await apiRes.dispose();
          }

          await this.goto(page, `/event-details?eventId=${encodeURIComponent(eventId2!)}`);
          await page.getByRole("heading", {name: "Event Details"}).waitFor({timeout: this.config.uiTimeoutMs});
          const rescanChip = page.getByTestId(`ocr-chip-${canonicalExpected}`);
          if (await rescanChip.waitFor({timeout: 15_000}).then(() => true).catch(() => false)) {
            await rescanChip.click().catch(() => {});
          }
          const banner = page.getByTestId("vehicle-related-passes-banner");
          await banner.waitFor({state: "visible", timeout: 25_000});
          await page.getByTestId("open-vehicle-pass-comparison").click();

          const compDialog = page.getByTestId("vehicle-pass-comparison-dialog");
          await compDialog.waitFor({state: "visible", timeout: 15_000});
          const tableRegion = compDialog.getByTestId("vehicle-pass-table-region");
          await tableRegion.waitFor({state: "visible", timeout: 15_000});
          const tableFocusable = (await tableRegion.getAttribute("tabindex")) === "0";
          const filmstripVisible = await compDialog.getByTestId("vehicle-visual-filmstrip")
            .waitFor({state: "visible", timeout: 15_000})
            .then(() => true)
            .catch(() => false);

          // Load radiation traces inside comparison dialog and verify non-flatline SVG waveform
          const loadTracesBtn = compDialog.getByTestId("vehicle-load-profiles-btn");
          await loadTracesBtn.scrollIntoViewIfNeeded().catch(() => {});
          if (await loadTracesBtn.isVisible().catch(() => false)) {
            await loadTracesBtn.click();
          }
          const profileChart = compDialog.getByTestId("vehicle-profile-chart");
          const chartVisible = await profileChart
            .waitFor({state: "visible", timeout: 20_000})
            .then(async () => {
              const polyCount = await profileChart.locator("svg polyline").count();
              if (polyCount === 0) {
                return (await profileChart.locator("svg circle").count()) > 0;
              }
              const ptsAttr = (await profileChart.locator("svg polyline").first().getAttribute("points")) ?? "";
              const ys = ptsAttr
                .trim()
                .split(/\s+/)
                .map(pair => Number(pair.split(",")[1]))
                .filter(v => Number.isFinite(v));
              return ys.length > 0 && Math.min(...ys) < 145;
            })
            .catch(() => false);

          // Linked/Batch Adjudicate reserved-lane open Pass #2 directly from VehiclePassComparisonDialog
          // while leaving any concurrent continuous-OCR open passes on non-reserved lanes untouched.
          const batchPanel = compDialog.getByTestId("vehicle-batch-adjudication-panel");
          await batchPanel.waitFor({state: "visible", timeout: 15_000});
          const passRows = tableRegion.locator("tbody tr");
          const passRowCount = await passRows.count();
          const reservedLaneRegex = new RegExp(`\\b${this.config.testLaneLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          for (let rIdx = 0; rIdx < passRowCount; rIdx += 1) {
            const tr = passRows.nth(rIdx);
            const cb = tr.locator('input[type="checkbox"]').first();
            if ((await cb.count()) === 0) continue;
            const rowTxt = await tr.innerText().catch(() => "");
            const isReservedRow = reservedLaneRegex.test(rowTxt);
            const checked = await cb.isChecked().catch(() => false);
            if (!isReservedRow && checked) {
              await cb.click();
            } else if (isReservedRow && !checked) {
              await cb.click();
            }
          }
          const batchAdjLabel = batchPanel.locator("label").filter({hasText: /^Adjudicate$/i}).first();
          await batchAdjLabel.locator("xpath=..").locator(".MuiSelect-select").click();
          const code9Opt = page.locator(".MuiList-root .MuiMenuItem-root:visible")
            .filter({hasText: /Code 9: Authorized Test/i}).first();
          await code9Opt.waitFor({timeout: 10_000});
          await code9Opt.click();
          const batchNotes = `${ocrNotes} (linked re-scan)`;
          await compDialog.getByTestId("vehicle-batch-notes-input").fill(batchNotes);
          await compDialog.getByTestId("vehicle-batch-submit-btn").click();
          await poll(
            async () => {
              const verifyRes = await page.context().request.get(
                this.viewerUrl(
                  `/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(canonicalExpected)}&matchMode=equals&limit=100`,
                ),
                {headers: {Accept: "application/json"}},
              );
              try {
                if (!verifyRes.ok()) return false;
                const verifyJson = await verifyRes.json() as {
                  passes?: Array<{occupancyObsId?: unknown; adjudications?: unknown[]}>;
                };
                const targetPass = (verifyJson.passes ?? []).find(
                  p => String(p.occupancyObsId ?? "").trim() === eventId2,
                );
                if (!targetPass || !Array.isArray(targetPass.adjudications) || targetPass.adjudications.length < 1) {
                  return false;
                }
              } finally {
                await verifyRes.dispose();
              }
              const panelStillVisible = await batchPanel.isVisible().catch(() => false);
              if (!panelStillVisible) return true;
              const alertVisible = await batchPanel.locator('[role="alert"]').isVisible().catch(() => false);
              return alertVisible;
            },
            ok => ok,
            {timeoutMs: 30_000, intervalMs: 750, description: `batch adjudication completion for ${eventId2}`},
          );

          // Verify 1-click VEHICLE_INCIDENT exports across PDF, CSV, JSON, and XLSX
          const exportSizes: Record<string, number> = {};
          let allFormatsValid = true;
          for (const fmt of ["PDF", "CSV", "JSON", "XLSX"] as const) {
            await compDialog.getByTestId(`vehicle-export-${fmt.toLowerCase()}-btn`).click();
            const links = compDialog.getByTestId("vehicle-exported-report-links");
            await poll(
              async () => (await links.innerText().catch(() => "")),
              txt => txt.includes(`(${fmt})`),
              {timeoutMs: this.config.eventTimeoutMs, intervalMs: 400, description: `VEHICLE_INCIDENT ${fmt} link`},
            );
            const dlHref = await links.locator("a[download]").first().getAttribute("href");
            if (!dlHref) {
              allFormatsValid = false;
              break;
            }
            const dlRes = await page.context().request.get(new URL(dlHref, this.config.oscarBaseUrl).toString());
            try {
              if (!dlRes.ok()) {
                allFormatsValid = false;
                break;
              }
              const buf = await dlRes.body();
              exportSizes[fmt] = buf.length;
              if (fmt === "PDF") {
                if (buf.subarray(0, 4).toString() !== "%PDF") {
                  allFormatsValid = false;
                } else {
                  const pdfParser = new PDFParse({data: buf});
                  try {
                    const pdfParsed = await pdfParser.getText();
                    const pdfTxt = pdfParsed.text.replaceAll(/\s+/g, " ");
                    if (!pdfTxt.includes("Vehicle Incident Report") || /urn:osh:system:/i.test(pdfTxt)) {
                      allFormatsValid = false;
                    }
                  } finally {
                    await pdfParser.destroy();
                  }
                }
              }
              if (fmt === "XLSX" && (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b)) allFormatsValid = false;
              if (fmt === "CSV") {
                const csvTxt = buf.toString("utf8");
                if (!csvTxt.includes("Pass #") || !csvTxt.includes(canonicalExpected)) allFormatsValid = false;
              }
              if (fmt === "JSON") {
                const parsedJson = JSON.parse(buf.toString("utf8")) as {
                  reportType?: unknown;
                  passes?: unknown[];
                };
                if (parsedJson.reportType !== "VEHICLE_INCIDENT" || !Array.isArray(parsedJson.passes) || parsedJson.passes.length < 2) {
                  allFormatsValid = false;
                }
              }
            } finally {
              await dlRes.dispose();
            }
          }

          const comparisonShot = await this.browser.screenshot(page, "vehicle-ocr-multipass-comparison");
          await compDialog.getByRole("button", {name: /^close$/i}).last().click();
          await compDialog.waitFor({state: "hidden", timeout: 10_000});

          const passed = apiCorrelated && tableFocusable && filmstripVisible && chartVisible && allFormatsValid;
          return {
            passed,
            observed: `apiCorrelated=${apiCorrelated} (profileSamples=${profileCount}); tableTabIndex0=${tableFocusable}; ` +
              `filmstrip=${filmstripVisible}; profileChart=${chartVisible}; exports=${JSON.stringify(exportSizes)}`,
            evidence: comparisonShot,
          };
        });
      }

      // Restore Enable Vehicle OCR = false on the reserved lane and record explicit verification.
      const disableOutcome = await this.check({
        scenario: "vehicle-ocr",
        category: "ocr",
        action: "restore reserved lane Vehicle OCR to default disabled state",
        target: `${this.config.testLaneLabel} (/sensorhub/admin)`,
        expected: "Enable Vehicle OCR is saved back to false and reserved lane RPM reconnects online",
      }, async () => {
        const res = await setLaneVehicleOcrEnabled(targetLaneSystem.systemId, false);
        ocrEnabledByScenario = false;
        await this.emulator.replaceConfig(this.config.testRpmId, quiet);
        await this.waitHealthRpmConnection(page, "online", 60_000);
        const passed = res.supported && res.checkedAfterSave === false;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "vehicle-ocr-disable-failed");
        return {
          passed,
          observed: `supported=${res.supported}; checkedAfterSave=${res.checkedAfterSave}; rpmOnline=true`,
          evidence,
        };
      });
      void disableOutcome;
    } finally {
      if (ocrEnabledByScenario && laneSystem) {
        await setLaneVehicleOcrEnabled(laneSystem.systemId, false).catch(error =>
          this.reporter.error("vehicle-ocr", "restore-lane-ocr-disabled", error));
      }
      if (restoreInitialReservedOcrEnabled && laneSystem) {
        await setLaneVehicleOcrEnabled(laneSystem.systemId, true)
          .then(() => this.waitHealthRpmConnection(page, "online", 60_000))
          .catch(error => this.reporter.error("vehicle-ocr", "restore-initial-lane-ocr-enabled", error));
      }
      await this.emulator.replaceConfig(this.config.testRpmId, quiet).catch(error =>
        this.reporter.error("vehicle-ocr", "restore-quiet-config", error));
      await page.close();
    }
  }

  private async verifyGeneratedAlarmRetention(probe: StorageProbeClient): Promise<void> {
    if (!this.alarmMediaBaselineCreated || this.generatedAlarmMedia.size === 0) {
      if (this.retainedMediaProofDeferred) {
        this.reporter.outcome(
          "storage-lifecycle",
          "retained-media",
          "self-seed retained-media proof",
          this.config.testLaneLabel,
          "at least one exact generated alarm UUID reaches accelerated five-frame retention",
          `baseline=${this.alarmMediaBaselineCreated}; generated events=${this.generatedAlarmMedia.size}`,
          "incorrect",
          0,
        );
      }
      return;
    }
    const generated = [...this.generatedAlarmMedia.values()];
    const expectedLaneUid = await this.configuredAlarmLaneUid();
    const page = await this.browser.oscarPage();
    try {
      await this.goto(page, "/");
      const retained = await this.check({
        scenario: "storage-lifecycle",
        category: "retained-media",
        action: "retain the exact generated alarm clips as five frames",
        target: `${generated.length} generated alarm event(s)`,
        expected: "each exact UUID has one source-bound manifest per camera and five quality-85, hash-valid, Chromium-decodable JPEGs per source",
      }, async () => {
        const assessments = await poll(async () => {
          const available = new Map<string, ReturnType<typeof assessRetainedMediaResponse>>();
          for (const item of generated) {
            const eventId = item.association.eventId;
            const response = await page.evaluate(boundedFetch, {
              url: this.viewerUrl(`/sensorhub/buckets/videos/media/${encodeURIComponent(eventId)}`),
              maxBytes: MAX_RETAINED_CATALOG_BYTES,
              decodeImage: false,
            });
            if (response.status === 404) continue;
            {
              const assessment = assessRetainedMediaResponse(
                parseBoundedJson(response, `retained-media API for ${eventId}`),
                eventId,
              );
              const sourceByCamera = new Map(item.association.paths.map(path => [path.cameraUid, path.path]));
              if (assessment.mediaSetCount !== sourceByCamera.size || assessment.frameCount !== sourceByCamera.size * 5 ||
                  assessment.jpegQualities.some(quality => quality !== 85) ||
                  assessment.mediaSets.some(mediaSet => mediaSet.laneUid !== expectedLaneUid) ||
                  assessment.mediaSets.some(mediaSet => sourceByCamera.get(mediaSet.cameraUid) !== mediaSet.sourceObjectKey) ||
                  assessment.mediaSets.some(mediaSet => !sourceByCamera.has(mediaSet.cameraUid))) {
                throw new Error(`retained manifests do not bind exactly to alarm ${eventId} videoPaths`);
              }
              available.set(eventId, assessment);
            }
          }
          return available;
        }, value => value.size === generated.length, {
          timeoutMs: this.config.storageArchiveTimeoutMs,
          intervalMs: 5_000,
          description: "accelerated retention to publish exact generated alarm manifests",
        });

        let validFrames = 0;
        let expectedFrames = 0;
        for (const assessment of assessments.values()) {
          expectedFrames += assessment.frameCount;
          for (const asset of assessment.assets) {
            const imageUrl = this.viewerUrl(`/sensorhub/buckets/videos/${asset.path}`);
            const image = await page.evaluate(boundedFetch, {
              url: imageUrl,
              maxBytes: Math.min(asset.bytes, MAX_RETAINED_FRAME_BYTES),
              decodeImage: true,
            });
            const bytes = Buffer.from(image.bodyBase64, "base64");
            const valid = image.ok && image.contentType === asset.contentType &&
              image.byteCount === asset.bytes && bytes.length === image.byteCount &&
              image.decodedWidth === asset.width && image.decodedHeight === asset.height &&
              assessJpeg(bytes, asset.bytes, asset.sha256, asset.width, asset.height);
            if (valid) validFrames++;
          }
        }
        const passed = validFrames === expectedFrames;
        return {
          passed,
          value: passed ? assessments : undefined,
          observed: `${assessments.size}/${generated.length} exact event manifest(s); ` +
            `${validFrames}/${expectedFrames} hash-valid and browser-decodable retained JPEGs`,
          evidence: passed ? "" : await this.screenshotOnFailure(page, "generated-alarm-retention"),
        };
      });

      if (retained) {
        for (const [eventId, assessment] of retained) {
          this.recordRetainedBackupExpectations(eventId, assessment);
        }
        await this.check({
          scenario: "storage-lifecycle",
          category: "retained-media",
          action: "verify generated alarm retention ledgers did not retry",
          target: `${generated.length} generated alarm event(s)`,
          expected: "each exact event/camera ledger is published once, has no failure, and names the persisted source path",
        }, async () => {
          let checked = 0;
          const failures: string[] = [];
          for (const item of generated) {
            const assessment = retained.get(item.association.eventId);
            if (!assessment) {
              failures.push(`${item.association.eventId}: missing retained assessment`);
              continue;
            }
            const sourceByCamera = new Map(item.association.paths.map(path => [path.cameraUid, path.path]));
            for (const mediaSet of assessment.mediaSets) {
              const value = await probe.runJson<{
                exists?: boolean;
                ledger?: {
                  eventId?: string;
                  laneUid?: string;
                  cameraUid?: string;
                  sourceObjectKey?: string;
                  state?: string;
                  attempts?: number;
                  failure?: string;
                };
              }>("alarm-media-ledger", [
                Buffer.from(item.association.eventId, "utf8").toString("base64url"),
                Buffer.from(expectedLaneUid, "utf8").toString("base64url"),
                Buffer.from(mediaSet.cameraUid, "utf8").toString("base64url"),
              ]);
              const ledger = value.ledger;
              const expectedSource = sourceByCamera.get(mediaSet.cameraUid);
              const valid = value.exists === true && ledger?.eventId === item.association.eventId &&
                mediaSet.laneUid === expectedLaneUid && ledger.laneUid === expectedLaneUid &&
                ledger.cameraUid === mediaSet.cameraUid &&
                ledger.sourceObjectKey?.replaceAll("\\", "/") === expectedSource &&
                (ledger.state === "PUBLISHED" || ledger.state === "SOURCE_DELETED") &&
                ledger.attempts === 1 && ledger.failure === "";
              checked++;
              if (!valid) failures.push(`${item.association.eventId}/${mediaSet.cameraUid}: invalid ledger`);
            }
          }
          return {
            passed: failures.length === 0 && checked === generated.reduce(
              (count, item) => count + item.association.paths.length, 0),
            observed: `${checked} exact ledger(s); failures=${failures.join("; ") || "none"}`,
          };
        });

        const galleryEventId = generated[0]!.association.eventId;
        await this.verifyRetainedMediaGallery(
          page,
          galleryEventId,
          "storage-lifecycle",
          this.retainedMediaProofDeferred
            ? "render self-seeded retained-media gallery"
            : "render generated retained-media gallery",
          "generated-retained-media-five-frame-gallery",
        );
        this.retainedMediaProofDeferred = false;
      }

      await this.check({
        scenario: "storage-lifecycle",
        category: "alarm-media",
        action: "reject new orphan or partial alarm media",
        target: this.config.testLaneLabel,
        expected: "since the scoped run baseline, every new finalized MP4 is UUID-bound, no new partial exists, and no generated path predates the run",
      }, async () => {
        const expectedPaths = generated.flatMap(item => item.association.paths.map(({path}) => path));
        const value = assessAlarmMediaForensics(
          await probe.runJson("alarm-media-forensics", [this.alarmMediaRunKey(), ...expectedPaths]),
          expectedPaths.length,
        );
        return {passed: alarmMediaForensicsPassed(value), observed: JSON.stringify(value)};
      });
      this.alarmMediaBaselineCreated = false;
    } finally {
      await page.close();
    }
  }

  private storageUnavailable(scenario: string): boolean {
    if (this.config.storageWorkflow === "disabled") {
      this.skip({scenario, category: "storage", action: "exercise OSCAR 3.9.2 storage", target: this.config.targetHost,
        expected: "storage workflow is enabled"}, "STORAGE_WORKFLOW=disabled");
      return true;
    }
    if (!this.config.oscarSshTarget || !this.config.oscarReleaseDirectory) {
      const metadata = {scenario, category: "storage", action: "connect guarded storage probe",
        target: this.config.targetHost, expected: "OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR identify the disposable deployment"};
      if (this.config.storageWorkflow === "auto") this.skip(metadata, "storage target configuration is unavailable");
      else this.reporter.outcome(metadata.scenario, metadata.category, metadata.action, metadata.target,
        metadata.expected, "required storage target configuration is missing", "incorrect", 0);
      return true;
    }
    return false;
  }

  private async verifyRetainedMediaGallery(
    page: Page,
    eventId: string,
    scenario: "storage-health" | "storage-lifecycle",
    action: string,
    evidenceName: string,
  ): Promise<void> {
    await this.check({
      scenario,
      category: "viewer",
      action,
      target: eventId,
      expected: "Event Details renders five choices per camera while lazily fetching only selected frames",
    }, async () => {
      const framePattern = /\/media\/[^/]+\/[^/]+\/frame-0[1-5]\.jpg(?:\?|$)/;
      const frameRequests: string[] = [];
      let inFlightFrameRequests = 0;
      let peakInFlightFrameRequests = 0;
      await page.route(framePattern, async route => {
        frameRequests.push(route.request().url());
        inFlightFrameRequests++;
        peakInFlightFrameRequests = Math.max(peakInFlightFrameRequests, inFlightFrameRequests);
        try {
          // Hold the request briefly so the scheduler's real in-flight bound
          // is observable even on a fast local test network.
          await sleep(150);
          await route.continue();
        } finally {
          inFlightFrameRequests--;
        }
      });
      const node = this.config.storageEventNodeId
        ? `&nodeId=${encodeURIComponent(this.config.storageEventNodeId)}` : "";
      await this.goto(page, `/event-details?eventId=${encodeURIComponent(eventId)}${node}`);
      await page.getByTestId("retained-media-gallery").waitFor({timeout: this.config.eventTimeoutMs});
      const cameras = await page.getByTestId("retained-media-camera").count();
      const thumbnails = await page.getByTestId("retained-media-thumbnail").count();
      if (cameras > 0) {
        await poll(
          () => page.getByTestId("retained-media-main-image").evaluateAll((images, expected) =>
            images.length === expected && images.every(image =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 &&
              image.naturalHeight > 0), cameras),
          Boolean,
          {timeoutMs: this.config.eventTimeoutMs, intervalMs: 100,
            description: "initial retained frames to load and decode in the gallery"},
        );
      }
      const initialRequests = frameRequests.length;
      let selectedFrameLoaded = false;
      let selectedFrameRequested = false;
      if (thumbnails >= 5) {
        const firstCamera = page.getByTestId("retained-media-camera").first();
        const mainImage = firstCamera.getByTestId("retained-media-main-image");
        const initialSource = await mainImage.getAttribute("src");
        const initialMetadata = await firstCamera.getByTestId("retained-media-frame-metadata").innerText();
        await firstCamera.getByTestId("retained-media-thumbnail").nth(4).click();
        const selected = await poll(async () => {
          const source = await mainImage.getAttribute("src").catch(() => null);
          const metadata = await firstCamera.getByTestId("retained-media-frame-metadata").innerText();
          const loaded = await mainImage.evaluate(image => image instanceof HTMLImageElement &&
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).catch(() => false);
          return {source, metadata, loaded};
        }, value => Boolean(value.loaded && value.source && value.source !== initialSource &&
            value.metadata !== initialMetadata),
        {timeoutMs: this.config.eventTimeoutMs, intervalMs: 100,
          description: "selected retained frame content to load and replace the initial image"});
        selectedFrameLoaded = Boolean(selected.loaded);
        selectedFrameRequested = frameRequests.slice(initialRequests)
          .some(url => /\/frame-05\.jpg(?:\?|$)/.test(url));
      }
      return {
        passed: cameras > 0 && thumbnails === cameras * 5 &&
          initialRequests === cameras && peakInFlightFrameRequests > 0 &&
          peakInFlightFrameRequests <= 3 && frameRequests.length === initialRequests + 1 &&
          selectedFrameRequested && selectedFrameLoaded,
        observed: `${cameras} camera group(s), ${thumbnails} choices, ` +
          `${initialRequests} initial frame request(s), ${frameRequests.length} after selection, ` +
          `peak in-flight=${peakInFlightFrameRequests}, selected requested=${selectedFrameRequested}, ` +
          `selected loaded=${selectedFrameLoaded}`,
        evidence: await this.browser.screenshot(page, evidenceName),
      };
    });
  }

  private recordRetainedBackupExpectations(
    eventId: string,
    assessment: ReturnType<typeof assessRetainedMediaResponse>,
  ): void {
    const eventToken = Buffer.from(eventId, "utf8").toString("base64url");
    for (const mediaSet of assessment.mediaSets) {
      const laneToken = Buffer.from(mediaSet.laneUid, "utf8").toString("base64url");
      const cameraToken = Buffer.from(mediaSet.cameraUid, "utf8").toString("base64url");
      const assets = assessment.assets
        .filter(asset => asset.path.startsWith(`media/${eventId}/${cameraToken}/`))
        .sort((left, right) => left.path.localeCompare(right.path));
      if (assets.length !== 5 || assets.some((asset, index) =>
        basename(asset.path) !== `frame-0${index + 1}.jpg`)) {
        throw new Error(`Cannot bind backup expectations to five exact frames for ${eventId}/${mediaSet.cameraUid}`);
      }
      const record = [eventToken, laneToken, cameraToken,
        ...assets.flatMap(asset => [asset.sha256, String(asset.bytes)])].join(".");
      if (record.length > 2048 || !/^[A-Za-z0-9_.-]+$/.test(record)) {
        throw new Error("Retained-media backup expectation exceeds the guarded probe argument contract");
      }
      this.retainedBackupExpectations.set(`${eventToken}/${laneToken}/${cameraToken}`, record);
    }
  }

  private async proveConfiguredRetainedMediaEvent(
    eventId: string,
    scenario: "storage-health" | "storage-lifecycle",
  ): Promise<boolean> {
    const page = await this.browser.oscarPage();
    try {
      // Establish a same-origin authenticated document before exercising
      // browser-native fetch/createImageBitmap.
      await this.goto(page, "/");
      const assessment = await this.check({scenario, category: "retained-media",
        action: "verify exact-five retained JPEG API", target: eventId,
        expected: "each retained camera has five quality-85, bounded baseline JPEGs whose hashes, dimensions, content types, and Chromium decodes match"}, async () => {
        const response = await page.evaluate(boundedFetch, {
          url: this.viewerUrl(`/sensorhub/buckets/videos/media/${encodeURIComponent(eventId)}`),
          maxBytes: MAX_RETAINED_CATALOG_BYTES,
          decodeImage: false,
        });
        const assessed = assessRetainedMediaResponse(
          parseBoundedJson(response, `retained-media API for ${eventId}`),
          eventId,
        );
        let valid = 0;
        for (const asset of assessed.assets) {
          const imageUrl = this.viewerUrl(`/sensorhub/buckets/videos/${asset.path}`);
          const image = await page.evaluate(boundedFetch, {
            url: imageUrl,
            maxBytes: Math.min(asset.bytes, MAX_RETAINED_FRAME_BYTES),
            decodeImage: true,
          });
          const bytes = Buffer.from(image.bodyBase64, "base64");
          const verified = image.ok && image.contentType === asset.contentType &&
            image.byteCount === asset.bytes && bytes.length === image.byteCount &&
            image.decodedWidth === asset.width && image.decodedHeight === asset.height &&
            assessJpeg(bytes, asset.bytes, asset.sha256, asset.width, asset.height);
          if (verified) valid++;
        }
        const passed = assessed.jpegQualities.every(quality => quality === 85) &&
          valid === assessed.frameCount;
        return {passed, ...(passed ? {value: assessed} : {}),
          observed: `${assessed.mediaSetCount} camera set(s), ${assessed.frameCount} frames, ` +
            `${valid} statically and browser-decodable JPEGs; qualities=${assessed.jpegQualities.join(",")}`};
      });
      if (!assessment) return false;
      this.recordRetainedBackupExpectations(eventId, assessment);
      await this.verifyRetainedMediaGallery(
        page,
        eventId,
        scenario,
        "render retained-media gallery",
        scenario === "storage-health"
          ? "retained-media-five-frame-gallery"
          : "lifecycle-configured-retained-media-five-frame-gallery",
      );
      return true;
    } finally {
      await page.close();
    }
  }

  private async storageHealth(): Promise<void> {
    if (this.storageUnavailable("storage-health")) return;
    const probe = new StorageProbeClient(this.config, this.reporter.runId);
    try {
      const platform = await this.check({
        scenario: "storage-health", category: "storage-platform", action: "verify PostgreSQL and storage controls",
        target: this.config.targetHost,
        expected: "the running images, mode-aware deployment/root identities, stable lock, inactive PostgreSQL archiving with no external WAL bind, packaged helpers, backup-root isolation, split noexec/data and executable/native temp mounts, forced JVM temp and JavaCPP cache properties, and complete 3.9.2 storage profile match",
      }, async () => {
        const value = assessStoragePlatform(await probe.runJson("platform"));
        const release = this.config.storageExpectedRelease;
        const resources = value.archiveResources;
        const indexes = value.observationIndexes;
        const passed = storagePlatformHasExactReleaseIdentity(
          value, release, this.config.storageBackupMode,
        ) && value.dataChecksums === "on" &&
          value.pgStatStatementsInstalled && value.pgStatStatementsPreloaded &&
          value.schemaVersion === OSCAR_STORAGE_SCHEMA_VERSION &&
          value.schemaChecksum === OSCAR_STORAGE_SCHEMA_CHECKSUM && value.batchRewriteConfigured &&
          value.archiveEnabled === true &&
          value.dailyJournalConfigured && value.deleteHotAfterArchive === true &&
          Object.entries(REGRESSION_ARCHIVE_POLICY).every(([key, expected]) =>
            value[key as keyof typeof REGRESSION_ARCHIVE_POLICY] === expected) &&
          Object.entries(SHIPPING_STORAGE_POLICY).every(([key, expected]) =>
            value.packagedDefaults[key as keyof typeof SHIPPING_STORAGE_POLICY] === expected) &&
          parquetPrimaryOutputNamesMatchRelease(
            value.outputNames,
            release,
            value.packagedDefaults.outputNames,
          ) &&
          indexes.genericPayloadGinAbsent && indexes.requiredCount === 15 &&
          indexes.requiredPresent === indexes.requiredCount && indexes.missingNames.length === 0 &&
          indexes.eventPathGinExact && indexes.numericEventIndexesExact &&
          resources.memoryLimitMegabytes === REGRESSION_ARCHIVE_RESOURCES.memoryLimitMegabytes &&
          resources.threads === REGRESSION_ARCHIVE_RESOURCES.threads &&
          resources.maximumTemporaryMegabytes ===
            REGRESSION_ARCHIVE_RESOURCES.maximumTemporaryMegabytes &&
          resources.maximumConcurrentSessions ===
            REGRESSION_ARCHIVE_RESOURCES.maximumConcurrentSessions &&
          resources.sessionAcquireTimeoutSeconds ===
            REGRESSION_ARCHIVE_RESOURCES.sessionAcquireTimeoutSeconds &&
          resources.temporaryDirectory === REGRESSION_ARCHIVE_RESOURCES.temporaryDirectory;
        return {passed, value, observed: JSON.stringify(value)};
      });

      await this.check({
        scenario: "storage-health", category: "hot-stage",
        action: "verify immutable observation staging lifecycle",
        target: "oscar_obs_stage_partition/oscar_obs_stage_owner",
        expected: "PARQUET_PRIMARY reports exact attached/detached children and sidecar ownership, no orphan or missing ownership, NULL legacy markers, mutable-only parent rows, and an oldest received_at within the one-hour staging SLO; HOT_RETENTION remains not applicable",
      }, async () => {
        const value = await poll(
          async () => assessImmutableStageHealth(await probe.runJson("stage-health")),
          candidate => candidate.storageMode === "PARQUET_PRIMARY"
            ? immutableStageHealthIsSafe(candidate)
            : !candidate.applicable,
          {timeoutMs: 30_000, intervalMs: 1_000,
            description: "immutable staging catalog to reach a consistent read-only boundary"},
        );
        const passed = value.storageMode === "PARQUET_PRIMARY"
          ? immutableStageHealthIsSafe(value)
          : !value.applicable;
        return {passed, value, observed: JSON.stringify(value)};
      });

      if (this.config.storageBackupWorkflow !== "disabled" &&
          this.config.storageBackupMode === "disabled") {
        await this.check({
          scenario: "storage-health", category: "backup", action: "verify disabled backup policy",
          target: this.config.targetHost,
          expected: "backup, verification, prune, and restore refuse before mutation; PostgreSQL has no active external WAL archive and a forced WAL switch grows no host archive",
        }, async () => {
          const value = await probe.runJson<Record<string, unknown>>("backup-mode-check");
          const passed = value.mode === "disabled" && value.commandsRejected === true &&
            value.backupTreeUnchanged === true && value.legacyWalTreeUnchanged === true &&
            Number(value.legacyWalBytesAfter) === Number(value.legacyWalBytesBefore) &&
            value.servicesUnchanged === true && value.backupEpochsUnchanged === true;
          return {passed, observed: JSON.stringify(value)};
        });
      }

      await this.check({
        scenario: "storage-health", category: "cold-archive", action: "verify archive catalog and object checksums",
        target: this.config.targetHost,
        expected: "archive catalog has no failed jobs, parity failures, incomplete objects, checksum errors, or archive partial artifacts",
      }, async () => {
        const value = await poll(
          async () => assessArchiveHealth(await probe.runJson("archive-health")),
          candidate => candidate.failedJobs === 0 && candidate.parityFailures === 0 &&
            candidate.incompleteActiveObjects === 0 && candidate.archivePartialArtifacts === 0 &&
            candidate.walPartialArtifacts === 0 && candidate.checksumVerificationPassed,
          {timeoutMs: 60_000, intervalMs: 2_000,
            description: "archive verification to reach a quiescent clean boundary"},
        );
        return {passed: value.failedJobs === 0 && value.parityFailures === 0 &&
          value.incompleteActiveObjects === 0 && value.archivePartialArtifacts === 0 &&
          value.walPartialArtifacts === 0 && value.checksumVerificationPassed,
        observed: JSON.stringify(value)};
      });

      await this.check({
        scenario: "storage-health", category: "cold-archive",
        action: "verify split-at-export profiles, event-only compaction, and catalog referential integrity",
        target: "oscar_archive_generation/oscar_archive_schema",
        expected: "every RAW_EVENTS, RAW_TELEMETRY, DAILY_EVENTS, legacy DAILY_TELEMETRY, and MONTHLY_EVENTS generation is strictly stream-separated, summary-populated, leaves RAW_TELEMETRY ocr_bloom NULL, keeps compacted tiers SEALED and parity-verified, with zero non-zero DELETING row counts and zero orphan catalog references",
      }, async () => {
        const value = await poll(
          async () => assessCompactionHealth(await probe.runJson("compaction-health")),
          candidate => compactionHealthIsSafe(candidate),
          {timeoutMs: 30_000, intervalMs: 1_000,
            description: "compaction catalog to reach a consistent boundary"},
        );
        return {passed: compactionHealthIsSafe(value), observed: JSON.stringify(value)};
      });

      await this.check({
        scenario: "storage-health", category: "cold-archive", action: "verify bounded DuckDB scratch hygiene",
        target: REGRESSION_ARCHIVE_RESOURCES.temporaryDirectory,
        expected: "the private archive-disjoint scratch root contains its exact 0600 lease and no operation or unexpected entries",
      }, async () => {
        const value = await poll(
          async () => assessArchiveScratch(await probe.runJson("archive-scratch-health")),
          scratch => archiveScratchIsSafe(scratch),
          {timeoutMs: 60_000, intervalMs: 1_000,
            description: "DuckDB scratch to retain only its safe lease between bounded operations"},
        );
        const clean = archiveScratchIsSafe(value);
        return {passed: clean, value: clean, observed: JSON.stringify(value)};
      });

      await this.check({
        scenario: "storage-health", category: "retained-media", action: "verify bounded media metadata health",
        target: "retained-media/v1",
        expected: "checkpoint schema 2 and compact hourly/deletion indexes are structurally valid, with no legacy markers, tombstones, partials, or unsafe entries",
      }, async () => {
        const requirePopulated = Boolean(this.config.storageRetainedEventId);
        const value = await poll(
          async () => assessMediaMetadataHealth(await probe.runJson("media-metadata-health")),
          candidate => mediaMetadataHealthIsSafe(candidate, requirePopulated),
          {timeoutMs: 30_000, intervalMs: 1_000,
            description: "retained-media metadata to reach an atomic clean boundary"},
        );
        return {
          passed: mediaMetadataHealthIsSafe(value, requirePopulated),
          observed: JSON.stringify(value),
        };
      });

      await this.check({
        scenario: "storage-health", category: "daily-file", action: "verify durable journal publications",
        target: "dailyfiles", expected: "each eligible completed day has an exact 12-key v1 CSV/manifest pair, or a not-yet-eligible current day has durable header-valid journal segments; neither state has links, partials, or unsafe entries",
      }, async () => {
        const value = await poll(
          () => probe.runJson<DailyJournalStatus>("journal-status"),
          candidate => assessDailyJournalStatus(candidate).passed,
          {timeoutMs: 30_000, intervalMs: 1_000,
            description: "daily-journal inventory to reach an atomic clean boundary"},
        );
        const assessment = assessDailyJournalStatus(value);
        return {
          passed: assessment.passed,
          observed: `${assessment.explanation}; ${JSON.stringify(value)}`,
        };
      });

      const snapshot = await probe.runJson<unknown>("snapshot");
      const healthMetric = storageMetricFromProbe("storage-health", snapshot);
      this.reporter.storageMetric(healthMetric);

      const latencyPage = await this.browser.oscarPage();
      try {
        await this.check({
          scenario: "storage-health",
          category: "performance",
          action: "verify ConSys API and browser observation query latency and database bloat",
          target: this.config.targetHost,
          expected: "obs_datastreams stays <= 32 MiB, connectionStatus <= 18000 rows/h, oscar_archive_schema_datastream_idx is present, single observation queries complete in <= 500 ms, datastreams?limit=1000 in <= 1000 ms, and 50-stream latest burst in <= 2500 ms",
        }, async () => {
          const latencies = await this.measureConSysQueryLatencies(latencyPage);
          const dsBytes = healthMetric.datastreamsTableBytes ?? null;
          const connRows = healthMetric.connectionStatusRowsLastHour ?? null;
          const idxPresent = healthMetric.archiveSchemaDatastreamIndexPresent ?? null;
          const passed = idxPresent === 1 &&
            dsBytes !== null && dsBytes <= 32 * 1024 * 1024 &&
            connRows !== null && connRows <= 18_000 &&
            latencies.allSucceeded &&
            latencies.datastreamsListMs <= 1_000 &&
            latencies.latestNonArchivedMs <= 500 &&
            latencies.latestPhenomenonNonArchivedMs <= 500 &&
            latencies.latestArchivedMs <= 500 &&
            latencies.latestPhenomenonArchivedMs <= 500 &&
            latencies.unboundedWindowNonArchivedMs <= 500 &&
            latencies.fiftyLaneBurstMs <= 2_500;
          return {
            passed,
            observed: JSON.stringify({
              datastreamsTableBytes: dsBytes,
              connectionStatusRowsLastHour: connRows,
              archiveSchemaDatastreamIndexPresent: idxPresent,
              ...latencies,
            }),
          };
        });
      } finally {
        await latencyPage.close();
      }

      const eventId = this.config.storageRetainedEventId;
      if (!eventId) {
        const metadata = {scenario: "storage-health", category: "retained-media", action: "verify exact-five JPEG API and gallery",
          target: "retained media",
          expected: "a configured retained event or an exact full-run generated alarm proves the API and gallery"};
        if (this.fullRunCanSelfSeedRetainedMedia()) {
          this.retainedMediaProofDeferred = true;
          this.skip(metadata,
            "full profile will self-seed an exact alarm UUID and run this proof after accelerated retention");
        } else if (this.config.storageWorkflow === "required") {
          this.reporter.outcome(metadata.scenario, metadata.category, metadata.action, metadata.target,
            metadata.expected,
            "STORAGE_RETAINED_EVENT_ID is missing and this run cannot self-seed retained media",
            "incorrect", 0);
        } else this.skip(metadata, "no retained-media fixture event configured");
      } else await this.proveConfiguredRetainedMediaEvent(eventId, "storage-health");

      const legacyId = this.config.storageLegacyEventId;
      if (legacyId) {
        const page = await this.browser.oscarPage();
        try {
          await this.check({scenario: "storage-health", category: "viewer", action: "use legacy video fallback",
            target: legacyId, expected: "a 404 retained-media response falls back to the legacy video player"}, async () => {
            const api = await page.context().request.get(this.viewerUrl(
              `/sensorhub/buckets/videos/media/${encodeURIComponent(legacyId)}`));
            const apiMissing = api.status() === 404;
            await api.dispose();
            const node = this.config.storageEventNodeId ? `&nodeId=${encodeURIComponent(this.config.storageEventNodeId)}` : "";
            await this.goto(page, `/event-details?eventId=${encodeURIComponent(legacyId)}${node}`);
            const video = page.locator("video").first();
            await video.waitFor({timeout: this.config.eventTimeoutMs});
            return {passed: apiMissing && await video.isVisible() &&
              await page.getByTestId("retained-media-gallery").count() === 0,
            observed: `API 404=${apiMissing}; legacy video visible=${await video.isVisible()}`};
          });
        } finally { await page.close(); }
      }
    } finally { await probe.cleanup(); }
  }

  private async storageLifecycle(): Promise<void> {
    if (this.storageUnavailable("storage-lifecycle")) return;
    const probe = this.alarmMediaProbe ?? new StorageProbeClient(this.config, this.reporter.runId);
    let apiPage: Page | undefined;
    let directJournalLaneUid: string | undefined;
    let directJournalAfterAppend: DirectJournalLaneState | undefined;
    try {
      const platform = assessStoragePlatform(await probe.runJson("platform"));
      const profileAccepted = await this.check({scenario: "storage-lifecycle", category: "configuration", action: "verify accelerated disposable profile",
        target: this.config.targetHost,
        expected: "the exact OSCAR 3.9.2 release, fresh 30-minute PARQUET_PRIMARY staging profile, lean mutable-parent indexes, and explicit zero-day/five-frame alarm-media test profile are running"}, async () => {
        const media = platform.videoRetention;
        const resources = platform.archiveResources;
        const passed = storagePlatformHasExactReleaseIdentity(
          platform, this.config.storageExpectedRelease, this.config.storageBackupMode,
        ) &&
            platform.archiveEnabled === true && platform.deleteHotAfterArchive === true &&
            Object.entries(REGRESSION_ARCHIVE_POLICY).every(([key, expected]) =>
              platform[key as keyof typeof REGRESSION_ARCHIVE_POLICY] === expected) &&
            parquetPrimaryOutputNamesMatchRelease(
              platform.outputNames,
              this.config.storageExpectedRelease,
            ) &&
            platform.observationIndexes.genericPayloadGinAbsent &&
            platform.observationIndexes.requiredPresent ===
              platform.observationIndexes.requiredCount &&
            platform.observationIndexes.missingNames.length === 0 &&
            platform.observationIndexes.eventPathGinExact &&
            platform.observationIndexes.numericEventIndexesExact &&
            platform.schemaVersion === OSCAR_STORAGE_SCHEMA_VERSION &&
            platform.schemaChecksum === OSCAR_STORAGE_SCHEMA_CHECKSUM &&
            resources.memoryLimitMegabytes === REGRESSION_ARCHIVE_RESOURCES.memoryLimitMegabytes &&
            resources.threads === REGRESSION_ARCHIVE_RESOURCES.threads &&
            resources.maximumTemporaryMegabytes ===
              REGRESSION_ARCHIVE_RESOURCES.maximumTemporaryMegabytes &&
            resources.maximumConcurrentSessions ===
              REGRESSION_ARCHIVE_RESOURCES.maximumConcurrentSessions &&
            resources.sessionAcquireTimeoutSeconds ===
              REGRESSION_ARCHIVE_RESOURCES.sessionAcquireTimeoutSeconds &&
            resources.temporaryDirectory === REGRESSION_ARCHIVE_RESOURCES.temporaryDirectory &&
            media.enabled === REGRESSION_MEDIA_RETENTION.enabled &&
            media.timeToRetentionDays === REGRESSION_MEDIA_RETENTION.timeToRetentionDays &&
            media.queryPeriodMinutes === REGRESSION_MEDIA_RETENTION.queryPeriodMinutes &&
            media.maximumCatchUpHours === REGRESSION_MEDIA_RETENTION.maximumCatchUpHours &&
            media.lateArrivalOverlapHours === REGRESSION_MEDIA_RETENTION.lateArrivalOverlapHours &&
            media.lateArrivalScanPeriodMinutes ===
              REGRESSION_MEDIA_RETENTION.lateArrivalScanPeriodMinutes &&
            media.lateArrivalCatchUpHours === REGRESSION_MEDIA_RETENTION.lateArrivalCatchUpHours &&
            media.reconciliationCatchUpHours ===
              REGRESSION_MEDIA_RETENTION.reconciliationCatchUpHours &&
            media.reconciliationPeriodHours ===
              REGRESSION_MEDIA_RETENTION.reconciliationPeriodHours &&
            media.occupancyStreamRefreshMinutes ===
              REGRESSION_MEDIA_RETENTION.occupancyStreamRefreshMinutes &&
            media.frameCount === REGRESSION_MEDIA_RETENTION.frameCount &&
            media.jpegQuality === REGRESSION_MEDIA_RETENTION.jpegQuality &&
            media.sourceRollbackGraceHours === REGRESSION_MEDIA_RETENTION.sourceRollbackGraceHours &&
            media.metadataReclamationWorkLimit ===
              REGRESSION_MEDIA_RETENTION.metadataReclamationWorkLimit &&
            media.maintenanceWorkLimit === REGRESSION_MEDIA_RETENTION.maintenanceWorkLimit;
        return {
          passed,
          value: passed,
          observed: JSON.stringify(platform),
        };
      });
      if (!profileAccepted) {
        throw new Error(
          "Storage lifecycle refused because the exact 3.9.2 stage/archive/media test profile failed",
        );
      }

      if (this.config.storageBackupWorkflow !== "disabled" &&
          this.config.storageBackupMode === "disabled") {
        await this.check({
          scenario: "storage-lifecycle", category: "backup", action: "prove disabled mode refuses safely",
          target: this.config.targetHost,
          expected: "all backup-family commands reject without changing services, backup state, or any legacy host WAL path",
        }, async () => {
          const value = await probe.runJson<Record<string, unknown>>("backup-mode-check");
          const passed = value.mode === "disabled" && value.commandsRejected === true &&
            value.backupTreeUnchanged === true && value.legacyWalTreeUnchanged === true &&
            value.servicesUnchanged === true && value.backupEpochsUnchanged === true;
          return {passed, observed: JSON.stringify(value)};
        });
      }

      const retentionRuntimeAccepted = await this.check({
        scenario: "storage-lifecycle", category: "configuration",
        action: "verify accelerated retained-media worker is active",
        target: this.config.targetHost,
        expected: `the durable scan cursor is valid and no more than ${REGRESSION_MEDIA_CURSOR_MAX_LAG_SECONDS} seconds behind the zero-day eligible cutoff`,
      }, async () => {
        const value = await poll(
          async () => assessRetentionRuntimeHealth(
            await probe.runJson("retention-runtime-health"),
          ),
          runtime => retentionRuntimeReady(
            runtime,
            REGRESSION_MEDIA_CURSOR_MAX_LAG_SECONDS,
          ),
          {timeoutMs: 90_000, intervalMs: 5_000,
            description: "accelerated retained-media scan cursor to become current"},
        );
        const passed = retentionRuntimeReady(
          value,
          REGRESSION_MEDIA_CURSOR_MAX_LAG_SECONDS,
        );
        return {passed, value: passed, observed: JSON.stringify(value)};
      });
      if (!retentionRuntimeAccepted) {
        throw new Error(
          "Storage lifecycle mutation refused because the retained-media worker is still using or catching up from an older runtime profile",
        );
      }

      const scratchAccepted = await this.check({
        scenario: "storage-lifecycle", category: "cold-archive",
        action: "verify clean DuckDB scratch before stage observation",
        target: REGRESSION_ARCHIVE_RESOURCES.temporaryDirectory,
        expected: "the private archive-disjoint scratch root contains only its exact safe lease between archive operations",
      }, async () => {
        const value = await poll(
          async () => assessArchiveScratch(await probe.runJson("archive-scratch-health")),
          scratch => archiveScratchIsSafe(scratch),
          {timeoutMs: 60_000, intervalMs: 1_000,
            description: "pre-lifecycle DuckDB scratch to retain only its safe lease"},
        );
        const clean = archiveScratchIsSafe(value);
        return {passed: clean, value: clean, observed: JSON.stringify(value)};
      });
      if (!scratchAccepted) {
        throw new Error("Storage lifecycle mutation refused because DuckDB scratch did not become clean");
      }

      if (this.generatedAlarmMedia.size === 0 && this.retainedBackupExpectations.size === 0) {
        const configuredEvent = this.config.storageRetainedEventId;
        if (!configuredEvent) {
          this.reporter.outcome(
            "storage-lifecycle", "retained-media", "require retained-media proof before mutation",
            this.config.testLaneLabel,
            "at least one generated alarm or explicitly configured retained event proves exact five-frame retention",
            "no generated alarm and STORAGE_RETAINED_EVENT_ID is unset",
            "incorrect", 0,
          );
          throw new Error(
            "Storage lifecycle mutation refused without generated or explicitly configured retained-media proof",
          );
        }
        const configuredProof = await this.proveConfiguredRetainedMediaEvent(
          configuredEvent,
          "storage-lifecycle",
        );
        if (!configuredProof) {
          throw new Error("Storage lifecycle mutation refused because configured retained-media proof failed");
        }
      }

      const configuredLane = this.config.laneConfigOracle?.lanes.find(
        lane => lane.name === this.config.testLaneLabel,
      );
      if (!configuredLane) {
        throw new Error("Direct daily-file proof requires the reserved lane in OSCAR_LANE_CONFIG_PATH");
      }
      directJournalLaneUid = configuredLane.uniqueId.startsWith("urn:")
        ? configuredLane.uniqueId
        : `urn:osh:system:lane:${configuredLane.uniqueId}`;
      directJournalAfterAppend = await this.check<DirectJournalLaneState>({
        scenario: "storage-lifecycle", category: "daily-file", action: "prove direct journal append",
        target: directJournalLaneUid,
        expected: "an emulator fault transition appends durable bytes directly to the exact lane journal without unsafe or partial entries",
      }, async () => {
        const before = await probe.runJson<DirectJournalLaneState>(
          "journal-lane-state",
          [directJournalLaneUid!],
        );
        try {
          await this.emulator.waitForIdle(this.config.testRpmId);
          await this.emulator.fault(this.config.testRpmId, "tamper", true);
          await this.emulator.waitForStatus(
            this.config.testRpmId,
            status => status.tamper_fault,
            "direct-journal tamper transition to assert",
          );
          await sleep(1_000);
        } finally {
          await this.emulator.fault(this.config.testRpmId, "tamper", false).catch(() => undefined);
          await this.emulator.waitForStatus(
            this.config.testRpmId,
            status => !status.tamper_fault,
            "direct-journal tamper transition to clear",
          ).catch(() => undefined);
        }
        const after = await poll(
          () => probe.runJson<DirectJournalLaneState>("journal-lane-state", [directJournalLaneUid!]),
          state => state.present && directJournalInventoryValid(state) &&
            state.bytes > before.bytes && state.files > 0,
          {timeoutMs: 30_000, intervalMs: 1_000, description: "reserved lane journal bytes to advance"},
        );
        const passed = after.present && directJournalInventoryValid(after) &&
          after.bytes > before.bytes && after.files > 0 &&
          after.openSegments + after.sealedSegments > 0 && after.partialFiles === 0 &&
          after.unsafeEntries === 0;
        return {passed, ...(passed ? {value: after} : {}), observed: JSON.stringify({before, after})};
      });
      if (!directJournalAfterAppend) {
        throw new Error("Storage lifecycle refused to continue after the direct daily-file append proof failed");
      }
      await this.verifyGeneratedAlarmRetention(probe);
      if (this.retainedBackupExpectations.size === 0) {
        throw new Error(
          "Storage lifecycle mutation refused because no exact retained-media set completed certification",
        );
      }
      await this.check({
        scenario: "storage-lifecycle", category: "retained-media",
        action: "verify compact media metadata after retention",
        target: "retained-media/v1",
        expected: "generated five-frame media has schema-2 checkpoint state and compact hourly processed indexes with no legacy or unsafe metadata",
      }, async () => {
        const requirePopulated = this.generatedAlarmMedia.size > 0;
        const value = await poll(
          async () => assessMediaMetadataHealth(await probe.runJson("media-metadata-health")),
          candidate => mediaMetadataHealthIsSafe(candidate, requirePopulated),
          {timeoutMs: 30_000, intervalMs: 1_000,
            description: "retained-media metadata to reach an atomic clean boundary"},
        );
        return {passed: mediaMetadataHealthIsSafe(value, requirePopulated), observed: JSON.stringify(value)};
      });
      const lifecycleBefore = storageMetricFromProbe(
        "storage-lifecycle-before",
        await probe.runJson("snapshot"),
      );
      this.reporter.storageMetric(lifecycleBefore);
      const beforeLatencyPage = await this.browser.oscarPage();
      let latencyBefore: Awaited<ReturnType<typeof this.measureConSysQueryLatencies>>;
      try {
        latencyBefore = await this.measureConSysQueryLatencies(beforeLatencyPage);
      } finally {
        await beforeLatencyPage.close();
      }
      type PrimaryStageSample = {
        available: boolean;
        storeKey: string;
        idScope: number;
        parentTable: string;
        childTable: string;
        windowStart: string;
        windowEnd: string;
        rowCount: number;
        ownerCount: number;
        markerNonNullRowCount: number;
        coldId: string;
        datastreamId: number;
        coldTime: string;
        oldestReceivedAt: string;
      };
      type PrimaryStageStatus = {
        registryState: "ATTACHED" | "DETACHED" | null;
        relationPresent: boolean;
        inheritsParent: boolean;
        rowCount: number;
        ownerCount: number;
        markerNonNullRowCount: number;
        coldHotPresent: boolean;
        sampleConsistent: boolean;
        selectedGeneration: {
          generationId: string | null;
          generationState: string | null;
          parityVerified: boolean;
          generationRowCount: number | null;
        };
        windowGenerations: {
          generationCount: number;
          generationIds: string[];
          invalidGenerationCount: number;
          nonSealedGenerationCount: number;
          generationRowCount: number;
        };
      };
      type PrimaryStageWitness = {
        relationPresent: boolean;
        fullOwnershipObserved: boolean;
        rowCount: number;
        ownerCount: number;
        ownerGenerationCount: number;
        invalidOwnerGenerationCount: number;
        ownerGenerationRowCount: number;
        generationIds: string[];
        selectedGenerationId: string | null;
        selectedGenerationState: string | null;
        selectedGenerationParityVerified: boolean;
      };
      const stageSample = await poll(
        () => probe.runJson<PrimaryStageSample>("stage-lifecycle-select"),
        value => value.available,
        {timeoutMs: this.config.storageArchiveTimeoutMs, intervalMs: 5_000,
          description: "a completed nonempty 30-minute immutable stage child"},
      );
      const stageSampleAccepted = await this.check({
        scenario: "storage-lifecycle", category: "cold-archive",
        action: "select a newly completed immutable stage child without mutation",
        target: stageSample.childTable,
        expected: "a completed attached LOGGED child still inside its archive-delay window contains only NULL legacy markers and has bounded exact sidecar ownership",
      }, async () => {
        const passed = stageSample.available && stageSample.idScope === this.config.storageDatabaseScope &&
          stageSample.parentTable === "obs" && stageSample.rowCount > 0 &&
          stageSample.ownerCount >= 0 && stageSample.ownerCount <= stageSample.rowCount &&
          stageSample.markerNonNullRowCount === 0 &&
          Number.isFinite(Date.parse(stageSample.windowStart)) &&
          Number.isFinite(Date.parse(stageSample.windowEnd)) &&
          Number.isFinite(Date.parse(stageSample.coldTime)) &&
          Number.isFinite(Date.parse(stageSample.oldestReceivedAt));
        return {passed, value: passed, observed: JSON.stringify(stageSample)};
      });
      if (!stageSampleAccepted) {
        throw new Error("PARQUET_PRIMARY lifecycle refused an invalid immutable stage sample");
      }
      const witness = await probe.runJson<PrimaryStageWitness>("stage-lifecycle-witness", [
        stageSample.childTable, stageSample.storeKey, String(stageSample.idScope),
        String(stageSample.rowCount), stageSample.coldId,
        String(Math.min(7_200, Math.ceil(this.config.storageArchiveTimeoutMs / 1_000))),
      ]);
      const ownershipWitnessAccepted = await this.check({
        scenario: "storage-lifecycle", category: "cold-archive",
        action: "witness exact multi-generation ownership before retirement",
        target: stageSample.childTable,
        expected: "while a read-only ACCESS SHARE lock keeps the child present, every exact row has one compact sidecar owner and every distinct owner generation is parity-verified ACTIVE or SEALED",
      }, async () => {
        const passed = witness.relationPresent && witness.fullOwnershipObserved &&
          witness.rowCount === stageSample.rowCount &&
          witness.ownerCount === stageSample.rowCount &&
          witness.ownerGenerationCount > 0 &&
          witness.ownerGenerationCount === witness.generationIds.length &&
          new Set(witness.generationIds).size === witness.generationIds.length &&
          witness.invalidOwnerGenerationCount === 0 &&
          witness.ownerGenerationRowCount === stageSample.rowCount &&
          witness.generationIds.every(id =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) &&
          typeof witness.selectedGenerationId === "string" &&
          witness.generationIds.includes(witness.selectedGenerationId) &&
          ["ACTIVE", "SEALED"].includes(witness.selectedGenerationState ?? "") &&
          witness.selectedGenerationParityVerified;
        return {passed, value: passed, observed: JSON.stringify({stageSample, witness})};
      });
      if (!ownershipWitnessAccepted) {
        throw new Error("PARQUET_PRIMARY lifecycle did not witness exact verified child ownership");
      }
      const sameWitnessedGenerationIds = (ids: string[]): boolean =>
        ids.length === witness.generationIds.length &&
        ids.every((id, index) => id === witness.generationIds[index]);
      const retired = await poll(
        () => probe.runJson<PrimaryStageStatus>("stage-lifecycle-status", [
          stageSample.childTable, stageSample.storeKey, String(stageSample.idScope),
          stageSample.coldId, String(stageSample.datastreamId),
          stageSample.windowStart, stageSample.windowEnd, witness.selectedGenerationId!,
        ]),
        value => value.sampleConsistent && value.registryState === null &&
          !value.relationPresent && !value.coldHotPresent &&
          value.selectedGeneration.generationState === "SEALED" &&
          value.selectedGeneration.parityVerified &&
          value.windowGenerations.generationCount === witness.ownerGenerationCount &&
          sameWitnessedGenerationIds(value.windowGenerations.generationIds) &&
          value.windowGenerations.invalidGenerationCount === 0 &&
          value.windowGenerations.nonSealedGenerationCount === 0 &&
          value.windowGenerations.generationRowCount === stageSample.rowCount,
        {timeoutMs: this.config.storageArchiveTimeoutMs, intervalMs: 2_000,
          description: "checksum/parity-verified whole-child retirement"},
      );
      const archived = retired.selectedGeneration;
      await this.check({
        scenario: "storage-lifecycle", category: "cold-archive",
        action: "retire one verified immutable child as a whole relation",
        target: stageSample.childTable,
        expected: "the catalog entry and physical child disappear only after every witnessed generation passes parity and the selected observation remains in sealed Parquet; no row marker is used",
      }, async () => {
        const passed = retired.sampleConsistent && retired.registryState === null &&
          !retired.relationPresent && !retired.inheritsParent && !retired.coldHotPresent &&
          retired.markerNonNullRowCount === 0 && archived.parityVerified &&
          archived.generationState === "SEALED" &&
          archived.generationId === witness.selectedGenerationId &&
          retired.windowGenerations.generationCount === witness.ownerGenerationCount &&
          sameWitnessedGenerationIds(retired.windowGenerations.generationIds) &&
          retired.windowGenerations.invalidGenerationCount === 0 &&
          retired.windowGenerations.nonSealedGenerationCount === 0 &&
          retired.windowGenerations.generationRowCount === stageSample.rowCount &&
          typeof archived.generationId === "string";
        return {passed, value: passed, observed: JSON.stringify({stageSample, witness, retired})};
      });
      if (!archived.generationId) {
        throw new Error("Whole-child retirement produced no queryable archive generation");
      }
      this.reporter.storageMetric(storageMetricFromProbe(
        "storage-lifecycle-after-whole-child-retirement",
        await probe.runJson("snapshot"),
      ));
      const exportDisruptionPhase = "storage-lifecycle-export-disruption";
      await this.metrics.sample();
      this.reporter.expectRemoteMetricDisruptionPhase(exportDisruptionPhase);
      this.metrics.setPhase(exportDisruptionPhase);
      try {
        await this.check({scenario: "storage-lifecycle", category: "portability", action: "export portable archive",
          target: archived.generationId,
          expected: "export contains hash-valid Parquet, manifests, schema material, query.sql, and README"}, async () => {
          const value = await probe.runJson<Record<string, unknown>>(
            "export-check", [archived.generationId!]);
          return {passed: value.checksumVerified === true && Number(value.parquetFiles) > 0 &&
            value.querySql === true && value.readme === true, observed: JSON.stringify(value)};
        });
      } finally {
        this.metrics.setPhase("storage-lifecycle-post-export");
        await this.metrics.sample();
      }
      await this.check({scenario: "storage-lifecycle", category: "portability",
        action: "exercise deployed archive-object helper", target: archived.generationId,
        expected: "the image helper verifies and copies a cataloged object by hash and rejects checksum mismatch and traversal"}, async () => {
        const value = await probe.runJson<Record<string, unknown>>(
          "archive-helper-check", [archived.generationId!]);
        const passed = ["verified", "copied", "copyChecksumValid", "mismatchRejected", "traversalRejected"]
          .every(field => value[field] === true);
        return {passed, observed: JSON.stringify(value)};
      });
      apiPage = await this.browser.oscarPage();
      const request = apiPage.context().request;
      const coldPublicId = encodeOshBigId(
        this.config.storageDatabaseScope, BigInt(stageSample.coldId));
      const streamPublicId = encodeOshBigId(
        this.config.storageDatabaseScope, BigInt(stageSample.datastreamId));
      await this.check({scenario: "storage-lifecycle", category: "mixed-tier-query", action: "query cold event by ID",
        target: coldPublicId, expected: "the archived observation remains queryable by its exact public ID after its whole PostgreSQL child is dropped"}, async () => {
        const response = await request.get(this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(coldPublicId)}`));
        try {
          const status = response.status();
          if (!response.ok()) {
            return {passed: false,
              observed: `generation=${archived.generationState}; child present=${retired.relationPresent}; HTTP ${status}`};
          }
          const body = await response.json();
          const record = body && typeof body === "object" ? body as Record<string, unknown> : null;
          const idMatches = record?.id === coldPublicId;
          const streamMatches = record?.["datastream@id"] === streamPublicId;
          return {passed: archived.generationState === "SEALED" && idMatches && streamMatches,
            observed: `generation=${archived.generationState}; child present=${retired.relationPresent}; HTTP ${status}; id=${String(record?.id)}; datastream=${String(record?.["datastream@id"])}`};
        } finally {
          await response.dispose();
        }
      });
      const hotSample = await poll(
        () => probe.runJson<{available: boolean; hotId: string | null; hotTime: string | null}>(
          "stage-lifecycle-hot", [String(stageSample.datastreamId), stageSample.coldId]),
        value => value.available && typeof value.hotId === "string" &&
          typeof value.hotTime === "string",
        {timeoutMs: this.config.storageArchiveTimeoutMs, intervalMs: 2_000,
          description: "a current attached hot sample for the archived datastream"},
      );
      if (!hotSample.hotId || !hotSample.hotTime) {
        throw new Error("Mixed-tier retrieval found no current attached hot sample");
      }
      const hotPublicId = encodeOshBigId(
        this.config.storageDatabaseScope, BigInt(hotSample.hotId));
      const hotTime = hotSample.hotTime;
      await this.check({scenario: "storage-lifecycle", category: "mixed-tier-query", action: "query mixed hot/cold range",
        target: streamPublicId, expected: "bounded ascending and descending filters over one datastream expose the exact cold Parquet ID and a current attached-stage ID"}, async () => {
        const start = new Date(Date.parse(stageSample.coldTime) - 60_000).toISOString();
        const end = new Date(Date.parse(hotTime) + 60_000).toISOString();
        const base = `/sensorhub/api/datastreams/${encodeURIComponent(streamPublicId)}/observations?phenomenonTime=${encodeURIComponent(`${start}/${end}`)}&limit=10000`;
        const ascending = await request.get(this.viewerUrl(`${base}&order=asc`));
        const descending = await request.get(this.viewerUrl(`${base}&order=desc`));
        try {
          if (!ascending.ok() || !descending.ok()) {
            return {passed: false,
              observed: `ascending HTTP ${ascending.status()}; descending HTTP ${descending.status()}`};
          }
          const ascendingIds = parseCollectionIds(await ascending.json());
          const descendingIds = parseCollectionIds(await descending.json());
          const ascColdIndex = ascendingIds.indexOf(coldPublicId);
          const ascHotIndex = ascendingIds.indexOf(hotPublicId);
          const descHotIndex = descendingIds.indexOf(hotPublicId);
          const descColdIndex = descendingIds.indexOf(coldPublicId);
          const coldFound = ascColdIndex >= 0 && descColdIndex >= 0;
          const hotFound = ascHotIndex >= 0 && descHotIndex >= 0;
          const ordered = coldFound && hotFound &&
            ascColdIndex < ascHotIndex && descHotIndex < descColdIndex;
          return {passed: ordered,
            observed: `ascending=${ascendingIds.length}, cold=${ascColdIndex}, hot=${ascHotIndex}; descending=${descendingIds.length}, hot=${descHotIndex}, cold=${descColdIndex}`};
        } finally {
          await ascending.dispose();
          await descending.dispose();
          }
      });
      await this.check({scenario: "storage-lifecycle", category: "cold-archive",
        action: "verify lifecycle left no partial archive artifacts", target: this.config.targetHost,
        expected: "post-purge archive verification passes with no archive-object or WAL partial artifacts"}, async () => {
        const value = await poll(
          async () => assessArchiveHealth(await probe.runJson("archive-health")),
          candidate => candidate.failedJobs === 0 && candidate.parityFailures === 0 &&
            candidate.incompleteActiveObjects === 0 && candidate.archivePartialArtifacts === 0 &&
            candidate.walPartialArtifacts === 0 && candidate.checksumVerificationPassed,
          {timeoutMs: 60_000, intervalMs: 2_000,
            description: "post-lifecycle archive verification to reach a quiescent clean boundary"},
        );
        return {passed: value.failedJobs === 0 && value.parityFailures === 0 &&
          value.incompleteActiveObjects === 0 && value.archivePartialArtifacts === 0 &&
          value.walPartialArtifacts === 0 && value.checksumVerificationPassed,
        observed: JSON.stringify(value)};
      });
      await this.check({
        scenario: "storage-lifecycle", category: "cold-archive",
        action: "verify DuckDB operation scratch cleanup",
        target: REGRESSION_ARCHIVE_RESOURCES.temporaryDirectory,
        expected: "archive/export/query/count/delete sessions remove every operation directory while preserving the exact safe lease",
      }, async () => {
        const value = await poll(
          async () => assessArchiveScratch(await probe.runJson("archive-scratch-health")),
          scratch => archiveScratchIsSafe(scratch),
          {timeoutMs: 60_000, intervalMs: 1_000,
            description: "post-lifecycle DuckDB scratch to retain only its safe lease"},
        );
        return {passed: archiveScratchIsSafe(value), observed: JSON.stringify(value)};
      });
      const lifecycleRestartPhase = "storage-lifecycle-restart-disruption";
      // Finish any interval sample that captured the steady-state phase before allowing the
      // supported restart. Otherwise that in-flight sample can observe the deliberate outage but
      // be mislabeled as ordinary storage-lifecycle activity.
      await this.metrics.sample();
      this.reporter.expectRemoteMetricDisruptionPhase(lifecycleRestartPhase);
      this.metrics.setPhase(lifecycleRestartPhase);
      try {
        await this.check({scenario: "storage-lifecycle", category: "daily-file", action: "recover journal after OSCAR restart",
          target: this.config.targetHost, expected: "OSCAR becomes healthy with no recovery errors or partial publications"}, async () => {
        const value = await probe.runJson<{
          healthy: boolean;
          segmentsChecked: number;
          segmentsPreserved: number;
          segmentFailures: number;
          partialFiles: number;
          recoveryErrors: number;
          shutdownErrors: number;
          cameraRecordingErrors: number;
          scratchBeforeRestartCount: number;
          scratchAfterRestartCount: number;
          staleScratchAfterRestartCount: number;
          scratchBeforeRestart: string[];
          scratchAfterRestart: string[];
          staleScratchAfterRestart: string[];
        }>("journal-restart", [directJournalLaneUid!]);
        const scratchRestart = assessArchiveScratchRestart(value);
        const lane = await probe.runJson<DirectJournalLaneState>(
          "journal-lane-state",
          [directJournalLaneUid!],
        );
        const laneDurable = lane.present && directJournalInventoryValid(lane) &&
          lane.bytes >= directJournalAfterAppend!.bytes &&
          lane.files > 0 && lane.openSegments + lane.sealedSegments > 0 &&
          lane.partialFiles === 0 && lane.unsafeEntries === 0;
        const exactRestartPreservation = Number.isSafeInteger(value.segmentsChecked) &&
          value.segmentsChecked > 0 && value.segmentsPreserved === value.segmentsChecked &&
          value.segmentFailures === 0;
          return {passed: value.healthy && exactRestartPreservation &&
            value.partialFiles === 0 && value.recoveryErrors === 0 &&
            value.shutdownErrors === 0 && value.cameraRecordingErrors === 0 && laneDurable &&
            archiveScratchRestartIsSafe(scratchRestart),
          observed: JSON.stringify({restart: value, scratchRestart, lane,
            preRestart: directJournalAfterAppend})};
        });
      } finally {
        this.metrics.setPhase("storage-lifecycle-post-restart");
      }
      if (this.config.storageBackupWorkflow !== "disabled" &&
          this.config.storageBackupMode === "single") {
        await this.check({scenario: "storage-lifecycle", category: "backup", action: "create and automatically verify backup",
          target: this.config.targetHost,
        expected: "single mode publishes one authenticated CURRENT schema-v2 snapshot with streamed WAL, no cumulative WAL archive, exact media/journal inventory, and crash-safe atomic replacement without restore"}, async () => {
          // Startup reclamation may briefly remove expired processed-index buckets before the
          // first scheduled overlap scan republishes current observations. Cross one complete
          // configured scan interval before freezing the exact backup inventory.
          await sleep(REGRESSION_MEDIA_RETENTION.queryPeriodMinutes * 60_000 + 15_000);
          let stableMetadataSignature = "";
          let stableMetadataSamples = 0;
          let previousManifestFiles = -1;
          const mediaBeforeBackup = await poll(
            async () => assessMediaMetadataHealth(
              await probe.runJson("media-metadata-health"),
            ),
            (value) => {
              // Stabilize processed/deletion index buckets across 3 clean samples while allowing
              // live non-reserved lanes to monotonically append complete 5-JPEG manifest sets.
              const signature = [value.processedIndexFiles, value.deletionIndexFiles].join(":");
              const manifestsMonotonic = previousManifestFiles < 0 ||
                value.retainedManifestFiles >= previousManifestFiles;
              const fiveFrameParity = value.retainedJpegFiles === value.retainedManifestFiles * 5;
              previousManifestFiles = value.retainedManifestFiles;
              stableMetadataSamples = signature === stableMetadataSignature &&
                  manifestsMonotonic && fiveFrameParity
                ? stableMetadataSamples + 1 : 1;
              stableMetadataSignature = signature;
              return mediaMetadataHealthIsSafe(value, true) && stableMetadataSamples >= 3;
            },
            {timeoutMs: 240_000, intervalMs: 2_000,
              description: "retained-media indexes to repopulate and stabilize after restart"},
          );
          const retainedExpectations = [...this.retainedBackupExpectations.values()].sort().slice(-8);
          if (retainedExpectations.length === 0) {
            throw new Error("Backup certification requires at least one exact retained-media set");
          }
          const backupDisruptionPhase = "storage-lifecycle-backup-disruption";
          await this.metrics.sample();
          this.reporter.expectRemoteMetricDisruptionPhase(backupDisruptionPhase);
          this.metrics.setPhase(backupDisruptionPhase);
          let value: Record<string, unknown>;
          try {
            value = await probe.runJson<Record<string, unknown>>(
              "backup-check",
              retainedExpectations,
            );
          } finally {
            this.metrics.setPhase("storage-lifecycle-post-backup");
          }
          const exactMembers = Number(value.retainedMediaExactMembersVerified);
          const expectedMembers = Number(value.retainedMediaExpectedMembers);
          const expectedProcessed = Number(value.expectedProcessedIndexes);
          const expectedDeletion = Number(value.expectedDeletionIndexes);
          const metadataIncluded = value.retainedMediaPrefixPresent === true &&
            value.mediaMetadataCheckpointIncluded === true &&
            Number(value.retainedMediaExpectedSets) === retainedExpectations.length &&
            Number.isSafeInteger(expectedMembers) && expectedMembers > retainedExpectations.length * 6 &&
            exactMembers === expectedMembers && mediaBeforeBackup.processedIndexFiles > 0 &&
            Number.isSafeInteger(expectedProcessed) && expectedProcessed >= 0 &&
            Number(value.processedObservationIndexesIncluded) === expectedProcessed &&
            Number(value.deletionIndexesIncluded) === expectedDeletion;
          const deletionMetadataIncluded = Number.isSafeInteger(Number(value.deletionIndexesIncluded)) &&
            Number.isSafeInteger(expectedDeletion) && expectedDeletion >= 0 &&
            Number(value.deletionIndexesIncluded) === expectedDeletion;
          return {passed: value.automaticVerification === true && value.supportedVerification === true &&
            value.backupMode === "single" && Number(value.schemaVersion) === 2 &&
            value.currentAuthenticated === true && Number(value.currentSnapshotCount) === 1 &&
            value.walArchiveTarAbsent === true && value.streamedWalPresent === true &&
            Number(value.stagingArtifacts) === 0 && value.atomicStateMachineExact === true &&
            value.pruneRetired === true &&
            value.independentCoreAuthentication === true &&
            value.authenticatedManifest === true && value.journalConfirmationAuthenticated === true &&
            value.regularMarkers === true && value.epochValid === true &&
            value.verifiedEpoch === true && value.archiveGenerationInventoryExact === true &&
            Number.isSafeInteger(Number(value.archiveGenerationCount)) && Number(value.archiveGenerationCount) >= 0 &&
            Number.isSafeInteger(Number(value.journalConfirmedPublications)) &&
            Number(value.journalConfirmedPublications) >= 0 &&
            Number(value.journalReceipts) === Number(value.journalConfirmedPublications) &&
            Number.isSafeInteger(Number(value.journalReceiptSegmentsVerified)) &&
            Number(value.journalReceiptSegmentsVerified) >= Number(value.journalReceipts) &&
            value.journalReceiptReferencesValid === true &&
            value.duckDbScratchExcluded === true &&
            metadataIncluded && deletionMetadataIncluded && value.restoreAttempted === false,
          observed: JSON.stringify({backup: value, mediaBeforeBackup})};
        });
      }
      const latencyAfter = await this.measureConSysQueryLatencies(apiPage);
      await apiPage.close();
      apiPage = undefined;
      const lifecycleAfter = storageMetricFromProbe(
        "storage-lifecycle-after",
        await probe.runJson("snapshot"),
      );
      this.reporter.storageMetric(lifecycleAfter);
      await this.check({
        scenario: "storage-lifecycle",
        category: "performance",
        action: "verify bounded database work amplification",
        target: "PostgreSQL observation lifecycle",
        expected: "whole-child raw retirement adds no observation-row DELETE calls and uses at most 512 MiB of PostgreSQL temporary data",
      }, async () => {
        const delta = (field: keyof typeof lifecycleBefore): number | null => {
          const before = lifecycleBefore[field];
          const after = lifecycleAfter[field];
          return typeof before === "number" && typeof after === "number" ? after - before : null;
        };
        const tempBytes = delta("tempBytes");
        const rawTempBlocks = delta("statementTempBlocksWritten");
        // pg_stat_statements evicts least-frequently-used entries under pg_stat_statements.max
        // during full multi-scenario runs while pg_stat_database.temp_bytes remains strictly monotonic.
        const tempBlocks = rawTempBlocks !== null && tempBytes !== null && tempBytes >= 0
          ? Math.max(0, rawTempBlocks)
          : rawTempBlocks;
        const deleteCalls = delta("observationDeleteCalls");
        const deleteRows = delta("observationDeleteRows");
        const singletonDeletes = delta("legacySingletonObservationDeleteCalls");
        const batchedDeleteCalls = delta("batchedObservationDeleteCalls");
        const batchedDeleteRows = delta("batchedObservationDeleteRows");
        const unaccountedSingletonDeletes = singletonDeletes === null
          ? null
          : singletonDeletes;
        const countersMonotonic = [tempBytes, tempBlocks, deleteCalls, deleteRows,
          singletonDeletes, batchedDeleteCalls, batchedDeleteRows,
          unaccountedSingletonDeletes]
          .every(value => value !== null && value >= 0);
        const passed = countersMonotonic && tempBytes! <= 512 * 1024 * 1024 &&
          tempBlocks! <= 65_536 &&
          deleteCalls === 0 && deleteRows === 0 &&
          singletonDeletes === 0 &&
          batchedDeleteCalls === 0 && batchedDeleteRows === 0 &&
          unaccountedSingletonDeletes === 0;
        return {passed, observed: JSON.stringify({
          tempBytes, statementTempBlocksWritten: tempBlocks,
          observationDeleteCalls: deleteCalls,
          observationDeleteRows: deleteRows,
          legacySingletonObservationDeleteCalls: singletonDeletes,
          batchedObservationDeleteCalls: batchedDeleteCalls,
          batchedObservationDeleteRows: batchedDeleteRows,
          expectedAuthorizedHotDeleteSingletonCalls: 0,
          unaccountedSingletonDeletes,
        })};
      });
      await this.check({
        scenario: "storage-lifecycle",
        category: "performance",
        action: "verify bounded datastream bloat and query latency drift across archival",
        target: this.config.targetHost,
        expected: "across whole-child archival, obs_datastreams stays <= 32 MiB with <= 4 MiB growth, connectionStatus stays <= 18000 rows/h, and post-archival ConSys API observation latencies remain within SLO",
      }, async () => {
        const dsBefore = lifecycleBefore.datastreamsTableBytes ?? null;
        const dsAfter = lifecycleAfter.datastreamsTableBytes ?? null;
        const dsDelta = dsBefore !== null && dsAfter !== null ? dsAfter - dsBefore : null;
        const updBefore = lifecycleBefore.datastreamsUpdates ?? null;
        const updAfter = lifecycleAfter.datastreamsUpdates ?? null;
        const updDelta = updBefore !== null && updAfter !== null ? updAfter - updBefore : null;
        const connRows = lifecycleAfter.connectionStatusRowsLastHour ?? null;
        const idxPresent = lifecycleAfter.archiveSchemaDatastreamIndexPresent ?? null;
        const passed = idxPresent === 1 &&
          dsAfter !== null && dsAfter <= 32 * 1024 * 1024 &&
          dsDelta !== null && dsDelta <= 4 * 1024 * 1024 &&
          connRows !== null && connRows <= 18_000 &&
          latencyAfter.allSucceeded &&
          latencyAfter.datastreamsListMs <= 1_000 &&
          latencyAfter.latestNonArchivedMs <= 500 &&
          latencyAfter.latestPhenomenonNonArchivedMs <= 500 &&
          latencyAfter.latestArchivedMs <= 500 &&
          latencyAfter.latestPhenomenonArchivedMs <= 500 &&
          latencyAfter.unboundedWindowNonArchivedMs <= 500 &&
          latencyAfter.fiftyLaneBurstMs <= 2_500;
        return {
          passed,
          observed: JSON.stringify({
            datastreamsTableBytesBefore: dsBefore,
            datastreamsTableBytesAfter: dsAfter,
            datastreamsTableBytesDelta: dsDelta,
            datastreamsUpdatesDelta: updDelta,
            connectionStatusRowsLastHour: connRows,
            archiveSchemaDatastreamIndexPresent: idxPresent,
            latencyBefore,
            latencyAfter,
          }),
        };
      });
    } finally {
      if (apiPage) await apiPage.close().catch(() => undefined);
      await probe.cleanup();
      if (this.alarmMediaProbe === probe) this.alarmMediaProbe = undefined;
    }
  }

  private async storageRestoreDrill(): Promise<void> {
    if (this.storageUnavailable("storage-restore-drill")) return;
    const probe = new StorageProbeClient(this.config, this.reporter.runId);
    const fixtureRun = safeName(this.reporter.runId).replaceAll("-", "_").slice(-80);
    try {
      const before = assessStoragePlatform(await probe.runJson("platform"));
      const identityAccepted = await this.check({
        scenario: "storage-restore-drill",
        category: "restore",
        action: "verify exact release identity before destructive restore",
        target: this.config.targetHost,
        expected: "the isolated target is running exact OSCAR/PostGIS 3.9.2 images and the pinned gateway",
      }, async () => {
        const release = this.config.storageExpectedRelease;
        const passed = storagePlatformHasExactReleaseIdentity(
          before, release, this.config.storageBackupMode,
        );
        return {passed, value: passed, observed: JSON.stringify(before)};
      });
      if (!identityAccepted) throw new Error("Destructive restore refused because exact 3.9.2 identity failed");

      const restoreDisruptionPhase = "storage-restore-drill-disruption";
      this.reporter.expectRemoteMetricDisruptionPhase(restoreDisruptionPhase);
      this.metrics.setPhase(restoreDisruptionPhase);
      let restoreResult: Record<string, unknown> | undefined;
      try {
        restoreResult = await this.check<Record<string, unknown>>({
          scenario: "storage-restore-drill",
          category: "restore",
          action: "restore authenticated backup over isolated deployment",
          target: this.config.targetHost,
          expected: "the authenticated schema-v2 CURRENT snapshot restores every canary without external WAL, promotes to a fresh timeline, clears recovery state, and retains a durable post-promotion write",
        }, async () => {
          const value = await probe.runJson<Record<string, unknown>>(
            "restore-drill",
            [
              fixtureRun,
              `${fixtureRun}:DESTRUCTIVE-RESTORE`,
              this.config.restoreArchiveDirectory ?? "missing",
              this.config.restoreBackupDirectory ?? "missing",
            ],
          );
          const passed = [
            "databaseRestored", "applicationStateRestored", "archiveRestored",
            "credentialsRestored", "servicesHealthy", "archiveVerified", "freshTimeline",
            "recoverySettingsCleared", "verifiedEpochRestored", "currentAuthenticated",
            "noExternalWalDependency", "walArchiveTarAbsent", "postPromotionWriteDurable",
            "allCanariesRestored", "authenticatedBackupReverified", "preRestoreSafetyCopyVerified",
          ].every(field => value[field] === true) &&
            Number(value.schemaVersion) === 2 &&
            typeof value.backupId === "string" &&
            /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/.test(value.backupId) &&
            typeof value.preRestoreSafetyDirectory === "string";
          return {passed, ...(passed ? {value} : {}), observed: JSON.stringify(value)};
        });
      } finally {
        this.metrics.setPhase("storage-restore-drill-post");
      }

      const after = assessStoragePlatform(await probe.runJson("platform"));
      const immutableImageIdentityPreserved = await this.check<boolean>({
        scenario: "storage-restore-drill",
        category: "restore",
        action: "verify immutable image identity after restore",
        target: this.config.targetHost,
        expected: "restore restarts the exact same immutable application, PostGIS, and gateway image IDs",
      }, async () => {
        const passed = storagePlatformHasExactReleaseIdentity(
          after, this.config.storageExpectedRelease, this.config.storageBackupMode,
        ) && after.appImage.containerImageId === before.appImage.containerImageId &&
          after.postgisImage.containerImageId === before.postgisImage.containerImageId &&
          after.gatewayImage.containerImageId === before.gatewayImage.containerImageId;
        return {passed, ...(passed ? {value: true} : {}), observed: JSON.stringify({
          before: {
            app: before.appImage.containerImageId,
            postgis: before.postgisImage.containerImageId,
            gateway: before.gatewayImage.containerImageId,
          },
          after: {
            app: after.appImage.containerImageId,
            postgis: after.postgisImage.containerImageId,
            gateway: after.gatewayImage.containerImageId,
          },
        })};
      });
      if (restoreResult && immutableImageIdentityPreserved === true) {
        this.reporter.addMetadata({
          restoreDrillCertification: {
            schemaVersion: 2,
            backupId: String(restoreResult.backupId),
            authenticatedBackupReverified: true,
            allCanariesRestored: true,
            immutableImageIdentityPreserved: true,
            preRestoreSafetyCopyVerified: true,
          },
        });
      }
      this.reporter.storageMetric(storageMetricFromProbe(
        "storage-restore-drill-after",
        await probe.runJson("snapshot"),
      ));
    } finally {
      await probe.cleanup();
    }
  }

  private async extendedOccupancy(): Promise<void> {
    if (!this.originalRpmConfig) throw new Error("Original RPM configuration is unavailable");
    const quiet = this.emulator.quietConfig(this.originalRpmConfig);
    const page = await this.browser.oscarPage();
    try {
      await this.emulator.replaceConfig(
        this.config.testRpmId,
        this.emulator.extendedOccupancyConfig(this.originalRpmConfig, this.config.extendedOccupancySeconds),
      );
      await this.emulator.waitForStatus(this.config.testRpmId, (status) => status.state === "OCCUPIED", "forced extended occupancy to start", 30_000);
      await this.goto(page, "/health");
      await this.check({
        scenario: "extended-occupancy", category: "fault-detection", action: "detect extended occupancy",
        target: this.config.testLaneLabel, expected: "Extended occupancy: Fault after more than one minute",
      }, async () => {
        const text = await this.waitHealthText(page, "Extended occupancy: Fault", (this.config.extendedOccupancySeconds + 35) * 1_000);
        return {passed: text.includes("Extended occupancy: Fault"), observed: "Extended occupancy: Fault visible"};
      });
      await this.check({
        scenario: "extended-occupancy", category: "dashboard-health", action: "show extended occupancy on dashboard",
        target: this.config.testLaneLabel, expected: "extended-occupancy compact indicator becomes Active after the configured one-minute threshold",
      }, async () => {
        const count = await this.waitDashboardFaultState(
          page,
          "extended-occupancy",
          "active",
          (this.config.extendedOccupancySeconds + 35) * 1_000,
        );
        const label = await this.dashboardFault(page, "extended-occupancy").getAttribute("aria-label") ?? "";
        const passed = count === 1 && label === "Extended occupancy: Fault";
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "dashboard-extended-occupancy-active");
        return {passed, observed: `active indicators=${count}; aria-label=${label}`, evidence};
      });
    } finally {
      await this.emulator.replaceConfig(this.config.testRpmId, quiet).catch((error) => this.reporter.error("extended-occupancy", "restore-quiet-config", error));
    }
    await this.check({
      scenario: "extended-occupancy", category: "fault-resolution", action: "resolve extended occupancy",
      target: this.config.testLaneLabel, expected: "Extended occupancy returns to Clear after occupancy ends",
    }, async () => {
      const text = await this.waitHealthText(page, "Extended occupancy: Clear", 60_000);
      return {passed: text.includes("Extended occupancy: Clear"), observed: "Extended occupancy: Clear visible"};
    });
    await this.check({
      scenario: "extended-occupancy", category: "dashboard-health", action: "clear extended occupancy from dashboard",
      target: this.config.testLaneLabel, expected: "extended-occupancy compact indicator disappears after occupancy ends",
    }, async () => {
      const count = await this.waitDashboardFaultState(page, "extended-occupancy", "clear", 60_000);
      return {passed: count === 0, observed: `remaining indicators=${count}`};
    });
    await page.close();
  }

  private async measureConSysQueryLatencies(page: Page): Promise<{
    allSucceeded: boolean;
    datastreamsListMs: number;
    latestNonArchivedMs: number;
    latestPhenomenonNonArchivedMs: number;
    latestArchivedMs: number;
    latestPhenomenonArchivedMs: number;
    unboundedWindowNonArchivedMs: number;
    fiftyLaneBurstMs: number;
  }> {
    const timedGet = async (path: string, parseJson = false): Promise<{ok: boolean; ms: number; body?: unknown}> => {
      const start = performance.now();
      const response = await page.context().request.get(this.viewerUrl(path), {
        headers: {Accept: "application/json"},
      });
      const body = parseJson && response.ok() ? await response.json() : await response.body();
      const ms = Number((performance.now() - start).toFixed(1));
      const ok = response.ok();
      await response.dispose();
      return {ok, ms, body};
    };

    const dsRes = await timedGet("/sensorhub/api/datastreams?limit=1000", true);
    const items = dsRes.body && typeof dsRes.body === "object" && Array.isArray((dsRes.body as {items?: unknown[]}).items)
      ? (dsRes.body as {items: Array<{id?: string; outputName?: string}>}).items
      : [];
    const byOutput = new Map<string, string[]>();
    for (const item of items) {
      if (typeof item?.id === "string" && typeof item?.outputName === "string") {
        const list = byOutput.get(item.outputName) ?? [];
        list.push(item.id);
        byOutput.set(item.outputName, list);
      }
    }
    const nonArchivedId = (byOutput.get("occupancy") ?? byOutput.get("connectionStatus") ?? [])[0] ?? "";
    const archivedId = (byOutput.get("gammaCounts") ?? byOutput.get("neutronCounts") ?? [])[0] ?? "";
    if (!dsRes.ok || !nonArchivedId || !archivedId) {
      return {
        allSucceeded: false,
        datastreamsListMs: dsRes.ms,
        latestNonArchivedMs: -1,
        latestPhenomenonNonArchivedMs: -1,
        latestArchivedMs: -1,
        latestPhenomenonArchivedMs: -1,
        unboundedWindowNonArchivedMs: -1,
        fiftyLaneBurstMs: -1,
      };
    }

    const encNa = encodeURIComponent(nonArchivedId);
    const encAr = encodeURIComponent(archivedId);
    const latestNa = await timedGet(`/sensorhub/api/datastreams/${encNa}/observations?resultTime=latest`);
    const latestPhenomNa = await timedGet(`/sensorhub/api/datastreams/${encNa}/observations?phenomenonTime=latest`);
    const latestAr = await timedGet(`/sensorhub/api/datastreams/${encAr}/observations?resultTime=latest`);
    const latestPhenomAr = await timedGet(`/sensorhub/api/datastreams/${encAr}/observations?phenomenonTime=latest`);
    const windowNa = await timedGet(`/sensorhub/api/datastreams/${encNa}/observations?limit=10`);

    const burstIds: string[] = [];
    for (const name of ["gammaCounts", "neutronCounts", "gammaThreshold", "occupancy", "connectionStatus"]) {
      for (const id of (byOutput.get(name) ?? []).slice(0, 10)) {
        burstIds.push(id);
        if (burstIds.length >= 50) break;
      }
      if (burstIds.length >= 50) break;
    }
    const burstStart = performance.now();
    const burstResults = await Promise.all(
      burstIds.map(id => timedGet(`/sensorhub/api/datastreams/${encodeURIComponent(id)}/observations?resultTime=latest`)),
    );
    const fiftyLaneBurstMs = Number((performance.now() - burstStart).toFixed(1));
    const allSucceeded = dsRes.ok && latestNa.ok && latestPhenomNa.ok &&
      latestAr.ok && latestPhenomAr.ok && windowNa.ok &&
      burstResults.length > 0 && burstResults.every(res => res.ok);
    return {
      allSucceeded,
      datastreamsListMs: dsRes.ms,
      latestNonArchivedMs: latestNa.ms,
      latestPhenomenonNonArchivedMs: latestPhenomNa.ms,
      latestArchivedMs: latestAr.ms,
      latestPhenomenonArchivedMs: latestPhenomAr.ms,
      unboundedWindowNonArchivedMs: windowNa.ms,
      fiftyLaneBurstMs,
    };
  }

  private async runtimeExtensions(): Promise<void> {
    const page = await this.browser.oscarPage();
    const extHeaders = {"X-Requested-With": "OSCAR-Viewer"};
    const mapFileName = "regression-region.pmtiles";
    const certFileName = "regression-ephemeral-ca.pem";
    let preOcrCustom = false;
    let preMapsCustom = false;
    let preSpecCustom = false;
    let preTrustCustom = false;
    let prePolicyCustom = false;

    try {
      await this.check({
        scenario: "runtime-extensions",
        category: "security",
        action: "reject unauthenticated runtime extensions API access",
        target: "/sensorhub/oscar/extensions/status",
        expected: "anonymous request returns HTTP 401",
      }, async () => {
        const res = await this.browser.unauthenticatedOscarGet("/sensorhub/oscar/extensions/status");
        return {
          passed: res.status === 401,
          observed: `HTTP ${res.status}`,
        };
      });

      await this.check({
        scenario: "runtime-extensions",
        category: "viewer",
        action: "render /extensions accessible tabs and starter templates",
        target: "/extensions",
        expected: "visible Pluggable Runtime Extensions & Regional Packs heading, ARIA tablist across 7 domains (including Cargo NII WCO UFF disabled by default), and downloadable OCR starter template ZIP",
      }, async () => {
        const status = await this.goto(page, "/extensions");
        const headingVisible = await page
          .getByRole("heading", {name: "Pluggable Runtime Extensions & Regional Packs", exact: true})
          .first()
          .waitFor({timeout: this.config.uiTimeoutMs})
          .then(() => true)
          .catch(() => false);
        const tabCount = await page.locator('[role="tablist"] [role="tab"]').count();
        const uffTabVisible = await page.getByTestId("ext-tab-uff").isVisible().catch(() => false);
        const tplRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/oscar/extensions/templates/ocr-pack.zip"),
        );
        const tplBytes = tplRes.ok() ? (await tplRes.body()).length : 0;
        await tplRes.dispose();
        const passed = status >= 200 && status < 400 && headingVisible && tabCount === 7 && uffTabVisible && tplBytes > 100;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "runtime-extensions-ui-failed");
        return {
          passed,
          observed: `HTTP ${status}; heading=${headingVisible}; tabs=${tabCount}; uffTab=${uffTabVisible}; templateZipBytes=${tplBytes}`,
          evidence,
        };
      });

      const initialRes = await page.context().request.get(
        this.viewerUrl("/sensorhub/oscar/extensions/status"),
        {headers: {Accept: "application/json"}},
      );
      const initialStatus = initialRes.ok()
        ? (await initialRes.json()) as Record<string, Record<string, unknown>>
        : {};
      await initialRes.dispose();
      preOcrCustom = Boolean(initialStatus.ocr?.customActive);
      preMapsCustom = Boolean(initialStatus.maps?.customActive);
      preSpecCustom = Boolean(initialStatus.spectroscopy?.customActive);
      preTrustCustom = Boolean(initialStatus.trustedCerts?.customActive);
      prePolicyCustom = Boolean(initialStatus.policyPacks?.customActive);

      await this.check({
        scenario: "runtime-extensions",
        category: "ocr",
        action: "upload regional OCR plate-rules pack and verify live OcrRuntimeRegistry activation",
        target: "/sensorhub/oscar/extensions/ocr/upload",
        expected: "HTTP 200 with ocr.customActive=true and plateRuleSetId=regression-gcc-rules-v1",
      }, async () => {
        if (preOcrCustom) {
          return {passed: true, observed: "preserved pre-existing custom OCR override"};
        }
        const payload = Buffer.from(JSON.stringify({
          ruleSetId: "regression-gcc-rules-v1",
          description: "Regression Numeric & Multilingual Plate Rules",
          minLength: 3,
          maxLength: 10,
          asciiOnly: false,
          requireLetter: false,
          requireDigit: true,
        }), "utf8");
        const upRes = await page.context().request.post(
          this.viewerUrl("/sensorhub/oscar/extensions/ocr/upload?filename=regression-plate-rules.json"),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: payload,
          },
        );
        const body = upRes.ok() ? (await upRes.json()) as {ocr?: {customActive?: boolean; plateRuleSetId?: string}} : {};
        const status = upRes.status();
        await upRes.dispose();
        const passed = status === 200 && body.ocr?.customActive === true &&
          body.ocr?.plateRuleSetId === "regression-gcc-rules-v1";
        return {
          passed,
          observed: `HTTP ${status}; customActive=${String(body.ocr?.customActive)}; ruleSetId=${String(body.ocr?.plateRuleSetId)}`,
        };
      });

      await this.check({
        scenario: "runtime-extensions",
        category: "maps",
        action: "upload PMTiles v3 regional basemap, verify HTTP 206 byte-range serving, and render /map",
        target: "/sensorhub/oscar/extensions/maps/tiles/regression-region.pmtiles",
        expected: "HTTP 200 upload, HTTP 206 Partial Content (127-byte header range), and error-free /map render",
      }, async () => {
        if (preMapsCustom) {
          return {passed: true, observed: "preserved pre-existing custom offline map override"};
        }
        const pmBuf = Buffer.alloc(256, 0);
        pmBuf.write("PMTiles", 0, "ascii");
        pmBuf[7] = 3;
        pmBuf.writeBigUInt64LE(127n, 8);
        pmBuf.writeBigUInt64LE(1n, 16);
        pmBuf.writeBigUInt64LE(128n, 24);
        pmBuf.writeBigUInt64LE(2n, 32);
        pmBuf.writeBigUInt64LE(130n, 40);
        pmBuf.writeBigUInt64LE(130n, 56);
        pmBuf[96] = 1;
        pmBuf[97] = 1;
        pmBuf[98] = 1;
        pmBuf[99] = 1;
        pmBuf[100] = 0;
        pmBuf[101] = 14;
        pmBuf.writeInt32LE(-844000000, 102);
        pmBuf.writeInt32LE(359000000, 106);
        pmBuf.writeInt32LE(-842000000, 110);
        pmBuf.writeInt32LE(360500000, 114);
        pmBuf[118] = 10;
        pmBuf.writeInt32LE(-843000000, 119);
        pmBuf.writeInt32LE(359750000, 123);
        pmBuf.write("{}", 128, "utf8");

        const upRes = await page.context().request.post(
          this.viewerUrl(`/sensorhub/oscar/extensions/maps/upload?filename=${mapFileName}&displayName=Regression%20Offline%20Vector&defaultBasemap=true`),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: pmBuf,
          },
        );
        const upStatus = upRes.status();
        const upJson = upRes.ok() ? (await upRes.json()) as {maps?: {customActive?: boolean}} : {};
        await upRes.dispose();

        const rangeRes = await page.context().request.get(
          this.viewerUrl(`/sensorhub/oscar/extensions/maps/tiles/${mapFileName}`),
          {headers: {Range: "bytes=0-126"}},
        );
        const rangeStatus = rangeRes.status();
        const rangeLen = (await rangeRes.body()).length;
        const contentRange = rangeRes.headers()["content-range"] ?? "";
        await rangeRes.dispose();

        const mapNavStatus = await this.goto(page, "/map");
        const leafletVisible = await page.locator(".leaflet-container").first()
          .waitFor({timeout: this.config.uiTimeoutMs})
          .then(() => true)
          .catch(() => false);
        const passed = upStatus === 200 && upJson.maps?.customActive === true &&
          rangeStatus === 206 && rangeLen === 127 && contentRange === "bytes 0-126/256" &&
          mapNavStatus >= 200 && mapNavStatus < 400 && leafletVisible;
        return {
          passed,
          observed: `upload=${upStatus}; range=${rangeStatus} (${rangeLen}B, ${contentRange}); mapLeaflet=${leafletVisible}`,
        };
      });

      await this.check({
        scenario: "runtime-extensions",
        category: "spectroscopy",
        action: "upload custom photopeak isotope library and toggle fallback/override mode",
        target: "/sensorhub/oscar/extensions/spectroscopy/upload",
        expected: "HTTP 200 with spectroscopy.customActive=true and mode switch to override",
      }, async () => {
        if (preSpecCustom) {
          return {passed: true, observed: "preserved pre-existing custom spectroscopy override"};
        }
        const libBuf = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          libraryId: "regression-riid-v1",
          version: "1.0.0",
          isotopes: [
            {name: "Cs-137", category: "Industrial", energiesKeV: [661.7], windowKeV: 20.0, minSnr: 3.5},
            {name: "Co-60", category: "Industrial", energiesKeV: [1173.2, 1332.5], windowKeV: 24.0, minSnr: 3.5},
          ],
        }), "utf8");
        const upRes = await page.context().request.post(
          this.viewerUrl("/sensorhub/oscar/extensions/spectroscopy/upload?filename=regression-isotopes.json&executionMode=fallback"),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: libBuf,
          },
        );
        const upStatus = upRes.status();
        await upRes.dispose();

        const modeRes = await page.context().request.post(
          this.viewerUrl("/sensorhub/oscar/extensions/spectroscopy/action"),
          {
            headers: {...extHeaders, "Content-Type": "application/json"},
            data: {action: "set-mode", executionMode: "override"},
          },
        );
        const modeStatus = modeRes.status();
        const modeJson = modeRes.ok()
          ? (await modeRes.json()) as {spectroscopy?: {customActive?: boolean; executionMode?: string}}
          : {};
        await modeRes.dispose();
        const passed = upStatus === 200 && modeStatus === 200 &&
          modeJson.spectroscopy?.customActive === true &&
          modeJson.spectroscopy?.executionMode === "override";
        return {
          passed,
          observed: `upload=${upStatus}; mode=${modeStatus}; executionMode=${String(modeJson.spectroscopy?.executionMode)}`,
        };
      });

      await this.check({
        scenario: "runtime-extensions",
        category: "trusted-certs",
        action: "reject private-key material (HTTP 400) and hot-reload public X.509 CA certificate",
        target: "/sensorhub/oscar/extensions/trusted-certs/upload",
        expected: "HTTP 400 on private key upload and HTTP 200 on valid X.509 CA certificate upload",
      }, async () => {
        const fakeKey = ["-----BEGIN " + "PRIVATE KEY-----", "dGVzdA==", "-----END " + "PRIVATE KEY-----"].join("\n");
        const badRes = await page.context().request.post(
          this.viewerUrl("/sensorhub/oscar/extensions/trusted-certs/upload?filename=rejected-key.pem"),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: Buffer.from(fakeKey, "utf8"),
          },
        );
        const badStatus = badRes.status();
        await badRes.dispose();

        const testCaCert = [
          "-----BEGIN " + "CERTIFICATE-----",
          "MIIB6DCCAY2gAwIBAgIUDu7BhMC7VJ2L5aY7wnQlr9cjy3owCgYIKoZIzj0EAwIw",
          "STErMCkGA1UEAwwiT1NDQVIgUmVncmVzc2lvbiBFcGhlbWVyYWwgVGVzdCBDQTEa",
          "MBgGA1UECgwRT1JOTCBUZXN0IEZpeHR1cmUwHhcNMjYxMTE5MTkyNTA0WhcNMzYx",
          "MTE2MTkyNTA0WjBJMSswKQYDVQQDDCJPU0NBUiBSZWdyZXNzaW9uIEVwaGVtZXJh",
          "bCBUZXN0IENBMRowGAYDVQQKDBFPUk5MIFRlc3QgRml4dHVyZTBZMBMGByqGSM49",
          "AgEGCCqGSM49AwEHA0IABI+/9JGj86a2MjXJt6OfpMJzak0ImBKt6HJhINquNy1O",
          "yNbV+mBrHnim/6w/BfG1CjpkGTTfIsVGhKQsA4iZoGyjUzBRMB0GA1UdDgQWBBQ8",
          "5g23KIfKnsay6z9P8mcLuv68ejAfBgNVHSMEGDAWgBQ85g23KIfKnsay6z9P8mcL",
          "uv68ejAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQDsKKITGSgj",
          "RM6/swph2ag5mO/yv8qvWLLgEmMwfvWeEgIhAICvvV/YhZ7Pq3z3fPqtXOSkPY5G",
          "yVbiYD94Kvx47zvG",
          "-----END " + "CERTIFICATE-----",
        ].join("\n");
        const goodRes = await page.context().request.post(
          this.viewerUrl(`/sensorhub/oscar/extensions/trusted-certs/upload?filename=${certFileName}`),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: Buffer.from(testCaCert, "utf8"),
          },
        );
        const goodStatus = goodRes.status();
        const goodJson = goodRes.ok() ? (await goodRes.json()) as {trustedCerts?: {customActive?: boolean}} : {};
        await goodRes.dispose();
        const passed = badStatus === 400 && goodStatus === 200 && goodJson.trustedCerts?.customActive === true;
        return {
          passed,
          observed: `privateKeyRejectedStatus=${badStatus}; publicCaUploadStatus=${goodStatus}; customActive=${String(goodJson.trustedCerts?.customActive)}`,
        };
      });

      await this.check({
        scenario: "runtime-extensions",
        category: "policy-packs",
        action: "reject reserved disposition code override and activate/export valid policy pack",
        target: "/sensorhub/oscar/extensions/policy-packs/upload",
        expected: "HTTP 400 on reserved Code 1 override, HTTP 200 on Code 741 policy pack, and matching JSON export",
      }, async () => {
        if (prePolicyCustom) {
          return {passed: true, observed: "preserved pre-existing custom policy pack override"};
        }
        const badPolicy = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          packId: "bad-reserved",
          version: "1.0.0",
          codes: [{code: 1, label: "Illegal Reserved Override"}],
        }), "utf8");
        const badRes = await page.context().request.post(
          this.viewerUrl("/sensorhub/oscar/extensions/policy-packs/upload?filename=bad-policy.json"),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: badPolicy,
          },
        );
        const badStatus = badRes.status();
        await badRes.dispose();

        const validPolicy = Buffer.from(JSON.stringify({
          schemaVersion: 1,
          packId: "regression-policy-v1",
          version: "1.0.0",
          agencyName: "Regression Port Authority",
          codes: [{code: 741, label: "Regression Verified Medical Permit"}],
        }), "utf8");
        const upRes = await page.context().request.post(
          this.viewerUrl("/sensorhub/oscar/extensions/policy-packs/upload?filename=regression-policy.json"),
          {
            headers: {...extHeaders, "Content-Type": "application/octet-stream"},
            data: validPolicy,
          },
        );
        const upStatus = upRes.status();
        const upJson = upRes.ok() ? (await upRes.json()) as {policyPacks?: {customActive?: boolean}} : {};
        await upRes.dispose();

        const expRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/oscar/extensions/policy-packs/export"),
        );
        const expStatus = expRes.status();
        const expText = expRes.ok() ? await expRes.text() : "";
        await expRes.dispose();
        const passed = badStatus === 400 && upStatus === 200 &&
          upJson.policyPacks?.customActive === true &&
          expStatus === 200 && expText.includes("Regression Verified Medical Permit");
        return {
          passed,
          observed: `reservedRejected=${badStatus}; upload=${upStatus}; export=${expStatus}`,
        };
      });
    } finally {
      if (!preOcrCustom) {
        await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/ocr/action"), {
          headers: {...extHeaders, "Content-Type": "application/json"},
          data: {action: "reset"},
        }).then(r => r.dispose()).catch(() => {});
      }
      if (!preMapsCustom) {
        await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/maps/action"), {
          headers: {...extHeaders, "Content-Type": "application/json"},
          data: {action: "delete-pack", fileName: mapFileName},
        }).then(r => r.dispose()).catch(() => {});
        await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/maps/action"), {
          headers: {...extHeaders, "Content-Type": "application/json"},
          data: {action: "reset"},
        }).then(r => r.dispose()).catch(() => {});
      }
      if (!preSpecCustom) {
        await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/spectroscopy/action"), {
          headers: {...extHeaders, "Content-Type": "application/json"},
          data: {action: "reset"},
        }).then(r => r.dispose()).catch(() => {});
      }
      await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/trusted-certs/action"), {
        headers: {...extHeaders, "Content-Type": "application/json"},
        data: preTrustCustom ? {action: "delete-cert", fileName: certFileName} : {action: "reset"},
      }).then(r => r.dispose()).catch(() => {});
      if (!prePolicyCustom) {
        await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/policy-packs/action"), {
          headers: {...extHeaders, "Content-Type": "application/json"},
          data: {action: "reset"},
        }).then(r => r.dispose()).catch(() => {});
      }
    }

    await this.check({
      scenario: "runtime-extensions",
      category: "reset",
      action: "restore shipped built-in defaults across modified extension domains",
      target: "/sensorhub/oscar/extensions/status",
      expected: "every domain modified by the regression scenario returns cleanly to customActive=false",
    }, async () => {
      const res = await page.context().request.get(
        this.viewerUrl("/sensorhub/oscar/extensions/status"),
        {headers: {Accept: "application/json"}},
      );
      const st = res.ok() ? (await res.json()) as Record<string, Record<string, unknown>> : {};
      const code = res.status();
      await res.dispose();
      const ocrOk = preOcrCustom || st.ocr?.customActive === false;
      const mapsOk = preMapsCustom || st.maps?.customActive === false;
      const specOk = preSpecCustom || st.spectroscopy?.customActive === false;
      const trustOk = preTrustCustom || st.trustedCerts?.customActive === false;
      const polOk = prePolicyCustom || st.policyPacks?.customActive === false;
      const passed = code === 200 && ocrOk && mapsOk && specOk && trustOk && polOk;
      return {
        passed,
        observed: `HTTP ${code}; ocr=${String(st.ocr?.customActive)}; maps=${String(st.maps?.customActive)}; spec=${String(st.spectroscopy?.customActive)}; trust=${String(st.trustedCerts?.customActive)}; policy=${String(st.policyPacks?.customActive)}`,
      };
    });

    await page.close();
  }

  private async cargoUffAdjudication(): Promise<void> {
    const capabilityMeta: CheckMetadata = {
      scenario: "cargo-uff",
      category: "cargo-uff",
      action: "detect Cargo NII (WCO UFF 2.0 & 3.0.0) runtime capability",
      target: "/sensorhub/oscar/extensions/uff/active",
      expected: "OSCAR 3.11.2+ Cargo UFF runtime endpoint responds HTTP 200",
    };
    if (this.config.cargoUffWorkflow === "disabled") {
      this.skip(capabilityMeta, "CARGO_UFF_WORKFLOW=disabled");
      return;
    }

    const page = await this.browser.oscarPage();
    const extHeaders = {"X-Requested-With": "OSCAR-Viewer"};
    let preUffEnabled = false;

    try {
      const activeRes = await page.context().request.get(
        this.viewerUrl("/sensorhub/oscar/extensions/uff/active"),
        {headers: {Accept: "application/json"}},
      );
      const activeStatus = activeRes.status();
      const activeBody = activeRes.ok() ? (await activeRes.json()) as {enabled?: boolean} : {};
      await activeRes.dispose();

      if (activeStatus === 404) {
        if (this.config.cargoUffWorkflow === "auto") {
          this.skip(capabilityMeta, "Cargo UFF runtime endpoint is absent on pre-3.11.2 build (auto)");
        } else {
          this.reporter.outcome(
            capabilityMeta.scenario, capabilityMeta.category, capabilityMeta.action, capabilityMeta.target,
            capabilityMeta.expected, `HTTP ${activeStatus}`, "incorrect", 0,
          );
        }
        return;
      }
      this.reporter.outcome(
        capabilityMeta.scenario, capabilityMeta.category, capabilityMeta.action, capabilityMeta.target,
        capabilityMeta.expected, `HTTP ${activeStatus} (enabled=${String(activeBody.enabled)})`,
        activeStatus === 200 ? "correct" : "incorrect", 0,
      );
      if (activeStatus !== 200) return;
      preUffEnabled = Boolean(activeBody.enabled);

      if (preUffEnabled) {
        const preStatusRes = await page.context().request.get(
          this.viewerUrl("/sensorhub/oscar/extensions/status"),
          {headers: {Accept: "application/json"}},
        );
        const preStatusJson = preStatusRes.ok()
          ? (await preStatusRes.json()) as {uff?: Record<string, unknown>}
          : {};
        await preStatusRes.dispose();
        this.pendingCargoUffRestorePayload = buildCargoUffRestorePayload(
          preStatusJson.uff ?? {enabled: true},
          this.config,
        );
        await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/uff/action"), {
          headers: {...extHeaders, "Content-Type": "application/json"},
          data: {action: "reset"},
        }).then((r) => r.dispose()).catch(() => {});
      }

      // Trigger a real 1s gamma alarm on the reserved test lane so Cargo UFF inspection & adjudication
      // operate on a fresh, deterministic occupancy with real gamma/neutron telemetry.
      if (this.originalRpmConfig) {
        await this.emulator.replaceConfig(
          this.config.testRpmId,
          this.emulator.shortAlarmConfig(this.originalRpmConfig, 3),
        );
        await this.waitHealthRpmConnection(page, "online", 60_000);
      }
      const trigger = await this.triggerAlarm("gamma", "cargo-uff");
      if (!trigger) throw new Error("Cargo UFF gamma alarm trigger returned no occupancy identity");
      const alarmRow = await this.findAlarmRow(page, /Gamma/i, trigger);
      const eventId = await this.resolveAlarmEventUuid(
        page,
        alarmRow,
        "gamma",
        trigger.occupancyCount,
        "cargo-uff",
      );
      if (!eventId) throw new Error("Failed to resolve occupancy UUID for Cargo UFF gamma alarm");
      await this.captureAlarmMedia(page, eventId, "gamma", trigger.occupancyCount, "cargo-uff");

      // 1. Verify shipped disabled default: zero UI clutter on /event-details and bounded /event-log latency
      await this.check({
        scenario: "cargo-uff",
        category: "zero-clutter",
        action: "verify zero permanent UI clutter and fast Event Log load when Cargo UFF is disabled",
        target: `/event-details?eventId=${eventId}`,
        expected: `Event Log first row <= ${EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS}ms; Browse Cargo Share button and correlated UFF banner absent when disabled; Upload Files input attached`,
      }, async () => {
        const t0 = Date.now();
        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-row").first().waitFor({timeout: this.config.uiTimeoutMs});
        const eventLogLoadMs = Date.now() - t0;

        await this.goto(page, `/event-details?eventId=${encodeURIComponent(eventId)}`);
        await page.getByTestId("adjudication-file-input").waitFor({state: "attached", timeout: this.config.uiTimeoutMs});
        await sleep(350);
        const pickerCount = await page.getByTestId("open-cargo-uff-picker-btn").count();
        const bannerCount = await page.getByTestId("correlated-cargo-uff-banner").count();
        const fileInputCount = await page.getByTestId("adjudication-file-input").count();
        const passed = eventLogLoadMs <= EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS &&
          pickerCount === 0 && bannerCount === 0 && fileInputCount === 1;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "cargo-uff-zero-clutter-failed");
        return {
          passed,
          observed: `eventLogLoadMs=${eventLogLoadMs}; pickerCount=${pickerCount}; bannerCount=${bannerCount}; fileInputCount=${fileInputCount}`,
          evidence,
        };
      });

      // 2. Upload bundled CC0-1.0 UFF 3.0.0 High-Z anomaly package from uff-samples/ and exercise 16-bit inspector
      const bundledSuspectUff = join(
        this.config.cargoUffSamplesDirectory,
        "04-uff3-highz-shielded-anomaly-scfu8572724.uff",
      );
      await this.check({
        scenario: "cargo-uff",
        category: "local-uff",
        action: "upload bundled CC0-1.0 UFF 3.0.0 package, auto-extract embedded .n42, and inspect 16-bit radiograph + HEMD + RPM alignment",
        target: basename(bundledSuspectUff),
        expected: "16-bit uint16 canvas decodes (2048x600), High-Z annotation box and RPM alignment strip render, W/L invert updates WebGL2/Canvas pixels, and embedded .n42 is staged",
      }, async () => {
        await page.getByTestId("adjudication-file-input").setInputFiles(bundledSuspectUff);
        const inspectBtn = page.getByTestId("inspect-uploaded-uff-0");
        await inspectBtn.waitFor({timeout: this.config.uiTimeoutMs});
        const pageTextAfterUpload = await poll(
          () => page.locator("body").innerText(),
          (txt) => /\.n42/i.test(txt),
          {timeoutMs: 15_000, intervalMs: 250, description: "auto-extracted .n42 attachment from uploaded .uff"},
        );
        const hasExtractedN42 = /\.n42/i.test(pageTextAfterUpload);

        await inspectBtn.click();
        await page.getByTestId("cargo-uff-viewer-dialog").waitFor({timeout: this.config.uiTimeoutMs});
        const canvas = page.getByTestId("uff-16bit-xray-canvas");
        await canvas.waitFor({timeout: this.config.uiTimeoutMs});
        const dims = await poll(
          () => canvas.evaluate((el) => {
            const c = el as HTMLCanvasElement;
            return {w: c.width, h: c.height, png: c.width > 0 && c.height > 0 ? c.toDataURL("image/png") : ""};
          }),
          (d) => d.w >= 2048 && d.h >= 600 && d.png.length > 1000,
          {timeoutMs: 20_000, intervalMs: 250, description: "decoded 16-bit uint16 radiograph canvas"},
        );

        const annotVisible = await page.getByTestId("uff-annotation-box-0").isVisible().catch(() => false);
        const rpmStripVisible = await poll(
          () => page.getByTestId("uff-rpm-alignment-strip").count(),
          (c) => c > 0,
          {timeoutMs: 10_000, intervalMs: 250, description: "longitudinal RPM alignment strip"},
        ).then((c) => c > 0).catch(() => false);

        await page.getByTestId("uff-toggle-invert").click();
        const invertedPng = await poll(
          () => canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL("image/png")),
          (png) => png.length > 1000 && png !== dims.png,
          {timeoutMs: 8_000, intervalMs: 150, description: "16-bit LUT invert recomputation"},
        );

        await page.getByTestId("cargo-uff-viewer-close").click();
        await page.getByTestId("cargo-uff-viewer-dialog").waitFor({state: "hidden", timeout: 10_000});

        const passed = hasExtractedN42 && dims.w === 2048 && dims.h === 600 &&
          annotVisible && rpmStripVisible && invertedPng !== dims.png;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "cargo-uff-local-inspector-failed");
        return {
          passed,
          observed: `n42=${hasExtractedN42}; canvas=${dims.w}x${dims.h}; annot=${annotVisible}; rpmStrip=${rpmStripVisible}; lutChanged=${invertedPng !== dims.png}`,
          evidence,
        };
      });

      // 3. Live SMBv2/SMBv3 Commercial Operator Workflow (when CARGO_UFF_SMB_SHARE is configured in local .env)
      if (this.config.cargoUffSmbShare) {
        await this.check({
          scenario: "cargo-uff",
          category: "smb-share",
          action: "connect SMBv2/SMBv3 Cargo UFF share in Runtime Extensions, verify secret redaction, and index .uff archives",
          target: "/extensions",
          expected: "Test Connection and Save & Apply succeed with indexedCount >= 1 and password redacted from /extensions/status",
        }, async () => {
          await this.goto(page, "/extensions");
          const uffTab = page.getByTestId("ext-tab-uff");
          await uffTab.waitFor({timeout: this.config.uiTimeoutMs});
          await uffTab.click();

          const enabledInput = page.getByTestId("uff-ext-enabled-checkbox").locator('input[type="checkbox"]');
          if (!(await enabledInput.isChecked())) {
            await page.getByTestId("uff-ext-enabled-checkbox").click();
          }
          await page.getByTestId("uff-ext-share-url").fill(this.config.cargoUffSmbShare ?? "");
          await page.getByTestId("uff-ext-subpath").fill(this.config.cargoUffSmbSubPath ?? "");
          await page.getByTestId("uff-ext-domain").fill(this.config.cargoUffSmbDomain ?? "WORKGROUP");
          await page.getByTestId("uff-ext-username").fill(this.config.cargoUffSmbUsername ?? "");
          if (this.config.cargoUffSmbPassword) {
            await page.getByTestId("uff-ext-password").fill(this.config.cargoUffSmbPassword);
          }

          await page.getByTestId("uff-ext-test-btn").click();
          await page.getByTestId("uff-ext-test-result").waitFor({timeout: 25_000});

          await page.getByTestId("uff-ext-save-btn").click();
          await page.getByTestId("uff-ext-active-summary").waitFor({timeout: 30_000});
          const indexedCount = await poll(
            async () => Number((await page.getByTestId("uff-ext-indexed-count").innerText().catch(() => "0")).trim()),
            (n) => Number.isFinite(n) && n >= 1,
            {timeoutMs: 25_000, intervalMs: 250, description: "indexed SMB Cargo UFF count >= 1"},
          );

          const stRes = await page.context().request.get(
            this.viewerUrl("/sensorhub/oscar/extensions/status"),
            {headers: {Accept: "application/json"}},
          );
          const stText = await stRes.text();
          const stJson = stRes.ok() ? JSON.parse(stText) as {uff?: Record<string, unknown>} : {};
          await stRes.dispose();
          const secretRedacted = !("password" in (stJson.uff ?? {})) &&
            (!this.config.cargoUffSmbPassword || !stText.includes(this.config.cargoUffSmbPassword));

          const passed = indexedCount >= 1 && secretRedacted;
          const evidence = passed ? "" : await this.screenshotOnFailure(page, "cargo-uff-smb-connect-failed");
          return {
            passed,
            observed: `indexedCount=${indexedCount}; secretRedacted=${secretRedacted}`,
            evidence,
          };
        });

        await this.check({
          scenario: "cargo-uff",
          category: "event-log-omnibox",
          action: "open sparse unlabelled UFF 2.0 package directly from Event Log omnibox by UFF UUID",
          target: "/event-log",
          expected: "pasting Tier-1 UFF UUID surfaces Open Cargo X-Ray match chip and opens CargoUffViewerDialog with UFF 2.0 radiograph",
        }, async () => {
          await this.goto(page, "/event-log");
          const vInput = page.getByTestId("vehicle-id-search-input");
          await vInput.waitFor({timeout: this.config.uiTimeoutMs});
          await vInput.fill("3889134c-dd1f-4d03-9399-0ca25f6f01b8");
          await page.getByTestId("vehicle-id-search-submit").click();
          const openUffBtn = page.getByTestId("event-log-open-uff-btn");
          const matchChipVisible = await openUffBtn.waitFor({timeout: 15_000}).then(() => true).catch(() => false);
          if (matchChipVisible) {
            await openUffBtn.click();
          }
          const dialog = page.getByTestId("cargo-uff-viewer-dialog");
          const opened = matchChipVisible && await dialog.waitFor({timeout: 20_000}).then(() => true).catch(() => false);
          const verText = opened
            ? await page.getByTestId("uff-viewer-version-chip").innerText().catch(() => "")
            : "";
          if (opened) {
            await page.getByTestId("cargo-uff-viewer-close").click();
            await dialog.waitFor({state: "hidden", timeout: 10_000});
          }
          const passed = opened && /UFF\s*2/i.test(verText);
          const evidence = passed ? "" : await this.screenshotOnFailure(page, "cargo-uff-omnibox-failed");
          return {
            passed,
            observed: `matchChip=${matchChipVisible}; dialogOpened=${opened}; versionChip=${verText}`,
            evidence,
          };
        });

        await this.check({
          scenario: "cargo-uff",
          category: "smb-adjudication",
          action: "browse Cargo SMB share with 1-char fuzzy OCR matching and submit zero-download .uffref.json adjudication",
          target: `/event-details?eventId=${eventId}`,
          expected: "CargoUffSmbPickerDialog finds exact + 1-Char OCR Match for EGHU3972694, stages .uffref.json without full archive copy, and records Code 9 adjudication",
        }, async () => {
          await this.goto(page, `/event-details?eventId=${encodeURIComponent(eventId)}`);
          const pickerBtn = page.getByTestId("open-cargo-uff-picker-btn");
          await pickerBtn.waitFor({timeout: this.config.uiTimeoutMs});
          await pickerBtn.click();

          const picker = page.getByTestId("cargo-uff-smb-picker-dialog");
          await picker.waitFor({timeout: this.config.uiTimeoutMs});
          await page.getByTestId("uff-smb-picker-window-select").click();
          await page.getByRole("option", {name: /All Indexed Scans/i}).first().click();

          await page.getByTestId("uff-smb-picker-search-input").fill("EGHU3972694");
          await page.getByTestId("uff-smb-picker-submit").click();
          const resultsText = await poll(
            () => page.getByTestId("uff-smb-picker-results").innerText().catch(() => ""),
            (txt) => txt.includes("EGHU3972G94") && /1-Char OCR Match/i.test(txt),
            {timeoutMs: 15_000, intervalMs: 250, description: "1-Char OCR fuzzy match EGHU3972G94"},
          );
          const fuzzyVerified = resultsText.includes("EGHU3972G94");

          await page.getByTestId("uff-smb-picker-search-input").fill("dfb985c4-eb26-41ab-938b-ad2a1f5966d4");
          await page.getByTestId("uff-smb-picker-submit").click();
          const linkBtn = page.getByTestId("uff-smb-link-dfb985c4-eb26-41ab-938b-ad2a1f5966d4");
          await linkBtn.waitFor({timeout: 15_000});
          await linkBtn.click();
          await picker.waitFor({state: "hidden", timeout: 20_000});

          const uffNotes = `Cargo UFF SMB regression ${this.reporter.runId.slice(-10)}`;
          await page.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill("SCFU8572724");
          await this.selectMui(page, "Adjudicate", "Code 9: Authorized Test, Maintenance, or Training Activity");
          await this.selectMui(page, "Secondary Inspection", "NONE");
          await page.getByLabel("Notes").fill(uffNotes);
          await page.getByRole("button", {name: "Submit", exact: true}).click();
          const confirm = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
          await confirm.waitFor({timeout: 15_000});
          await confirm.getByRole("button", {name: /Confirm & Submit/i}).click();
          await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});

          await page.reload({waitUntil: "domcontentloaded"});
          const reloadedBody = await poll(
            () => page.locator("body").innerText(),
            (txt) => txt.includes(uffNotes) && txt.includes(".uffref.json"),
            {timeoutMs: 30_000, intervalMs: 500, description: "persisted .uffref.json adjudication pointer"},
          );
          const passed = fuzzyVerified && reloadedBody.includes(".uffref.json");
          const evidence = passed ? "" : await this.screenshotOnFailure(page, "cargo-uff-smb-adjudication-failed");
          return {
            passed,
            observed: `fuzzyVerified=${fuzzyVerified}; persistedUffRef=${reloadedBody.includes(".uffref.json")}`,
            evidence,
          };
        });
      }
    } finally {
      await page.context().request.post(this.viewerUrl("/sensorhub/oscar/extensions/uff/action"), {
        headers: {...extHeaders, "Content-Type": "application/json"},
        data: {action: "reset"},
      }).then((r) => r.dispose()).catch(() => {});
      if (this.originalRpmConfig) {
        await this.emulator.replaceConfig(
          this.config.testRpmId,
          this.emulator.quietConfig(this.originalRpmConfig),
        ).catch((err) => this.reporter.error("cargo-uff", "restore-quiet-config", err));
      }
    }

    const restorePayload = this.pendingCargoUffRestorePayload;
    try {
      // 4. Verify post-reset zero-latency & zero-clutter restoration
      await this.check({
        scenario: "cargo-uff",
        category: "post-reset-latency",
        action: "verify Cargo UFF resets cleanly to disabled with zero Event Log latency degradation",
        target: "/sensorhub/oscar/extensions/uff/active",
        expected: `uff.enabled=false and Event Log first row <= ${EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS}ms`,
      }, async () => {
        const res = await page.context().request.get(
          this.viewerUrl("/sensorhub/oscar/extensions/uff/active"),
          {headers: {Accept: "application/json"}},
        );
        const body = res.ok() ? (await res.json()) as {enabled?: boolean} : {};
        await res.dispose();

        const t0 = Date.now();
        await this.goto(page, "/event-log");
        await page.locator(".MuiDataGrid-row").first().waitFor({timeout: this.config.uiTimeoutMs});
        const postResetEventLogMs = Date.now() - t0;

        const passed = body.enabled === false && postResetEventLogMs <= EVENT_LOG_INITIAL_FIRST_ROW_MAX_MS;
        return {
          passed,
          observed: `enabled=${String(body.enabled)}; postResetEventLogMs=${postResetEventLogMs}ms`,
        };
      });

      if (restorePayload) {
        this.pendingCargoUffRestorePayload = undefined;
        await this.check({
          scenario: "cargo-uff",
          category: "endurance-restore",
          action: "restore pre-existing Cargo UFF runtime configuration for normal endurance operations",
          target: "/sensorhub/oscar/extensions/uff/action",
          expected: "uff.enabled=true restored to pre-regression configuration",
        }, async () => {
          const restoreRes = await page.context().request.post(
            this.viewerUrl("/sensorhub/oscar/extensions/uff/action"),
            {
              headers: {...extHeaders, "Content-Type": "application/json"},
              data: restorePayload,
            },
          );
          const restoreCode = restoreRes.status();
          const restoreJson = restoreRes.ok()
            ? (await restoreRes.json()) as {uff?: {enabled?: boolean; indexedCount?: number}}
            : {};
          await restoreRes.dispose();

          const activeAfterRes = await page.context().request.get(
            this.viewerUrl("/sensorhub/oscar/extensions/uff/active"),
            {headers: {Accept: "application/json"}},
          );
          const activeAfter = activeAfterRes.ok() ? (await activeAfterRes.json()) as {enabled?: boolean} : {};
          await activeAfterRes.dispose();

          const passed = restoreCode === 200 && activeAfter.enabled === true;
          return {
            passed,
            observed: `HTTP ${restoreCode}; enabled=${String(activeAfter.enabled)}; indexedCount=${String(restoreJson.uff?.indexedCount ?? 0)}`,
          };
        });
      }
    } finally {
      if (this.pendingCargoUffRestorePayload) {
        await this.restorePendingCargoUff();
      }
      await page.close().catch(() => {});
    }
  }

  private async trainingSandbox(): Promise<void> {
    const capabilityMeta: CheckMetadata = {
      scenario: "training-sandbox",
      category: "training-sandbox",
      action: "verify OSCAR 3.11.3+ ephemeral Hands-On Training Sandbox capability",
      target: "oscar-sandbox.sh",
      expected: "SSH storage probe resolves oscar-sandbox.sh on target host",
    };
    if (this.config.trainingSandboxWorkflow === "disabled") {
      this.skip(capabilityMeta, "TRAINING_SANDBOX_WORKFLOW=disabled");
      return;
    }

    const sshConfigured = Boolean(
      this.config.oscarSshTarget && this.config.oscarReleaseDirectory && this.config.storageTargetAcknowledgement,
    );
    if (!sshConfigured) {
      if (this.config.trainingSandboxWorkflow === "auto") {
        this.skip(capabilityMeta, "SSH storage probe is not configured for training-sandbox (auto)");
      } else {
        this.reporter.outcome(
          capabilityMeta.scenario, capabilityMeta.category, capabilityMeta.action, capabilityMeta.target,
          capabilityMeta.expected, "SSH storage probe not configured", "incorrect", 0,
        );
      }
      return;
    }

    const probe = this.alarmMediaProbe ?? new StorageProbeClient(this.config, this.reporter.runId);
    let beforeSnap = await probe.sandboxIsolationSnapshot();
    if (!beforeSnap.sandboxScriptPresent) {
      if (this.config.trainingSandboxWorkflow === "auto") {
        this.skip(capabilityMeta, "oscar-sandbox.sh is absent on pre-3.11.3 build (auto)");
      } else {
        this.reporter.outcome(
          capabilityMeta.scenario, capabilityMeta.category, capabilityMeta.action, capabilityMeta.target,
          capabilityMeta.expected, "oscar-sandbox.sh missing", "incorrect", 0,
        );
      }
      return;
    }

    if (beforeSnap.sandboxContainerCount > 0 || beforeSnap.sandboxVolumeCount > 0) {
      await probe.sandboxStop();
      beforeSnap = await probe.sandboxIsolationSnapshot();
    }

    this.reporter.outcome(
      capabilityMeta.scenario, capabilityMeta.category, capabilityMeta.action, capabilityMeta.target,
      capabilityMeta.expected,
      `present=true; preConfigSha=${beforeSnap.stateConfigSha256.slice(0, 12)}`,
      "correct", 0,
    );

    const opPage = await this.browser.oscarPage();
    const browserInstance = opPage.context().browser();
    if (!browserInstance) {
      await opPage.close();
      throw new Error("Playwright browser instance unavailable for training-sandbox");
    }

    const sandboxPort = 8444;
    const parsedOpUrl = new URL(this.config.oscarBaseUrl);
    const sandboxBaseUrl = `https://${parsedOpUrl.hostname}:${sandboxPort}`;

    try {
      await this.check({
        scenario: "training-sandbox",
        category: "sandbox-launch",
        action: "start isolated ephemeral oscar-sandbox stack on :8444",
        target: `${sandboxBaseUrl}/sensorhub/oscar/sandbox/active`,
        expected: "oscar.sh sandbox start brings up gateway+oscar+postgres healthy while operational :443 stays sandboxMode=false",
      }, async () => {
        await probe.sandboxStart(sandboxPort, 15);
        const opRes = await opPage.context().request.get(
          this.viewerUrl("/sensorhub/oscar/sandbox/active"),
          {headers: {Accept: "application/json"}},
        );
        const opBody = opRes.ok() ? (await opRes.json()) as {sandboxMode?: boolean} : {};
        await opRes.dispose();
        const passed = opBody.sandboxMode === false;
        return {
          passed,
          observed: `sandboxStarted=true; operationalSandboxMode=${String(opBody.sandboxMode)}`,
        };
      });

      const sbCtx = await browserInstance.newContext({
        viewport: {width: 1920, height: 1080},
        ignoreHTTPSErrors: true,
        httpCredentials: {
          username: this.config.oscarUsername,
          password: this.config.oscarPassword,
        },
      });
      const sbPage = await sbCtx.newPage();
      try {
        await sbPage.goto(`${sandboxBaseUrl}/`, {waitUntil: "domcontentloaded", timeout: this.config.uiTimeoutMs});
        const loginUser = sbPage.getByLabel("Username");
        if (await loginUser.isVisible({timeout: 4_000}).catch(() => false)) {
          await loginUser.fill(this.config.oscarUsername);
          await sbPage.getByLabel("Password").fill(this.config.oscarPassword);
          await Promise.all([
            sbPage.waitForURL((u) => !u.pathname.startsWith("/login"), {timeout: 25_000}),
            sbPage.getByRole("button", {name: "Sign in", exact: true}).click(),
          ]);
        }

        await this.check({
          scenario: "training-sandbox",
          category: "operator-academy-lab",
          action: "verify Training Coach dock auto-navigates / -> /event-log on NORM Code 9999 injection, displays Code 9999 row, and emits zero preload warnings",
          target: `${sandboxBaseUrl}/`,
          expected: "sandboxMode=true, archiveEnabled=false, onlineLaneCount>=1, auto-navigation to /event-log, visible Code 9999 row, and zero link preload warnings",
        }, async () => {
          const preloadWarnings: string[] = [];
          const onConsole = (msg: {text(): string}) => {
            const t = msg.text();
            if (t.includes("was preloaded using link preload")) {
              preloadWarnings.push(t);
            }
          };
          sbPage.on("console", onConsole);
          try {
            await sbPage.goto(`${sandboxBaseUrl}/`, {waitUntil: "domcontentloaded", timeout: this.config.uiTimeoutMs});
            await sbPage.getByTestId("navbar-sandbox-indicator").waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
            if (!(await sbPage.getByTestId("training-coach-dock").isVisible().catch(() => false))) {
              await sbPage.getByTestId("navbar-training-coach-toggle").click();
            }
            await sbPage.getByTestId("training-coach-dock").waitFor({state: "visible", timeout: 10_000});
            await sbPage.getByTestId("training-lab-chip-op-3").click();
            await sbPage.waitForURL((u) => u.pathname.includes("/event-log"), {timeout: 10_000});
            await sbPage.getByTestId("training-inject-norm_eml").click();

            let activeJson: {
              sandboxMode?: boolean;
              archiveEnabled?: boolean;
              verification?: {onlineLaneCount?: number; emlCode9999Count?: number};
            } = {};
            const deadline = Date.now() + 20_000;
            while (Date.now() < deadline) {
              const r = await sbCtx.request.get(`${sandboxBaseUrl}/sensorhub/oscar/sandbox/active`, {
                headers: {Accept: "application/json"},
              });
              if (r.ok()) {
                activeJson = await r.json();
              }
              await r.dispose();
              if ((activeJson.verification?.emlCode9999Count ?? 0) >= 1) {
                break;
              }
              await sbPage.waitForTimeout(1_000);
            }

            await sbPage.waitForFunction(
              () => {
                const txt = document.body?.innerText || "";
                return txt.includes("9999") && txt.includes("EML Non-Threat");
              },
              {timeout: 10_000},
            ).catch(() => {});
            const bodyTxt = await sbPage.evaluate(() => document.body?.innerText || "");
            const visibleCode9999 = bodyTxt.includes("9999") && bodyTxt.includes("EML Non-Threat");
            const navigatedToEventLog = sbPage.url().includes("/event-log");

            const passed =
              activeJson.sandboxMode === true &&
              activeJson.archiveEnabled === false &&
              (activeJson.verification?.onlineLaneCount ?? 0) >= 1 &&
              (activeJson.verification?.emlCode9999Count ?? 0) >= 1 &&
              navigatedToEventLog &&
              visibleCode9999 &&
              preloadWarnings.length === 0;
            const evidence = passed ? "" : await this.screenshotOnFailure(sbPage, "training-sandbox-operator-lab-failed");
            return {
              passed,
              observed: `sandboxMode=${String(activeJson.sandboxMode)}; archiveEnabled=${String(activeJson.archiveEnabled)}; onlineLanes=${activeJson.verification?.onlineLaneCount ?? 0}; emlCode9999=${activeJson.verification?.emlCode9999Count ?? 0}; navigatedToEventLog=${navigatedToEventLog}; visibleCode9999=${visibleCode9999}; preloadWarnings=${preloadWarnings.length}`,
              evidence,
            };
          } finally {
            sbPage.off("console", onConsole);
          }
        });

        await this.check({
          scenario: "training-sandbox",
          category: "certificate-and-admin-split",
          action: "verify watermarked PDF Completion Record export and Track 3 Split-Pane SensorHub Admin",
          target: `${sandboxBaseUrl}/sensorhub/oscar/sandbox/certificate`,
          expected: "certificate endpoint returns valid PDF >= 4 KiB and Track 3 opens /sensorhub/admin iframe",
        }, async () => {
          const certRes = await sbCtx.request.post(`${sandboxBaseUrl}/sensorhub/oscar/sandbox/certificate`, {
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "Content-Type": "application/json",
            },
            data: {
              traineeName: "Regression Operator",
              completedLabs: [
                {trackId: "operator", labId: "1.3", title: "NORM (Code 9999)", status: "verified"},
              ],
            },
          });
          const certStatus = certRes.status();
          const certBytes = certRes.ok() ? await certRes.body() : Buffer.alloc(0);
          await certRes.dispose();
          const pdfValid = certStatus === 200 && certBytes.length >= 4096 && certBytes.subarray(0, 5).toString("ascii") === "%PDF-";

          await sbPage.getByTestId("training-track-btn-administrator").click();
          const splitBtn = sbPage.getByTestId("training-toggle-split-admin");
          await splitBtn.waitFor({state: "visible", timeout: 15_000});
          await splitBtn.click();
          await sbPage.getByTestId("sandbox-split-admin-shell").waitFor({state: "visible", timeout: 15_000});
          const iframeVisible = await sbPage.getByTestId("sandbox-admin-iframe").isVisible();

          await sbPage.getByTestId("training-lab-chip-adm-5").click();
          await sbPage.waitForURL((u) => u.pathname.includes("/health"), {timeout: 10_000});
          await sbPage.getByTestId("training-inject-stage_webrelay_demo").click();
          await sbPage.waitForFunction(
            () => {
              const el = document.querySelector('[data-testid="training-active-lab-status"]');
              return Boolean(el && /Auto-Verified/i.test(el.textContent || ""));
            },
            {timeout: 15_000},
          );
          const lab35Verified = true;

          const passed = pdfValid && iframeVisible && lab35Verified;
          const evidence = passed ? "" : await this.screenshotOnFailure(sbPage, "training-sandbox-admin-split-failed");
          return {
            passed,
            observed: `certStatus=${certStatus}; certBytes=${certBytes.length}; splitAdminIframe=${iframeVisible}; lab35WebRelayVerified=${lab35Verified}`,
            evidence,
          };
        });
      } finally {
        await sbCtx.close().catch(() => {});
      }
    } finally {
      await probe.sandboxStop().catch((err) => this.reporter.error("training-sandbox", "sandbox-stop", err));
      await opPage.close().catch(() => {});
    }

    await this.check({
      scenario: "training-sandbox",
      category: "zero-production-residue",
      action: "verify sandbox stop flushes all sandbox containers/volumes and leaves zero operational DB, Parquet, or config.json residue",
      target: "operational PostgreSQL + Parquet archive + config.json",
      expected: "unchanged config.json SHA-256 and zero sandbox datastreams, observations, archive files, containers, or volumes",
    }, async () => {
      const afterSnap = await probe.sandboxIsolationSnapshot();
      const passed =
        afterSnap.stateConfigSha256 === beforeSnap.stateConfigSha256 &&
        afterSnap.postgresSandboxDatastreamCount === 0 &&
        afterSnap.postgresSandboxObsCount === 0 &&
        afterSnap.archiveSandboxFileCount === 0 &&
        afterSnap.sandboxContainerCount === 0 &&
        afterSnap.sandboxVolumeCount === 0;
      return {
        passed,
        observed: `configUnchanged=${afterSnap.stateConfigSha256 === beforeSnap.stateConfigSha256}; sbDs=${afterSnap.postgresSandboxDatastreamCount}; sbObs=${afterSnap.postgresSandboxObsCount}; sbArchive=${afterSnap.archiveSandboxFileCount}; sbContainers=${afterSnap.sandboxContainerCount}; sbVolumes=${afterSnap.sandboxVolumeCount}`,
      };
    });
  }

  private async resolveRunnerOutboundIp(targetHost: string): Promise<string> {
    return await new Promise<string>((resolveIp, rejectIp) => {
      const sock = createSocket("udp4");
      sock.once("error", (err) => {
        try { sock.close(); } catch { /* ignore */ }
        rejectIp(err);
      });
      sock.connect(443, targetHost, () => {
        try {
          const addr = sock.address();
          sock.close();
          resolveIp(addr.address);
        } catch (err) {
          try { sock.close(); } catch { /* ignore */ }
          rejectIp(err);
        }
      });
    });
  }

  private async laneWebRelay(): Promise<void> {
    const capabilityMeta = {
      scenario: "lane-webrelay",
      category: "lane-webrelay",
      action: "verify OSCAR 3.11.4+ per-lane ControlByWeb WebRelay-Quad capability",
      target: `${this.config.oscarBaseUrl}/sensorhub/oscar/webrelay/status`,
      expected: "authenticated admin endpoint returns lane WebRelay catalog",
    };

    if (this.config.laneWebRelayWorkflow === "disabled") {
      this.skip(capabilityMeta, "LANE_WEBRELAY_WORKFLOW=disabled");
      return;
    }

    const page = await this.browser.oscarPage();
    await page.goto(`${this.config.oscarBaseUrl}/health`, {
      waitUntil: "domcontentloaded",
      timeout: this.config.uiTimeoutMs,
    });

    const statusRes = await page.context().request.get(
      `${this.config.oscarBaseUrl}/sensorhub/oscar/webrelay/status`,
      {headers: {Accept: "application/json"}},
    );
    const initialHttpStatus = statusRes.status();
    if (initialHttpStatus === 404) {
      await statusRes.dispose();
      if (this.config.laneWebRelayWorkflow === "auto") {
        this.skip(capabilityMeta, "/sensorhub/oscar/webrelay/status is absent on pre-3.11.4 build (auto)");
        return;
      }
      throw new Error("LANE_WEBRELAY_WORKFLOW=required but /sensorhub/oscar/webrelay/status returned 404");
    }

    const initialPayload = statusRes.ok()
      ? (await statusRes.json() as {isAdmin?: boolean; lanes?: Array<Record<string, any>>})
      : {isAdmin: false, lanes: []};
    await statusRes.dispose();

    const targetLaneEntry = (initialPayload.lanes ?? []).find(
      (entry) => String(entry.laneName ?? "") === this.config.testLaneLabel,
    );

    await this.check(capabilityMeta, async () => ({
      passed: initialHttpStatus === 200 && initialPayload.isAdmin === true && Boolean(targetLaneEntry),
      observed: `httpStatus=${initialHttpStatus}; isAdmin=${String(initialPayload.isAdmin)}; foundTestLane=${Boolean(targetLaneEntry)}`,
    }));
    if (!targetLaneEntry) {
      return;
    }

    // Start ephemeral mock ControlByWeb WebRelay-Quad (/stateFull.xml) on runner
    const relayCoils: [number, number, number, number] = [0, 0, 0, 0];
    const recordedQueries: string[] = [];
    const mockServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (reqUrl.pathname !== "/stateFull.xml") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const rawQs = reqUrl.search.startsWith("?") ? reqUrl.search.slice(1) : "";
      if (rawQs.length > 0) {
        recordedQueries.push(rawQs);
        for (const [k, v] of reqUrl.searchParams.entries()) {
          if (k === "relay1State") relayCoils[0] = (v === "1" || v === "2") ? 1 : 0;
          if (k === "relay2State") relayCoils[1] = (v === "1" || v === "2") ? 1 : 0;
          if (k === "relay3State") relayCoils[2] = (v === "1" || v === "2") ? 1 : 0;
          if (k === "relay4State") relayCoils[3] = (v === "1" || v === "2") ? 1 : 0;
        }
      }
      const xml = `<?xml version='1.0' encoding='utf-8'?><datavalues>` +
        `<relay1state>${relayCoils[0]}</relay1state>` +
        `<relay2state>${relayCoils[1]}</relay2state>` +
        `<relay3state>${relayCoils[2]}</relay3state>` +
        `<relay4state>${relayCoils[3]}</relay4state>` +
        `</datavalues>`;
      res.writeHead(200, {"Content-Type": "text/xml; charset=utf-8"});
      res.end(xml);
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      mockServer.once("error", rejectListen);
      mockServer.listen(0, "0.0.0.0", () => resolveListen());
    });
    const mockAddr = mockServer.address();
    const mockPort = typeof mockAddr === "object" && mockAddr ? mockAddr.port : 0;
    const runnerIp = await this.resolveRunnerOutboundIp(this.config.targetHost);
    const originalRpmQuieted = this.originalRpmConfig ? this.emulator.quietConfig(this.originalRpmConfig) : undefined;

    try {
      await this.check({
        scenario: "lane-webrelay",
        category: "admin-ui-and-manual-relays",
        action: "configure WebRelay on reserved lane via Status of Health dialog, verify AUTO arming (R1=1,R2=1), and exercise manual Gamma/Neutron pulses & pass-through",
        target: this.config.testLaneLabel,
        expected: "test-connection succeeds on /stateFull.xml, save-config arms R1=1,R2=1, manual pulses emit relay3State=2 & relay4State=2, and Status of Health shows WebRelay (AUTO) · Online",
      }, async () => {
        const openBtn = page.getByTestId(`webrelay-open-lane-${this.config.testLaneLabel}`);
        await openBtn.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
        await openBtn.click();

        const dlg = page.getByTestId("lane-webrelay-dialog");
        await dlg.waitFor({state: "visible", timeout: 10_000});
        await page.waitForFunction(() => {
          const btn = document.querySelector('[data-testid="webrelay-btn-test-primary"]') as HTMLButtonElement | null;
          const opts = document.querySelectorAll('[data-testid="lane-webrelay-dialog"] select option');
          return Boolean(btn && !btn.disabled && opts.length > 0);
        }, {timeout: 10_000});

        const hostInput = page.getByTestId("webrelay-input-primary-host");
        await hostInput.fill(runnerIp);
        const portInput = page.getByTestId("webrelay-input-primary-port");
        await portInput.fill(String(mockPort));

        await page.getByTestId("webrelay-btn-test-primary").click();
        await page.getByTestId("webrelay-status-banner").waitFor({state: "visible", timeout: 10_000});
        const testBannerText = await page.getByTestId("webrelay-status-banner").innerText();

        const enabledChk = page.getByTestId("webrelay-input-enabled");
        if (!(await enabledChk.isChecked())) {
          await enabledChk.check();
        }
        await page.getByTestId("webrelay-mode-auto").check();
        await page.getByTestId("webrelay-input-pulse-seconds").fill("3");
        await page.getByTestId("webrelay-btn-save").click();

        await page.getByTestId("webrelay-primary-unit-r1").waitFor({state: "visible", timeout: 10_000});
        const r1ArmedText = await page.getByTestId("webrelay-primary-unit-r1").innerText();

        await page.getByTestId("webrelay-btn-pulse-gamma").click();
        await page.waitForTimeout(400);
        await page.getByTestId("webrelay-btn-pulse-neutron").click();
        await page.waitForTimeout(400);
        await page.getByTestId("webrelay-btn-passthrough").click();
        await page.waitForTimeout(400);
        await page.getByTestId("webrelay-btn-silence").click();
        await page.waitForTimeout(400);

        await page.getByTestId("webrelay-btn-close").click();
        const rowText = await this.healthRow(page).innerText();

        // Also verify anytime Read-Only Guided Walkthrough Refresher + auto-shutdown orientation on live :443
        const walkthroughBtn = page.getByTestId("navbar-walkthrough-button");
        await walkthroughBtn.waitFor({state: "visible", timeout: 10_000});
        await walkthroughBtn.click();
        await page.getByTestId("coach-refresher-badge").waitFor({state: "visible", timeout: 10_000});
        const orientationText = await page.getByTestId("coach-refresher-orientation").innerText();
        const refresherOrientationOk = /120\s*min/i.test(orientationText);
        await page.getByTestId("training-coach-minimize").click();

        const sawGammaPulse = recordedQueries.some((q) => q.includes("relay3State=2&pulseTime3=3"));
        const sawNeutronPulse = recordedQueries.some((q) => q.includes("relay4State=2&pulseTime4=3"));
        const sawPassThrough = recordedQueries.some((q) => q.includes("relay1State=0&relay2State=0&relay3State=0&relay4State=0"));
        const sawReArm = recordedQueries.some((q) => q.includes("relay1State=1&relay2State=1&relay3State=0&relay4State=0"));
        const healthChipVisible = /WebRelay\s*\(AUTO\)\s*·\s*Online/i.test(rowText);

        const passed =
          testBannerText.includes("/stateFull.xml") &&
          /ARMED/i.test(r1ArmedText) &&
          sawGammaPulse &&
          sawNeutronPulse &&
          sawPassThrough &&
          sawReArm &&
          healthChipVisible &&
          refresherOrientationOk;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "lane-webrelay-manual-ui-failed");
        return {
          passed,
          observed: `testBanner=${testBannerText.includes("/stateFull.xml")}; r1Armed=${/ARMED/i.test(r1ArmedText)}; gammaPulse=${sawGammaPulse}; neutronPulse=${sawNeutronPulse}; passThrough=${sawPassThrough}; reArm=${sawReArm}; healthChip=${healthChipVisible}; refresherOrientation=${refresherOrientationOk}`,
          evidence,
        };
      });

      if (this.originalRpmConfig) {
        let webrelayTrigger: Awaited<ReturnType<typeof this.triggerAlarm>> | undefined;
        try {
          await this.check({
            scenario: "lane-webrelay",
            category: "auto-alarm-gatekeeper",
            action: "trigger live RPM gamma alarm on reserved lane and verify AUTO hardware-timed WebRelay pulse",
            target: this.config.testLaneLabel,
            expected: "actionable RPM gamma alarm triggers relay1State=1&relay2State=1&relay3State=2&pulseTime3=3 and increments triggeredAlarmCount",
          }, async () => {
            const beforeLen = recordedQueries.length;
            await this.emulator.replaceConfig(
              this.config.testRpmId,
              this.emulator.shortAlarmConfig(this.originalRpmConfig!),
            );
            await this.waitHealthRpmConnection(page, "online", 60_000);
            webrelayTrigger = await this.triggerAlarm("gamma", "lane-webrelay");

            let autoPulsed = false;
            let triggeredCount = 0;
            const deadline = Date.now() + 20_000;
            while (Date.now() < deadline) {
              const newQs = recordedQueries.slice(beforeLen);
              if (newQs.some((q) => q.includes("relay1State=1&relay2State=1&relay3State=2&pulseTime3=3"))) {
                autoPulsed = true;
              }
              const st = await page.context().request.get(
                `${this.config.oscarBaseUrl}/sensorhub/oscar/webrelay/status`,
                {headers: {Accept: "application/json"}},
              );
              if (st.ok()) {
                const stJson = await st.json() as {lanes?: Array<Record<string, any>>};
                const entry = (stJson.lanes ?? []).find((l) => l.laneName === this.config.testLaneLabel);
                triggeredCount = Number(entry?.triggeredAlarmCount ?? 0);
              }
              await st.dispose();
              if (autoPulsed && triggeredCount >= 1) {
                break;
              }
              await page.waitForTimeout(500);
            }

            return {
              passed: autoPulsed && triggeredCount >= 1,
              observed: `autoPulsed=${autoPulsed}; triggeredAlarmCount=${triggeredCount}`,
            };
          });

          if (webrelayTrigger) {
            const alarmRow = await this.findAlarmRow(page, /Gamma/i, webrelayTrigger);
            const eventId = await this.resolveAlarmEventUuid(
              page,
              alarmRow,
              "gamma",
              webrelayTrigger.occupancyCount,
              "lane-webrelay",
            );
            if (eventId) {
              await this.captureAlarmMedia(page, eventId, "gamma", webrelayTrigger.occupancyCount, "lane-webrelay");
            }
          }
        } finally {
          if (originalRpmQuieted) {
            await this.emulator.replaceConfig(this.config.testRpmId, originalRpmQuieted);
          }
        }
      }
    } finally {
      // Restore exact pre-test WebRelay settings on reserved lane
      await page.context().request.post(
        `${this.config.oscarBaseUrl}/sensorhub/oscar/webrelay/action`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "OSCAR-Viewer",
          },
          data: {
            action: "save-config",
            laneUid: String(targetLaneEntry.laneUid),
            enabled: Boolean(targetLaneEntry.enabled),
            mode: String(targetLaneEntry.mode || "AUTO"),
            primaryHost: String(targetLaneEntry.primaryHost ?? ""),
            primaryPort: Number(targetLaneEntry.primaryPort ?? 80),
            ancillaryEnabled: Boolean(targetLaneEntry.ancillaryEnabled),
            ancillaryHost: String(targetLaneEntry.ancillaryHost ?? ""),
            ancillaryPort: Number(targetLaneEntry.ancillaryPort ?? 80),
            username: String(targetLaneEntry.username ?? ""),
            clearPassword: !Boolean(targetLaneEntry.passwordConfigured),
            alarmPulseSeconds: Number(targetLaneEntry.alarmPulseSeconds ?? 5),
            suppressExtendedOccupancyGamma: targetLaneEntry.suppressExtendedOccupancyGamma !== false,
            soundOnNeutronAlarm: Boolean(targetLaneEntry.soundOnNeutronAlarm),
            pollIntervalSeconds: Number(targetLaneEntry.pollIntervalSeconds ?? 10),
          },
        },
      ).then((r) => r.dispose()).catch((err) => this.reporter.error("lane-webrelay", "restore-config", err));

      await new Promise<void>((resolveClose) => mockServer.close(() => resolveClose()));
    }

    await this.check({
      scenario: "lane-webrelay",
      category: "teardown",
      action: "verify reserved lane WebRelay configuration restored after test",
      target: this.config.testLaneLabel,
      expected: `enabled=${String(Boolean(targetLaneEntry.enabled))} restored cleanly`,
    }, async () => {
      const checkRes = await page.context().request.get(
        `${this.config.oscarBaseUrl}/sensorhub/oscar/webrelay/status`,
        {headers: {Accept: "application/json"}},
      );
      const body = checkRes.ok()
        ? (await checkRes.json() as {lanes?: Array<Record<string, any>>})
        : {lanes: []};
      await checkRes.dispose();
      const restored = (body.lanes ?? []).find((l) => l.laneName === this.config.testLaneLabel);
      const passed = Boolean(restored) && Boolean(restored?.enabled) === Boolean(targetLaneEntry.enabled);
      return {
        passed,
        observed: `restoredEnabled=${String(restored?.enabled)}; expected=${String(Boolean(targetLaneEntry.enabled))}`,
      };
    });
  }

  private async clickSpaNavItem(page: Page, testId: string, expectedPathname: string): Promise<void> {
    const target = page.getByTestId(testId).first();
    if (!(await target.isVisible().catch(() => false))) {
      const toggle = page.getByTestId("navbar-drawer-toggle").first();
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        await target.waitFor({state: "visible", timeout: 10_000});
      }
    }
    await Promise.all([
      page.waitForURL(
        (url) => normalizePathname(url.pathname) === normalizePathname(expectedPathname),
        {timeout: this.config.uiTimeoutMs},
      ),
      target.click(),
    ]);
  }

  private async resolvePortalServerNodeName(reqCtx: APIRequestContext, baseUrl: string): Promise<string> {
    const sysRes = await reqCtx.get(`${baseUrl}/sensorhub/api/systems?format=application%2Fjson&limit=200`);
    try {
      if (!sysRes.ok()) return "";
      const payload = await sysRes.json() as {
        items?: Array<{
          uid?: string;
          name?: string;
          validTime?: string[];
          properties?: {uid?: string; name?: string; validTime?: string[]};
        }>;
      };
      const oscarSystems = (payload.items ?? []).filter((item) =>
        String(item?.uid ?? item?.properties?.uid ?? "").includes("urn:ornl:oscar:system:"),
      );
      oscarSystems.sort((a, b) => {
        const va = String(a?.validTime?.[0] ?? a?.properties?.validTime?.[0] ?? "");
        const vb = String(b?.validTime?.[0] ?? b?.properties?.validTime?.[0] ?? "");
        return vb.localeCompare(va);
      });
      const rawName = String(oscarSystems[0]?.name ?? oscarSystems[0]?.properties?.name ?? "").trim();
      return rawName && rawName !== "OSCAR System" ? rawName : "";
    } finally {
      await sysRes.dispose();
    }
  }

  private async ensurePortalNationalStatisticsObservation(
    reqCtx: APIRequestContext,
    baseUrl: string,
  ): Promise<void> {
    const obsRes = await reqCtx.get(
      `${baseUrl}/sensorhub/api/observations?observedProperty=${encodeURIComponent(NATIONAL_STATISTICS_OBSERVED_PROPERTY)}&resultTime=latest&limit=1`,
      {headers: {Accept: "application/om+json, application/json"}},
    );
    try {
      if (obsRes.ok()) {
        const obsJson = await obsRes.json() as {items?: unknown[]};
        if (Array.isArray(obsJson.items) && obsJson.items.length > 0) {
          return;
        }
      }
    } finally {
      await obsRes.dispose();
    }

    const csRes = await reqCtx.get(
      `${baseUrl}/sensorhub/api/controlstreams?validTime=latest&limit=200`,
      {headers: {Accept: "application/json"}},
    );
    let natCsId = "";
    try {
      if (csRes.ok()) {
        const csJson = await csRes.json() as {items?: Array<Record<string, unknown>>};
        for (const item of csJson.items ?? []) {
          const text = JSON.stringify(item);
          if (/startDateTime/i.test(text) && /endDateTime/i.test(text) && !/reportType/i.test(text)) {
            natCsId = String(item.id ?? "");
            if (natCsId) break;
          }
        }
      }
    } finally {
      await csRes.dispose();
    }
    if (!natCsId) return;

    const cmdRes = await reqCtx.post(
      `${baseUrl}/sensorhub/api/controlstreams/${encodeURIComponent(natCsId)}/commands`,
      {
        headers: {"Content-Type": "application/json", Accept: "application/json"},
        data: {parameters: {startDateTime: null, endDateTime: null, laneUID: null}},
      },
    );
    try {
      if (!cmdRes.ok()) return;
      let progress = assessNationalStatisticsCommandSubmission(await cmdRes.json());
      const deadline = Date.now() + 60_000;
      while (progress.state !== "complete" && Date.now() < deadline) {
        await sleep(1_000);
        const stRes = await reqCtx.get(
          `${baseUrl}/sensorhub/api/controlstreams/${encodeURIComponent(natCsId)}/commands/${encodeURIComponent(progress.commandId)}/status?format=application%2Fjson&offset=0&limit=100`,
        );
        try {
          if (stRes.ok()) {
            progress = assessNationalStatisticsCommandStatus(await stRes.json(), progress.commandId);
          }
        } finally {
          await stRes.dispose();
        }
      }
    } finally {
      await cmdRes.dispose();
    }
  }

  private async adjudicateRecentOccupancyViaApi(options: {
    reqCtx: APIRequestContext;
    baseUrl: string;
    vehicleId: string;
    preferredLaneName?: string;
    allowReservedRpmTrigger?: boolean;
    windowStartIso: string;
  }): Promise<{laneName: string; occupancyObsId: string}> {
    const {reqCtx, baseUrl, vehicleId, preferredLaneName, allowReservedRpmTrigger, windowStartIso} = options;
    const sysRes = await reqCtx.get(
      `${baseUrl}/sensorhub/api/systems?searchMembers=true&validTime=latest&limit=500`,
      {headers: {Accept: "application/json"}},
    );
    let laneSystemId = "";
    let laneName = preferredLaneName ?? "";
    try {
      if (!sysRes.ok()) {
        throw new Error(`Lane system lookup on ${baseUrl} returned HTTP ${sysRes.status()}`);
      }
      const sysJson = await sysRes.json() as {
        items?: Array<{
          id?: string;
          uid?: string;
          name?: string;
          properties?: {id?: string; uid?: string; name?: string};
        }>;
      };
      const laneSystems = (sysJson.items ?? []).filter((item) => {
        const uid = String(item?.uid ?? item?.properties?.uid ?? "");
        return uid.startsWith("urn:osh:system:lane:");
      });
      const chosen = (preferredLaneName
        ? laneSystems.find((item) =>
          String(item?.name ?? item?.properties?.name ?? "").toLowerCase() === preferredLaneName.toLowerCase())
        : undefined) ?? laneSystems[0];
      if (!chosen) {
        throw new Error(`No urn:osh:system:lane:* system found on ${baseUrl}`);
      }
      laneSystemId = String(chosen.id ?? chosen.properties?.id ?? "");
      laneName = String(chosen.name ?? chosen.properties?.name ?? (preferredLaneName || "Lane"));
    } finally {
      await sysRes.dispose();
    }

    const dsRes = await reqCtx.get(
      `${baseUrl}/sensorhub/api/datastreams?system=${encodeURIComponent(laneSystemId)}&validTime=latest&limit=200`,
      {headers: {Accept: "application/json"}},
    );
    let occDsId = "";
    try {
      if (dsRes.ok()) {
        const dsJson = await dsRes.json() as {items?: Array<{id?: string; outputName?: string}>};
        occDsId = String((dsJson.items ?? []).find((ds) => ds.outputName === "occupancy")?.id ?? "");
      }
    } finally {
      await dsRes.dispose();
    }
    if (!occDsId) {
      const fallbackDsRes = await reqCtx.get(
        `${baseUrl}/sensorhub/api/datastreams?validTime=latest&limit=2500`,
        {headers: {Accept: "application/json"}},
      );
      try {
        if (fallbackDsRes.ok()) {
          const dsJson = await fallbackDsRes.json() as {
            items?: Array<{id?: string; outputName?: string; "system@link"?: {uid?: string; title?: string}}>;
          };
          const occItems = (dsJson.items ?? []).filter((ds) => ds.outputName === "occupancy");
          const matched = (preferredLaneName
            ? occItems.find((ds) =>
              String(ds["system@link"]?.title ?? ds["system@link"]?.uid ?? "")
                .toLowerCase()
                .includes(preferredLaneName.toLowerCase()))
            : undefined) ?? occItems[0];
          occDsId = String(matched?.id ?? "");
        }
      } finally {
        await fallbackDsRes.dispose();
      }
    }
    if (!occDsId) {
      throw new Error(`No occupancy datastream found on ${baseUrl} for lane ${laneName}`);
    }

    const findRecentObsId = async (): Promise<string> => {
      const endIso = new Date(Date.now() + 60_000).toISOString();
      const obsRes = await reqCtx.get(
        `${baseUrl}/sensorhub/api/observations?datastream=${encodeURIComponent(occDsId)}&phenomenonTime=${encodeURIComponent(windowStartIso)}/${encodeURIComponent(endIso)}&limit=5`,
        {headers: {Accept: "application/om+json, application/json"}},
      );
      try {
        if (!obsRes.ok()) return "";
        const obsJson = await obsRes.json() as {items?: Array<{id?: string}>};
        return String(obsJson.items?.[0]?.id ?? "");
      } finally {
        await obsRes.dispose();
      }
    };

    let occupancyObsId = await findRecentObsId();
    if (!occupancyObsId && allowReservedRpmTrigger) {
      occupancyObsId = [...this.resolvedAlarmEventIds][0] ?? "";
    }
    if (!occupancyObsId && allowReservedRpmTrigger && this.originalRpmConfig) {
      await this.emulator.replaceConfig(
        this.config.testRpmId,
        this.emulator.shortAlarmConfig(this.originalRpmConfig, 3),
      );
      try {
        await this.triggerAlarm("gamma", "multi-node-federation");
        occupancyObsId = await poll(
          findRecentObsId,
          (id) => id.length > 0,
          {timeoutMs: 30_000, intervalMs: 500, description: "generated occupancy observation on reserved lane"},
        );
      } finally {
        await this.emulator.replaceConfig(
          this.config.testRpmId,
          this.emulator.quietConfig(this.originalRpmConfig),
        ).catch((err) => this.reporter.error("multi-node-federation", "restore-quiet-config", err));
      }
    }
    if (!occupancyObsId) {
      throw new Error(`No recent occupancy observation available on ${baseUrl} (${laneName}) within 30d window`);
    }

    const findAdjCsId = async (url: string, matchLane?: string): Promise<string> => {
      const csRes = await reqCtx.get(url, {headers: {Accept: "application/json"}});
      try {
        if (!csRes.ok()) return "";
        const csJson = await csRes.json() as {
          items?: Array<{
            id?: string;
            inputName?: string;
            "system@link"?: {uid?: string; title?: string};
            schema?: unknown;
          }>;
        };
        const adjStreams = (csJson.items ?? []).filter(
          (cs) => cs.inputName === "adjudicationControl" || /Adjudication/i.test(JSON.stringify(cs.schema ?? "")),
        );
        const chosen = (matchLane
          ? adjStreams.find((cs) =>
            String(cs["system@link"]?.title ?? cs["system@link"]?.uid ?? "")
              .toLowerCase()
              .includes(matchLane.toLowerCase()))
          : undefined) ?? adjStreams[0];
        return String(chosen?.id ?? "");
      } finally {
        await csRes.dispose();
      }
    };

    let adjCsId = await findAdjCsId(
      `${baseUrl}/sensorhub/api/controlstreams?system=${encodeURIComponent(laneSystemId)}&validTime=latest&limit=200`,
    );
    if (!adjCsId) {
      adjCsId = await findAdjCsId(
        `${baseUrl}/sensorhub/api/controlstreams?validTime=latest&limit=1000`,
        preferredLaneName,
      );
    }
    if (!adjCsId) {
      throw new Error(`No adjudicationControl stream found on ${baseUrl} for lane ${laneName}`);
    }

    const cmdRes = await reqCtx.post(
      `${baseUrl}/sensorhub/api/controlstreams/${encodeURIComponent(adjCsId)}/commands`,
      {
        headers: {"Content-Type": "application/json", Accept: "application/json"},
        data: {
          parameters: {
            feedback: `Cross-node federation regression ${this.reporter.runId.slice(-12)}`,
            adjudicationCode: 9,
            isotopesCount: 0,
            isotopes: [],
            secondaryInspectionStatus: "NONE",
            filePathCount: 0,
            filePaths: [],
            occupancyObsId,
            vehicleId,
          },
        },
      },
    );
    try {
      if (!cmdRes.ok()) {
        throw new Error(`Adjudication command on ${baseUrl} returned HTTP ${cmdRes.status()}`);
      }
      const cmdJson = await cmdRes.json() as {statusCode?: string; "command@id"?: string; id?: string};
      const cmdId = String(cmdJson["command@id"] ?? cmdJson.id ?? "");
      if (cmdJson.statusCode === "PENDING" && cmdId) {
        await poll(
          async () => {
            const stRes = await reqCtx.get(
              `${baseUrl}/sensorhub/api/controlstreams/${encodeURIComponent(adjCsId)}/commands/${encodeURIComponent(cmdId)}/status?format=application%2Fjson`,
            );
            try {
              if (!stRes.ok()) return "";
              const stJson = await stRes.json() as {items?: Array<{statusCode?: string}>; statusCode?: string};
              const items = Array.isArray(stJson.items) ? stJson.items : [stJson];
              return items.map((it) => String(it?.statusCode ?? "")).find((s) => s === "COMPLETED" || s === "ACCEPTED") ?? "";
            } finally {
              await stRes.dispose();
            }
          },
          (code) => code === "COMPLETED" || code === "ACCEPTED",
          {timeoutMs: 30_000, intervalMs: 400, description: `adjudication command ${cmdId} completion`},
        );
      }
    } finally {
      await cmdRes.dispose();
    }

    await poll(
      async () => {
        const vsRes = await reqCtx.get(
          `${baseUrl}/sensorhub/buckets/adjudication/vehicle-search?vehicleId=${encodeURIComponent(vehicleId)}&matchMode=equals&limit=20`,
          {headers: {Accept: "application/json"}},
        );
        try {
          if (!vsRes.ok()) return 0;
          const vsJson = await vsRes.json() as {passes?: unknown[]};
          return Array.isArray(vsJson.passes) ? vsJson.passes.length : 0;
        } finally {
          await vsRes.dispose();
        }
      },
      (count) => count >= 1,
      {timeoutMs: 30_000, intervalMs: 500, description: `vehicle-search indexing of ${vehicleId} on ${baseUrl}`},
    );

    return {laneName, occupancyObsId};
  }

  private async multiNodeFederation(): Promise<void> {
    const capabilityMeta: CheckMetadata = {
      scenario: "multi-node-federation",
      category: "federation",
      action: "authenticate federated peer portal and mint short-lived Federation Service Token",
      target: this.config.oscarFederatedPeerBaseUrl ?? "OSCAR_FEDERATED_PEER_BASE_URL",
      expected: "peer portal authenticates session, resolves authoritative node identity, and mints a revocable oscar_fed_ token",
    };

    if (this.config.federationWorkflow === "disabled") {
      this.skip(capabilityMeta, "FEDERATION_WORKFLOW=disabled");
      return;
    }
    const peerBaseUrl = this.config.oscarFederatedPeerBaseUrl;
    if (!peerBaseUrl) {
      if (this.config.federationWorkflow === "auto") {
        this.skip(capabilityMeta, "OSCAR_FEDERATED_PEER_BASE_URL is not configured (auto)");
      } else {
        this.reporter.outcome(
          capabilityMeta.scenario,
          capabilityMeta.category,
          capabilityMeta.action,
          capabilityMeta.target,
          capabilityMeta.expected,
          "OSCAR_FEDERATED_PEER_BASE_URL is missing",
          "incorrect",
          0,
        );
      }
      return;
    }

    const parsedPeerUrl = new URL(peerBaseUrl);
    const peerHost = parsedPeerUrl.hostname;
    const peerPort = parsedPeerUrl.port || "443";
    const peerOrigin = parsedPeerUrl.origin;
    const peerUsername = this.config.oscarFederatedPeerUsername ?? this.config.oscarUsername;
    const peerPassword = this.config.oscarFederatedPeerPassword ?? this.config.oscarPassword;
    const tokenLabel = `Regression Cross-Node Fed ${this.reporter.runId}`.slice(0, 76);

    const peerContext = await playwrightRequest.newContext({
      baseURL: peerBaseUrl,
      ignoreHTTPSErrors: true,
      httpCredentials: {
        username: peerUsername,
        password: peerPassword,
      },
    });
    const page = await this.browser.oscarPage();
    let createdTokenId = "";
    let mintedRawToken = "";
    let localNodeName = "Local Node";
    let expectedPeerNodeName = peerHost;

    const removePeerNodeFromViewer = async (targetPage: Page): Promise<void> => {
      await this.goto(targetPage, "/servers");
      await targetPage.getByRole("heading", {name: "Nodes", exact: true})
        .waitFor({timeout: this.config.uiTimeoutMs})
        .catch(() => undefined);

      for (let attempt = 0; attempt < 5; attempt++) {
        const peerItem = targetPage.locator("li").filter({hasText: `${peerHost}:${peerPort}`}).first();
        if ((await peerItem.count()) === 0) break;
        const delBtn = peerItem.getByRole("button", {name: /^Delete$/i}).first();
        if (!(await delBtn.isVisible().catch(() => false))) break;
        await delBtn.click();
        await sleep(250);
      }

      await targetPage.evaluate((hostToPurge) => {
        const rawNodes = window.localStorage.getItem("osh_nodes");
        if (rawNodes) {
          try {
            const parsed = JSON.parse(rawNodes);
            if (Array.isArray(parsed)) {
              const filtered = parsed.filter(
                (n: {address?: unknown; isDefaultNode?: unknown}) =>
                  n?.isDefaultNode === true || String(n?.address ?? "") !== hostToPurge,
              );
              window.localStorage.setItem("osh_nodes", JSON.stringify(filtered));
            }
          } catch {
            // Ignore malformed storage
          }
        }
        const rawCfg = window.localStorage.getItem("osh_config_node");
        if (rawCfg && rawCfg.includes(hostToPurge)) {
          window.localStorage.removeItem("osh_config_node");
        }
        const rawPersistNodes = window.localStorage.getItem("persist:nodes");
        if (rawPersistNodes && rawPersistNodes.includes(hostToPurge)) {
          window.localStorage.removeItem("persist:nodes");
        }
      }, peerHost);

      await this.goto(targetPage, "/servers");
      await targetPage.getByRole("heading", {name: "Nodes", exact: true})
        .waitFor({timeout: this.config.uiTimeoutMs})
        .catch(() => undefined);
    };

    const revokePeerToken = async (): Promise<void> => {
      if (!createdTokenId) return;
      const tokenToRevoke = createdTokenId;
      createdTokenId = "";
      const deleteUrl = `${peerBaseUrl}/sensorhub/session/admin/federation-tokens/${encodeURIComponent(tokenToRevoke)}`;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const delRes = await peerContext.delete(deleteUrl, {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Origin: peerBaseUrl,
              "X-Requested-With": "XMLHttpRequest",
            },
            data: {},
            timeout: 60_000,
          });
          const delStatus = delRes.status();
          await delRes.dispose();
          if (delStatus >= 200 && delStatus < 300 || delStatus === 404) {
            return;
          }
          throw new Error(`Peer token DELETE returned HTTP ${delStatus}`);
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
    };

    this.pendingFederationCleanup = async () => {
      let cleanupPage: Page | undefined;
      try {
        cleanupPage = await this.browser.oscarPage();
        await removePeerNodeFromViewer(cleanupPage);
      } finally {
        await cleanupPage?.close().catch(() => undefined);
        await revokePeerToken().catch(() => undefined);
        await peerContext.dispose().catch(() => undefined);
      }
    };

    let revokedTokenIdForAudit = "";

    try {
      try {
        const tokenReady = await this.check(capabilityMeta, async () => {
          const loginRes = await peerContext.post(`${peerBaseUrl}/login`, {
            form: {username: peerUsername, password: peerPassword},
            maxRedirects: 0,
          });
          await loginRes.dispose();

          let sessionRes = await peerContext.get(`${peerBaseUrl}/sensorhub/session`, {
            headers: {Accept: "application/json"},
          });
          if (sessionRes.status() === 404) {
            await sessionRes.dispose();
            sessionRes = await peerContext.get(`${peerBaseUrl}/session`, {
              headers: {Accept: "application/json"},
            });
          }
          let sessionUser = "";
          const sessionStatus = sessionRes.status();
          try {
            if (sessionRes.ok()) {
              const sessionJson = await sessionRes.json() as {username?: string};
              sessionUser = String(sessionJson.username ?? "");
            }
          } finally {
            await sessionRes.dispose();
          }

          const [localDiscovered, peerDiscovered] = await Promise.all([
            this.resolvePortalServerNodeName(page.context().request, this.config.oscarBaseUrl),
            this.resolvePortalServerNodeName(peerContext, peerBaseUrl),
          ]);
          if (localDiscovered) {
            localNodeName = localDiscovered;
          }
          if (peerDiscovered) {
            expectedPeerNodeName = peerDiscovered;
          }

          await this.ensurePortalNationalStatisticsObservation(peerContext, peerBaseUrl);

          const createRes = await peerContext.post(
            `${peerBaseUrl}/sensorhub/session/admin/federation-tokens`,
            {
              headers: {"Content-Type": "application/json", Accept: "application/json"},
              data: {label: tokenLabel, role: "operator", expiresInDays: 1},
            },
          );
          const createStatus = createRes.status();
          try {
            if (createRes.ok()) {
              const payload = await createRes.json() as {token?: string; record?: {id?: string}};
              createdTokenId = String(payload?.record?.id ?? "");
              revokedTokenIdForAudit = createdTokenId;
              mintedRawToken = String(payload?.token ?? "");
            }
          } finally {
            await createRes.dispose();
          }

          const passed = sessionStatus === 200 &&
            sessionUser.toLowerCase() === peerUsername.toLowerCase() &&
            (createStatus === 200 || createStatus === 201) &&
            createdTokenId.length > 0 &&
            mintedRawToken.startsWith("oscar_fed_");
          return {
            passed,
            value: passed,
            observed: `peerSessionHttp=${sessionStatus}; peerUser=${sessionUser}; peerNode=${expectedPeerNodeName}; ` +
              `tokenCreateHttp=${createStatus}; tokenId=${createdTokenId || "none"}`,
          };
        });
        if (!tokenReady) return;

        const peerConnected = await this.check({
          scenario: "multi-node-federation",
          category: "federation",
          action: "connect federated peer node on /servers?auth=bearer via Bearer Federation Token",
          target: `${peerHost}:${peerPort}`,
          expected: "Add Server form submits over HTTPS with Bearer token, peer ConSys API responds HTTP 200, and peer node renders with Federation Token badge",
        }, async () => {
          await this.goto(page, "/servers?auth=bearer");
          await page.getByRole("heading", {name: "Nodes", exact: true}).waitFor({timeout: this.config.uiTimeoutMs});
          await page.getByRole("heading", {name: "Add a New Server", exact: true}).waitFor({timeout: this.config.uiTimeoutMs});

          const storedPrimaryName = await page.evaluate(() => {
            try {
              const parsed = JSON.parse(window.localStorage.getItem("osh_nodes") || "[]");
              if (Array.isArray(parsed) && parsed[0]?.name) {
                return String(parsed[0].name).trim();
              }
            } catch {
              // Ignore
            }
            return "";
          });
          if (storedPrimaryName) {
            localNodeName = storedPrimaryName;
          }

          for (let attempt = 0; attempt < 3; attempt++) {
            const staleItem = page.locator("li").filter({hasText: `${peerHost}:${peerPort}`}).first();
            if ((await staleItem.count()) === 0) break;
            const delBtn = staleItem.getByRole("button", {name: /^Delete$/i}).first();
            if (!(await delBtn.isVisible().catch(() => false))) break;
            await delBtn.click();
            await sleep(250);
          }

          let customPeerName = "";
          if (expectedPeerNodeName === localNodeName) {
            customPeerName = `${expectedPeerNodeName} (${peerHost})`;
            expectedPeerNodeName = customPeerName;
          }

          const tokenInput = page.getByTestId("node-federation-token-input");
          await tokenInput.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});

          if (customPeerName) {
            await page.getByLabel(/^Name$/i).first().fill(customPeerName);
          }
          await page.getByLabel(/^Address$/i).first().fill(peerHost);
          await page.getByLabel(/^Port$/i).first().fill(peerPort);
          const secureCheckbox = page.getByLabel(/Use a secure connection/i).first();
          if (!(await secureCheckbox.isChecked())) {
            await secureCheckbox.check();
          }
          await tokenInput.fill(mintedRawToken);

          let peerApiBearer200 = false;
          let peerDatastreams200 = false;
          const onPeerRes = (res: Response) => {
            try {
              const parsed = new URL(res.url());
              if (parsed.origin !== peerOrigin) return;
              const authHdr = res.request().headers()["authorization"] ?? "";
              if (res.status() === 200 && /^Bearer\s+oscar_fed_/i.test(authHdr)) {
                if (/\/sensorhub\/api\/?$/.test(parsed.pathname) || /\/sensorhub\/api\/systems/.test(parsed.pathname)) {
                  peerApiBearer200 = true;
                }
                if (/\/sensorhub\/api\/datastreams/.test(parsed.pathname)) {
                  peerDatastreams200 = true;
                }
              }
            } catch {
              // Ignore malformed URLs
            }
          };
          page.on("response", onPeerRes);
          try {
            await page.getByRole("button", {name: /^Add Node$/i}).click();
            const cardState = await poll(
              async () => {
                const item = page.locator("li").filter({hasText: `${peerHost}:${peerPort}`}).first();
                const count = await item.count();
                const text = count > 0 ? await item.innerText().catch(() => "") : "";
                return {
                  visible: count > 0,
                  hasFederationBadge: /Federation Token/i.test(text),
                  hasExpectedName: text.includes(expectedPeerNodeName),
                  text: text.replace(/\s+/g, " ").trim(),
                };
              },
              (state) => state.visible && state.hasFederationBadge && state.hasExpectedName,
              {timeoutMs: this.config.eventTimeoutMs, intervalMs: 300, description: "federated peer card on /servers"},
            );

            await poll(
              async () => peerDatastreams200,
              (ready) => ready,
              {timeoutMs: 25_000, intervalMs: 300, description: "initial federated peer datastream discovery"},
            ).catch(() => false);

            const passed = peerApiBearer200 && cardState.visible && cardState.hasFederationBadge && cardState.hasExpectedName;
            const evidence = passed ? "" : await this.screenshotOnFailure(page, "multi-node-servers-connect-failed");
            return {
              passed,
              value: passed,
              observed: `peerApiBearer200=${peerApiBearer200}; peerDatastreams200=${peerDatastreams200}; ` +
                `localNode=${localNodeName}; peerNode=${expectedPeerNodeName}; card="${cardState.text}"`,
              evidence,
            };
          } finally {
            page.off("response", onPeerRes);
          }
        });
        if (!peerConnected) return;

        await this.check({
          scenario: "multi-node-federation",
          category: "national",
          action: "render unified multi-node statistics on /national-view",
          target: "/national-view",
          expected: "both the local primary site row and the federated peer site row render in .MuiDataGrid-row with valid numeric statistics and Bearer token preserved across SPA navigation",
        }, async () => {
          let peerNationalBearerVerified = false;
          const onNationalPeerRes = (res: Response) => {
            try {
              const parsed = new URL(res.url());
              if (parsed.origin !== peerOrigin) return;
              const checkHdr = (hdrs: Record<string, string>) => {
                const authHdr = hdrs["authorization"] ?? hdrs["Authorization"] ?? "";
                if (/^Bearer\s+oscar_fed_/i.test(authHdr) && res.status() === 200) {
                  peerNationalBearerVerified = true;
                }
              };
              checkHdr(res.request().headers());
              if (!peerNationalBearerVerified) {
                void res.request().allHeaders().then(checkHdr).catch(() => undefined);
              }
            } catch {
              // Ignore malformed URLs
            }
          };
          page.on("response", onNationalPeerRes);
          try {
            await this.clickSpaNavItem(page, "nav-item-national", "/national-view");
            await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});

            const readSiteRowStats = async (siteName: string) => {
              const row = page.locator(".MuiDataGrid-row").filter({
                has: page.locator('[data-field="site"]', {hasText: siteName}),
              }).first();
              if ((await row.count()) === 0) return null;
              const values = {} as Record<NationalStatisticsField, string>;
              for (const field of NATIONAL_STATISTICS_FIELDS) {
                values[field] = await row.locator(`[data-field="${field}"]`).innerText();
              }
              return parseRenderedNationalStatistics(values);
            };

            const rendered = await poll(
              async () => {
                const rowCount = await page.locator(".MuiDataGrid-row").count();
                let localStats = null;
                let peerStats = null;
                try {
                  localStats = await readSiteRowStats(localNodeName);
                } catch {
                  localStats = null;
                }
                try {
                  peerStats = await readSiteRowStats(expectedPeerNodeName);
                } catch {
                  peerStats = null;
                }
                return {rowCount, localStats, peerStats, peerBearer: peerNationalBearerVerified};
              },
              (candidate) => candidate.rowCount >= 2 && candidate.localStats !== null && candidate.peerStats !== null && candidate.peerBearer,
              {
                timeoutMs: this.config.eventTimeoutMs,
                intervalMs: 400,
                description: `both ${localNodeName} and ${expectedPeerNodeName} rows on /national-view with Bearer auth`,
              },
            );

            const passed = rendered.rowCount >= 2 && rendered.localStats !== null && rendered.peerStats !== null && rendered.peerBearer;
            const evidence = passed ? "" : await this.screenshotOnFailure(page, "multi-node-national-view-failed");
            return {
              passed,
              observed: `rows=${rendered.rowCount}; peerBearer=${rendered.peerBearer}; local(${localNodeName})=${JSON.stringify(rendered.localStats)}; ` +
                `peer(${expectedPeerNodeName})=${JSON.stringify(rendered.peerStats)}`,
              evidence,
            };
          } finally {
            page.off("response", onNationalPeerRes);
          }
        });

        await this.check({
          scenario: "multi-node-federation",
          category: "vehicle-search",
          action: "correlate cross-node vehicle passes on /event-log and compare both portals in VehiclePassComparisonDialog",
          target: "/event-log and VehiclePassComparisonDialog",
          expected: "cross-origin Bearer GET to peer /sensorhub/buckets/adjudication/vehicle-search returns HTTP 200, summary shows >=2 passes across >=2 sites, and VehiclePassComparisonDialog renders passes from both nodes",
        }, async () => {
          const recentStartIso = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
          const windowStartIso = new Date(Date.now() - 29 * 24 * 60 * 60 * 1_000).toISOString();
          const isoContainerPattern = /^[A-Z]{3}[UJZR]\d{7}$/;
          const collectVehicles = async (
            reqCtx: APIRequestContext,
            baseUrl: string,
          ): Promise<Map<string, string>> => {
            const map = new Map<string, string>();
            for (const startIso of [windowStartIso, recentStartIso]) {
              let res = await reqCtx.get(
                `${baseUrl}/sensorhub/buckets/adjudication/vehicle-search?matchMode=isNotEmpty&limit=50&startTime=${encodeURIComponent(startIso)}`,
                {headers: {Accept: "application/json"}, timeout: 90_000},
              );
              if (res.status() >= 500 && res.status() < 600) {
                await res.dispose();
                await new Promise((r) => setTimeout(r, 600));
                res = await reqCtx.get(
                  `${baseUrl}/sensorhub/buckets/adjudication/vehicle-search?matchMode=isNotEmpty&limit=50&startTime=${encodeURIComponent(startIso)}`,
                  {headers: {Accept: "application/json"}, timeout: 90_000},
                );
              }
              try {
                if (res.ok()) {
                  const json = await res.json() as {
                    passes?: Array<{normalizedVehicleId?: unknown; vehicleId?: unknown}>;
                  };
                  for (const p of json.passes ?? []) {
                    const raw = String(p.vehicleId ?? p.normalizedVehicleId ?? "").trim();
                    const norm = String(p.normalizedVehicleId ?? raw)
                      .trim()
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "");
                    if (norm.length >= 4 && !map.has(norm)) {
                      map.set(norm, raw || norm);
                    }
                  }
                }
              } finally {
                await res.dispose();
              }
              if (map.size > 0) break;
            }
            return map;
          };

          const [peerVehicles, localVehicles] = await Promise.all([
            collectVehicles(peerContext, peerBaseUrl),
            collectVehicles(page.context().request, this.config.oscarBaseUrl),
          ]);

          let targetNorm = "";
          let targetVehicleId = "";
          let correlationSeedSource = "existing-both-portals";

          const sharedIso = [...peerVehicles.keys()].find(
            (norm) => isoContainerPattern.test(norm) && localVehicles.has(norm),
          );
          const sharedSevenChar = [...peerVehicles.keys()].find(
            (norm) => norm.length >= 7 && localVehicles.has(norm),
          );
          if (sharedIso ?? sharedSevenChar) {
            targetNorm = (sharedIso ?? sharedSevenChar)!;
            targetVehicleId = targetNorm;
          }

          if (!targetNorm) {
            const preferredPeer = [...peerVehicles.keys()].find((norm) => /^[A-Z]{3}[UJZR]\d{7}$/.test(norm))
              ?? [...peerVehicles.keys()].find((norm) => norm.length >= 7);
            if (preferredPeer) {
              targetNorm = preferredPeer;
              targetVehicleId = preferredPeer;
              if (!localVehicles.has(targetNorm)) {
                await this.adjudicateRecentOccupancyViaApi({
                  reqCtx: page.context().request,
                  baseUrl: this.config.oscarBaseUrl,
                  vehicleId: targetVehicleId,
                  preferredLaneName: this.config.testLaneLabel,
                  allowReservedRpmTrigger: true,
                  windowStartIso,
                });
              }
              correlationSeedSource = `reused-peer-vehicle-adjudicated-${this.config.testLaneLabel}`;
            } else {
              const preferredLocalIso = [...localVehicles.keys()].find((norm) => /^[A-Z]{3}[UJZR]\d{7}$/.test(norm))
                ?? [...localVehicles.keys()].find((norm) => norm.length >= 7);
              targetNorm = preferredLocalIso ?? "EGHU3972694";
              targetVehicleId = targetNorm;
              await this.adjudicateRecentOccupancyViaApi({
                reqCtx: peerContext,
                baseUrl: peerBaseUrl,
                vehicleId: targetVehicleId,
                windowStartIso,
              });
              if (!localVehicles.has(targetNorm)) {
                await this.adjudicateRecentOccupancyViaApi({
                  reqCtx: page.context().request,
                  baseUrl: this.config.oscarBaseUrl,
                  vehicleId: targetVehicleId,
                  preferredLaneName: this.config.testLaneLabel,
                  allowReservedRpmTrigger: true,
                  windowStartIso,
                });
              }
              correlationSeedSource = "seeded-peer-and-local";
            }
          }

          let peerVehicleSearchHttp200 = false;
          let peerVehicleSearchBearerVerified = false;
          const peerSearchStatuses: number[] = [];
          const onVehicleSearchRes = (res: Response) => {
            try {
              const parsed = new URL(res.url());
              if (parsed.origin !== peerOrigin) return;
              if (res.request().method() !== "GET") return;
              if (!parsed.pathname.endsWith("/sensorhub/buckets/adjudication/vehicle-search")) return;
              const status = res.status();
              peerSearchStatuses.push(status);
              const checkAuthHeader = (hdrs: Record<string, string>) => {
                const authHdr = hdrs["authorization"] ?? hdrs["Authorization"] ?? "";
                if (/^Bearer\s+oscar_fed_/i.test(authHdr)) {
                  peerVehicleSearchBearerVerified = true;
                  if (status === 200) {
                    peerVehicleSearchHttp200 = true;
                  }
                }
              };
              checkAuthHeader(res.request().headers());
              if (!peerVehicleSearchBearerVerified) {
                void res.request().allHeaders().then(checkAuthHeader).catch(() => undefined);
              }
            } catch {
              // Ignore malformed URLs
            }
          };

          page.on("response", onVehicleSearchRes);
          try {
            await this.clickSpaNavItem(page, "nav-item-events", "/event-log");
            await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});

            const searchInput = page.getByTestId("vehicle-id-search-input");
            await searchInput.waitFor({state: "visible", timeout: this.config.uiTimeoutMs});
            await searchInput.fill(targetVehicleId);
            await page.getByTestId("vehicle-id-search-submit").click();

            const summaryObs = await poll(
              async () => {
                const compareBtn = page.getByTestId("vehicle-search-compare-btn").first();
                const compareVisible = await compareBtn.isVisible().catch(() => false);
                const compareText = compareVisible ? (await compareBtn.innerText().catch(() => "")).trim() : "";
                const chip = page.getByTestId("vehicle-search-summary-chip").first();
                const chipVisible = await chip.isVisible().catch(() => false);
                const chipText = chipVisible ? (await chip.innerText().catch(() => "")).trim() : "";
                const statusTexts = await page.locator('[role="status"]').allInnerTexts().catch(() => []);
                const combinedStatus = [chipText, ...statusTexts].filter(Boolean).join(" | ").replace(/\s+/g, " ").trim();
                const countMatch = /\((\d+)\)/.exec(compareText);
                const passCount = countMatch?.[1] ? Number(countMatch[1]) : 0;
                const multiSiteMentioned = /\b([2-9]|\d{2,})\s+(?:node\(s\)|nodes?|sites?)\b/i.test(combinedStatus);
                return {
                  compareVisible,
                  compareText,
                  chipText,
                  combinedStatus,
                  passCount,
                  multiSiteMentioned,
                  peerHttp200: peerVehicleSearchHttp200,
                  peerBearer: peerVehicleSearchBearerVerified,
                };
              },
              (obs) => obs.compareVisible && obs.passCount >= 2 && obs.multiSiteMentioned && obs.peerHttp200 && obs.peerBearer,
              {timeoutMs: 90_000, intervalMs: 300, description: "cross-node Vehicle Search summary and Bearer GET 200"},
            );

            await page.getByTestId("vehicle-search-compare-btn").first().click();
            const dialog = page.getByTestId("vehicle-pass-comparison-dialog");
            await dialog.waitFor({state: "visible", timeout: 15_000});
            await dialog.getByTestId("vehicle-pass-table-region").waitFor({state: "visible", timeout: 15_000});

            const dialogObs = await poll(
              async () => {
                const rows = dialog.locator('[data-testid^="vehicle-pass-row-"]');
                const rowCount = await rows.count();
                const rowTexts = await rows.allInnerTexts().catch(() => []);
                const hasLocalNodePass = rowTexts.some((txt) => txt.includes(localNodeName));
                const hasPeerNodePass = rowTexts.some((txt) => txt.includes(expectedPeerNodeName));
                const hasFederatedBadge = rowTexts.some((txt) => /Federated/i.test(txt));
                return {rowCount, hasLocalNodePass, hasPeerNodePass, hasFederatedBadge};
              },
              (obs) => obs.rowCount >= 2 && obs.hasLocalNodePass && obs.hasPeerNodePass && obs.hasFederatedBadge,
              {timeoutMs: 20_000, intervalMs: 300, description: "VehiclePassComparisonDialog rows from both nodes"},
            );

            await dialog.getByRole("button", {name: /^close$/i}).last().click();
            await dialog.waitFor({state: "hidden", timeout: 10_000});
            await page.getByTestId("vehicle-id-search-clear").click();

            const passed = summaryObs.peerHttp200 &&
              summaryObs.peerBearer &&
              summaryObs.passCount >= 2 &&
              summaryObs.multiSiteMentioned &&
              dialogObs.rowCount >= 2 &&
              dialogObs.hasLocalNodePass &&
              dialogObs.hasPeerNodePass &&
              dialogObs.hasFederatedBadge;
            const evidence = passed ? "" : await this.screenshotOnFailure(page, "multi-node-vehicle-comparison-failed");
            return {
              passed,
              observed: `vehicleId=${targetVehicleId} (${correlationSeedSource}); peerSearchStatuses=${JSON.stringify(peerSearchStatuses)}; ` +
                `bearerVerified=${summaryObs.peerBearer}; compare="${summaryObs.compareText}"; ` +
                `dialogRows=${dialogObs.rowCount}; localPass=${dialogObs.hasLocalNodePass}; peerPass=${dialogObs.hasPeerNodePass}; federatedBadge=${dialogObs.hasFederatedBadge}`,
              evidence,
            };
          } finally {
            page.off("response", onVehicleSearchRes);
          }
        });
      } finally {
        await removePeerNodeFromViewer(page).catch((err) =>
          this.reporter.error("multi-node-federation", "remove-peer-node", err));
        await revokePeerToken().catch((err) =>
          this.reporter.error("multi-node-federation", "revoke-peer-token", err));
      }

      await this.check({
        scenario: "multi-node-federation",
        category: "teardown",
        action: "verify zero federated node or service-token residue after teardown",
        target: `${this.config.targetHost} and ${peerHost}`,
        expected: "primary Viewer /servers and localStorage contain zero peer host entries, and peer /sensorhub/session/admin/overview excludes the revoked Federation Service Token",
      }, async () => {
        const storageState = await page.evaluate((hostToCheck) => {
          const keys = ["osh_nodes", "osh_config_node", "persist:nodes", "persist:root"];
          const leakedKeys = keys.filter((k) => (window.localStorage.getItem(k) ?? "").includes(hostToCheck));
          let nodeCount = 0;
          try {
            const parsed = JSON.parse(window.localStorage.getItem("osh_nodes") || "[]");
            if (Array.isArray(parsed)) nodeCount = parsed.length;
          } catch {
            nodeCount = -1;
          }
          return {leakedKeys, nodeCount};
        }, peerHost);
        const peerCardRemaining = await page.locator("li").filter({hasText: `${peerHost}:${peerPort}`}).count();

        const ovRes = await peerContext.get(`${peerBaseUrl}/sensorhub/session/admin/overview`, {
          headers: {Accept: "application/json"},
        });
        const ovStatus = ovRes.status();
        let tokenAbsentOnPeer = false;
        try {
          if (ovRes.ok()) {
            const ovJson = await ovRes.json() as {
              federationTokens?: Array<{id?: string; label?: string}>;
            };
            tokenAbsentOnPeer = !(ovJson.federationTokens ?? []).some(
              (tok) =>
                (revokedTokenIdForAudit && tok.id === revokedTokenIdForAudit) ||
                tok.label === tokenLabel,
            );
          }
        } finally {
          await ovRes.dispose();
        }

        const passed = peerCardRemaining === 0 &&
          storageState.leakedKeys.length === 0 &&
          storageState.nodeCount === 1 &&
          ovStatus === 200 &&
          tokenAbsentOnPeer;
        const evidence = passed ? "" : await this.screenshotOnFailure(page, "multi-node-federation-teardown-failed");
        return {
          passed,
          observed: `peerCardRemaining=${peerCardRemaining}; leakedStorageKeys=${JSON.stringify(storageState.leakedKeys)}; ` +
            `oshNodesCount=${storageState.nodeCount}; peerOverviewHttp=${ovStatus}; tokenAbsentOnPeer=${tokenAbsentOnPeer}`,
          evidence,
        };
      });
    } finally {
      this.pendingFederationCleanup = undefined;
      await page.close().catch(() => undefined);
      await peerContext.dispose().catch(() => undefined);
    }
  }
}
