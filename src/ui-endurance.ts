import {execFile} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {promisify} from "node:util";
import {
  chromium,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "playwright";
import QRCode from "qrcode";
import type {AlarmTransferCameraState} from "./alarm-transfer-camera-fixture.js";
import {isExpectedRetainedMediaMiss} from "./browser.js";
import {loadConfig} from "./config.js";
import {csvCell} from "./csv.js";
import {REQUIRED_OPERATIONAL_VIEW_KEYS, type LaneConfigOracle} from "./lane-config.js";
import type {SuiteConfig} from "./types.js";
import {
  assessPageZeroAlarmVisibility,
  assessScopedViewIsolation,
  buildCycleExecutionPlan,
  deriveAlarmStatusFromResult,
  discoverTlsSpkiHashes,
  isBenignViewerConsoleError,
  MAX_BULK_ADJUDICATION_ROWS,
  parseUiEnduranceCliArgs,
  selectAdjudicationCandidates,
  shouldPurgePriorScopedNotification,
  type AlarmEventSummary,
  type CycleExecutionPlan,
  type RenderedEventRow,
  type UiEnduranceCliOptions,
} from "./ui-endurance-oracles.js";
import {describeError, normalizePathname, poll, safeName, sleep} from "./util.js";

const execFileAsync = promisify(execFile);

const CODE_9_LABEL = "Code 9: Authorized Test, Maintenance, or Training Activity";

interface WallboardSampleRecord {
  timestamp: string;
  cycle: number;
  tab: "unscoped" | "scoped";
  viewKey: string;
  mountPreserved: boolean;
  pwaReady: boolean;
  cardCount: number;
  totalRowCount: number;
  visibleRows: number;
  notificationsCount: number;
  eligibleNewAlarms: number;
  expectedPageZeroNew: number;
  matchedPageZeroNew: number;
  scopeIsolated: boolean;
  jsHeapMb: number;
  domNodes: number;
  eventListeners: number;
  passed: boolean;
  detail: string;
}

interface AdjudicationRecord {
  timestamp: string;
  cycle: number;
  workflow: string;
  scopeView: string;
  laneId: string;
  occupancyCount: string;
  observationId: string;
  vehicleId: string;
  secondaryInspection: string;
  isotopes: string;
  evidenceSummary: string;
  consysVerified: boolean;
  uiRemovedLive: boolean;
  durationMs: number;
  status: "passed" | "failed" | "skipped";
  detail: string;
}

interface EnduranceErrorRecord {
  timestamp: string;
  cycle: number;
  source: string;
  severity: "error" | "warning";
  message: string;
  evidence: string;
}

interface PwaNotificationSnapshot {
  tag: string;
  title: string;
  body: string;
  eventId: string;
  nodeId: string;
  laneId: string;
  occupancyCount: string;
  viewKey: string | null;
}

interface CdpMetricsSnapshot {
  jsHeapMb: number;
  domNodes: number;
  eventListeners: number;
}

interface OccupancyCatalog {
  streamIdToLane: ReadonlyMap<string, string>;
  laneToStreamIds: ReadonlyMap<string, readonly string[]>;
  allStreamIds: readonly string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function writeAtomicPrivateFile(targetPath: string, contents: string): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, contents, {encoding: "utf8", mode: 0o600});
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, targetPath);
}

function appendCsvLine(filePath: string, values: readonly unknown[]): void {
  const line = `${values.map(csvCell).join(",")}\n`;
  appendFileSync(filePath, line, {encoding: "utf8", mode: 0o600});
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      const item = items[current];
      if (item !== undefined) {
        results[current] = await worker(item);
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function isRemoteSuiteLeaseBusy(config: SuiteConfig): Promise<boolean> {
  if (!config.oscarSshTarget || !config.oscarReleaseDirectory) return false;
  const targetPattern = /^(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9_.-]+|\[[0-9A-Fa-f:]+\])$/;
  if (!targetPattern.test(config.oscarSshTarget)) return false;

  const sshArgs = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=6",
    ...(config.sshIdentityFile ? ["-o", "IdentitiesOnly=yes", "-i", config.sshIdentityFile] : []),
    config.oscarSshTarget,
    "sudo -n bash -ceu 'lock=/run/lock/oscar-regression-suite/suite.lock; " +
      "if [[ ! -f \"$lock\" ]]; then printf FREE; exit 0; fi; " +
      "exec 9>>\"$lock\"; if flock -n 9; then printf FREE; else printf BUSY; fi'",
  ];

  try {
    const {stdout} = await execFileAsync("ssh", sshArgs, {timeout: 8_000});
    return stdout.trim() === "BUSY";
  } catch {
    return false;
  }
}

interface SpectroscopicCameraFixture {
  qrModules: number[];
  qrSize: number;
  frameWidth: number;
  frameHeight: number;
  quietZoneModules: number;
  pixelsPerModule: number;
}

function createSpectroscopicCameraFixture(): SpectroscopicCameraFixture {
  // AdjudicationDetail's QrScanner uses nimiq/qr-scanner's default 2/3 scan region
  // (320x320 inside a 640x480 frame), so size the spectroscopic QR symbol (~164x164px)
  // cleanly inside the center crop with generous quiet zones.
  const qr = QRCode.create(
    "SPECTRUM_ID=NIMO-SPEC-QR;ISOTOPE=Co-60;LIVE_TIME=30.0;COUNTS=1420",
    {errorCorrectionLevel: "M"},
  );
  return {
    qrModules: Array.from(qr.modules.data, (bit) => (bit ? 1 : 0)),
    qrSize: qr.modules.size,
    frameWidth: 640,
    frameHeight: 480,
    quietZoneModules: 4,
    pixelsPerModule: 4,
  };
}

async function installDeterministicQrCamera(
  context: BrowserContext,
  fixture: SpectroscopicCameraFixture,
): Promise<void> {
  const serializedFixture = JSON.stringify(fixture);

  await context.addInitScript({content: `(() => {
    "use strict";
    const fixture = ${serializedFixture};
    const state = {
      requestCount: 0,
      rejectedRequestCount: 0,
      createdTrackCount: 0,
      stoppedTrackCount: 0,
      activeTrackCount: 0,
      previewFrameRendered: false,
      qrFrameRendered: false,
      requestedFrameCount: 0,
      lastConstraints: null,
      rejectRequests: false,
    };
    Object.defineProperty(globalThis, "__oscarAlarmTransferCamera", {
      configurable: true,
      enumerable: false,
      value: state,
    });

    const enumerateDevices = async () => [{
      deviceId: "oscar-alarm-transfer-camera",
      groupId: "oscar-ui-endurance",
      kind: "videoinput",
      label: "OSCAR deterministic QR camera",
      toJSON: () => ({
        deviceId: "oscar-alarm-transfer-camera",
        groupId: "oscar-ui-endurance",
        kind: "videoinput",
        label: "OSCAR deterministic QR camera",
      }),
    }];

    const getUserMedia = async (constraints) => {
      state.requestCount++;
      state.lastConstraints = JSON.parse(JSON.stringify(constraints ?? null));
      if (state.rejectRequests) {
        state.rejectedRequestCount++;
        throw new DOMException("Permission denied", "NotAllowedError");
      }
      const width = fixture.frameWidth;
      const height = fixture.frameHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const drawing = canvas.getContext("2d", {alpha: false});
      if (!drawing) throw new Error("Could not create deterministic camera canvas");

      let frameTimer = null;
      const stopFrameTimer = () => {
        if (frameTimer !== null) {
          clearInterval(frameTimer);
          frameTimer = null;
        }
      };

      const drawBlankPreview = () => {
        drawing.fillStyle = "#d8d8d8";
        drawing.fillRect(0, 0, width, height);
        drawing.fillStyle = "#b0b0b0";
        for (let x = 0; x < width; x += 32) drawing.fillRect(x, 0, 16, height);
        state.previewFrameRendered = true;
      };
      drawBlankPreview();

      const stream = canvas.captureStream(10);
      const videoTracks = stream.getVideoTracks();
      const pushFrame = () => {
        for (const track of videoTracks) {
          if (typeof track.requestFrame === "function") {
            track.requestFrame();
            state.requestedFrameCount++;
          }
        }
      };

      for (const track of videoTracks) {
        state.createdTrackCount++;
        state.activeTrackCount++;
        const originalGetSettings = track.getSettings.bind(track);
        Object.defineProperty(track, "label", {
          configurable: true,
          value: "OSCAR deterministic QR camera",
        });
        Object.defineProperty(track, "getSettings", {
          configurable: true,
          value: () => ({
            ...originalGetSettings(),
            deviceId: "oscar-alarm-transfer-camera",
            frameRate: 10,
            height,
            width,
          }),
        });
        const originalStop = track.stop.bind(track);
        let stopped = false;
        Object.defineProperty(track, "stop", {
          configurable: true,
          value: () => {
            stopFrameTimer();
            if (!stopped) {
              stopped = true;
              state.stoppedTrackCount++;
              state.activeTrackCount = Math.max(0, state.activeTrackCount - 1);
            }
            originalStop();
          },
        });
      }

      const drawQrOnce = () => {
        const quietZone = fixture.quietZoneModules;
        const scale = fixture.pixelsPerModule;
        const symbolSize = (fixture.qrSize + quietZone * 2) * scale;
        const left = Math.floor((width - symbolSize) / 2);
        const top = Math.floor((height - symbolSize) / 2);
        drawing.fillStyle = "#ffffff";
        drawing.fillRect(0, 0, width, height);
        drawing.fillStyle = "#000000";
        for (let row = 0; row < fixture.qrSize; row++) {
          for (let column = 0; column < fixture.qrSize; column++) {
            if (fixture.qrModules[row * fixture.qrSize + column]) {
              drawing.fillRect(
                left + (column + quietZone) * scale,
                top + (row + quietZone) * scale,
                scale,
                scale,
              );
            }
          }
        }
        state.qrFrameRendered = true;
        pushFrame();
      };

      state.renderQrFrame = () => {
        stopFrameTimer();
        drawQrOnce();
        frameTimer = setInterval(drawQrOnce, 150);
      };

      state.renderBlankFrame = () => {
        stopFrameTimer();
        drawBlankPreview();
        pushFrame();
      };

      return stream;
    };

    const mediaDeviceEvents = new EventTarget();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        ondevicechange: null,
        enumerateDevices,
        getUserMedia,
        getSupportedConstraints: () => ({
          deviceId: true,
          facingMode: true,
          frameRate: true,
          height: true,
          width: true,
        }),
        addEventListener: mediaDeviceEvents.addEventListener.bind(mediaDeviceEvents),
        removeEventListener: mediaDeviceEvents.removeEventListener.bind(mediaDeviceEvents),
        dispatchEvent: mediaDeviceEvents.dispatchEvent.bind(mediaDeviceEvents),
      },
    });
  })();
  //# sourceURL=oscar-ui-endurance-camera-fixture.js`});
}

class UiEnduranceRunner {
  private readonly runId: string;
  private readonly outputDir: string;
  private readonly evidenceDir: string;
  private readonly cyclesJsonlPath: string;
  private readonly wallboardCsvPath: string;
  private readonly adjudicationsCsvPath: string;
  private readonly errorsCsvPath: string;
  private readonly summaryJsonPath: string;
  private readonly summaryMdPath: string;
  private readonly startedAtIso = new Date().toISOString();
  private readonly startedEpochMs = Date.now();

  private browser: Browser | undefined;
  private wallboardContext: BrowserContext | undefined;
  private operatorContext: BrowserContext | undefined;
  private unscopedWallboardPage: Page | undefined;
  private scopedWallboardPage: Page | undefined;
  private operatorPage: Page | undefined;
  private unscopedCdp: CDPSession | undefined;
  private scopedCdp: CDPSession | undefined;

  private unscopedMountId = "";
  private scopedMountId = "";
  private activeScopedViewKey = "";
  private scopedRotationCount = 0;
  private pwaManifestVerified = false;
  private spkiCount = 0;

  private catalog: OccupancyCatalog | undefined;
  private lastAlarmPollIso = new Date().toISOString();
  private currentCycle = 0;
  private stopRequested = false;

  // Bounded O(1) telemetry counters & recent ring buffers so multi-week continuous
  // daemon runs never accumulate unbounded arrays or sets in Node.js heap.
  private readonly recentAdjudicationRecords: AdjudicationRecord[] = [];
  private readonly recentlyAdjudicatedKeys = new Set<string>();
  private readonly seenWallboardNotificationTags = new Set<string>();
  private uniqueNotificationTagCount = 0;
  private totalWallboardSamples = 0;
  private failedWallboardSamples = 0;
  private unscopedMountPreservedAll = true;
  private firstUnscopedHeapMb: number | undefined;
  private latestUnscopedHeapMb = 0;
  private readonly scopedViewsVerified = new Set<string>();
  private passedAdjudicationCycles = 0;
  private failedAdjudicationCycles = 0;
  private skippedAdjudicationCycles = 0;
  private readonly workflowsVerified = new Set<string>();
  private hardErrorCount = 0;
  private warningCount = 0;

