import {
  REQUIRED_OPERATIONAL_VIEW_KEYS,
  type LaneConfigOracle,
} from "./lane-config.js";
import type {CapabilityMode} from "./types.js";

export interface HttpCacheObservation {
  status: number;
  cacheControl: string;
}

export interface ViewerCacheAssessment {
  authenticatedAssetValid: boolean;
  serviceWorkerValid: boolean;
  unauthenticatedAssetProtected: boolean;
  unauthenticatedAssetNotCacheable: boolean;
  passed: boolean;
}

function cacheDirectives(value: string): string[] {
  return value.toLowerCase().split(",").map((directive) => directive.trim()).filter(Boolean);
}

function hasDirective(directives: readonly string[], name: string): boolean {
  return directives.some((directive) => directive === name || directive.startsWith(`${name}=`));
}

function positiveLifetime(directives: readonly string[]): boolean {
  return directives.some((directive) => {
    const match = /^(?:s-maxage|max-age)\s*=\s*"?(\d+)"?$/.exec(directive);
    return match ? Number(match[1]) > 0 : false;
  });
}

export function assessViewerCachePolicy(input: {
  authenticatedAsset: HttpCacheObservation;
  serviceWorker: HttpCacheObservation;
  unauthenticatedAsset: HttpCacheObservation;
}): ViewerCacheAssessment {
  const assetDirectives = cacheDirectives(input.authenticatedAsset.cacheControl);
  const serviceWorkerDirectives = cacheDirectives(input.serviceWorker.cacheControl);
  const unauthenticatedDirectives = cacheDirectives(input.unauthenticatedAsset.cacheControl);

  const authenticatedAssetValid = input.authenticatedAsset.status >= 200 &&
    input.authenticatedAsset.status < 300 &&
    hasDirective(assetDirectives, "private") &&
    assetDirectives.includes("max-age=31536000") &&
    hasDirective(assetDirectives, "immutable") &&
    !hasDirective(assetDirectives, "public");
  const serviceWorkerValid = input.serviceWorker.status >= 200 &&
    input.serviceWorker.status < 300 &&
    hasDirective(serviceWorkerDirectives, "no-cache") &&
    !hasDirective(serviceWorkerDirectives, "immutable") &&
    !positiveLifetime(serviceWorkerDirectives);
  const unauthenticatedAssetProtected = input.unauthenticatedAsset.status === 401 ||
    input.unauthenticatedAsset.status === 403;
  const unauthenticatedAssetNotCacheable =
    !hasDirective(unauthenticatedDirectives, "public") &&
    !hasDirective(unauthenticatedDirectives, "immutable") &&
    !positiveLifetime(unauthenticatedDirectives);

  return {
    authenticatedAssetValid,
    serviceWorkerValid,
    unauthenticatedAssetProtected,
    unauthenticatedAssetNotCacheable,
    passed: authenticatedAssetValid && serviceWorkerValid &&
      unauthenticatedAssetProtected && unauthenticatedAssetNotCacheable,
  };
}

export interface OperationalViewScopePair {
  assignedView: string;
  nonMemberView: string;
}

export function scopedUuidOperationalViewChecksEnabled(
  mode: CapabilityMode,
  runtimeCapabilityAvailable: boolean,
): boolean {
  return mode === "required" || (mode === "auto" && runtimeCapabilityAvailable);
}

export function operationalViewScopePair(
  oracle: LaneConfigOracle,
  laneName: string,
): OperationalViewScopePair {
  const lane = oracle.lanes.find((candidate) => candidate.name === laneName);
  if (!lane) throw new Error(`Lane membership oracle does not contain ${laneName}`);

  const assignedView = lane.operationalViews.find((view) =>
    oracle.lanesByView.get(view)?.includes(laneName));
  if (!assignedView) {
    throw new Error(`Lane membership oracle does not assign ${laneName} to a known operational view`);
  }

  const knownViews = [...new Set([
    ...REQUIRED_OPERATIONAL_VIEW_KEYS,
    ...[...oracle.lanesByView.keys()].sort(),
  ])];
  const nonMemberView = knownViews.find((view) => {
    const members = oracle.lanesByView.get(view);
    return Boolean(members?.length) && !members?.includes(laneName);
  });
  if (!nonMemberView) {
    throw new Error(`Lane membership oracle has no non-member operational view for ${laneName}`);
  }

  return {assignedView, nonMemberView};
}

export interface AlarmChartCanvasSnapshot {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  gammaPlotPixels: number;
  neutronPlotPixels: number;
  canvasDigest?: string;
}

export type AlarmChartSeries = "gamma" | "neutron";

export function importedAlarmChartsRendered(
  expectedSeries: readonly AlarmChartSeries[],
  snapshots: readonly AlarmChartCanvasSnapshot[],
): boolean {
  return expectedSeries.length > 0 && snapshots.length === expectedSeries.length && snapshots.every((snapshot, index) => {
    const visible = snapshot.width > 0 && snapshot.height > 0 &&
      snapshot.clientWidth > 0 && snapshot.clientHeight > 0;
    const series = expectedSeries[index];
    const seriesPixels = series === "gamma"
      ? snapshot.gammaPlotPixels
      : series === "neutron"
        ? snapshot.neutronPlotPixels
        : 0;
    return visible && seriesPixels > 0;
  });
}

/** Require both live Lane Details datasets to paint, not merely their canvases. */
export function liveLaneTelemetryChartsRendered(
  gamma: AlarmChartCanvasSnapshot,
  neutron: AlarmChartCanvasSnapshot,
): boolean {
  const visible = (snapshot: AlarmChartCanvasSnapshot) =>
    snapshot.width > 0 && snapshot.height > 0 &&
    snapshot.clientWidth > 0 && snapshot.clientHeight > 0;
  return visible(gamma) && visible(neutron) &&
    gamma.gammaPlotPixels > 0 && neutron.neutronPlotPixels > 0;
}

