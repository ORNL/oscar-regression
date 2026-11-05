import type {RpmConfig, RpmResponse, RpmStatus} from "./types.js";
import {poll} from "./util.js";

type FaultType = "gh" | "gl" | "nh" | "tamper";

export interface RpmTamperBaselineEntry {
  rpmId: string;
  running: boolean;
  connectedClients: number | null;
  tamperFault: boolean | null;
}

export interface KnownClearTamperAssessment {
  passed: boolean;
  expectedCount: number;
  rpmCount: number;
  clearCount: number;
  duplicateIds: string[];
  stoppedIds: string[];
  disconnectedIds: string[];
  activeIds: string[];
  unknownIds: string[];
}

/**
 * Require an explicit false tamper model value for every connected emulator
 * RPM. Connectivity by itself is never interpreted as a clear tamper state.
 */
export function assessKnownClearTamperBaseline(
  entries: readonly RpmTamperBaselineEntry[],
  expectedCount: number,
): KnownClearTamperAssessment {
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const {rpmId} of entries) {
    if (seen.has(rpmId)) duplicateIds.add(rpmId);
    seen.add(rpmId);
  }

  const stoppedIds = entries.filter(({running}) => !running).map(({rpmId}) => rpmId);
  const disconnectedIds = entries
    .filter(({connectedClients}) => connectedClients === null || connectedClients < 1)
    .map(({rpmId}) => rpmId);
  const activeIds = entries.filter(({tamperFault}) => tamperFault === true).map(({rpmId}) => rpmId);
  const unknownIds = entries
    .filter(({tamperFault}) => tamperFault !== true && tamperFault !== false)
    .map(({rpmId}) => rpmId);
  const clearCount = entries.filter(({tamperFault}) => tamperFault === false).length;

  return {
    passed: entries.length === expectedCount && seen.size === expectedCount &&
      duplicateIds.size === 0 && stoppedIds.length === 0 &&
      disconnectedIds.length === 0 && activeIds.length === 0 &&
      unknownIds.length === 0 && clearCount === expectedCount,
    expectedCount,
    rpmCount: entries.length,
    clearCount,
    duplicateIds: [...duplicateIds].sort(),
    stoppedIds: stoppedIds.sort(),
    disconnectedIds: disconnectedIds.sort(),
    activeIds: activeIds.sort(),
    unknownIds: unknownIds.sort(),
  };
}

