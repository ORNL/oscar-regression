import {createHash, X509Certificate} from "node:crypto";
import {isIP} from "node:net";
import * as tls from "node:tls";
import {REQUIRED_OPERATIONAL_VIEW_KEYS, type LaneConfigOracle} from "./lane-config.js";

export const UI_ENDURANCE_PAGE_SIZE = 15;
export const MAX_BULK_ADJUDICATION_ROWS = 2;
export const DEFAULT_OPERATOR_RECYCLE_CYCLES = 12;

export const UI_ENDURANCE_WORKFLOWS = [
  "pwa-notification-detail",
  "scoped-quickview-inline",
  "event-log-filter-detail",
  "bounded-bulk-adjudication",
] as const;

export type UiEnduranceWorkflow = (typeof UI_ENDURANCE_WORKFLOWS)[number];

export const SECONDARY_INSPECTION_STATUSES = [
  "NONE",
  "REQUESTED",
  "COMPLETED",
] as const;

export type SecondaryInspectionStatus = (typeof SECONDARY_INSPECTION_STATUSES)[number];

export interface IsotopeTestPlan {
  readonly mode: "single" | "multi" | "unknown-exclusivity";
  readonly preSelect: readonly string[];
  readonly finalExpected: readonly string[];
}

export const ISOTOPE_TEST_PLANS: readonly IsotopeTestPlan[] = [
  {
    mode: "multi",
    preSelect: ["Cesium137", "Cobalt60"],
    finalExpected: ["Cesium137", "Cobalt60"],
  },
  {
    mode: "unknown-exclusivity",
    preSelect: ["Americium", "Uranium235", "Unknown"],
    finalExpected: ["Unknown"],
  },
  {
    mode: "single",
    preSelect: ["Potassium"],
    finalExpected: ["Potassium"],
  },
] as const;

export interface CycleExecutionPlan {
  readonly cycleIndex: number;
  readonly workflow: UiEnduranceWorkflow;
  readonly scopedWatcherViewKey: string;
  readonly rotateScopedWatcher: boolean;
  readonly recycleOperatorTab: boolean;
  readonly operatorViewKey: string | null;
  readonly secondaryInspection: SecondaryInspectionStatus;
  readonly isotopePlan: IsotopeTestPlan;
  readonly qrClearMode: "delete-in-form" | "clear-all-in-dialog";
  readonly vehicleId: string;
  readonly notes: string;
}

export interface AlarmEventSummary {
  readonly observationId: string;
  readonly laneId: string;
  readonly occupancyCount: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly status: string;
  readonly adjudicatedIdsCount: number;
}

export interface RenderedEventRow {
  readonly rowKey: string;
  readonly laneId: string;
  readonly occupancyCount: string;
  readonly status: string;
  readonly startTimeText: string;
}

export interface ScopedViewIsolationAssessment {
  readonly passed: boolean;
  readonly viewKey: string;
  readonly expectedLanes: readonly string[];
  readonly missingCardLanes: readonly string[];
  readonly unexpectedCardLanes: readonly string[];
  readonly outOfScopeTableLanes: readonly string[];
  readonly outOfScopeNotificationLanes: readonly string[];
  readonly mismatchedNotificationViews: readonly string[];
  readonly reason: string;
}

export interface PageZeroVisibilityAssessment {
  readonly eligibleNewAlarms: readonly AlarmEventSummary[];
  readonly expectedOnPageZero: readonly AlarmEventSummary[];
  readonly missingFromDom: readonly AlarmEventSummary[];
  readonly matchedInDom: readonly AlarmEventSummary[];
  readonly passed: boolean;
  readonly reason: string;
}

export interface UiEnduranceCliOptions {
  readonly maxCycles?: number;
  readonly durationSeconds?: number;
  readonly cycleIntervalMs: number;
  readonly scopedHoldCycles: number;
  readonly operatorRecycleCycles: number;
  readonly wallboardSettleMs: number;
  readonly readOnlyWallboard: boolean;
}

const BENIGN_VIEWER_CONSOLE_FRAGMENTS = [
  "Failed to load resource: the server responded with a status of 404",
  "MUI X: useResizeContainer",
  "QR Scan Error: No QR code found",
  "Failed to fetch DRF values",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_NAME_NOT_RESOLVED",
  "net::ERR_NETWORK_CHANGED",
] as const;