/**
 * Require both live Lane Details charts to actively redraw across 1 Hz ticks
 * rather than freezing after painting only their initial point.
 */
export function liveLaneTelemetryChartsAdvancing(
  initial: {gamma: AlarmChartCanvasSnapshot; neutron: AlarmChartCanvasSnapshot},
  subsequent: {gamma: AlarmChartCanvasSnapshot; neutron: AlarmChartCanvasSnapshot},
): boolean {
  if (!liveLaneTelemetryChartsRendered(initial.gamma, initial.neutron) ||
      !liveLaneTelemetryChartsRendered(subsequent.gamma, subsequent.neutron)) {
    return false;
  }
  const gammaAdvanced = Boolean(
    initial.gamma.canvasDigest &&
    subsequent.gamma.canvasDigest &&
    initial.gamma.canvasDigest !== subsequent.gamma.canvasDigest,
  );
  const neutronAdvanced = Boolean(
    initial.neutron.canvasDigest &&
    subsequent.neutron.canvasDigest &&
    initial.neutron.canvasDigest !== subsequent.neutron.canvasDigest,
  );
  return gammaAdvanced && neutronAdvanced;
}

export const LIVE_VIDEO_MAX_STARTUP_MS = 15_000;

export interface LiveVideoStartupObservation {
  readyState: number;
  width: number;
  height: number;
  paused: boolean;
  advanced: boolean;
  startupMs: number;
}

export function assessLiveVideoStartupAndAdvance(
  observation: LiveVideoStartupObservation,
  maxStartupMs = LIVE_VIDEO_MAX_STARTUP_MS,
): boolean {
  return observation.readyState >= 2 &&
    observation.width > 0 &&
    observation.height > 0 &&
    !observation.paused &&
    observation.advanced &&
    Number.isFinite(observation.startupMs) &&
    observation.startupMs >= 0 &&
    observation.startupMs <= maxStartupMs;
}

export interface MultiCameraFeedObservation {
  index: number;
  m3u8Url: string;
  readyState: number;
  width: number;
  height: number;
  advanced: boolean;
}

export function assessMultiCameraFeedCycle(
  expectedLaneCameras: number,
  feeds: readonly MultiCameraFeedObservation[],
): boolean {
  if (expectedLaneCameras < 2 || feeds.length !== expectedLaneCameras) {
    return false;
  }
  const urls = new Set<string>();
  for (let idx = 0; idx < feeds.length; idx++) {
    const feed = feeds[idx];
    if (!feed || feed.index !== idx) return false;
    const url = feed.m3u8Url.trim();
    if (!url || !/\.m3u8(?:\?|$)/i.test(url)) return false;
    if (urls.has(url)) return false;
    urls.add(url);
    if (feed.readyState < 2 || feed.width <= 0 || feed.height <= 0 || !feed.advanced) {
      return false;
    }
  }
  return urls.size === expectedLaneCameras;
}

export interface DashboardWidgetCustomizationObservation {
  initialAllVisible: boolean;
  laneStatusHiddenInDom: boolean;
  storedWhenLaneStatusHidden: {
    laneStatus?: boolean;
    eventTable?: boolean;
    quickView?: boolean;
  } | null;
  allHiddenResetPromptVisible: boolean;
  restoredAfterResetInDom: boolean;
  storedAfterReset: {
    laneStatus?: boolean;
    eventTable?: boolean;
    quickView?: boolean;
  } | null;
}

export function assessDashboardWidgetCustomization(
  obs: DashboardWidgetCustomizationObservation,
): boolean {
  const hiddenStoredValid = obs.storedWhenLaneStatusHidden?.laneStatus === false &&
    obs.storedWhenLaneStatusHidden?.eventTable === true &&
    obs.storedWhenLaneStatusHidden?.quickView === true;
  const resetStoredValid = obs.storedAfterReset?.laneStatus === true &&
    obs.storedAfterReset?.eventTable === true &&
    obs.storedAfterReset?.quickView === true;
  return obs.initialAllVisible &&
    obs.laneStatusHiddenInDom &&
    hiddenStoredValid &&
    obs.allHiddenResetPromptVisible &&
    obs.restoredAfterResetInDom &&
    resetStoredValid;
}

export interface LaneStatusTableFaultRow {
  status: string;
  timestamp: string;
}

export function assessLaneViewStatusTableFaults(
  rows: readonly LaneStatusTableFaultRow[],
  expectedStatuses: readonly string[],
): boolean {
  if (!expectedStatuses.length || !rows.length) return false;
  const normalizeStatus = (value: string) =>
    value.trim().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").toLowerCase();
  const validRows = rows.filter((row) => {
    const status = row.status.trim();
    const ts = row.timestamp.trim();
    if (!status || !ts || /invalid date/i.test(ts)) return false;
    return Number.isFinite(Date.parse(ts));
  });
  if (validRows.length !== rows.length) return false;
  return expectedStatuses.every((expected) =>
    validRows.some((row) => normalizeStatus(row.status) === normalizeStatus(expected)),
  );
}

export function canonicalAlarmTransferDocumentJson(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new Error("Alarm transfer document must be an object");
  }
  const document = value as Record<string, unknown>;
  if (!document.payload || typeof document.payload !== "object" ||
    !document.integrity || typeof document.integrity !== "object" ||
    typeof document.transport !== "string") {
    throw new Error("Alarm transfer document is missing payload, integrity, or transport");
  }
  return JSON.stringify({
    payload: document.payload,
    integrity: document.integrity,
    transport: document.transport,
  });
}