export class RpmEmulatorClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 15_000) {}

  private async request<T>(path: string, init?: RequestInit, expected = 200): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {...init, signal: controller.signal});
      const body = await response.text();
      if (response.status !== expected) {
        throw new Error(`${init?.method ?? "GET"} ${path} returned ${response.status}: ${body.slice(0, 500)}`);
      }
      return (body ? JSON.parse(body) : {}) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  list(): Promise<RpmResponse[]> {
    return this.request<RpmResponse[]>("/api/rpms");
  }

  async get(rpmId: string): Promise<RpmResponse> {
    const rpm = (await this.list()).find((candidate) => candidate.id === rpmId);
    if (!rpm) throw new Error(`RPM ${rpmId} was not found`);
    return rpm;
  }

  status(rpmId: string): Promise<RpmStatus> {
    return this.request<RpmStatus>(`/api/rpms/${encodeURIComponent(rpmId)}/status`);
  }

  async statusOrNull(rpmId: string): Promise<RpmStatus | null> {
    try { return await this.status(rpmId); } catch (error) {
      if (error instanceof Error && error.message.includes(" returned 404:")) return null;
      throw error;
    }
  }

  /**
   * Read the modeled tamper state for every emulator RPM without changing it.
   * This is the source-state oracle; the Dashboard assertion independently
   * proves that OSCAR's Rapiscan driver published its required clear baseline
   * when the connection was established.
   */
  async tamperBaseline(): Promise<RpmTamperBaselineEntry[]> {
    const rpms = [...await this.list()].sort((left, right) => left.id.localeCompare(right.id));
    return Promise.all(rpms.map(async (rpm) => {
      const status = rpm.running ? await this.statusOrNull(rpm.id) : null;
      return {
        rpmId: rpm.id,
        running: rpm.running,
        connectedClients: status?.connected_clients ?? null,
        tamperFault: status?.tamper_fault ?? null,
      };
    }));
  }

  fault(rpmId: string, type: FaultType, active: boolean): Promise<{message: string}> {
    return this.request(
      `/api/rpms/${encodeURIComponent(rpmId)}/fault?type=${type}&active=${String(active)}`,
      {method: "POST"},
    );
  }

  trigger(rpmId: string, gamma: boolean, neutron: boolean): Promise<{message: string}> {
    if (!gamma && !neutron) throw new Error("At least one alarm source must be selected");
    return this.request(
      `/api/rpms/${encodeURIComponent(rpmId)}/trigger?gamma=${String(gamma)}&neutron=${String(neutron)}`,
      {method: "POST"},
    );
  }

  start(rpmId: string): Promise<{message: string}> {
    return this.request(`/api/rpms/${encodeURIComponent(rpmId)}/start`, {method: "POST"});
  }

  stop(rpmId: string): Promise<{message: string}> {
    return this.request(`/api/rpms/${encodeURIComponent(rpmId)}/stop`, {method: "POST"});
  }

  update(rpmId: string, config: RpmConfig): Promise<{message?: string}> {
    return this.request(`/api/rpms/${encodeURIComponent(rpmId)}`, {
      method: "PUT",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(config),
    });
  }

  waitForStatus(
    rpmId: string,
    accept: (status: RpmStatus) => boolean,
    description: string,
    timeoutMs = 45_000,
  ): Promise<RpmStatus> {
    return poll(() => this.status(rpmId), accept, {timeoutMs, intervalMs: 500, description});
  }

  async waitForStopped(rpmId: string, timeoutMs = 20_000): Promise<RpmResponse> {
    return poll(
      () => this.get(rpmId),
      (rpm) => !rpm.running,
      {timeoutMs, intervalMs: 400, description: `${rpmId} to stop`},
    );
  }

  async waitForConnected(rpmId: string, timeoutMs = 60_000, minClients = 1): Promise<RpmStatus> {
    const requiredClients = Math.max(1, Math.trunc(minClients));
    const suffix = requiredClients > 1 ? ` (${requiredClients} clients)` : "";
    return this.waitForStatus(
      rpmId,
      (status) => status.connected_clients >= requiredClients,
      `${rpmId} to reconnect to OSCAR${suffix}`,
      timeoutMs,
    );
  }

  async waitForIdle(rpmId: string, timeoutMs = 90_000): Promise<RpmStatus> {
    return this.waitForStatus(rpmId, (status) => status.state === "IDLE", `${rpmId} to become idle`, timeoutMs);
  }

  async clearFaults(rpmId: string): Promise<void> {
    const rpm = await this.get(rpmId);
    if (!rpm.running) await this.start(rpmId);
    for (const type of ["gh", "gl", "nh", "tamper"] as const) {
      await this.fault(rpmId, type, false);
    }
    await this.waitForStatus(
      rpmId,
      (status) => !status.gh_fault && !status.gl_fault && !status.nh_fault && !status.tamper_fault,
      `${rpmId} faults to clear`,
    );
  }

  quietConfig(original: RpmConfig): RpmConfig {
    return {
      ...structuredClone(original),
      occupancy_frequency: 0,
      occupancy_schedule_enabled: false,
      gamma_alarm_probability: 0,
      neutron_alarm_probability: 0,
      unique_alarm_probability: 0,
    };
  }

  shortAlarmConfig(original: RpmConfig, durationSeconds = 1): RpmConfig {
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1) {
      throw new Error("Short alarm duration must be a positive whole number of seconds");
    }
    return {
      ...this.quietConfig(original),
      occupancy_duration_range: [durationSeconds, durationSeconds],
    };
  }

  distributedNormAlarmConfig(original: RpmConfig, durationSeconds = 8): RpmConfig {
    return {
      ...this.quietConfig(original),
      occupancy_duration_range: [durationSeconds, durationSeconds],
      is_distributed: true,
      distributed_source_sigma: 0.85,
      source_pos_length: 0.5,
      source_pos_width: 0.5,
      source_pos_height: 0.5,
      eml_enabled: true,
      eml_collimated: true,
      lane_width: 4.82,
    };
  }

  localizedThreatAlarmConfig(original: RpmConfig, durationSeconds = 6): RpmConfig {
    return {
      ...this.quietConfig(original),
      occupancy_duration_range: [durationSeconds, durationSeconds],
      is_distributed: false,
      point_source_sigma: 0.12,
      source_pos_length: 0.5,
      source_pos_width: 0.05,
      source_pos_height: 0.1,
      eml_enabled: true,
      eml_collimated: true,
      lane_width: 4.82,
    };
  }

  extendedOccupancyConfig(original: RpmConfig, durationSeconds: number): RpmConfig {
    return {
      ...this.quietConfig(original),
      occupancy_frequency: 1,
      occupancy_duration_range: [durationSeconds, durationSeconds],
    };
  }

  async replaceConfig(rpmId: string, config: RpmConfig): Promise<RpmStatus> {
    const rpm = await this.get(rpmId);
    let expectedClients = 1;
    if (rpm.running) {
      const preStopStatus = await this.statusOrNull(rpmId);
      expectedClients = Math.max(1, preStopStatus?.connected_clients ?? 1);
      await this.stop(rpmId);
      await this.waitForStopped(rpmId);
    }
    await this.update(rpmId, config);
    await this.start(rpmId);
    const firstConnected = await this.waitForConnected(rpmId, 60_000, 1);
    if (expectedClients <= 1 || firstConnected.connected_clients >= expectedClients) {
      return firstConnected;
    }
    return this.waitForConnected(rpmId, 25_000, expectedClients).catch(() => this.status(rpmId));
  }
}