/**
 * Filters expected browser console noise (optional HLS/retained-media 404 probes,
 * QR frame misses prior to detection, and offline external Sandia WebID DRF lookups)
 * while preserving real application errors and Service Worker registration failures.
 */
export function isBenignViewerConsoleError(text: string): boolean {
  if (text.includes("Service Worker registration failed")) return false;
  return BENIGN_VIEWER_CONSOLE_FRAGMENTS.some((fragment) => text.includes(fragment));
}

const ALARM_PRIORITY_ORDER = ["Gamma & Neutron", "Neutron", "Gamma"] as const;

export function alarmPriorityRank(status: string): number {
  const index = ALARM_PRIORITY_ORDER.indexOf(status as (typeof ALARM_PRIORITY_ORDER)[number]);
  return index >= 0 ? index : ALARM_PRIORITY_ORDER.length;
}

/**
 * Mirrors oscar-viewer's `sortEventsByAlarmPriority` (`TableHelpers.ts`):
 * `Gamma & Neutron` -> `Neutron` -> `Gamma` -> others, tie-broken by newest `startTime`.
 */
export function compareAlarmsByViewerPriority(
  left: Pick<AlarmEventSummary, "status" | "startTime">,
  right: Pick<AlarmEventSummary, "status" | "startTime">,
): number {
  const priorityDiff = alarmPriorityRank(left.status) - alarmPriorityRank(right.status);
  if (priorityDiff !== 0) return priorityDiff;
  return new Date(right.startTime).getTime() - new Date(left.startTime).getTime();
}

export function deriveAlarmStatusFromResult(result: Record<string, unknown>): string {
  const rawCategory = typeof result.alarmCategoryCode === "string"
    ? result.alarmCategoryCode.trim()
    : "";
  if (rawCategory.length > 0) return rawCategory;
  const gammaAlarm = result.gammaAlarm === true;
  const neutronAlarm = result.neutronAlarm === true;
  if (gammaAlarm && neutronAlarm) return "Gamma & Neutron";
  if (gammaAlarm) return "Gamma";
  if (neutronAlarm) return "Neutron";
  return "None";
}

export function isUnadjudicatedAlarm(event: AlarmEventSummary): boolean {
  return event.status !== "None" && event.adjudicatedIdsCount === 0;
}

/**
 * Computes which newly arrived alarms MUST appear on Page 0 (`PAGE_SIZE = 15`) of a
 * never-reloaded `EventTable` (`tableMode="alarmtable"`), accounting for priority sorting
 * so lower-priority alarms legitimately sorted below 15 higher-priority rows do not trigger
 * false failures, while any dropped Page-0 alarm is caught deterministically.
 */
export function assessPageZeroAlarmVisibility(params: {
  readonly currentPageZeroEvents: readonly AlarmEventSummary[];
  readonly newlyArrivedEvents: readonly AlarmEventSummary[];
  readonly renderedRows: readonly RenderedEventRow[];
  readonly allowedLanes?: ReadonlySet<string>;
  readonly pageSize?: number;
}): PageZeroVisibilityAssessment {
  const pageSize = params.pageSize ?? UI_ENDURANCE_PAGE_SIZE;
  const eligibleNewAlarms = params.newlyArrivedEvents
    .filter(isUnadjudicatedAlarm)
    .filter((event) => !params.allowedLanes || params.allowedLanes.has(event.laneId));

  const byKey = new Map<string, AlarmEventSummary>();
  for (const existing of params.currentPageZeroEvents) {
    if (!isUnadjudicatedAlarm(existing)) continue;
    if (params.allowedLanes && !params.allowedLanes.has(existing.laneId)) continue;
    byKey.set(`${existing.laneId}:${existing.occupancyCount}:${existing.startTime}`, existing);
  }
  for (const incoming of eligibleNewAlarms) {
    byKey.set(`${incoming.laneId}:${incoming.occupancyCount}:${incoming.startTime}`, incoming);
  }

  const projectedPageZero = [...byKey.values()]
    .sort(compareAlarmsByViewerPriority)
    .slice(0, pageSize);
  const projectedIds = new Set(projectedPageZero.map((event) => event.observationId));

  const expectedOnPageZero = eligibleNewAlarms.filter((event) => projectedIds.has(event.observationId));
  const matchedInDom: AlarmEventSummary[] = [];
  const missingFromDom: AlarmEventSummary[] = [];

  for (const expected of expectedOnPageZero) {
    const present = params.renderedRows.some((row) =>
      row.laneId === expected.laneId &&
      String(row.occupancyCount).trim() === String(expected.occupancyCount).trim(),
    );
    if (present) matchedInDom.push(expected);
    else missingFromDom.push(expected);
  }

  const passed = missingFromDom.length === 0;
  const reason = passed
    ? `matched ${matchedInDom.length}/${expectedOnPageZero.length} Page-0 eligible alarms (${eligibleNewAlarms.length} total new in scope)`
    : `missing ${missingFromDom.length}/${expectedOnPageZero.length} Page-0 alarms in DOM: ` +
      missingFromDom.map((item) => `${item.laneId}#${item.occupancyCount}(${item.status})`).join(", ");

  return {
    eligibleNewAlarms,
    expectedOnPageZero,
    missingFromDom,
    matchedInDom,
    passed,
    reason,
  };
}