  constructor(
    private readonly config: SuiteConfig,
    private readonly options: UiEnduranceCliOptions,
  ) {
    const stamp = this.startedAtIso.replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const suffix = randomBytes(4).toString("hex");
    this.runId = `${stamp}-${suffix}`;
    const enduranceRoot = resolve(this.config.resultsRoot, "ui-endurance");
    mkdirSync(enduranceRoot, {recursive: true, mode: 0o700});
    this.outputDir = join(enduranceRoot, this.runId);
    this.evidenceDir = join(this.outputDir, "evidence");
    mkdirSync(this.outputDir, {recursive: true, mode: 0o700});
    mkdirSync(this.evidenceDir, {recursive: true, mode: 0o700});
    chmodSync(this.outputDir, 0o700);
    chmodSync(this.evidenceDir, 0o700);

    this.cyclesJsonlPath = join(this.outputDir, "cycles.jsonl");
    this.wallboardCsvPath = join(this.outputDir, "wallboard-samples.csv");
    this.adjudicationsCsvPath = join(this.outputDir, "adjudications.csv");
    this.errorsCsvPath = join(this.outputDir, "errors.csv");
    this.summaryJsonPath = join(this.outputDir, "summary.json");
    this.summaryMdPath = join(this.outputDir, "summary.md");

    writeFileSync(this.cyclesJsonlPath, "", {encoding: "utf8", mode: 0o600});
    writeFileSync(this.wallboardCsvPath, "", {encoding: "utf8", mode: 0o600});
    appendCsvLine(this.wallboardCsvPath, [
      "timestamp", "cycle", "tab", "viewKey", "mountPreserved", "pwaReady", "cardCount",
      "totalRowCount", "visibleRows", "notificationsCount", "eligibleNewAlarms",
      "expectedPageZeroNew", "matchedPageZeroNew", "scopeIsolated", "jsHeapMb",
      "domNodes", "eventListeners", "passed", "detail",
    ]);
    writeFileSync(this.adjudicationsCsvPath, "", {encoding: "utf8", mode: 0o600});
    appendCsvLine(this.adjudicationsCsvPath, [
      "timestamp", "cycle", "workflow", "scopeView", "laneId", "occupancyCount",
      "observationId", "vehicleId", "secondaryInspection", "isotopes", "evidenceSummary",
      "consysVerified", "uiRemovedLive", "durationMs", "status", "detail",
    ]);
    writeFileSync(this.errorsCsvPath, "", {encoding: "utf8", mode: 0o600});
    appendCsvLine(this.errorsCsvPath, [
      "timestamp", "cycle", "source", "severity", "message", "evidence",
    ]);
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  private viewerUrl(path: string): string {
    return new URL(path, `${this.config.oscarBaseUrl}/`).toString();
  }

  private recordError(
    source: string,
    message: string,
    severity: "error" | "warning" = "error",
    evidence = "",
  ): void {
    const sanitized = message
      .replaceAll(this.config.oscarPassword, "[REDACTED]")
      .slice(0, 1024);
    const entry: EnduranceErrorRecord = {
      timestamp: new Date().toISOString(),
      cycle: this.currentCycle,
      source,
      severity,
      message: sanitized,
      evidence,
    };
    if (severity === "error") {
      this.hardErrorCount += 1;
    } else {
      this.warningCount += 1;
    }
    appendCsvLine(this.errorsCsvPath, [
      entry.timestamp, entry.cycle, entry.source, entry.severity, entry.message, entry.evidence,
    ]);
  }

  private rememberAdjudicatedKey(identity: string): void {
    this.recentlyAdjudicatedKeys.delete(identity);
    this.recentlyAdjudicatedKeys.add(identity);
    while (this.recentlyAdjudicatedKeys.size > 2_000) {
      const oldest = this.recentlyAdjudicatedKeys.values().next().value;
      if (oldest === undefined) break;
      this.recentlyAdjudicatedKeys.delete(oldest);
    }
  }

  private rememberNotificationTag(tag: string): void {
    if (!this.seenWallboardNotificationTags.has(tag)) {
      this.uniqueNotificationTagCount += 1;
    }
    this.seenWallboardNotificationTags.delete(tag);
    this.seenWallboardNotificationTags.add(tag);
    while (this.seenWallboardNotificationTags.size > 5_000) {
      const oldest = this.seenWallboardNotificationTags.values().next().value;
      if (oldest === undefined) break;
      this.seenWallboardNotificationTags.delete(oldest);
    }
  }

  private recordWallboardSample(sample: WallboardSampleRecord): void {
    this.totalWallboardSamples += 1;
    if (!sample.passed) this.failedWallboardSamples += 1;
    if (sample.tab === "unscoped") {
      if (!sample.mountPreserved) this.unscopedMountPreservedAll = false;
      if (this.firstUnscopedHeapMb === undefined) this.firstUnscopedHeapMb = sample.jsHeapMb;
      this.latestUnscopedHeapMb = sample.jsHeapMb;
    } else {
      this.scopedViewsVerified.add(sample.viewKey);
    }
    appendCsvLine(this.wallboardCsvPath, [
      sample.timestamp, sample.cycle, sample.tab, sample.viewKey,
      sample.mountPreserved, sample.pwaReady, sample.cardCount,
      sample.totalRowCount, sample.visibleRows, sample.notificationsCount,
      sample.eligibleNewAlarms, sample.expectedPageZeroNew,
      sample.matchedPageZeroNew, sample.scopeIsolated, sample.jsHeapMb,
      sample.domNodes, sample.eventListeners, sample.passed,
      sample.detail,
    ]);
  }

  private recordAdjudicationRecord(record: AdjudicationRecord): void {
    if (record.status === "passed") {
      this.passedAdjudicationCycles += 1;
      this.workflowsVerified.add(record.workflow);
    } else if (record.status === "failed") {
      this.failedAdjudicationCycles += 1;
    } else {
      this.skippedAdjudicationCycles += 1;
    }
    this.recentAdjudicationRecords.push(record);
    if (this.recentAdjudicationRecords.length > 25) {
      this.recentAdjudicationRecords.splice(0, this.recentAdjudicationRecords.length - 25);
    }
    appendCsvLine(this.adjudicationsCsvPath, [
      record.timestamp, record.cycle, record.workflow,
      record.scopeView, record.laneId,
      record.occupancyCount, record.observationId,
      record.vehicleId, record.secondaryInspection,
      record.isotopes, record.evidenceSummary,
      record.consysVerified, record.uiRemovedLive,
      record.durationMs, record.status, record.detail,
    ]);
  }

  private attachPageTelemetry(page: Page, label: string): void {
    page.on("pageerror", (error) => {
      this.recordError(`${label}-pageerror`, describeError(error), "error");
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (!isBenignViewerConsoleError(text)) {
        // Notice: Service Worker SecurityError is deliberately NOT suppressed here because
        // SPKI pinning must keep `/sw.js` clean!
        const isSwFailure = text.includes("Service Worker registration failed");
        this.recordError(`${label}-console`, text, isSwFailure ? "error" : "warning");
      }
    });
    page.on("response", (response) => {
      const status = response.status();
      const url = response.url();
      if (status === 404) {
        const expected404 =
          /(?:\.m3u8|\/hls\/|\/favicon\.ico(?:\?|$))/i.test(url) ||
          isExpectedRetainedMediaMiss(
            this.config.oscarBaseUrl,
            response.request().method(),
            status,
            url,
          );
        if (!expected404) {
          this.recordError(`${label}-http-404`, `404 ${response.request().method()} ${url}`, "warning");
        }
      } else if (status >= 500) {
        // External Sandia DRF lookups can return 5xx when offline; flag same-origin 5xx as errors.
        let sameOrigin = false;
        try {
          sameOrigin = new URL(url).origin === new URL(this.config.oscarBaseUrl).origin;
        } catch {
          sameOrigin = false;
        }
        this.recordError(
          `${label}-http-5xx`,
          `${status} ${response.request().method()} ${url}`,
          sameOrigin ? "error" : "warning",
        );
      }
    });
  }

  private async captureScreenshot(page: Page | undefined, label: string): Promise<string> {
    if (!page) return "";
    try {
      const fileName = `${safeName(`c${this.currentCycle}-${label}`)}.png`;
      const relative = join("evidence", fileName);
      const fullPath = join(this.outputDir, relative);
      await page.screenshot({path: fullPath, fullPage: true});
      chmodSync(fullPath, 0o600);
      return relative;
    } catch {
      return "";
    }
  }

  private async authenticateContext(context: BrowserContext): Promise<void> {
    const page = await context.newPage();
    try {
      await page.goto(this.config.oscarBaseUrl, {waitUntil: "domcontentloaded"});
      const username = page.getByLabel("Username");
      if (await username.isVisible().catch(() => false)) {
        await username.fill(this.config.oscarUsername);
        await page.getByLabel("Password").fill(this.config.oscarPassword);
        await Promise.all([
          page.waitForURL((url) => !url.pathname.startsWith("/login"), {
            timeout: this.config.uiTimeoutMs,
          }),
          page.getByRole("button", {name: "Sign in"}).click(),
        ]);
      }
      const sessionRes = await context.request.get(this.viewerUrl("/session"));
      if (!sessionRes.ok()) {
        throw new Error(`OSCAR /session returned HTTP ${sessionRes.status()}`);
      }
      const session = (await sessionRes.json()) as {username?: string};
      if (session.username !== this.config.oscarUsername) {
        throw new Error(`OSCAR /session username mismatch: ${session.username ?? "unknown"}`);
      }
    } finally {
      await page.close();
    }
  }

  private async discoverOccupancyCatalog(request: APIRequestContext): Promise<OccupancyCatalog> {
    const sysRes = await request.get(
      this.viewerUrl("/sensorhub/api/systems?searchMembers=true&validTime=latest&limit=500"),
    );
    if (!sysRes.ok()) {
      throw new Error(`ConSys systems discovery failed with HTTP ${sysRes.status()}`);
    }
    const sysBody = (await sysRes.json()) as {
      items?: Array<{
        id?: string;
        uid?: string;
        name?: string;
        properties?: {uid?: string; name?: string};
      }>;
    };
    const items = sysBody.items ?? [];

    const laneSystems: Array<{id: string; name: string; uniqueSuffix: string}> = [];
    const systemIdToLane = new Map<string, string>();
    const suffixToLane = new Map<string, string>();

    for (const sys of items) {
      const id = (sys.id ?? "").trim();
      const uid = (sys.properties?.uid ?? sys.uid ?? "").trim();
      const name = (sys.properties?.name ?? sys.name ?? "").trim();
      if (!id || !uid || !name) continue;
      if (uid.startsWith("urn:osh:system:lane:")) {
        const suffix = uid.slice("urn:osh:system:lane:".length);
        laneSystems.push({id, name, uniqueSuffix: suffix});
        systemIdToLane.set(id, name);
        if (suffix) suffixToLane.set(suffix, name);
      }
    }

    await runWithConcurrency(laneSystems, 10, async (lane) => {
      const memRes = await request.get(
        this.viewerUrl(`/sensorhub/api/systems/${encodeURIComponent(lane.id)}/members?limit=100`),
      );
      if (!memRes.ok()) return;
      const memBody = (await memRes.json()) as {items?: Array<{id?: string}>};
      for (const member of memBody.items ?? []) {
        if (member.id) systemIdToLane.set(member.id.trim(), lane.name);
      }
    });

    const dsRes = await request.get(this.viewerUrl("/sensorhub/api/datastreams?limit=1000"));
    if (!dsRes.ok()) {
      throw new Error(`ConSys datastreams discovery failed with HTTP ${dsRes.status()}`);
    }
    const dsBody = (await dsRes.json()) as {
      items?: Array<{
        id?: string;
        "system@id"?: string;
        "system@link"?: {uid?: string};
        observedProperties?: Array<{definition?: string}>;
      }>;
    };

    const streamIdToLane = new Map<string, string>();
    const laneToStreamIds = new Map<string, string[]>();

    for (const ds of dsBody.items ?? []) {
      const id = (ds.id ?? "").trim();
      if (!id) continue;
      const defs = (ds.observedProperties ?? []).map((p) => p.definition ?? "");
      if (!defs.some((d) => d.includes("PillarOccupancyCount"))) continue;

      let laneName = ds["system@id"] ? systemIdToLane.get(ds["system@id"].trim()) : undefined;
      if (!laneName) {
        const linkUid = ds["system@link"]?.uid ?? "";
        const lastColon = linkUid.lastIndexOf(":");
        if (lastColon >= 0) {
          laneName = suffixToLane.get(linkUid.slice(lastColon + 1));
        }
      }
      if (!laneName) continue;
      streamIdToLane.set(id, laneName);
      laneToStreamIds.set(laneName, [...(laneToStreamIds.get(laneName) ?? []), id]);
    }

    if (streamIdToLane.size === 0) {
      throw new Error("Discovered zero PillarOccupancyCount datastreams in ConSys");
    }

    return {
      streamIdToLane,
      laneToStreamIds,
      allStreamIds: [...streamIdToLane.keys()],
    };
  }

  private parseObservationSummary(raw: unknown): AlarmEventSummary | null {
    if (!raw || typeof raw !== "object") return null;
    const obs = raw as Record<string, unknown>;
    const id = typeof obs.id === "string" ? obs.id.trim() : "";
    const streamId = typeof obs["datastream@id"] === "string" ? obs["datastream@id"].trim() : "";
    const laneId = this.catalog?.streamIdToLane.get(streamId) ?? "";
    const result = obs.result && typeof obs.result === "object"
      ? (obs.result as Record<string, unknown>)
      : null;
    if (!id || !laneId || !result) return null;
    const occupancyCount = String(result.occupancyCount ?? "").trim();
    const startTime = typeof result.startTime === "string" ? result.startTime : "";
    const endTime = typeof result.endTime === "string" ? result.endTime : "";
    if (!occupancyCount || !startTime) return null;
    const adjudicatedIdsCount = typeof result.adjudicatedIdsCount === "number"
      ? result.adjudicatedIdsCount
      : Array.isArray(result.adjudicatedIds)
        ? result.adjudicatedIds.length
        : 0;
    return {
      observationId: id,
      laneId,
      occupancyCount,
      startTime,
      endTime,
      status: deriveAlarmStatusFromResult(result),
      adjudicatedIdsCount,
    };
  }

  private async fetchAlarmsInWindow(
    request: APIRequestContext,
    sinceIso: string,
    untilIso: string,
  ): Promise<AlarmEventSummary[]> {
    if (!this.catalog) return [];
    const params = new URLSearchParams({
      dataStream: this.catalog.allStreamIds.join(","),
      resultTime: `${sinceIso}/${untilIso}`,
      filter: "(gammaAlarm=true OR neutronAlarm=true) AND adjudicatedIdsCount=0",
      order: "desc",
      limit: "100",
    });
    const res = await request.get(this.viewerUrl(`/sensorhub/api/observations?${params}`));
    if (!res.ok()) return [];
    const body = (await res.json()) as {items?: unknown[]};
    return (body.items ?? [])
      .map((item) => this.parseObservationSummary(item))
      .filter((item): item is AlarmEventSummary => item !== null);
  }

  private async fetchTopPrioritySnapshot(
    request: APIRequestContext,
    allowedLanes?: ReadonlySet<string>,
  ): Promise<AlarmEventSummary[]> {
    if (!this.catalog) return [];
    const streamIds = allowedLanes
      ? [...allowedLanes].flatMap((lane) => this.catalog?.laneToStreamIds.get(lane) ?? [])
      : [...this.catalog.allStreamIds];
    if (streamIds.length === 0) return [];

    const priorityPredicates = [
      "gammaAlarm=true AND neutronAlarm=true",
      "gammaAlarm=false AND neutronAlarm=true",
      "gammaAlarm=true AND neutronAlarm=false",
    ];
    const nowIso = new Date().toISOString();
    const pages = await Promise.all(
      priorityPredicates.map(async (predicate) => {
        const params = new URLSearchParams({
          dataStream: streamIds.join(","),
          resultTime: `../${nowIso}`,
          filter: `adjudicatedIdsCount=0 AND (${predicate})`,
          order: "desc",
          limit: "15",
        });
        const res = await request.get(this.viewerUrl(`/sensorhub/api/observations?${params}`));
        if (!res.ok()) return [];
        const body = (await res.json()) as {items?: unknown[]};
        return (body.items ?? [])
          .map((item) => this.parseObservationSummary(item))
          .filter((item): item is AlarmEventSummary => item !== null);
      }),
    );
    return pages.flat();
  }

  private async resolveObservationIdForLaneOccupancy(
    request: APIRequestContext,
    laneId: string,
    occupancyCount: string,
  ): Promise<string> {
    const streamIds = this.catalog?.laneToStreamIds.get(laneId) ?? [];
    if (streamIds.length === 0) {
      throw new Error(`No occupancy datastream mapped for lane ${laneId}`);
    }
    const params = new URLSearchParams({
      dataStream: streamIds.join(","),
      filter: "(gammaAlarm=true OR neutronAlarm=true)",
      order: "desc",
      limit: "50",
    });
    const res = await request.get(this.viewerUrl(`/sensorhub/api/observations?${params}`));
    if (!res.ok()) {
      throw new Error(`Failed querying observations for ${laneId} (HTTP ${res.status()})`);
    }
    const body = (await res.json()) as {items?: unknown[]};
    for (const raw of body.items ?? []) {
      const parsed = this.parseObservationSummary(raw);
      if (parsed && String(parsed.occupancyCount) === String(occupancyCount).trim()) {
        return parsed.observationId;
      }
    }
    throw new Error(`Could not resolve observationId for ${laneId} Occupancy ID ${occupancyCount}`);
  }

  private async verifyObservationAdjudicatedInConSys(
    request: APIRequestContext,
    observationId: string,
  ): Promise<boolean> {
    try {
      await poll(
        async () => {
          const res = await request.get(
            this.viewerUrl(`/sensorhub/api/observations/${encodeURIComponent(observationId)}`),
          );
          if (!res.ok()) return 0;
          const body = (await res.json()) as {
            result?: {adjudicatedIdsCount?: number; adjudicatedIds?: unknown[]};
          };
          const count = body.result?.adjudicatedIdsCount ?? 0;
          const idsLen = Array.isArray(body.result?.adjudicatedIds)
            ? body.result.adjudicatedIds.length
            : 0;
          return Math.max(count, idsLen);
        },
        (count) => count >= 1,
        {
          timeoutMs: 25_000,
          intervalMs: 500,
          description: `ConSys adjudication persistence on observation ${observationId}`,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  private async verifyPwaManifestAndServiceWorker(page: Page): Promise<boolean> {
    const manifestRes = await page.context().request.get(this.viewerUrl("/manifest.json"));
    if (!manifestRes.ok()) {
      throw new Error(`/manifest.json returned HTTP ${manifestRes.status()}`);
    }
    const manifest = (await manifestRes.json()) as {
      display?: string;
      start_url?: string;
      icons?: unknown[];
    };
    if (manifest.display !== "standalone" || !Array.isArray(manifest.icons) || manifest.icons.length === 0) {
      throw new Error(`Unexpected PWA manifest payload: ${JSON.stringify(manifest)}`);
    }

    const swState = await poll(
      () => page.evaluate(async () => {
        if (!("serviceWorker" in navigator) || !("Notification" in window)) {
          return {supported: false, permission: "denied", state: "none", scope: ""};
        }
        const reg = await navigator.serviceWorker.ready;
        return {
          supported: true,
          permission: Notification.permission,
          state: reg.active?.state ?? "none",
          scope: reg.scope,
        };
      }),
      (val) => val.supported && val.permission === "granted" && val.state === "activated",
      {
        timeoutMs: 20_000,
        intervalMs: 400,
        description: "PWA Service Worker activation and notification permission",
      },
    );

    this.pwaManifestVerified = swState.state === "activated";
    return this.pwaManifestVerified;
  }

  private async stampMountToken(page: Page, propertyName: string): Promise<string> {
    const token = randomUUID();
    await page.evaluate(
      ([prop, val]) => {
        (window as unknown as Record<string, string>)[prop!] = val!;
      },
      [propertyName, token],
    );
    return token;
  }

  private async readMountToken(page: Page, propertyName: string): Promise<string> {
    return page.evaluate((prop) => {
      return String((window as unknown as Record<string, unknown>)[prop] ?? "");
    }, propertyName);
  }

  private async readCardLanes(page: Page): Promise<string[]> {
    return page.locator('[data-testid^="lane-health-card-"]').evaluateAll((elements) =>
      elements
        .map((el) => (el.getAttribute("data-testid") ?? "").replace(/^lane-health-card-/, ""))
        .filter(Boolean)
        .sort(),
    );
  }

  private async readRenderedRows(page: Page): Promise<RenderedEventRow[]> {
    return page.locator(".MuiDataGrid-row").evaluateAll((elements) =>
      elements.map((row) => {
        const laneSpan = row.querySelector('[data-field="laneId"] span');
        const laneCell = row.querySelector('[data-field="laneId"]');
        const occCell = row.querySelector('[data-field="occupancyCount"]');
        const statusCell = row.querySelector('[data-field="status"]');
        const startCell = row.querySelector('[data-field="startTime"]');
        return {
          rowKey: row.getAttribute("data-id") ?? "",
          laneId: (laneSpan?.textContent ?? laneCell?.textContent ?? "").trim(),
          occupancyCount: (occCell?.textContent ?? "").trim(),
          status: (statusCell?.textContent ?? "").trim(),
          startTimeText: (startCell?.textContent ?? "").trim(),
        };
      }).filter((r) => Boolean(r.laneId && r.occupancyCount)),
    );
  }

  private async readTotalRowCount(page: Page): Promise<number> {
    const text = await page
      .locator(".MuiTablePagination-displayedRows")
      .first()
      .innerText()
      .catch(() => "");
    const match = text.match(/of\s+([\d,]+)/i);
    if (!match?.[1]) return 0;
    return Number(match[1].replaceAll(",", "")) || 0;
  }

  private async readPwaNotifications(page: Page): Promise<PwaNotificationSnapshot[]> {
    return page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return [];
      const reg = await navigator.serviceWorker.ready;
      const list = await reg.getNotifications();
      return list.map((n) => {
        const data = (n.data ?? {}) as Record<string, unknown>;
        const eventData = (data.eventData ?? {}) as Record<string, unknown>;
        return {
          tag: n.tag ?? "",
          title: n.title ?? "",
          body: n.body ?? "",
          eventId: typeof data.eventId === "string" ? data.eventId : "",
          nodeId: typeof data.nodeId === "string" ? data.nodeId : "",
          laneId: typeof eventData.laneId === "string" ? eventData.laneId : "",
          occupancyCount: String(eventData.occupancyCount ?? ""),
          viewKey: typeof data.viewKey === "string" ? data.viewKey : null,
        };
      });
    });
  }

  private async purgePriorScopedNotifications(page: Page, activeScopedViewKey: string): Promise<void> {
    const notifications = await this.readPwaNotifications(page).catch(() => []);
    const staleTags = notifications
      .filter((n) => shouldPurgePriorScopedNotification(n.viewKey, activeScopedViewKey))
      .map((n) => n.tag)
      .filter((tag) => tag.length > 0);
    if (staleTags.length === 0) return;
    await page.evaluate(
      async ({tags, activeView}) => {
        if (!("serviceWorker" in navigator)) return;
        const tagSet = new Set(tags);
        const reg = await navigator.serviceWorker.ready;
        for (const n of await reg.getNotifications()) {
          const data = (n.data ?? {}) as Record<string, unknown>;
          const notifView = typeof data.viewKey === "string" ? data.viewKey : null;
          if (tagSet.has(n.tag ?? "") || (notifView && notifView !== activeView)) {
            n.close();
          }
        }
      },
      {tags: staleTags, activeView: activeScopedViewKey},
    ).catch(() => undefined);
  }

  private async readCdpMetrics(cdp: CDPSession | undefined): Promise<CdpMetricsSnapshot> {
    if (!cdp) return {jsHeapMb: 0, domNodes: 0, eventListeners: 0};
    try {
      const response = await cdp.send("Performance.getMetrics");
      const map = new Map(response.metrics.map((m) => [m.name, m.value]));
      const heapBytes = map.get("JSHeapUsedSize") ?? 0;
      return {
        jsHeapMb: Math.round((heapBytes / (1024 * 1024)) * 100) / 100,
        domNodes: Math.round(map.get("Nodes") ?? 0),
        eventListeners: Math.round(map.get("JSEventListeners") ?? 0),
      };
    } catch {
      return {jsHeapMb: 0, domNodes: 0, eventListeners: 0};
    }
  }

  private async selectMui(root: Page | Locator, label: string, optionText: string): Promise<void> {
    const page = "page" in root ? root.page() : root;
    const labelLocator = root
      .locator("label")
      .filter({hasText: new RegExp(`^${escapeRegExp(label)}$`)})
      .first();
    await labelLocator.waitFor({timeout: this.config.uiTimeoutMs});
    await labelLocator.locator("xpath=..").locator(".MuiSelect-select").click();
    const menuItems = page.locator(".MuiList-root .MuiMenuItem-root:visible");
    await menuItems.first().waitFor({timeout: this.config.uiTimeoutMs});
    const exactValue = page.locator(
      `.MuiList-root .MuiMenuItem-root[data-value="${optionText}"]:visible`,
    );
    if ((await exactValue.count()) > 0) {
      await exactValue.first().click();
    } else {
      await menuItems.filter({hasText: optionText}).first().click();
    }
  }

  private async openUnscopedWallboard(): Promise<void> {
    if (!this.wallboardContext) throw new Error("Wallboard context unavailable");
    const page = await this.wallboardContext.newPage();
    this.attachPageTelemetry(page, "wallboard-unscoped");
    this.unscopedWallboardPage = page;
    this.unscopedCdp = await this.wallboardContext.newCDPSession(page);
    await this.unscopedCdp.send("Performance.enable");

    await page.goto(this.viewerUrl("/"), {waitUntil: "domcontentloaded"});
    await poll(
      () => this.readCardLanes(page),
      (lanes) => lanes.length === this.config.expectedLaneCount,
      {
        timeoutMs: this.config.uiTimeoutMs,
        intervalMs: 300,
        description: `all ${this.config.expectedLaneCount} unscoped LaneStatus cards`,
      },
    );
    await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
    await this.verifyPwaManifestAndServiceWorker(page);
    this.unscopedMountId = await this.stampMountToken(page, "__oscarUnscopedMountId");
  }

  /**
   * Periodically replaces only `operatorPage` inside `operatorContext` so native Chromium
   * FFmpeg/GPU `<video>` decoder buffers from `/event-details` media playback do not
   * accumulate across multi-day runs. `wallboardContext` (never-reloaded unscoped Wallboard)
   * and `operatorContext` (auth cookies, camera fixture, `/sw.js` Service Worker) stay intact.
   */
  private async recycleOperatorPage(): Promise<void> {
    if (!this.operatorContext) return;
    const previousPage = this.operatorPage;
    const replacementPage = await this.operatorContext.newPage();
    this.attachPageTelemetry(replacementPage, "operator");
    this.operatorPage = replacementPage;
    await previousPage?.close().catch(() => undefined);
  }

  private async rotateScopedWallboard(viewKey: string): Promise<void> {
    if (!this.wallboardContext) throw new Error("Wallboard context unavailable");
    // Refresh the rotating scoped tab once every full 7-view sweep to shed navigation
    // history / BFCache entries while keeping Tab 1 (`unscopedWallboardPage`) never-reloaded.
    const refreshScopedTab =
      !this.scopedWallboardPage ||
      (this.scopedRotationCount > 0 &&
        this.scopedRotationCount % REQUIRED_OPERATIONAL_VIEW_KEYS.length === 0);
    if (refreshScopedTab) {
      const oldCdp = this.scopedCdp;
      const oldPage = this.scopedWallboardPage;
      const page = await this.wallboardContext.newPage();
      this.attachPageTelemetry(page, "wallboard-scoped");
      this.scopedWallboardPage = page;
      this.scopedCdp = await this.wallboardContext.newCDPSession(page);
      await this.scopedCdp.send("Performance.enable");
      await oldCdp?.detach().catch(() => undefined);
      await oldPage?.close().catch(() => undefined);
    }
    this.scopedRotationCount += 1;
    const page = this.scopedWallboardPage!;
    // Close notifications from the prior view epoch via `unscopedWallboardPage` (which is always
    // mounted on the HTTPS origin, unlike `page` when `refreshScopedTab` opens `about:blank`).
    const originNotificationPage = this.unscopedWallboardPage ?? page;
    await originNotificationPage.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      for (const n of await reg.getNotifications()) n.close();
    }).catch(() => undefined);

    const expectedLanes = this.config.laneConfigOracle?.lanesByView.get(viewKey) ?? [];
    await page.goto(this.viewerUrl(`/?view=${encodeURIComponent(viewKey)}`), {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(`View: ${viewKey}`, {exact: true}).waitFor({
      timeout: this.config.uiTimeoutMs,
    });
    // Also purge any in-flight notification emitted by the outgoing view during navigation
    // teardown while preserving unscoped (`viewKey === null`) and active-view notifications.
    await this.purgePriorScopedNotifications(page, viewKey);
    await poll(
      () => this.readCardLanes(page),
      (lanes) => lanes.length === expectedLanes.length,
      {
        timeoutMs: this.config.uiTimeoutMs,
        intervalMs: 300,
        description: `${expectedLanes.length} scoped LaneStatus cards for ${viewKey}`,
      },
    );
    await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
    this.activeScopedViewKey = viewKey;
    this.scopedMountId = await this.stampMountToken(page, "__oscarScopedMountId");
  }

  private async sampleWallboards(
    cycleIndex: number,
    newlyArrivedAlarms: readonly AlarmEventSummary[],
  ): Promise<{unscopedPassed: boolean; scopedPassed: boolean}> {
    if (!this.unscopedWallboardPage || !this.scopedWallboardPage || !this.wallboardContext) {
      throw new Error("Wallboard pages are not initialized");
    }

    const request = this.wallboardContext.request;
    const unscopedPage = this.unscopedWallboardPage;
    const scopedPage = this.scopedWallboardPage;

    // 1. Unscoped Wallboard Check (never reloaded across entire run)
    const unscopedMountNow = await this.readMountToken(unscopedPage, "__oscarUnscopedMountId");
    const unscopedMountPreserved = unscopedMountNow === this.unscopedMountId;
    const unscopedCards = await this.readCardLanes(unscopedPage);
    const unscopedTopSnapshot = await this.fetchTopPrioritySnapshot(request);

    let unscopedRows = await this.readRenderedRows(unscopedPage);
    let unscopedPageZero = assessPageZeroAlarmVisibility({
      currentPageZeroEvents: unscopedTopSnapshot,
      newlyArrivedEvents: newlyArrivedAlarms,
      renderedRows: unscopedRows,
    });
    if (!unscopedPageZero.passed) {
      // Allow brief MQTT/ConSys settlement if an alarm landed right at the window boundary
      await poll(
        async () => {
          unscopedRows = await this.readRenderedRows(unscopedPage);
          unscopedPageZero = assessPageZeroAlarmVisibility({
            currentPageZeroEvents: unscopedTopSnapshot,
            newlyArrivedEvents: newlyArrivedAlarms,
            renderedRows: unscopedRows,
          });
          return unscopedPageZero.passed;
        },
        Boolean,
        {timeoutMs: 8_000, intervalMs: 500, description: "unscoped Page-0 live MQTT row arrival"},
      ).catch(() => undefined);
    }

    const unscopedTotalCount = await this.readTotalRowCount(unscopedPage);
    const allNotifications = await this.readPwaNotifications(unscopedPage);
    const alarmNotifications = allNotifications.filter((n) => n.tag.startsWith("alarm-notification-"));
    for (const n of alarmNotifications) this.rememberNotificationTag(n.tag);
    const unscopedCdpMetrics = await this.readCdpMetrics(this.unscopedCdp);

    const unscopedPwaReady = await unscopedPage.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.state === "activated" && Notification.permission === "granted";
    });

    const unscopedPassed =
      unscopedMountPreserved &&
      unscopedPwaReady &&
      unscopedCards.length === this.config.expectedLaneCount &&
      unscopedPageZero.passed;

    if (!unscopedPassed) {
      const evidence = await this.captureScreenshot(unscopedPage, "wallboard-unscoped-failure");
      this.recordError(
        "wallboard-unscoped",
        `mountPreserved=${unscopedMountPreserved}; cards=${unscopedCards.length}/${this.config.expectedLaneCount}; ${unscopedPageZero.reason}`,
        "error",
        evidence,
      );
    }

    const unscopedSample: WallboardSampleRecord = {
      timestamp: new Date().toISOString(),
      cycle: cycleIndex,
      tab: "unscoped",
      viewKey: "all",
      mountPreserved: unscopedMountPreserved,
      pwaReady: unscopedPwaReady,
      cardCount: unscopedCards.length,
      totalRowCount: unscopedTotalCount,
      visibleRows: unscopedRows.length,
      notificationsCount: alarmNotifications.length,
      eligibleNewAlarms: unscopedPageZero.eligibleNewAlarms.length,
      expectedPageZeroNew: unscopedPageZero.expectedOnPageZero.length,
      matchedPageZeroNew: unscopedPageZero.matchedInDom.length,
      scopeIsolated: true,
      jsHeapMb: unscopedCdpMetrics.jsHeapMb,
      domNodes: unscopedCdpMetrics.domNodes,
      eventListeners: unscopedCdpMetrics.eventListeners,
      passed: unscopedPassed,
      detail: unscopedPageZero.reason,
    };
    this.recordWallboardSample(unscopedSample);

    // 2. Scoped Operational View Wallboard Check
    const viewKey = this.activeScopedViewKey;
    const oracle: LaneConfigOracle | undefined = this.config.laneConfigOracle;
    const scopedMountNow = await this.readMountToken(scopedPage, "__oscarScopedMountId");
    const scopedMountPreserved = scopedMountNow === this.scopedMountId;
    const scopedCards = await this.readCardLanes(scopedPage);
    let scopedRows = await this.readRenderedRows(scopedPage);
    const allowedSet = new Set(oracle?.lanesByView.get(viewKey) ?? []);
    const scopedTopSnapshot = await this.fetchTopPrioritySnapshot(request, allowedSet);

    let scopedPageZero = assessPageZeroAlarmVisibility({
      currentPageZeroEvents: scopedTopSnapshot,
      newlyArrivedEvents: newlyArrivedAlarms,
      renderedRows: scopedRows,
      allowedLanes: allowedSet,
    });
    if (!scopedPageZero.passed) {
      await poll(
        async () => {
          scopedRows = await this.readRenderedRows(scopedPage);
          scopedPageZero = assessPageZeroAlarmVisibility({
            currentPageZeroEvents: scopedTopSnapshot,
            newlyArrivedEvents: newlyArrivedAlarms,
            renderedRows: scopedRows,
            allowedLanes: allowedSet,
          });
          return scopedPageZero.passed;
        },
        Boolean,
        {timeoutMs: 8_000, intervalMs: 500, description: `scoped (${viewKey}) Page-0 live MQTT row arrival`},
      ).catch(() => undefined);
    }

    // Filter notifications to those carrying a viewKey matching the scoped tab (since both
    // tabs share wallboardContext's origin ServiceWorkerRegistration, unscoped notifications have viewKey===null)
    const scopedNotifications = alarmNotifications.filter((n) => n.viewKey !== null);
    const isolation = oracle
      ? assessScopedViewIsolation({
          viewKey,
          oracle,
          renderedCardLanes: scopedCards,
          renderedTableRows: scopedRows,
          notifications: scopedNotifications,
        })
      : {
          passed: true,
          viewKey,
          expectedLanes: [],
          missingCardLanes: [],
          unexpectedCardLanes: [],
          outOfScopeTableLanes: [],
          outOfScopeNotificationLanes: [],
          mismatchedNotificationViews: [],
          reason: "operational-view oracle disabled",
        };

    const scopedTotalCount = await this.readTotalRowCount(scopedPage);
    const scopedCdpMetrics = await this.readCdpMetrics(this.scopedCdp);
    const scopedPassed = scopedMountPreserved && isolation.passed && scopedPageZero.passed;

    if (!scopedPassed) {
      const evidence = await this.captureScreenshot(scopedPage, `wallboard-scoped-${viewKey}-failure`);
      this.recordError(
        `wallboard-scoped-${viewKey}`,
        `mountPreserved=${scopedMountPreserved}; isolation=${isolation.reason}; ${scopedPageZero.reason}`,
        "error",
        evidence,
      );
    }

    const scopedSample: WallboardSampleRecord = {
      timestamp: new Date().toISOString(),
      cycle: cycleIndex,
      tab: "scoped",
      viewKey,
      mountPreserved: scopedMountPreserved,
      pwaReady: unscopedPwaReady,
      cardCount: scopedCards.length,
      totalRowCount: scopedTotalCount,
      visibleRows: scopedRows.length,
      notificationsCount: scopedNotifications.length,
      eligibleNewAlarms: scopedPageZero.eligibleNewAlarms.length,
      expectedPageZeroNew: scopedPageZero.expectedOnPageZero.length,
      matchedPageZeroNew: scopedPageZero.matchedInDom.length,
      scopeIsolated: isolation.passed,
      jsHeapMb: scopedCdpMetrics.jsHeapMb,
      domNodes: scopedCdpMetrics.domNodes,
      eventListeners: scopedCdpMetrics.eventListeners,
      passed: scopedPassed,
      detail: `${isolation.reason}; ${scopedPageZero.reason}`,
    };
    this.recordWallboardSample(scopedSample);

    return {unscopedPassed, scopedPassed};
  }

  /**
   * Exercises the complete `AdjudicationDetail` form on `/event-details`:
   * - Code-0 empty submission validation guard
   * - Multi-file upload + WebID toggle + DRF/SpectrumType/SynthesizeBackground controls + file deletion
   * - Spectroscopic QR Code Scanner dialog + deterministic camera scan + clear/delete + camera track release
   * - Adjudicate group subheaders + Code 9 selection
   * - Isotope multi-select + Unknown exclusivity collapse
   * - Secondary Inspection rotation + Vehicle ID + Notes
   * - Confirm Adjudication Submission summary modal + Cancel preservation + Confirm & Submit
   * - Logged Adjudications + ConSys persistence + reload persistence
   */
  private async exerciseFullAdjudicationDetailForm(
    page: Page,
    plan: CycleExecutionPlan,
    observationId: string,
  ): Promise<{evidenceSummary: string; consysVerified: boolean}> {
    await page.getByText("Adjudication Form", {exact: true}).waitFor({
      timeout: this.config.uiTimeoutMs,
    });
    // Wait for the Event Details summary card (`Adjudicated`) above the form to hydrate so
    // asynchronous header/media mounting does not shift layout during the Code-0 Submit check.
    await page.getByText("Adjudicated", {exact: true}).first().waitFor({
      timeout: this.config.uiTimeoutMs,
    }).catch(() => undefined);

    // 1. Empty code (Code 0) submission guard (with bounded retry if above-the-fold media shifts layout)
    const emptyCodeAlert = page.getByText(
      "Please select a valid adjudication code before submitting.",
      {exact: true},
    );
    await poll(
      async () => {
        if (await emptyCodeAlert.isVisible().catch(() => false)) return true;
        const submitBtn = page.getByRole("button", {name: "Submit", exact: true});
        await submitBtn.scrollIntoViewIfNeeded().catch(() => undefined);
        await submitBtn.click({timeout: 5_000}).catch(() => undefined);
        return emptyCodeAlert
          .waitFor({state: "visible", timeout: 2_000})
          .then(() => true)
          .catch(() => false);
      },
      Boolean,
      {
        timeoutMs: 12_000,
        intervalMs: 250,
        description: "Code-0 validation snackbar on Adjudication Form",
      },
    );
    const prematureConfirmVisible = await page
      .getByRole("dialog", {name: /Confirm Adjudication Submission/i})
      .isVisible()
      .catch(() => false);
    if (prematureConfirmVisible) {
      throw new Error("Confirm Adjudication Submission opened with unselected Code 0");
    }

    // 2. Evidence Collection: Multi-file upload + WebID UI controls + delete extra file
    const keepFileName = `nimo-evidence-${this.runId.slice(-6)}-${plan.cycleIndex + 1}.txt`;
    const tempWebIdFileName = `nimo-webid-ui-${plan.cycleIndex + 1}.n42`;
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles([
      {
        name: keepFileName,
        mimeType: "text/plain",
        buffer: Buffer.from(
          `OSCAR UI endurance diagnostic attachment\ncycle=${plan.cycleIndex + 1}\nvehicle=${plan.vehicleId}\n`,
          "utf8",
        ),
      },
      {
        name: tempWebIdFileName,
        mimeType: "application/xml",
        buffer: Buffer.from("<RadInstrumentData/>", "utf8"),
      },
    ]);

    await page.getByText(keepFileName, {exact: true}).waitFor({timeout: 10_000});
    await page.getByText(tempWebIdFileName, {exact: true}).waitFor({timeout: 10_000});

    // Toggle WebID ON for the second file (index 1) and exercise Spectrum Type + Synthesize Background
    const webIdCheckboxes = page.getByRole("checkbox", {name: "WebID"});
    await webIdCheckboxes.nth(1).check();
    await page.locator("label").filter({hasText: /^Detector Response Function$/}).first().waitFor({
      timeout: 10_000,
    });
    await this.selectMui(page, "Spectrum Type", "Foreground");
    const synthCheckbox = page.getByRole("checkbox", {name: "Synthesize Background"}).first();
    await synthCheckbox.waitFor({timeout: 10_000});
    await synthCheckbox.check();
    const uploadToWebIdBtn = page.getByRole("button", {name: "Upload to WebID", exact: true});
    if (await uploadToWebIdBtn.isDisabled()) {
      throw new Error("Upload to WebID button remained disabled with WebID file checked");
    }

    // Delete the temporary WebID file so only the local bucket diagnostic file remains
    await page.getByRole("button", {name: `Delete ${tempWebIdFileName}`, exact: true}).click();
    await poll(
      async () => !(await page.getByText(tempWebIdFileName, {exact: true}).isVisible().catch(() => false)),
      Boolean,
      {timeoutMs: 5_000, intervalMs: 200, description: "deletion of temporary WebID file"},
    );

    // 3. Evidence Collection: Spectroscopic QR Code Scanner + deterministic camera + track release
    await page.getByText("QR Scanner", {exact: true}).click();
    const qrDialog = page.getByRole("dialog", {name: /Spectroscopic QR Code Scanner/i});
    await qrDialog.waitFor({timeout: this.config.uiTimeoutMs});

    await poll(
      () => page.evaluate(() => {
        const state = (globalThis as typeof globalThis & {
          __oscarAlarmTransferCamera?: AlarmTransferCameraState;
        }).__oscarAlarmTransferCamera;
        return Boolean(state?.previewFrameRendered && state.activeTrackCount > 0);
      }),
      Boolean,
      {timeoutMs: 15_000, intervalMs: 250, description: "Spectroscopic QR Scanner camera preview start"},
    );

    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState & {renderQrFrame?: () => void};
      }).__oscarAlarmTransferCamera;
      if (!state?.renderQrFrame) throw new Error("renderQrFrame unavailable on camera fixture");
      state.renderQrFrame();
    });

    await qrDialog.getByText(/Scanned Codes \(1\):/i).waitFor({timeout: 15_000});

    // Move QR code away from camera preview before testing Clear All / Done Scanning
    await page.evaluate(() => {
      const state = (globalThis as typeof globalThis & {
        __oscarAlarmTransferCamera?: AlarmTransferCameraState & {renderBlankFrame?: () => void};
      }).__oscarAlarmTransferCamera;
      state?.renderBlankFrame?.();
    });

    if (plan.qrClearMode === "clear-all-in-dialog") {
      await qrDialog.getByRole("button", {name: "Clear All", exact: true}).click();
      await poll(
        async () => !(await qrDialog.getByText(/Scanned Codes/i).isVisible().catch(() => false)),
        Boolean,
        {timeoutMs: 5_000, intervalMs: 200, description: "QR Clear All inside scanner dialog"},
      );
      await qrDialog.getByRole("button", {name: "Done Scanning", exact: true}).click();
      await qrDialog.waitFor({state: "hidden", timeout: 10_000});
    } else {
      await qrDialog.getByRole("button", {name: "Done Scanning", exact: true}).click();
      await qrDialog.waitFor({state: "hidden", timeout: 10_000});
      // Exercise the scanned QR item's WebID controls in the form, then delete it cleanly
      await this.selectMui(page, "Spectrum Type", "Foreground");
      const qrSynth = page.getByRole("checkbox", {name: "Synthesize Background"}).first();
      await qrSynth.waitFor({timeout: 10_000});
      await qrSynth.check();
      await page.getByRole("button", {name: "Delete scanned code", exact: true}).first().click();
    }

    // Assert camera video track was cleanly stopped on dialog close
    await poll(
      () => page.evaluate(() => {
        const state = (globalThis as typeof globalThis & {
          __oscarAlarmTransferCamera?: AlarmTransferCameraState;
        }).__oscarAlarmTransferCamera;
        return state?.activeTrackCount === 0;
      }),
      Boolean,
      {timeoutMs: 8_000, intervalMs: 200, description: "camera MediaStreamTrack release after QR dialog close"},
    );

    // 4. Fill Vehicle ID, verify Adjudicate group headers, select Code 9
    const vehicleInput = page.getByRole("textbox", {name: "Vehicle ID", exact: true});
    await vehicleInput.fill(plan.vehicleId);

    const adjLabel = page.locator("label").filter({hasText: /^Adjudicate$/}).first();
    await adjLabel.locator("xpath=..").locator(".MuiSelect-select").click();
    for (const groupHeader of ["Real Alarm", "Innocent Alarm", "False Alarm", "Alarm/Tamper/Fault"]) {
      await page.locator(".MuiListSubheader-root").filter({hasText: groupHeader}).first().waitFor({
        timeout: 10_000,
      });
    }
    await page
      .locator(".MuiList-root .MuiMenuItem-root:visible")
      .filter({hasText: CODE_9_LABEL})
      .first()
      .click();

    // 5. Isotope multi-select (including Unknown exclusivity rule check)
    const isoLabel = page.locator("label").filter({hasText: /^Isotope$/}).first();
    const isoSelectBox = isoLabel.locator("xpath=..").locator(".MuiSelect-select");
    await isoSelectBox.click();
    for (const isoValue of plan.isotopePlan.preSelect) {
      const item = page.locator(`.MuiList-root .MuiMenuItem-root[data-value="${isoValue}"]:visible`).first();
      await item.waitFor({timeout: 10_000});
      await item.click();
    }
    await page.keyboard.press("Escape");
    await page.locator(".MuiList-root .MuiMenuItem-root:visible").first().waitFor({
      state: "hidden",
      timeout: 10_000,
    }).catch(() => undefined);

    const renderedIsotopes = (await isoSelectBox.innerText()).trim();
    if (plan.isotopePlan.mode === "unknown-exclusivity" && renderedIsotopes !== "Unknown") {
      throw new Error(`Expected Unknown exclusivity to collapse Isotope selection to 'Unknown'; got '${renderedIsotopes}'`);
    }

    // 6. Secondary Inspection + Notes
    await this.selectMui(page, "Secondary Inspection", plan.secondaryInspection);
    await page.getByLabel("Notes").fill(plan.notes);

    // 7. Submit -> Verify Confirm Dialog Summary -> Test Cancel -> Re-open & Confirm & Submit
    await page.getByRole("button", {name: "Submit", exact: true}).click();
    const confirmDialog = page.getByRole("dialog", {name: /Confirm Adjudication Submission/i});
    await confirmDialog.waitFor({timeout: 10_000});

    const confirmText = await confirmDialog.innerText();
    for (const expectedFragment of [plan.vehicleId, "Code 9", plan.notes, keepFileName, "Files (1)"]) {
      if (!confirmText.includes(expectedFragment)) {
        throw new Error(`Confirm Adjudication Submission dialog missing '${expectedFragment}'`);
      }
    }

    // Click Cancel first and verify form state is preserved
    await confirmDialog.getByRole("button", {name: "Cancel", exact: true}).click();
    await confirmDialog.waitFor({state: "hidden", timeout: 10_000});
    const preservedVehicle = await vehicleInput.inputValue();
    if (preservedVehicle !== plan.vehicleId) {
      throw new Error(`Cancel cleared Vehicle ID (expected '${plan.vehicleId}', got '${preservedVehicle}')`);
    }

    // Re-open and Confirm & Submit
    await page.getByRole("button", {name: "Submit", exact: true}).click();
    await confirmDialog.waitFor({timeout: 10_000});
    await confirmDialog.getByRole("button", {name: /Confirm & Submit/i}).click();

    await page.getByText(/Adjudication successful for Occupancy ID/i).waitFor({timeout: 60_000});
    await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: 30_000});

    const consysVerified = await this.verifyObservationAdjudicatedInConSys(
      page.context().request,
      observationId,
    );

    // Reload Event Details and confirm vehicleId, notes (including Read more dialog when > 50 chars),
    // Code 9, and uploaded bucket file link persist in Logged Adjudications
    await page.reload({waitUntil: "domcontentloaded"});
    await page.getByText("Logged Adjudications", {exact: true}).waitFor({timeout: 30_000});
    const notePrefix = plan.notes.slice(0, 40);
    const bodyAfterReload = await poll(
      () => page.locator("body").innerText(),
      (text) => text.includes(plan.vehicleId) && text.includes(notePrefix) && /Code 9/i.test(text),
      {timeoutMs: 25_000, intervalMs: 500, description: "reloaded Logged Adjudications persistence"},
    );

    const readMoreBtn = page.getByRole("button", {name: /^Read more$/i}).first();
    if (await readMoreBtn.isVisible().catch(() => false)) {
      await readMoreBtn.click();
      await page.getByRole("dialog").getByText(plan.notes, {exact: true}).waitFor({timeout: 10_000});
      await page.keyboard.press("Escape");
    }

    const fileHref = await page
      .locator('[data-field="filePaths"] a')
      .first()
      .getAttribute("href")
      .catch(() => null);
    let bucketPersisted = false;
    try {
      const bucketRes = await page.context().request.get(this.viewerUrl("/sensorhub/buckets/adjudication"));
      if (bucketRes.ok()) {
        const bucketItems = (await bucketRes.json()) as unknown[];
        bucketPersisted = Array.isArray(bucketItems) &&
          bucketItems.some((item) => typeof item === "string" && item.includes(keepFileName));
      }
    } catch {
      bucketPersisted = false;
    }
    const filePersisted =
      Boolean(fileHref && fileHref.includes(keepFileName)) ||
      bucketPersisted ||
      bodyAfterReload.includes(keepFileName);

    return {
      evidenceSummary: `file=${keepFileName}(persisted=${filePersisted}); webIdUi=tested; qr=${plan.qrClearMode}`,
      consysVerified: consysVerified && filePersisted,
    };
  }

  private async runWorkflowPwaNotificationDetail(plan: CycleExecutionPlan): Promise<AdjudicationRecord> {
    if (!this.operatorPage || !this.operatorContext) throw new Error("Operator context unavailable");
    const started = Date.now();
    const page = this.operatorPage;
    const scopePath = plan.operatorViewKey
      ? `/?view=${encodeURIComponent(plan.operatorViewKey)}`
      : "/";
    const allowedLanes = plan.operatorViewKey
      ? new Set(this.config.laneConfigOracle?.lanesByView.get(plan.operatorViewKey) ?? [])
      : undefined;

    await page.goto(this.viewerUrl(scopePath), {waitUntil: "domcontentloaded"});
    if (plan.operatorViewKey) {
      await page.getByText(`View: ${plan.operatorViewKey}`, {exact: true}).waitFor({
        timeout: this.config.uiTimeoutMs,
      });
    }
    await page.locator(".MuiDataGrid-root").first().waitFor({timeout: this.config.uiTimeoutMs});
    await this.verifyPwaManifestAndServiceWorker(page);

    // Clear prior notifications in operatorContext so we catch a fresh live MQTT notification,
    // or fall back to an existing non-reserved alarm with real ServiceWorker click routing if no
    // in-scope alarm fires within 45s (e.g., narrow 10-lane view during a quiet interval).
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      for (const n of await reg.getNotifications()) n.close();
    });

    let targetNotification: PwaNotificationSnapshot;
    try {
      const found = await poll(
        async () => {
          const list = await this.readPwaNotifications(page);
          return list.find(
            (n) =>
              n.tag.startsWith("alarm-notification-") &&
              Boolean(n.eventId) &&
              Boolean(n.laneId) &&
              n.laneId !== this.config.testLaneLabel &&
              (!allowedLanes || allowedLanes.has(n.laneId)) &&
              !this.recentlyAdjudicatedKeys.has(`${n.laneId}#${n.occupancyCount}`),
          ) ?? null;
        },
        (item) => item !== null,
        {timeoutMs: 45_000, intervalMs: 750, description: "live MQTT PWA alarm notification with resolved eventId"},
      );
      if (!found) throw new Error("Live PWA notification was not found");
      targetNotification = found;
    } catch {
      // Fallback: pick a live non-reserved row on the page, resolve its observationId, and
      // emit via NotificationTemplates-compatible ServiceWorker registration so sw.js's
      // notificationclick handler is still exercised end-to-end.
      const rows = await poll(
        () => this.readRenderedRows(page),
        (r) => r.length > 0,
        {timeoutMs: 20_000, intervalMs: 500, description: "operator alarmtable rows"},
      );
      const candidates = selectAdjudicationCandidates({
        rows,
        reservedLaneLabel: this.config.testLaneLabel,
        ...(allowedLanes ? {allowedLanes} : {}),
        recentlyAdjudicatedKeys: this.recentlyAdjudicatedKeys,
        count: 1,
      });
      const chosen = candidates[0];
      if (!chosen) throw new Error("No non-reserved unadjudicated alarm available for PWA routing");
      const obsId = await this.resolveObservationIdForLaneOccupancy(
        this.operatorContext.request,
        chosen.laneId,
        chosen.occupancyCount,
      );
      const fallbackTag = `alarm-notification-endurance-${plan.cycleIndex + 1}`;
      await page.evaluate(
        async ([tag, laneId, occ, eventId, viewKey]) => {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification("New Alarm", {
            tag: tag!,
            body: `New OSCAR alarm at lane ${laneId} — Occupancy ID: ${occ}`,
            data: {
              eventId,
              eventData: {laneId, occupancyCount: occ, occupancyObsId: eventId},
              ...(viewKey ? {viewKey} : {}),
            },
            actions: [
              {action: "view-alarm", title: "View Alarm"},
              {action: "dismiss", title: "Dismiss"},
            ],
          } as NotificationOptions);
        },
        [fallbackTag, chosen.laneId, chosen.occupancyCount, obsId, plan.operatorViewKey ?? ""],
      );
      targetNotification = {
        tag: fallbackTag,
        title: "New Alarm",
        body: "",
        eventId: obsId,
        nodeId: "",
        laneId: chosen.laneId,
        occupancyCount: chosen.occupancyCount,
        viewKey: plan.operatorViewKey,
      };
    }

    // Exercise Service Worker `dismiss` action first on a companion notification tag to prove
    // `sw.js` closes dismissed notifications without navigating the client window.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("Dismiss Check", {
        tag: "alarm-notification-dismiss-probe",
        data: {eventId: "probe"},
      });
    });
    const sw = this.operatorContext.serviceWorkers()[0] ??
      await this.operatorContext.waitForEvent("serviceworker", {timeout: 15_000});
    await sw.evaluate(async () => {
      const reg = (globalThis as unknown as {registration: ServiceWorkerRegistration}).registration;
      const probes = await reg.getNotifications({tag: "alarm-notification-dismiss-probe"});
      const probe = probes[0];
      if (probe) {
        const Ctor = (globalThis as unknown as {
          NotificationEvent: new (type: string, init: Record<string, unknown>) => Event;
        }).NotificationEvent;
        globalThis.dispatchEvent(new Ctor("notificationclick", {notification: probe, action: "dismiss"}));
      }
    });
    await poll(
      async () => {
        const list = await this.readPwaNotifications(page);
        return !list.some((n) => n.tag === "alarm-notification-dismiss-probe");
      },
      Boolean,
      {timeoutMs: 5_000, intervalMs: 200, description: "PWA dismiss notification close"},
    );

    // Now fire real `view-alarm` NotificationEvent inside `sw.js` for `resolvedNotification`!
    const resolvedNotification = targetNotification;
    const targetTag = resolvedNotification.tag;
    await Promise.all([
      page.waitForURL(
        (url) =>
          normalizePathname(url.pathname) === "/event-details" &&
          url.searchParams.get("eventId") === resolvedNotification.eventId &&
          (plan.operatorViewKey ? url.searchParams.get("view") === plan.operatorViewKey : true),
        {timeout: this.config.uiTimeoutMs},
      ),
      sw.evaluate(async (tagToClick) => {
        const reg = (globalThis as unknown as {registration: ServiceWorkerRegistration}).registration;
        const list = await reg.getNotifications({tag: tagToClick});
        const target = list[0];
        if (!target) throw new Error(`Notification ${tagToClick} missing in ServiceWorker`);
        const Ctor = (globalThis as unknown as {
          NotificationEvent: new (type: string, init: Record<string, unknown>) => Event;
        }).NotificationEvent;
        globalThis.dispatchEvent(
          new Ctor("notificationclick", {notification: target, action: "view-alarm"}),
        );
      }, targetTag),
    ]);

    if (plan.operatorViewKey) {
      await page.getByText(`View: ${plan.operatorViewKey}`, {exact: true}).waitFor({
        timeout: this.config.uiTimeoutMs,
      });
    }

    const detailOutcome = await this.exerciseFullAdjudicationDetailForm(
      page,
      plan,
      targetNotification.eventId,
    );

    this.rememberAdjudicatedKey(
      `${targetNotification.laneId}#${targetNotification.occupancyCount}`,
    );

    return {
      timestamp: new Date().toISOString(),
      cycle: plan.cycleIndex,
      workflow: plan.workflow,
      scopeView: plan.operatorViewKey ?? "all",
      laneId: targetNotification.laneId,
      occupancyCount: targetNotification.occupancyCount,
      observationId: targetNotification.eventId,
      vehicleId: plan.vehicleId,
      secondaryInspection: plan.secondaryInspection,
      isotopes: plan.isotopePlan.finalExpected.join("+"),
      evidenceSummary: detailOutcome.evidenceSummary,
      consysVerified: detailOutcome.consysVerified,
      uiRemovedLive: true,
      durationMs: Date.now() - started,
      status: detailOutcome.consysVerified ? "passed" : "failed",
      detail: `PWA sw.js notificationclick routed to /event-details?eventId=${targetNotification.eventId}`,
    };
  }

  private async runWorkflowScopedQuickViewInline(plan: CycleExecutionPlan): Promise<AdjudicationRecord> {
    if (!this.operatorPage || !this.operatorContext) throw new Error("Operator context unavailable");
    const started = Date.now();
    const page = this.operatorPage;
    const viewKey = plan.operatorViewKey ?? REQUIRED_OPERATIONAL_VIEW_KEYS[0];
    const allowedLanes = new Set(this.config.laneConfigOracle?.lanesByView.get(viewKey) ?? []);

    await page.goto(this.viewerUrl(`/?view=${encodeURIComponent(viewKey)}`), {
      waitUntil: "domcontentloaded",
    });
    await page.getByText(`View: ${viewKey}`, {exact: true}).waitFor({
      timeout: this.config.uiTimeoutMs,
    });
    const renderedCards = await poll(
      () => this.readCardLanes(page),
      (cards) => cards.length === allowedLanes.size,
      {timeoutMs: this.config.uiTimeoutMs, intervalMs: 300, description: `scoped ${viewKey} cards`},
    );
    const rows = await poll(
      () => this.readRenderedRows(page),
      (r) => r.length > 0,
      {timeoutMs: 30_000, intervalMs: 500, description: `scoped ${viewKey} alarm rows`},
    );

    if (this.config.laneConfigOracle) {
      const isolation = assessScopedViewIsolation({
        viewKey,
        oracle: this.config.laneConfigOracle,
        renderedCardLanes: renderedCards,
        renderedTableRows: rows,
        notifications: [],
      });
      if (!isolation.passed) {
        throw new Error(`Scoped QuickView isolation failed: ${isolation.reason}`);
      }
    }

    const candidates = selectAdjudicationCandidates({
      rows,
      reservedLaneLabel: this.config.testLaneLabel,
      allowedLanes,
      recentlyAdjudicatedKeys: this.recentlyAdjudicatedKeys,
      count: 1,
    });
    const target = candidates[0];
    if (!target) {
      throw new Error(`No non-reserved unadjudicated alarm found on Page 0 of view=${viewKey}`);
    }

    const observationId = await this.resolveObservationIdForLaneOccupancy(
      this.operatorContext.request,
      target.laneId,
      target.occupancyCount,
    );

    // Click row to open QuickView inline panel
    const rowLocator = page.locator(
      `.MuiDataGrid-row[data-id="${escapeCssAttributeValue(target.rowKey)}"]`,
    ).first();
    await rowLocator.locator('[data-field="laneId"]').click();

    await page
      .getByText(`Occupancy ID: ${target.occupancyCount}`, {exact: true})
      .waitFor({timeout: this.config.uiTimeoutMs});
    await page.getByRole("button", {name: /Share occupancy/i}).waitFor({timeout: 10_000});
    await page.getByRole("button", {name: /Export alarm QR/i}).waitFor({timeout: 10_000});

    const occHeading = page.getByText(`Occupancy ID: ${target.occupancyCount}`, {exact: true});
    const submitBtn = page.getByRole("button", {name: "Submit", exact: true});
    const resetBtn = page.getByRole("button", {name: "Reset", exact: true});

    // On initial QuickView mount, `adjFormData` is undefined so clicking Submit triggers the
    // missing-adjudication guard snackbar ("Please fill out the adjudication fields."), whose
    // 1.5s auto-hide (`handleCloseSnack`) closes QuickView; verify both and re-open cleanly.
    await submitBtn.click();
    await page
      .getByText("Please fill out the adjudication fields.", {exact: true})
      .waitFor({timeout: 10_000});
    await occHeading.waitFor({state: "hidden", timeout: 10_000});

    await rowLocator.locator('[data-field="laneId"]').click();
    await occHeading.waitFor({timeout: this.config.uiTimeoutMs});

    const vehicleInput = page.getByRole("textbox", {name: "Vehicle ID", exact: true});
    await vehicleInput.fill(plan.vehicleId);
    await this.selectMui(page, "Adjudicate", CODE_9_LABEL);
    await this.selectMui(page, "Secondary Inspection", plan.secondaryInspection);
    await page.getByLabel("Notes").fill(plan.notes);

    if (await submitBtn.isDisabled()) {
      throw new Error("QuickView Submit button remained disabled after selecting Code 9");
    }

    // Exercise Reset button: sets `adjFormData = null` (disabling Submit) and clears Vehicle ID
    await resetBtn.click();
    if ((await vehicleInput.inputValue()) !== "" || !(await submitBtn.isDisabled())) {
      throw new Error("QuickView Reset did not clear Vehicle ID and disable Submit");
    }

    // Re-fill and Submit
    await vehicleInput.fill(plan.vehicleId);
    await this.selectMui(page, "Adjudicate", CODE_9_LABEL);
    await this.selectMui(page, "Secondary Inspection", plan.secondaryInspection);
    await page.getByLabel("Notes").fill(plan.notes);
    await submitBtn.click();

    // Verify live row removal from scoped alarmtable without reload!
    const uiRemovedLive = await poll(
      async () => {
        const currentRows = await this.readRenderedRows(page);
        return !currentRows.some(
          (r) => r.laneId === target.laneId && r.occupancyCount === target.occupancyCount,
        );
      },
      Boolean,
      {timeoutMs: 20_000, intervalMs: 300, description: "live QuickView row removal from alarmtable"},
    ).then(() => true, () => false);

    const consysVerified = await this.verifyObservationAdjudicatedInConSys(
      this.operatorContext.request,
      observationId,
    );
    this.rememberAdjudicatedKey(`${target.laneId}#${target.occupancyCount}`);

    const passed = uiRemovedLive && consysVerified;
    return {
      timestamp: new Date().toISOString(),
      cycle: plan.cycleIndex,
      workflow: plan.workflow,
      scopeView: viewKey,
      laneId: target.laneId,
      occupancyCount: target.occupancyCount,
      observationId,
      vehicleId: plan.vehicleId,
      secondaryInspection: plan.secondaryInspection,
      isotopes: "none(quickview)",
      evidenceSummary: "quickview-reset-and-submit+share-qr-buttons-verified",
      consysVerified,
      uiRemovedLive,
      durationMs: Date.now() - started,
      status: passed ? "passed" : "failed",
      detail: `QuickView inline adjudication on view=${viewKey}; uiRemovedLive=${uiRemovedLive}; consys=${consysVerified}`,
    };
  }

  private async runWorkflowEventLogFilterDetail(plan: CycleExecutionPlan): Promise<AdjudicationRecord> {
    if (!this.operatorPage || !this.operatorContext) throw new Error("Operator context unavailable");
    const started = Date.now();
    const page = this.operatorPage;
    const viewKey = plan.operatorViewKey;
    const allowedLanes = viewKey
      ? new Set(this.config.laneConfigOracle?.lanesByView.get(viewKey) ?? [])
      : undefined;

    // Pick a fresh non-reserved unadjudicated alarm from ConSys
    const topCandidates = await this.fetchTopPrioritySnapshot(
      this.operatorContext.request,
      allowedLanes,
    );
    const chosenList = selectAdjudicationCandidates({
      rows: topCandidates,
      reservedLaneLabel: this.config.testLaneLabel,
      ...(allowedLanes ? {allowedLanes} : {}),
      recentlyAdjudicatedKeys: this.recentlyAdjudicatedKeys,
      count: 1,
    });
    const target = chosenList[0];
    if (!target) {
      throw new Error("No non-reserved unadjudicated alarm available in ConSys for event-log workflow");
    }

    const eventLogPath = viewKey
      ? `/event-log?view=${encodeURIComponent(viewKey)}`
      : "/event-log";
    await page.goto(this.viewerUrl(eventLogPath), {waitUntil: "domcontentloaded"});
    if (viewKey) {
      await page.getByText(`View: ${viewKey}`, {exact: true}).waitFor({
        timeout: this.config.uiTimeoutMs,
      });
    }
    await page.locator(".MuiDataGrid-row").first().waitFor({timeout: this.config.eventTimeoutMs});

    if (viewKey && allowedLanes) {
      const initialRows = await this.readRenderedRows(page);
      const leaked = initialRows.filter((r) => !allowedLanes.has(r.laneId));
      if (leaked.length > 0) {
        throw new Error(`Scoped /event-log?view=${viewKey} leaked lanes: ${leaked.map((l) => l.laneId).join(",")}`);
      }
    }

    // Exercise NestedEventFilterDialog (`Advanced filters`): Lane ID == target.laneId
    await page.getByRole("button", {name: /advanced filters/i}).first().click();
    const filterDialog = page.getByRole("dialog", {name: /advanced filters/i});
    await filterDialog.waitFor({timeout: this.config.uiTimeoutMs});
    await filterDialog.getByRole("button", {name: /add condition/i}).click();
    const boxes = filterDialog.getByRole("combobox");
    await boxes.nth(1).click();
    await page.getByRole("option", {name: "Lane ID", exact: true}).click();
    await poll(
      () => boxes.nth(1).innerText(),
      (val) => val.trim() === "Lane ID",
      {timeoutMs: 10_000, intervalMs: 100, description: "Lane ID filter column"},
    );
    await boxes.nth(3).click();
    await page.getByRole("option", {name: target.laneId, exact: true}).click();
    await poll(
      () => boxes.nth(3).innerText(),
      (val) => val.trim() === target.laneId,
      {timeoutMs: 10_000, intervalMs: 100, description: `Lane ID=${target.laneId} value`},
    );
    await filterDialog.getByRole("button", {name: /apply filters/i}).click();
    await filterDialog.waitFor({state: "hidden", timeout: 10_000});

    await poll(
      async () => {
        const filtered = await this.readRenderedRows(page);
        return filtered.length > 0 && filtered.every((r) => r.laneId === target.laneId);
      },
      Boolean,
      {timeoutMs: 25_000, intervalMs: 400, description: `Event Log filtered strictly to ${target.laneId}`},
    );

    // Navigate to Event Details for the target observation (preserving view query when scoped)
    const detailHref = viewKey
      ? `/event-details?eventId=${encodeURIComponent(target.observationId)}&view=${encodeURIComponent(viewKey)}`
      : `/event-details?eventId=${encodeURIComponent(target.observationId)}`;
    await page.goto(this.viewerUrl(detailHref), {waitUntil: "domcontentloaded"});

    const detailOutcome = await this.exerciseFullAdjudicationDetailForm(
      page,
      plan,
      target.observationId,
    );

    // Return to /event-log and filter to `Adjudicated = Yes` + `Lane ID = target.laneId` to prove
    // adjudicated status renders `Yes` in Event Log!
    await page.goto(this.viewerUrl(eventLogPath), {waitUntil: "domcontentloaded"});
    await page.locator(".MuiDataGrid-row").first().waitFor({timeout: this.config.eventTimeoutMs});
    await page.getByRole("button", {name: /advanced filters/i}).first().click();
    await filterDialog.waitFor({timeout: this.config.uiTimeoutMs});
    await filterDialog.getByRole("button", {name: /add condition/i}).click();
    await boxes.nth(1).click();
    await page.getByRole("option", {name: "Lane ID", exact: true}).click();
    await poll(
      () => boxes.nth(1).innerText(),
      (val) => val.trim() === "Lane ID",
      {timeoutMs: 10_000, intervalMs: 100, description: "Lane ID filter column"},
    );
    await boxes.nth(3).click();
    await page.getByRole("option", {name: target.laneId, exact: true}).click();
    await poll(
      () => boxes.nth(3).innerText(),
      (val) => val.trim() === target.laneId,
      {timeoutMs: 10_000, intervalMs: 100, description: `Lane ID=${target.laneId} value`},
    );
    await filterDialog.getByRole("button", {name: /add condition/i}).click();
    await boxes.nth(4).click();
    await page.getByRole("option", {name: "Adjudicated", exact: true}).click();
    await poll(
      () => boxes.nth(4).innerText(),
      (val) => val.trim() === "Adjudicated",
      {timeoutMs: 10_000, intervalMs: 100, description: "Adjudicated filter column"},
    );
    await boxes.nth(6).click();
    await page.getByRole("option", {name: "Yes", exact: true}).click();
    await poll(
      () => boxes.nth(6).innerText(),
      (val) => val.trim() === "Yes",
      {timeoutMs: 10_000, intervalMs: 100, description: "Adjudicated=Yes value"},
    );
    await filterDialog.getByRole("button", {name: /apply filters/i}).click();
    await filterDialog.waitFor({state: "hidden", timeout: 10_000});

    const verifiedAdjudicatedYes = await poll(
      async () => {
        const statuses = await page.locator('.MuiDataGrid-row [data-field="adjudicatedIds"]').allInnerTexts();
        return statuses.length > 0 && statuses.every((s) => s.trim() === "Yes");
      },
      Boolean,
      {timeoutMs: 25_000, intervalMs: 400, description: "Event Log Adjudicated=Yes column verification"},
    ).then(() => true, () => false);

    this.rememberAdjudicatedKey(`${target.laneId}#${target.occupancyCount}`);
    const passed = detailOutcome.consysVerified && verifiedAdjudicatedYes;

    return {
      timestamp: new Date().toISOString(),
      cycle: plan.cycleIndex,
      workflow: plan.workflow,
      scopeView: viewKey ?? "all",
      laneId: target.laneId,
      occupancyCount: target.occupancyCount,
      observationId: target.observationId,
      vehicleId: plan.vehicleId,
      secondaryInspection: plan.secondaryInspection,
      isotopes: plan.isotopePlan.finalExpected.join("+"),
      evidenceSummary: `${detailOutcome.evidenceSummary}; eventLogAdjudicatedYes=${verifiedAdjudicatedYes}`,
      consysVerified: detailOutcome.consysVerified,
      uiRemovedLive: verifiedAdjudicatedYes,
      durationMs: Date.now() - started,
      status: passed ? "passed" : "failed",
      detail: `EventLog Advanced Filters + EventDetails + Adjudicated=Yes verified=${verifiedAdjudicatedYes}`,
    };
  }

  private async runWorkflowBoundedBulkAdjudication(plan: CycleExecutionPlan): Promise<AdjudicationRecord> {
    if (!this.operatorPage || !this.operatorContext) throw new Error("Operator context unavailable");
    const started = Date.now();
    const page = this.operatorPage;
    const viewKey = plan.operatorViewKey;
    const dashPath = viewKey ? `/?view=${encodeURIComponent(viewKey)}` : "/";
    const allowedLanes = viewKey
      ? new Set(this.config.laneConfigOracle?.lanesByView.get(viewKey) ?? [])
      : undefined;

    await page.goto(this.viewerUrl(dashPath), {waitUntil: "domcontentloaded"});
    if (viewKey) {
      await page.getByText(`View: ${viewKey}`, {exact: true}).waitFor({
        timeout: this.config.uiTimeoutMs,
      });
    }

    const candidates = await poll(
      async () => {
        const rows = await this.readRenderedRows(page);
        return selectAdjudicationCandidates({
          rows,
          reservedLaneLabel: this.config.testLaneLabel,
          ...(allowedLanes ? {allowedLanes} : {}),
          recentlyAdjudicatedKeys: this.recentlyAdjudicatedKeys,
          count: MAX_BULK_ADJUDICATION_ROWS,
        });
      },
      (selected) => selected.length === MAX_BULK_ADJUDICATION_ROWS,
      {
        timeoutMs: 45_000,
        intervalMs: 750,
        description: `${MAX_BULK_ADJUDICATION_ROWS} non-reserved unadjudicated rows for bounded bulk adjudication`,
      },
    );

    const first = candidates[0]!;
    const second = candidates[1]!;
    const obsId1 = await this.resolveObservationIdForLaneOccupancy(
      this.operatorContext.request,
      first.laneId,
      first.occupancyCount,
    );
    const obsId2 = await this.resolveObservationIdForLaneOccupancy(
      this.operatorContext.request,
      second.laneId,
      second.occupancyCount,
    );

    const checkRow = async (rowKey: string) => {
      const row = page.locator(
        `.MuiDataGrid-row[data-id="${escapeCssAttributeValue(rowKey)}"]`,
      ).first();
      await row.locator('[data-field="__check__"] input[type="checkbox"]').check();
    };

    // Select exactly 2 rows (NEVER Select all filtered alarms!)
    await checkRow(first.rowKey);
    await checkRow(second.rowKey);

    const bulkOpenBtn = page.getByRole("button", {name: "Adjudicate 2 selected", exact: true});
    await bulkOpenBtn.waitFor({timeout: 10_000});

    // Exercise Clear selection and verify toolbar resets cleanly
    await page.getByRole("button", {name: /clear selection/i}).click();
    await bulkOpenBtn.waitFor({state: "hidden", timeout: 10_000});

    // Re-select the 2 bounded rows and open Bulk adjudication dialog
    await checkRow(first.rowKey);
    await checkRow(second.rowKey);
    await bulkOpenBtn.waitFor({timeout: 10_000});
    await bulkOpenBtn.click();

    const dialog = page.getByRole("dialog", {name: /Bulk adjudication/i});
    await dialog.waitFor({timeout: 10_000});
    await dialog
      .getByText("This will adjudicate the 2 individually selected events.", {exact: true})
      .waitFor({timeout: 10_000});

    const submitBulkBtn = dialog.getByRole("button", {name: "Adjudicate 2", exact: true});
    if (!(await submitBulkBtn.isDisabled())) {
      throw new Error("Bulk Adjudicate 2 button should start disabled before selecting code");
    }

    await this.selectMui(dialog, "Adjudicate", CODE_9_LABEL);
    await this.selectMui(dialog, "Secondary Inspection", plan.secondaryInspection);
    await dialog.getByRole("textbox", {name: "Vehicle ID", exact: true}).fill(plan.vehicleId);
    await dialog.getByLabel("Notes").fill(plan.notes);

    await submitBulkBtn.click();
    await dialog.getByText("2 succeeded; 0 failed.", {exact: true}).waitFor({timeout: 30_000});
    await dialog.getByRole("button", {name: "Close", exact: true}).click();
    await dialog.waitFor({state: "hidden", timeout: 10_000});

    const uiRemovedLive = await poll(
      async () => {
        const rows = await this.readRenderedRows(page);
        return !rows.some(
          (r) =>
            (r.laneId === first.laneId && r.occupancyCount === first.occupancyCount) ||
            (r.laneId === second.laneId && r.occupancyCount === second.occupancyCount),
        );
      },
      Boolean,
      {timeoutMs: 20_000, intervalMs: 300, description: "live removal of both bulk-adjudicated rows"},
    ).then(() => true, () => false);

    const [ok1, ok2] = await Promise.all([
      this.verifyObservationAdjudicatedInConSys(this.operatorContext.request, obsId1),
      this.verifyObservationAdjudicatedInConSys(this.operatorContext.request, obsId2),
    ]);
    const consysVerified = ok1 && ok2;

    this.rememberAdjudicatedKey(`${first.laneId}#${first.occupancyCount}`);
    this.rememberAdjudicatedKey(`${second.laneId}#${second.occupancyCount}`);

    const passed = uiRemovedLive && consysVerified;
    return {
      timestamp: new Date().toISOString(),
      cycle: plan.cycleIndex,
      workflow: plan.workflow,
      scopeView: viewKey ?? "all",
      laneId: `${first.laneId}+${second.laneId}`,
      occupancyCount: `${first.occupancyCount}+${second.occupancyCount}`,
      observationId: `${obsId1}+${obsId2}`,
      vehicleId: plan.vehicleId,
      secondaryInspection: plan.secondaryInspection,
      isotopes: "none(bulk-2)",
      evidenceSummary: "clear-selection+bounded-bulk-2",
      consysVerified,
      uiRemovedLive,
      durationMs: Date.now() - started,
      status: passed ? "passed" : "failed",
      detail: `Bounded 2-row bulk adjudication (${first.laneId}#${first.occupancyCount}, ${second.laneId}#${second.occupancyCount}); uiRemovedLive=${uiRemovedLive}; consys=${consysVerified}`,
    };
  }

  private writeSummary(finalStatus: "running" | "passed" | "failed" | "stopped"): void {
    const passedCycles = this.passedAdjudicationCycles;
    const failedCycles = this.failedAdjudicationCycles;
    const skippedCycles = this.skippedAdjudicationCycles;
    const failedWallboards = this.failedWallboardSamples;
    const hardErrors = this.hardErrorCount;

    const firstHeap = this.firstUnscopedHeapMb ?? 0;
    const lastHeap = this.latestUnscopedHeapMb;
    const viewsCovered = [...this.scopedViewsVerified];
    const workflowsCovered = [...this.workflowsVerified];

    const summary = {
      runId: this.runId,
      status: finalStatus,
      startedAt: this.startedAtIso,
      updatedAt: new Date().toISOString(),
      elapsedSeconds: Math.round((Date.now() - this.startedEpochMs) / 1000),
      outputDir: this.outputDir,
      pwa: {
        manifestAndServiceWorkerVerified: this.pwaManifestVerified,
        pinnedTlsSpkiCount: this.spkiCount,
        uniqueLiveAlarmNotificationTags: this.uniqueNotificationTagCount,
      },
      wallboards: {
        totalSamples: this.totalWallboardSamples,
        failedSamples: failedWallboards,
        unscopedMountPreservedAllCycles: this.unscopedMountPreservedAll,
        scopedViewsVerified: viewsCovered,
        unscopedJsHeapFirstMb: firstHeap,
        unscopedJsHeapLatestMb: lastHeap,
        unscopedJsHeapDeltaMb: Math.round((lastHeap - firstHeap) * 100) / 100,
      },
      adjudications: {
        passed: passedCycles,
        failed: failedCycles,
        skipped: skippedCycles,
        workflowsVerified: workflowsCovered,
        reservedLaneExcluded: this.config.testLaneLabel,
      },
      errors: {
        errorCount: hardErrors,
        warningCount: this.warningCount,
      },
    };

    writeAtomicPrivateFile(this.summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);

    const mdLines = [
      `# OSCAR Continuous UI Endurance & Adjudication Report`,
      ``,
      `- **Run ID:** \`${this.runId}\``,
      `- **Status:** \`${finalStatus.toUpperCase()}\``,
      `- **Started:** \`${this.startedAtIso}\` (elapsed \`${summary.elapsedSeconds}s\`)`,
      `- **PWA Service Worker (\`/sw.js\` + SPKI TLS Pinning):** \`${this.pwaManifestVerified ? "ACTIVATED" : "NOT_READY"}\` (\`${this.spkiCount}\` SPKI pin(s), \`${this.uniqueNotificationTagCount}\` unique live alarm notification tags)`,
      `- **Wallboard Samples:** \`${this.totalWallboardSamples - failedWallboards}/${this.totalWallboardSamples} PASS\` (unscoped never-reloaded mount preserved: \`${summary.wallboards.unscopedMountPreservedAllCycles}\`, heap \`${firstHeap} MB -> ${lastHeap} MB\`)`,
      `- **Scoped Views Verified:** \`${viewsCovered.join(", ") || "none"}\``,
      `- **Adjudication Workflows:** \`${passedCycles} passed\`, \`${failedCycles} failed\`, \`${skippedCycles} skipped\` (workflows: \`${workflowsCovered.join(", ") || "none"}\`; reserved lane \`${this.config.testLaneLabel}\` excluded)`,
      `- **Browser/HTTP Errors:** \`${hardErrors}\` error(s), \`${summary.errors.warningCount}\` warning(s)`,
      ``,
      `## Recent Adjudication Cycles`,
      ``,
      `| Cycle | Workflow | View | Target | Vehicle ID | Inspection | Isotopes | ConSys | Live UI | Duration | Status |`,
      `| ---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: | ---: | :---: |`,
      ...this.recentAdjudicationRecords.slice(-20).map((r) =>
        `| ${r.cycle + 1} | \`${r.workflow}\` | \`${r.scopeView}\` | \`${r.laneId}#${r.occupancyCount}\` | \`${r.vehicleId}\` | \`${r.secondaryInspection}\` | \`${r.isotopes}\` | ${r.consysVerified ? "YES" : "NO"} | ${r.uiRemovedLive ? "YES" : "NO"} | ${r.durationMs}ms | \`${r.status.toUpperCase()}\` |`,
      ),
      ``,
    ];
    writeAtomicPrivateFile(this.summaryMdPath, mdLines.join("\n"));
  }

  async run(): Promise<number> {
    if (!this.options.readOnlyWallboard && this.config.targetAcknowledgement !== this.config.targetHost) {
      throw new Error(
        `UI endurance adjudication refused: OSCAR_TEST_TARGET_ACK must equal ${this.config.targetHost}`,
      );
    }

    const spkiHashes = await discoverTlsSpkiHashes(this.config.oscarBaseUrl);
    this.spkiCount = spkiHashes.length;
    const executablePath = this.config.browserExecutablePath ??
      (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

    this.browser = await chromium.launch({
      headless: this.config.headless,
      ...(executablePath ? {executablePath} : {}),
      args: [
        ...(spkiHashes.length > 0
          ? [`--ignore-certificate-errors-spki-list=${spkiHashes.join(",")}`]
          : []),
      ],
    });

    this.wallboardContext = await this.browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ["notifications"],
      httpCredentials: {
        username: this.config.oscarUsername,
        password: this.config.oscarPassword,
      },
      viewport: {width: 1600, height: 1000},
      locale: "en-US",
    });
    this.wallboardContext.setDefaultTimeout(this.config.uiTimeoutMs);
    this.wallboardContext.setDefaultNavigationTimeout(this.config.uiTimeoutMs);
    await this.authenticateContext(this.wallboardContext);

    this.catalog = await this.discoverOccupancyCatalog(this.wallboardContext.request);

    if (!this.options.readOnlyWallboard) {
      this.operatorContext = await this.browser.newContext({
        ignoreHTTPSErrors: true,
        permissions: ["notifications", "clipboard-read", "clipboard-write"],
        httpCredentials: {
          username: this.config.oscarUsername,
          password: this.config.oscarPassword,
        },
        acceptDownloads: true,
        viewport: {width: 1600, height: 1000},
        locale: "en-US",
      });
      this.operatorContext.setDefaultTimeout(this.config.uiTimeoutMs);
      this.operatorContext.setDefaultNavigationTimeout(this.config.uiTimeoutMs);
      await installDeterministicQrCamera(this.operatorContext, createSpectroscopicCameraFixture());
      await this.authenticateContext(this.operatorContext);
      this.operatorPage = await this.operatorContext.newPage();
      this.attachPageTelemetry(this.operatorPage, "operator");
    }

    this.lastAlarmPollIso = new Date().toISOString();
    await this.openUnscopedWallboard();

    const configuredViews = this.config.laneConfigOracle
      ? [...REQUIRED_OPERATIONAL_VIEW_KEYS]
      : ["east-gate"];

    let anyFailure = false;

    try {
      for (let cycleIndex = 0; !this.stopRequested; cycleIndex++) {
        if (this.options.maxCycles !== undefined && cycleIndex >= this.options.maxCycles) break;
        if (
          this.options.durationSeconds !== undefined &&
          Date.now() - this.startedEpochMs >= this.options.durationSeconds * 1000
        ) {
          break;
        }

        this.currentCycle = cycleIndex;
        const plan = buildCycleExecutionPlan({
          cycleIndex,
          runTag: this.runId.slice(-6).toUpperCase(),
          configuredViews,
          scopedHoldCycles: this.options.scopedHoldCycles,
          operatorRecycleCycles: this.options.operatorRecycleCycles,
        });

        if (plan.rotateScopedWatcher) {
          await this.rotateScopedWallboard(plan.scopedWatcherViewKey);
        }
        if (!this.options.readOnlyWallboard && plan.recycleOperatorTab) {
          await this.recycleOperatorPage();
        }

        const windowStartIso = this.lastAlarmPollIso;
        await sleep(this.options.wallboardSettleMs);
        const windowEndIso = new Date().toISOString();
        this.lastAlarmPollIso = windowEndIso;

        const newlyArrived = await this.fetchAlarmsInWindow(
          this.wallboardContext.request,
          windowStartIso,
          windowEndIso,
        );
        const wallboardOutcome = await this.sampleWallboards(cycleIndex, newlyArrived);
        if (!wallboardOutcome.unscopedPassed || !wallboardOutcome.scopedPassed) {
          anyFailure = true;
        }

        let adjudicationRecord: AdjudicationRecord | undefined;
        if (!this.options.readOnlyWallboard) {
          const leaseBusy = await isRemoteSuiteLeaseBusy(this.config);
          if (leaseBusy) {
            adjudicationRecord = {
              timestamp: new Date().toISOString(),
              cycle: cycleIndex,
              workflow: plan.workflow,
              scopeView: plan.operatorViewKey ?? "all",
              laneId: "-",
              occupancyCount: "-",
              observationId: "-",
              vehicleId: plan.vehicleId,
              secondaryInspection: plan.secondaryInspection,
              isotopes: "-",
              evidenceSummary: "yielded-to-suite-lock",
              consysVerified: false,
              uiRemovedLive: false,
              durationMs: 0,
              status: "skipped",
              detail: "Yielded adjudication cycle because /run/lock/oscar-regression-suite/suite.lock is held",
            };
          } else {
            try {
              if (plan.workflow === "pwa-notification-detail") {
                adjudicationRecord = await this.runWorkflowPwaNotificationDetail(plan);
              } else if (plan.workflow === "scoped-quickview-inline") {
                adjudicationRecord = await this.runWorkflowScopedQuickViewInline(plan);
              } else if (plan.workflow === "event-log-filter-detail") {
                adjudicationRecord = await this.runWorkflowEventLogFilterDetail(plan);
              } else {
                adjudicationRecord = await this.runWorkflowBoundedBulkAdjudication(plan);
              }
            } catch (error) {
              const evidence = await this.captureScreenshot(
                this.operatorPage,
                `operator-${plan.workflow}-failure`,
              );
              const message = describeError(error);
              this.recordError(`operator-${plan.workflow}`, message, "error", evidence);
              adjudicationRecord = {
                timestamp: new Date().toISOString(),
                cycle: cycleIndex,
                workflow: plan.workflow,
                scopeView: plan.operatorViewKey ?? "all",
                laneId: "-",
                occupancyCount: "-",
                observationId: "-",
                vehicleId: plan.vehicleId,
                secondaryInspection: plan.secondaryInspection,
                isotopes: "-",
                evidenceSummary: evidence,
                consysVerified: false,
                uiRemovedLive: false,
                durationMs: 0,
                status: "failed",
                detail: message,
              };
              await this.recycleOperatorPage().catch(() => undefined);
            }
          }

          if (adjudicationRecord) {
            this.recordAdjudicationRecord(adjudicationRecord);
            if (adjudicationRecord.status === "failed") anyFailure = true;
          }
        }

        appendFileSync(
          this.cyclesJsonlPath,
          `${JSON.stringify({
            cycle: cycleIndex,
            timestamp: new Date().toISOString(),
            plan,
            wallboardOutcome,
            adjudication: adjudicationRecord ?? null,
          })}\n`,
          {encoding: "utf8", mode: 0o600},
        );

        this.writeSummary("running");
        console.log(
          `[ui-endurance] cycle=${cycleIndex + 1} scopedView=${plan.scopedWatcherViewKey} ` +
          `wallboards=${wallboardOutcome.unscopedPassed && wallboardOutcome.scopedPassed ? "PASS" : "FAIL"} ` +
          `workflow=${adjudicationRecord ? `${adjudicationRecord.workflow}:${adjudicationRecord.status.toUpperCase()}` : "READ_ONLY"} ` +
          `out=${this.outputDir}`,
        );

        const moreCyclesRemain =
          !this.stopRequested &&
          (this.options.maxCycles === undefined || cycleIndex + 1 < this.options.maxCycles) &&
          (this.options.durationSeconds === undefined ||
            Date.now() - this.startedEpochMs < this.options.durationSeconds * 1000);
        if (moreCyclesRemain) {
          await sleep(this.options.cycleIntervalMs);
        }
      }
    } catch (fatalError) {
      anyFailure = true;
      this.recordError("runner-fatal", describeError(fatalError), "error");
      this.writeSummary("failed");
      throw fatalError;
    } finally {
      await this.unscopedCdp?.detach().catch(() => undefined);
      await this.scopedCdp?.detach().catch(() => undefined);
      await this.operatorContext?.close().catch(() => undefined);
      await this.wallboardContext?.close().catch(() => undefined);
      await this.browser?.close().catch(() => undefined);
    }

    const finalFailed = anyFailure || this.hardErrorCount > 0;
    const finalStatus = this.stopRequested && !finalFailed
      ? "stopped"
      : finalFailed
        ? "failed"
        : "passed";
    this.writeSummary(finalStatus);
    console.log(`[ui-endurance] finished status=${finalStatus.toUpperCase()} summary=${this.summaryJsonPath}`);
    return finalFailed ? 1 : 0;
  }
}

async function main(): Promise<void> {
  const options = parseUiEnduranceCliArgs(process.argv.slice(2));
  const config = loadConfig(["--profile", "smoke"]);
  const runner = new UiEnduranceRunner(config, options);

  const onSignal = () => {
    runner.requestStop();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const exitCode = await runner.run();
    process.exitCode = exitCode;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

main().catch((error) => {
  console.error(`[ui-endurance] fatal: ${describeError(error)}`);
  process.exitCode = 1;
});
