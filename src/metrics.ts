import {execFile} from "node:child_process";
import {cpus, freemem, hostname, loadavg, totalmem} from "node:os";
import {promisify} from "node:util";
import {
  OSCAR_COMPOSE_SERVICES,
  type OscarComposeService,
  type SuiteConfig,
} from "./types.js";
import {isWindowsReleasePath} from "./config.js";
import {RunReporter} from "./reporter.js";

const execFileAsync = promisify(execFile);

export function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(/%$/, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1_000,
  kib: 1_024,
  mb: 1_000_000,
  mib: 1_048_576,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
  tb: 1_000_000_000_000,
  tib: 1_099_511_627_776,
};

export function parseBytes(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgt]?i?b)$/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  const multiplier = UNIT_BYTES[(match[2] ?? "").toLowerCase()];
  return Number.isFinite(amount) && multiplier ? Math.round(amount * multiplier) : null;
}

interface DockerStat {
  ID?: string;
  Name?: string;
  Container?: string;
  CPUPerc?: string;
  MemUsage?: string;
  MemPerc?: string;
  PIDs?: string;
}

interface DockerInspectDocument {
  Id?: string;
  Name?: string;
  RestartCount?: number;
  Config?: {Labels?: Record<string, string>};
  State?: {
    Status?: string;
    Running?: boolean;
    OOMKilled?: boolean;
    Health?: {Status?: string};
  };
}

export interface OscarContainerSnapshot {
  composeService: OscarComposeService;
  containerId: string | null;
  containerName: string | null;
  containerState: string | null;
  containerHealth: string | null;
  containerStatsAvailable: boolean;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
  pids: number | null;
  restartCount: number | null;
  oomKilled: boolean | null;
}

export type SshMetricsExecutor = (command: string) => Promise<string>;

export function parseDockerStats(text: string): DockerStat[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try { return [JSON.parse(trimmed) as DockerStat]; } catch { return []; }
  });
}

function splitMemory(value: string | undefined): [number | null, number | null] {
  const [used, limit] = value?.split("/").map((part) => part.trim()) ?? [];
  return [parseBytes(used), parseBytes(limit)];
}

function parseInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isOscarComposeService(value: string | undefined): value is OscarComposeService {
  return OSCAR_COMPOSE_SERVICES.includes(value as OscarComposeService);
}

function outputSection(text: string, startMarker: string, endMarker: string): string {
  const normalized = text.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(`${startMarker}\n`);
  if (start < 0) return "";
  const contentStart = start + startMarker.length + 1;
  const end = normalized.indexOf(`${endMarker}\n`, contentStart);
  return normalized.slice(contentStart, end < 0 ? undefined : end);
}

function missingOscarSnapshot(composeService: OscarComposeService): OscarContainerSnapshot {
  return {
    composeService,
    containerId: null,
    containerName: null,
    containerState: null,
    containerHealth: null,
    containerStatsAvailable: false,
    cpuPercent: null,
    memoryUsedBytes: null,
    memoryLimitBytes: null,
    memoryPercent: null,
    pids: null,
    restartCount: null,
    oomKilled: null,
  };
}

/**
 * Build a target-side read-only snapshot command for the canonical OSCAR
 * Compose project. All-state discovery is intentionally label-scoped so an
 * unrelated running container cannot satisfy remote-metrics coverage.
 */