/**
 * Returns true when a Service Worker notification carries a non-empty operational-view
 * `viewKey` from a prior scoped epoch (`viewKey !== activeScopedViewKey`), while keeping
 * unscoped notifications (`viewKey == null`) and active-epoch notifications intact.
 */
export function shouldPurgePriorScopedNotification(
  notificationViewKey: unknown,
  activeScopedViewKey: string,
): boolean {
  return (
    typeof notificationViewKey === "string" &&
    notificationViewKey.length > 0 &&
    notificationViewKey !== activeScopedViewKey
  );
}

/**
 * Evaluates strict fail-closed Operational View isolation across `LaneStatus` cards,
 * `EventTable` rows, and Service Worker `alarm-notification-*` payloads.
 */
export function assessScopedViewIsolation(params: {
  readonly viewKey: string;
  readonly oracle: LaneConfigOracle;
  readonly renderedCardLanes: readonly string[];
  readonly renderedTableRows: readonly RenderedEventRow[];
  readonly notifications: readonly {
    readonly tag: string;
    readonly laneId?: string;
    readonly viewKey?: string | null;
  }[];
}): ScopedViewIsolationAssessment {
  const configured = params.oracle.lanesByView.get(params.viewKey);
  if (!configured || configured.length === 0) {
    return {
      passed: false,
      viewKey: params.viewKey,
      expectedLanes: [],
      missingCardLanes: [],
      unexpectedCardLanes: [...params.renderedCardLanes],
      outOfScopeTableLanes: params.renderedTableRows.map((row) => row.laneId),
      outOfScopeNotificationLanes: [],
      mismatchedNotificationViews: [],
      reason: `operational view ${params.viewKey} has no lanes in oracle`,
    };
  }

  const expectedSet = new Set(configured);
  const actualCardSet = new Set(params.renderedCardLanes);

  const missingCardLanes = configured.filter((lane) => !actualCardSet.has(lane));
  const unexpectedCardLanes = [...actualCardSet].filter((lane) => !expectedSet.has(lane)).sort();
  const outOfScopeTableLanes = [
    ...new Set(
      params.renderedTableRows
        .map((row) => row.laneId)
        .filter((lane) => Boolean(lane) && !expectedSet.has(lane)),
    ),
  ].sort();

  const outOfScopeNotificationLanes: string[] = [];
  const mismatchedNotificationViews: string[] = [];
  for (const notification of params.notifications) {
    if (!notification.tag.startsWith("alarm-notification-")) continue;
    if ((notification.viewKey ?? null) !== params.viewKey) {
      mismatchedNotificationViews.push(`${notification.tag}:${String(notification.viewKey ?? "null")}`);
    }
    if (notification.laneId && !expectedSet.has(notification.laneId)) {
      outOfScopeNotificationLanes.push(notification.laneId);
    }
  }

  const passed =
    missingCardLanes.length === 0 &&
    unexpectedCardLanes.length === 0 &&
    outOfScopeTableLanes.length === 0 &&
    outOfScopeNotificationLanes.length === 0 &&
    mismatchedNotificationViews.length === 0;

  const issues: string[] = [];
  if (missingCardLanes.length > 0) issues.push(`missing cards=${missingCardLanes.join(",")}`);
  if (unexpectedCardLanes.length > 0) issues.push(`unexpected cards=${unexpectedCardLanes.join(",")}`);
  if (outOfScopeTableLanes.length > 0) issues.push(`leaked table lanes=${outOfScopeTableLanes.join(",")}`);
  if (outOfScopeNotificationLanes.length > 0) {
    issues.push(`leaked notification lanes=${[...new Set(outOfScopeNotificationLanes)].join(",")}`);
  }
  if (mismatchedNotificationViews.length > 0) {
    issues.push(`mismatched notification views=${mismatchedNotificationViews.join(",")}`);
  }

  return {
    passed,
    viewKey: params.viewKey,
    expectedLanes: [...configured],
    missingCardLanes,
    unexpectedCardLanes,
    outOfScopeTableLanes,
    outOfScopeNotificationLanes: [...new Set(outOfScopeNotificationLanes)].sort(),
    mismatchedNotificationViews,
    reason: passed
      ? `view=${params.viewKey} isolated cleanly (${configured.length} cards, ${params.renderedTableRows.length} rows)`
      : issues.join("; "),
  };
}

/**
 * Selects non-reserved unadjudicated alarm candidates for operator adjudication,
 * strictly excluding `reservedLaneLabel` (`Lane50`) and bounding bulk selection to `<= 2`.
 */
export function selectAdjudicationCandidates<T extends {laneId: string; occupancyCount: string}>(params: {
  readonly rows: readonly T[];
  readonly reservedLaneLabel: string;
  readonly allowedLanes?: ReadonlySet<string>;
  readonly recentlyAdjudicatedKeys?: ReadonlySet<string>;
  readonly count: number;
}): T[] {
  if (!Number.isSafeInteger(params.count) || params.count < 1 || params.count > MAX_BULK_ADJUDICATION_ROWS) {
    throw new Error(`Adjudication candidate count must be between 1 and ${MAX_BULK_ADJUDICATION_ROWS}`);
  }
  const reserved = params.reservedLaneLabel.trim();
  const selected: T[] = [];
  const seenKeys = new Set<string>();

  for (const row of params.rows) {
    const lane = row.laneId.trim();
    if (!lane || lane === reserved) continue;
    if (params.allowedLanes && !params.allowedLanes.has(lane)) continue;
    const identity = `${lane}#${String(row.occupancyCount).trim()}`;
    if (seenKeys.has(identity)) continue;
    if (params.recentlyAdjudicatedKeys?.has(identity)) continue;
    seenKeys.add(identity);
    selected.push(row);
    if (selected.length === params.count) break;
  }
  return selected;
}

/**
 * Builds the deterministic cycle execution plan so continuous runs exercise every
 * adjudication workflow, every operational view, every secondary inspection state,
 * single/multi/Unknown-exclusive isotope rules, file WebID UI controls, and QR camera scan modes.
 */