export function buildOscarMetricsCommand(): string {
  return [
    "set -eu",
    "export LC_ALL=C",
    "printf '__CONTAINERS__\\n'",
    "running_ids=''",
    [
      "for service in gateway oscar postgres; do",
      "service_ids=$(docker ps --all --quiet --no-trunc --filter \"label=com.docker.compose.project=oscar\" --filter \"label=com.docker.compose.service=$service\" --filter \"label=com.docker.compose.oneoff=False\")",
      "service_found=false",
      "for container_id in $service_ids; do",
      "if inspect_json=$(docker inspect --format '{{json .}}' \"$container_id\" 2>/dev/null); then",
      "printf '%s\\n' \"$inspect_json\"",
      "service_found=true",
      "if running_state=$(docker inspect --format '{{.State.Running}}' \"$container_id\" 2>/dev/null); then",
      "if [ \"$running_state\" = true ]; then running_ids=\"$running_ids${running_ids:+ }$container_id\"; fi",
      "fi",
      "fi",
      "done",
      "if [ \"$service_found\" = false ]; then printf '__MISSING__\\t%s\\n' \"$service\"; fi",
      "done",
    ].join("\n"),
    "printf '__STATS__\\n'",
    [
      "if [ -n \"$running_ids\" ]; then",
      "docker stats --no-stream --format '{{json .}}' $running_ids 2>/dev/null || true",
      "fi",
    ].join("\n"),
    "printf '__HOST__\\n'",
    "awk '{print $1}' /proc/loadavg",
    "awk '/MemAvailable:/ {print $2 * 1024}' /proc/meminfo",
    "awk '/MemTotal:/ {print $2 * 1024}' /proc/meminfo",
    "awk '/^cpu / {for (i=2; i<=NF; i++) total += $i; print total, $5 + $6}' /proc/stat",
  ].join("\n");
}