export function buildCycleExecutionPlan(params: {
  readonly cycleIndex: number;
  readonly runTag: string;
  readonly configuredViews?: readonly string[];
  readonly scopedHoldCycles: number;
  readonly operatorRecycleCycles?: number;
}): CycleExecutionPlan {
  if (!Number.isSafeInteger(params.cycleIndex) || params.cycleIndex < 0) {
    throw new Error("cycleIndex must be a non-negative safe integer");
  }
  const holdCycles = Math.max(1, params.scopedHoldCycles);
  const recycleCycles = Math.max(1, params.operatorRecycleCycles ?? DEFAULT_OPERATOR_RECYCLE_CYCLES);
  const views = params.configuredViews && params.configuredViews.length > 0
    ? params.configuredViews
    : REQUIRED_OPERATIONAL_VIEW_KEYS;

  const workflow = UI_ENDURANCE_WORKFLOWS[params.cycleIndex % UI_ENDURANCE_WORKFLOWS.length]!;
  const viewEpoch = Math.floor(params.cycleIndex / holdCycles);
  const scopedWatcherViewKey = views[viewEpoch % views.length]!;
  const rotateScopedWatcher = params.cycleIndex === 0 || params.cycleIndex % holdCycles === 0;
  const recycleOperatorTab = params.cycleIndex > 0 && params.cycleIndex % recycleCycles === 0;

  // Alternate operator workflows across scoped and unscoped surfaces so every
  // adjudication workflow is exercised under operational-view scoping and unscoped mode.
  let operatorViewKey: string | null = null;
  if (workflow === "scoped-quickview-inline") {
    operatorViewKey = views[params.cycleIndex % views.length]!;
  } else if (workflow === "pwa-notification-detail") {
    operatorViewKey = params.cycleIndex % 8 >= 4 ? scopedWatcherViewKey : null;
  } else if (workflow === "event-log-filter-detail") {
    operatorViewKey = params.cycleIndex % 8 >= 4 ? views[(params.cycleIndex + 1) % views.length]! : null;
  } else if (workflow === "bounded-bulk-adjudication") {
    operatorViewKey = params.cycleIndex % 8 >= 4 ? views[(params.cycleIndex + 2) % views.length]! : null;
  }

  const secondaryInspection =
    SECONDARY_INSPECTION_STATUSES[params.cycleIndex % SECONDARY_INSPECTION_STATUSES.length]!;
  const isotopePlan = ISOTOPE_TEST_PLANS[params.cycleIndex % ISOTOPE_TEST_PLANS.length]!;
  const qrClearMode = Math.floor(params.cycleIndex / 2) % 2 === 0
    ? "clear-all-in-dialog"
    : "delete-in-form";
  const seq = String(params.cycleIndex + 1).padStart(5, "0");
  const safeTag = params.runTag.replace(/[^A-Za-z0-9-]/g, "").slice(-10) || "ENDURANCE";
  const vehicleId = `NIMO-UI-${safeTag}-${seq}`;
  const scopeLabel = operatorViewKey ? `view=${operatorViewKey}` : "view=unscoped";
  const notes = `Nimo automated UI endurance (${workflow}, ${scopeLabel}, cycle=${seq})`;

  return {
    cycleIndex: params.cycleIndex,
    workflow,
    scopedWatcherViewKey,
    rotateScopedWatcher,
    recycleOperatorTab,
    operatorViewKey,
    secondaryInspection,
    isotopePlan,
    qrClearMode,
    vehicleId,
    notes,
  };
}

export function parseUiEnduranceCliArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): UiEnduranceCliOptions {
  const values = new Map<string, string>();
  const booleanFlags = new Set<string>();
  const valueFlags = new Set([
    "--max-cycles",
    "--duration-seconds",
    "--interval-ms",
    "--scoped-hold-cycles",
    "--operator-recycle-cycles",
    "--wallboard-settle-ms",
  ]);
  const switchFlags = new Set(["--continuous", "--read-only-wallboard"]);

  for (let index = 0; index < args.length; index++) {
    const token = args[index] ?? "";
    if (switchFlags.has(token)) {
      if (booleanFlags.has(token)) throw new Error(`Duplicate argument ${token}`);
      booleanFlags.add(token);
      continue;
    }
    if (!valueFlags.has(token)) {
      throw new Error(`Unknown ui-endurance argument ${token}`);
    }
    if (values.has(token)) throw new Error(`Duplicate argument ${token}`);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("-") || !next.trim()) {
      throw new Error(`${token} requires a non-empty value`);
    }
    values.set(token, next.trim());
    index++;
  }

  const parsePositiveInt = (raw: string | undefined, name: string, minimum: number, maximum: number): number | undefined => {
    if (raw === undefined || raw === "") return undefined;
    if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} must be a whole-number integer`);
    const parsed = Number(raw.trim());
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error(`${name} must be between ${minimum} and ${maximum}`);
    }
    return parsed;
  };

  const maxCycles = parsePositiveInt(
    values.get("--max-cycles") ?? env.UI_ENDURANCE_MAX_CYCLES,
    "maxCycles",
    1,
    1_000_000,
  );
  const durationSeconds = parsePositiveInt(
    values.get("--duration-seconds") ?? env.UI_ENDURANCE_DURATION_SECONDS,
    "durationSeconds",
    10,
    31_536_000,
  );
  const cycleIntervalMs = parsePositiveInt(
    values.get("--interval-ms") ?? env.UI_ENDURANCE_INTERVAL_MS,
    "cycleIntervalMs",
    2_000,
    3_600_000,
  ) ?? 20_000;
  const continuous = booleanFlags.has("--continuous") ||
    ["1", "true", "yes", "on"].includes((env.UI_ENDURANCE_CONTINUOUS ?? "").trim().toLowerCase());
  const readOnlyWallboard = booleanFlags.has("--read-only-wallboard") ||
    ["1", "true", "yes", "on"].includes((env.UI_ENDURANCE_READ_ONLY ?? "").trim().toLowerCase());

  const effectiveMaxCycles = !continuous && maxCycles === undefined && durationSeconds === undefined
    ? 4
    : maxCycles;
  const scopedHoldCycles = parsePositiveInt(
    values.get("--scoped-hold-cycles") ?? env.UI_ENDURANCE_SCOPED_HOLD_CYCLES,
    "scopedHoldCycles",
    1,
    10_000,
  ) ?? (effectiveMaxCycles !== undefined && effectiveMaxCycles <= 8 ? 1 : 4);
  const operatorRecycleCycles = parsePositiveInt(
    values.get("--operator-recycle-cycles") ?? env.UI_ENDURANCE_OPERATOR_RECYCLE_CYCLES,
    "operatorRecycleCycles",
    1,
    10_000,
  ) ?? DEFAULT_OPERATOR_RECYCLE_CYCLES;
  const wallboardSettleMs = parsePositiveInt(
    values.get("--wallboard-settle-ms") ?? env.UI_ENDURANCE_WALLBOARD_SETTLE_MS,
    "wallboardSettleMs",
    1_000,
    120_000,
  ) ?? 6_000;

  return {
    ...(effectiveMaxCycles === undefined ? {} : {maxCycles: effectiveMaxCycles}),
    ...(durationSeconds === undefined ? {} : {durationSeconds}),
    cycleIntervalMs,
    scopedHoldCycles,
    operatorRecycleCycles,
    wallboardSettleMs,
    readOnlyWallboard,
  };
}

export function spkiSha256Base64FromCertDer(rawDer: Buffer): string {
  const cert = new X509Certificate(rawDer);
  const spkiDer = cert.publicKey.export({type: "spki", format: "der"});
  return createHash("sha256").update(spkiDer).digest("base64");
}

/**
 * Extracts SHA-256 SPKI hashes from the HTTPS endpoint's TLS certificate chain so
 * headless Chromium can pin `--ignore-certificate-errors-spki-list` and activate
 * `/sw.js` cleanly on self-signed test deployments without mutating host trust stores.
 */
export async function discoverTlsSpkiHashes(oscarBaseUrl: string, timeoutMs = 10_000): Promise<string[]> {
  const parsed = new URL(oscarBaseUrl);
  if (parsed.protocol !== "https:") return [];
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const port = parsed.port ? Number(parsed.port) : 443;

  return new Promise<string[]>((resolve, reject) => {
    const socket = tls.connect({
      host: hostname,
      port,
      rejectUnauthorized: false,
      ...(isIP(hostname) === 0 ? {servername: hostname} : {}),
    });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out discovering TLS SPKI hashes from ${hostname}:${port}`));
    }, timeoutMs);

    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      try {
        const hashes = new Set<string>();
        let current: tls.DetailedPeerCertificate | undefined = socket.getPeerCertificate(true);
        const visited = new Set<string>();
        while (current && current.raw && current.raw.length > 0) {
          const fingerprint = current.fingerprint256 || current.raw.toString("hex");
          if (visited.has(fingerprint)) break;
          visited.add(fingerprint);
          hashes.add(spkiSha256Base64FromCertDer(current.raw));
          if (!current.issuerCertificate || current.issuerCertificate === current) break;
          current = current.issuerCertificate;
        }
        socket.end();
        resolve([...hashes]);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
  });
}