export function buildWindowsOscarMetricsCommand(): string {
  const ps = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::Out.WriteLine('__CONTAINERS__')",
    "$runningIds = New-Object System.Collections.Generic.List[string]",
    "foreach ($service in @('gateway', 'oscar', 'postgres')) {",
    "  $ids = @(docker ps --all --quiet --no-trunc --filter 'label=com.docker.compose.project=oscar' --filter \"label=com.docker.compose.service=$service\" --filter 'label=com.docker.compose.oneoff=False' 2>$null)",
    "  $found = $false",
    "  foreach ($cid in $ids) {",
    "    if (-not $cid) { continue }",
    "    $insp = docker inspect --format '{{json .}}' $cid 2>$null",
    "    if ($LASTEXITCODE -eq 0 -and $insp) {",
    "      [Console]::Out.WriteLine($insp)",
    "      $found = $true",
    "      $running = docker inspect --format '{{.State.Running}}' $cid 2>$null",
    "      if ($running -eq 'true') { $runningIds.Add($cid) }",
    "    }",
    "  }",
    "  if (-not $found) { [Console]::Out.WriteLine(\"__MISSING__`t$service\") }",
    "}",
    "[Console]::Out.WriteLine('__STATS__')",
    "if ($runningIds.Count -gt 0) {",
    "  docker stats --no-stream --format '{{json .}}' $runningIds 2>$null",
    "}",
    "[Console]::Out.WriteLine('__HOST__')",
    "$os = Get-CimInstance Win32_OperatingSystem 2>$null",
    "$availBytes = if ($os) { [int64]$os.FreePhysicalMemory * 1024 } else { 0 }",
    "$totalBytes = if ($os) { [int64]$os.TotalVisibleMemorySize * 1024 } else { 0 }",
    "[Console]::Out.WriteLine('0')",
    "[Console]::Out.WriteLine($availBytes)",
    "[Console]::Out.WriteLine($totalBytes)",
    "[Console]::Out.WriteLine('0 0')",
    "[Console]::Out.WriteLine('__END__')",
  ].join("\n");
  return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, "utf16le").toString("base64")}`;
}

/** Parse the container portions of buildOscarMetricsCommand output. */
export function parseOscarDockerSnapshot(text: string): OscarContainerSnapshot[] {
  const containerText = outputSection(text, "__CONTAINERS__", "__STATS__");
  const statsText = outputSection(text, "__STATS__", "__HOST__");
  const explicitlyMissing = new Set<OscarComposeService>();
  const inspections: DockerInspectDocument[] = [];

  for (const line of containerText.split(/\r?\n/)) {
    const missing = line.match(/^__MISSING__\t(gateway|oscar|postgres)$/);
    if (missing && isOscarComposeService(missing[1])) {
      explicitlyMissing.add(missing[1]);
      continue;
    }
    if (!line.trim().startsWith("{")) continue;
    try {
      const value = JSON.parse(line) as DockerInspectDocument;
      const labels = value.Config?.Labels;
      if (labels?.["com.docker.compose.project"] === "oscar" &&
          labels["com.docker.compose.oneoff"] !== "True" &&
          isOscarComposeService(labels["com.docker.compose.service"])) inspections.push(value);
    } catch {
      // A malformed inspection is omitted so required service coverage fails closed.
    }
  }

  const unavailableStats = new Set(statsText.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^__STAT_MISSING__\t([^\s]+)$/);
    return match?.[1] ? [match[1]] : [];
  }));
  const statsByIdentity = new Map<string, DockerStat>();
  for (const stat of parseDockerStats(statsText)) {
    for (const identity of [stat.ID, stat.Container, stat.Name]) {
      if (identity) statsByIdentity.set(identity.replace(/^\//, ""), stat);
    }
  }

  const snapshots: OscarContainerSnapshot[] = [];
  for (const inspection of inspections) {
    const service = inspection.Config?.Labels?.["com.docker.compose.service"];
    if (!isOscarComposeService(service)) continue;
    const containerId = inspection.Id?.trim() || null;
    const containerName = inspection.Name?.replace(/^\//, "").trim() || null;
    const stat = [containerId, containerId?.slice(0, 12), containerName]
      .flatMap((identity) => identity ? [statsByIdentity.get(identity)] : [])
      .find((value) => value !== undefined);
    const [memoryUsedBytes, memoryLimitBytes] = splitMemory(stat?.MemUsage);
    const statsUnavailable = !stat || (containerId !== null && (
      unavailableStats.has(containerId) || unavailableStats.has(containerId.slice(0, 12))
    ));
    snapshots.push({
      composeService: service,
      containerId,
      containerName,
      containerState: inspection.State?.Status ?? null,
      containerHealth: inspection.State
        ? inspection.State.Health?.Status ?? "none"
        : null,
      containerStatsAvailable: !statsUnavailable,
      cpuPercent: parsePercent(stat?.CPUPerc),
      memoryUsedBytes,
      memoryLimitBytes,
      memoryPercent: parsePercent(stat?.MemPerc),
      pids: parseInteger(stat?.PIDs),
      restartCount: Number.isSafeInteger(inspection.RestartCount) ? inspection.RestartCount as number : null,
      oomKilled: typeof inspection.State?.OOMKilled === "boolean" ? inspection.State.OOMKilled : null,
    });
  }

  for (const service of explicitlyMissing) {
    snapshots.push(missingOscarSnapshot(service));
  }
  const representedServices = new Set(snapshots.map((snapshot) => snapshot.composeService));
  for (const service of OSCAR_COMPOSE_SERVICES) {
    if (representedServices.has(service)) continue;
    snapshots.push(missingOscarSnapshot(service));
  }
  return snapshots;
}

function localCpuTotals(): {total: number; idle: number} {
  let total = 0;
  let idle = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return {total, idle};
}

export class MetricsSampler {
  private timer: NodeJS.Timeout | undefined;
  private activeSample: Promise<void> | undefined;
  private readonly requiredRemoteSamples = new Set<Promise<void>>();
  private phase = "initialization";
  private previousCpu = process.cpuUsage();
  private previousTime = process.hrtime.bigint();
  private previousRemoteCpu: {total: number; idle: number} | undefined;
  private previousLocalCpu = localCpuTotals();

  constructor(
    private readonly config: SuiteConfig,
    private readonly reporter: RunReporter,
    private readonly executeSsh?: SshMetricsExecutor,
  ) {
    if (config.oscarSshTarget) reporter.setRemoteMetricTarget(config.oscarSshTarget);
  }

  setPhase(phase: string): void {
    this.phase = phase;
    if (this.config.oscarSshTarget) {
      this.reporter.requireRemoteMetricPhase(phase);
      this.captureRequiredRemotePhase(phase);
    }
  }

  async start(): Promise<void> {
    if (this.config.oscarSshTarget) this.reporter.requireRemoteMetricPhase(this.phase);
    await this.sample();
    this.timer = setInterval(() => void this.sample(), this.config.metricsIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeSample;
    while (this.requiredRemoteSamples.size) {
      await Promise.all([...this.requiredRemoteSamples]);
    }
    await this.sample();
  }

  async sample(): Promise<void> {
    if (this.activeSample) return this.activeSample;
    const phase = this.phase;
    const active = Promise.resolve()
      .then(() => this.collectSample(phase))
      .finally(() => {
        if (this.activeSample === active) this.activeSample = undefined;
      });
    this.activeSample = active;
    await active;
  }

  private captureRequiredRemotePhase(phase: string): void {
    const operation = this.sampleOscarHost(phase, false).catch((error) => {
      this.recordUnavailableOscarServices(phase);
      this.reporter.error(phase, "metrics", error, "", "warning");
    });
    let tracked: Promise<void>;
    tracked = operation.finally(() => this.requiredRemoteSamples.delete(tracked));
    this.requiredRemoteSamples.add(tracked);
  }

  private async collectSample(phase: string): Promise<void> {
    try {
      this.sampleRunner(phase);
    } catch (error) {
      this.reporter.error(phase, "metrics", error, "", "warning");
    }
    if (this.config.oscarSshTarget) {
      try {
        await this.sampleOscarHost(phase, true);
      } catch (error) {
        this.recordUnavailableOscarServices(phase);
        this.reporter.error(phase, "metrics", error, "", "warning");
      }
    }
  }

  private recordUnavailableOscarServices(phase: string): void {
    for (const composeService of OSCAR_COMPOSE_SERVICES) {
      this.reporter.metric({
        phase,
        source: "oscar-container",
        target: composeService,
        composeService,
        containerId: null,
        containerState: null,
        containerHealth: null,
        containerStatsAvailable: false,
        cpuPercent: null,
        memoryUsedBytes: null,
        memoryLimitBytes: null,
        memoryPercent: null,
        pids: null,
        restartCount: null,
        oomKilled: null,
        load1m: null,
        hostMemoryAvailableBytes: null,
        note: "remote OSCAR metrics snapshot failed",
      });
    }
  }

  private sampleRunner(phase: string): void {
    const now = process.hrtime.bigint();
    const cpu = process.cpuUsage(this.previousCpu);
    const elapsedMicros = Number(now - this.previousTime) / 1_000;
    const cpuPercent = elapsedMicros > 0 ? ((cpu.user + cpu.system) / elapsedMicros) * 100 : null;
    this.previousCpu = process.cpuUsage();
    this.previousTime = now;
    this.reporter.metric({
      phase,
      source: "test-runner",
      target: "regression-process",
      composeService: null,
      containerId: null,
      containerState: null,
      containerHealth: null,
      containerStatsAvailable: null,
      cpuPercent,
      memoryUsedBytes: process.memoryUsage().rss,
      memoryLimitBytes: totalmem(),
      memoryPercent: totalmem() ? (process.memoryUsage().rss / totalmem()) * 100 : null,
      pids: 1,
      restartCount: 0,
      oomKilled: false,
      load1m: loadavg()[0] ?? null,
      hostMemoryAvailableBytes: freemem(),
      note: `${cpus().length} logical CPUs`,
    });
    const localCpu = localCpuTotals();
    const totalDelta = localCpu.total - this.previousLocalCpu.total;
    const idleDelta = localCpu.idle - this.previousLocalCpu.idle;
    this.previousLocalCpu = localCpu;
    const available = freemem();
    const total = totalmem();
    this.reporter.metric({
      phase,
      source: "test-runner-host",
      target: hostname(),
      composeService: null,
      containerId: null,
      containerState: null,
      containerHealth: null,
      containerStatsAvailable: null,
      cpuPercent: totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : null,
      memoryUsedBytes: total - available,
      memoryLimitBytes: total,
      memoryPercent: total > 0 ? ((total - available) / total) * 100 : null,
      pids: null,
      restartCount: null,
      oomKilled: null,
      load1m: loadavg()[0] ?? null,
      hostMemoryAvailableBytes: available,
      note: `${cpus().length} logical CPUs; includes browser processes`,
    });
  }

  private async ssh(command: string): Promise<string> {
    if (this.executeSsh) return this.executeSsh(command);
    if (!this.config.oscarSshTarget) return "";
    const args = [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=8",
      ...(this.config.sshIdentityFile
        ? ["-o", "IdentitiesOnly=yes", "-i", this.config.sshIdentityFile]
        : []),
      this.config.oscarSshTarget,
      command,
    ];
    const {stdout} = await execFileAsync("ssh", args, {timeout: 20_000, maxBuffer: 4 * 1024 * 1024});
    return stdout;
  }

  private async sampleOscarHost(phase: string, trackHostCpu: boolean): Promise<void> {
    const metricsCmd = isWindowsReleasePath(this.config.oscarReleaseDirectory)
      ? buildWindowsOscarMetricsCommand()
      : buildOscarMetricsCommand();
    const output = await this.ssh(metricsCmd);
    const hostLines = outputSection(output, "__HOST__", "__END__").trim().split(/\r?\n/);
    const load1m = Number.parseFloat(hostLines[0] ?? "");
    const available = Number.parseFloat(hostLines[1] ?? "");
    const totalMemory = Number.parseFloat(hostLines[2] ?? "");
    const [cpuTotalRaw, cpuIdleRaw] = (hostLines[3] ?? "").split(/\s+/);
    const remoteCpu = {total: Number.parseFloat(cpuTotalRaw ?? ""), idle: Number.parseFloat(cpuIdleRaw ?? "")};
    let hostCpuPercent: number | null = null;
    if (trackHostCpu && this.previousRemoteCpu &&
        Number.isFinite(remoteCpu.total) && Number.isFinite(remoteCpu.idle)) {
      const totalDelta = remoteCpu.total - this.previousRemoteCpu.total;
      const idleDelta = remoteCpu.idle - this.previousRemoteCpu.idle;
      if (totalDelta > 0) hostCpuPercent = ((totalDelta - idleDelta) / totalDelta) * 100;
    }
    if (trackHostCpu && Number.isFinite(remoteCpu.total) && Number.isFinite(remoteCpu.idle)) {
      this.previousRemoteCpu = remoteCpu;
    }
    for (const snapshot of parseOscarDockerSnapshot(output)) {
      const target = snapshot.containerName ?? snapshot.composeService;
      const note = snapshot.containerId === null
        ? "Compose project oscar service container is missing"
        : snapshot.containerState !== "running"
          ? "Compose project oscar service container is not running"
          : snapshot.containerStatsAvailable
            ? "Compose project oscar service"
            : "running container resource stats are unavailable";
      this.reporter.metric({
        phase,
        source: "oscar-container",
        target,
        composeService: snapshot.composeService,
        containerId: snapshot.containerId,
        containerState: snapshot.containerState,
        containerHealth: snapshot.containerHealth,
        containerStatsAvailable: snapshot.containerStatsAvailable,
        cpuPercent: snapshot.cpuPercent,
        memoryUsedBytes: snapshot.memoryUsedBytes,
        memoryLimitBytes: snapshot.memoryLimitBytes,
        memoryPercent: snapshot.memoryPercent,
        pids: snapshot.pids,
        restartCount: snapshot.restartCount,
        oomKilled: snapshot.oomKilled,
        load1m: Number.isFinite(load1m) ? load1m : null,
        hostMemoryAvailableBytes: Number.isFinite(available) ? available : null,
        note,
      });
    }
    this.reporter.metric({
      phase,
      source: "oscar-host",
      target: this.config.oscarSshTarget ?? "OSCAR_SSH_TARGET",
      composeService: null,
      containerId: null,
      containerState: null,
      containerHealth: null,
      containerStatsAvailable: null,
      cpuPercent: hostCpuPercent,
      memoryUsedBytes: Number.isFinite(totalMemory) && Number.isFinite(available) ? totalMemory - available : null,
      memoryLimitBytes: Number.isFinite(totalMemory) ? totalMemory : null,
      memoryPercent: Number.isFinite(totalMemory) && totalMemory > 0 && Number.isFinite(available)
        ? ((totalMemory - available) / totalMemory) * 100 : null,
      pids: null,
      restartCount: null,
      oomKilled: null,
      load1m: Number.isFinite(load1m) ? load1m : null,
      hostMemoryAvailableBytes: Number.isFinite(available) ? available : null,
      note: "host aggregate",
    });
  }
}
