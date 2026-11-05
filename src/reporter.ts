import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {toCsv} from "./csv.js";
import {OSCAR_COMPOSE_SERVICES} from "./types.js";
import type {
  AggregateRow,
  ErrorRecord,
  FunctionalResult,
  MetricSample,
  RunMetadata,
  ResultStatus,
  StorageMetricSample,
} from "./types.js";

const FUNCTIONAL_COLUMNS: readonly (keyof FunctionalResult)[] = [
  "runId", "timestamp", "scenario", "category", "action", "target", "expected",
  "observed", "status", "durationMs", "evidence", "error",
];
const ERROR_COLUMNS: readonly (keyof ErrorRecord)[] = [
  "runId", "timestamp", "scenario", "source", "severity", "message", "evidence",
];
const METRIC_COLUMNS: readonly (keyof MetricSample)[] = [
  "runId", "timestamp", "phase", "source", "target", "composeService", "containerId",
  "containerState", "containerHealth", "containerStatsAvailable", "cpuPercent", "memoryUsedBytes",
  "memoryLimitBytes", "memoryPercent", "pids", "restartCount", "oomKilled", "load1m",
  "hostMemoryAvailableBytes", "note",
];
const AGGREGATE_COLUMNS: readonly (keyof AggregateRow)[] = [
  "runId", "section", "group", "total", "correct", "incorrect", "skipped",
  "accuracyPercent", "peakCpuPercent", "peakMemoryBytes", "averageCpuPercent",
  "averageMemoryBytes",
];
const STORAGE_METRIC_COLUMNS: readonly (keyof StorageMetricSample)[] = [
  "runId", "timestamp", "phase", "databaseSizeBytes", "observationTableBytes",
  "observationIndexBytes", "walBytes", "tempBytes", "tuplesInserted", "tuplesUpdated",
  "tuplesDeleted", "transactionCommits", "transactionRollbacks", "observationInsertCalls",
  "observationInsertRows", "observationRowsPerCall", "statementTempBlocksWritten",
  "observationDeleteCalls", "observationDeleteRows", "observationRowsPerDeleteCall",
  "legacySingletonObservationDeleteCalls", "batchedObservationDeleteCalls",
  "batchedObservationDeleteRows", "batchedObservationRowsPerDeleteCall",
  "activeArchiveGenerations",
  "sealedArchiveGenerations", "archiveRows", "archiveBytes", "failedArchiveJobs",
  "failedParityReceipts", "activeHolds", "verifiedBackups", "journalBytes",
  "dailyFileBytes", "retainedMediaBytes", "retainedMediaManifestFiles",
  "retainedMediaJpegFiles", "processedObservationIndexFiles",
  "processedObservationIndexBytes", "deletionIndexFiles", "deletionIndexBytes",
  "legacyProcessedMarkerFiles", "legacyDeletionTombstones",
  "mediaMetadataCheckpointBytes", "backupBytes", "note",
];

/** Unweighted arithmetic mean of the available point-in-time samples. */
function arithmeticSampleMean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function performanceGroup(sample: MetricSample): string {
  if (sample.source !== "oscar-container") return `${sample.source}:${sample.target}`;
  return [
    sample.source,
    sample.composeService ?? "unresolved-service",
    sample.containerId ?? "missing-container",
    sample.target,
  ].join(":");
}

function containerSampleLabel(sample: MetricSample): string {
  const identity = sample.containerId ? sample.containerId.slice(0, 12) : "missing";
  return `${sample.phase}/${sample.composeService ?? "unresolved"}/${identity}`;
}

function unavailableNumber(value: number | null): boolean {
  return value === null || !Number.isFinite(value);
}

function maximum(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function rounded(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  return Number(value.toFixed(digits));
}

function oneLine(value: unknown): string {
  return String(value ?? "").replaceAll(/\s+/g, " ").trim();
}

export class RunReporter {
  readonly functional: FunctionalResult[] = [];
  readonly errors: ErrorRecord[] = [];
  readonly metrics: MetricSample[] = [];
  readonly storageMetrics: StorageMetricSample[] = [];
  readonly outputDir: string;
  readonly evidenceDir: string;
  readonly downloadDir: string;
  private readonly secrets: string[];
  private readonly metadata: RunMetadata;
  private readonly requiredRemoteMetricPhases = new Set<string>();
  private readonly expectedRemoteMetricDisruptionPhases = new Set<string>();
  private remoteMetricTarget: string | undefined;

  constructor(
    readonly runId: string,
    resultsRoot: string,
    secrets: string[] = [],
    metadata: RunMetadata,
  ) {
    this.outputDir = join(resultsRoot, runId);
    this.evidenceDir = join(this.outputDir, "evidence");
    this.downloadDir = join(this.outputDir, "downloads");
    mkdirSync(this.evidenceDir, {recursive: true});
    mkdirSync(this.downloadDir, {recursive: true});
    this.secrets = secrets.filter(Boolean);
    this.metadata = metadata;
  }

  addMetadata(values: Partial<RunMetadata>): void {
    Object.assign(this.metadata, values);
  }

  requireRemoteMetricPhase(phase: string): void {
    const normalized = oneLine(phase);
    if (normalized) this.requiredRemoteMetricPhases.add(normalized);
  }

  expectRemoteMetricDisruptionPhase(phase: string): void {
    const normalized = oneLine(phase);
    const restore = this.metadata.profile === "restore-drill" &&
      normalized === "storage-restore-drill-disruption";
    const lifecycleDisruption = (this.metadata.profile === "full" ||
      this.metadata.profile === "3.9.2-release" ||
      this.metadata.profile === "3.11.0-release") && [
      "storage-lifecycle-export-disruption",
      "storage-lifecycle-restart-disruption",
      "storage-lifecycle-backup-disruption",
    ].includes(normalized);
    if (!restore && !lifecycleDisruption) {
      throw new Error(
        "Remote metric disruption exemptions are restricted to exact supported disruption phases",
      );
    }
    this.expectedRemoteMetricDisruptionPhases.add(normalized);
  }

  setRemoteMetricTarget(target: string): void {
    const normalized = oneLine(target);
    if (normalized) this.remoteMetricTarget = normalized;
  }

  redact(value: unknown): string {
    let text = oneLine(value);
    for (const secret of this.secrets) text = text.replaceAll(secret, "[REDACTED]");
    return text.replaceAll(/(authorization\s*[:=]\s*basic\s+)[a-z0-9+/=]+/gi, "$1[REDACTED]");
  }

  record(input: Omit<FunctionalResult, "runId" | "timestamp">): void {
    this.functional.push({
      runId: this.runId,
      timestamp: new Date().toISOString(),
      ...input,
      observed: this.redact(input.observed),
      error: this.redact(input.error),
    });
  }

  outcome(
    scenario: string,
    category: string,
    action: string,
    target: string,
    expected: string,
    observed: string,
    status: ResultStatus,
    durationMs: number,
    evidence = "",
    error = "",
  ): void {
    this.record({scenario, category, action, target, expected, observed, status, durationMs, evidence, error});
  }

  error(
    scenario: string,
    source: string,
    message: unknown,
    evidence = "",
    severity: ErrorRecord["severity"] = "error",
  ): void {
    this.errors.push({
      runId: this.runId,
      timestamp: new Date().toISOString(),
      scenario,
      source,
      severity,
      message: this.redact(message),
      evidence,
    });
  }

  metric(sample: Omit<MetricSample, "runId" | "timestamp">): void {
    this.metrics.push({runId: this.runId, timestamp: new Date().toISOString(), ...sample});
  }

  storageMetric(sample: Omit<StorageMetricSample, "runId" | "timestamp">): void {
    this.storageMetrics.push({runId: this.runId, timestamp: new Date().toISOString(), ...sample});
  }

  aggregate(): AggregateRow[] {
    const rows: AggregateRow[] = [];
    const groups = new Map<string, FunctionalResult[]>();
    groups.set("all", this.functional);
    for (const item of this.functional) {
      for (const group of [
        `category:${item.category}`,
        `scenario:${item.scenario}`,
        `action:${item.scenario}/${item.action}`,
      ]) groups.set(group, [...(groups.get(group) ?? []), item]);
    }
    for (const [group, subset] of groups) {
      const correct = subset.filter((item) => item.status === "correct").length;
      const incorrect = subset.filter((item) => item.status === "incorrect").length;
      const skipped = subset.filter((item) => item.status === "skipped").length;
      const evaluated = correct + incorrect;
      rows.push({
        runId: this.runId,
        section: "correctness",
        group,
        total: subset.length,
        correct,
        incorrect,
        skipped,
        accuracyPercent: evaluated ? rounded((correct / evaluated) * 100) : null,
        peakCpuPercent: null,
        peakMemoryBytes: null,
        averageCpuPercent: null,
        averageMemoryBytes: null,
      });
    }

    const targets = new Set(this.metrics.map((item) => performanceGroup(item)));
    for (const target of targets) {
      const subset = this.metrics.filter((item) => performanceGroup(item) === target);
      const cpu = subset.flatMap((item) =>
        item.cpuPercent !== null && Number.isFinite(item.cpuPercent) ? [item.cpuPercent] : []);
      const memory = subset.flatMap((item) =>
        item.memoryUsedBytes !== null && Number.isFinite(item.memoryUsedBytes) ? [item.memoryUsedBytes] : []);
      rows.push({
        runId: this.runId,
        section: "performance",
        group: target,
        total: subset.length,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        accuracyPercent: null,
        peakCpuPercent: rounded(maximum(cpu)),
        peakMemoryBytes: rounded(maximum(memory), 0),
        averageCpuPercent: rounded(arithmeticSampleMean(cpu)),
        averageMemoryBytes: rounded(arithmeticSampleMean(memory), 0),
      });
    }
    return rows;
  }

  private addPerformanceHealthChecks(): void {
    if (!this.metadata.remoteMetricsExpected) return;
    const containers = this.metrics.filter((item) =>
      item.source === "oscar-container" && item.composeService !== null &&
      OSCAR_COMPOSE_SERVICES.includes(item.composeService));
    const requiredPhases = [...this.requiredRemoteMetricPhases];
    const disruptionPhases = this.expectedRemoteMetricDisruptionPhases;
    const steadyRequiredPhases = requiredPhases.filter((phase) => !disruptionPhases.has(phase));
    const steadyContainers = containers.filter((item) => !disruptionPhases.has(item.phase));
    const remoteTarget = this.remoteMetricTarget
      ?? this.metrics.find((item) => item.source === "oscar-host")?.target
      ?? "configured OSCAR_SSH_TARGET";
    const missingCoverage: string[] = [];
    if (!steadyRequiredPhases.length) missingCoverage.push("no steady-state required phases were registered");
    if (disruptionPhases.size && steadyRequiredPhases.length < 2) {
      missingCoverage.push("expected disruption lacks distinct pre/post steady-state phases");
    }
    for (const phase of steadyRequiredPhases) {
      for (const service of OSCAR_COMPOSE_SERVICES) {
        const serviceSamples = steadyContainers.filter((item) =>
          item.phase === phase && item.composeService === service);
        if (!serviceSamples.some((item) => item.containerId !== null) ||
            serviceSamples.some((item) => item.containerId === null)) {
          missingCoverage.push(`${phase}/${service}`);
        }
      }
    }
    this.outcome(
      "performance", "performance", "capture exact OSCAR Compose service metrics", remoteTarget,
      "gateway, oscar, and postgres identities are sampled in every steady-state required phase",
      missingCoverage.length
        ? `missing phase/service coverage: ${missingCoverage.join(", ")}`
        : `${steadyRequiredPhases.length * OSCAR_COMPOSE_SERVICES.length} steady-state phase/service pairs covered`,
      missingCoverage.length ? "incorrect" : "correct", 0,
    );

    if (disruptionPhases.size) {
      const unregistered = [...disruptionPhases].filter((phase) => !this.requiredRemoteMetricPhases.has(phase));
      const disruptionSamples = containers.filter((item) => disruptionPhases.has(item.phase));
      const missingHostCoverage = [...disruptionPhases].filter((phase) =>
        !this.metrics.some((item) => item.source === "oscar-host" && item.phase === phase &&
          item.load1m !== null && item.hostMemoryAvailableBytes !== null &&
          item.memoryLimitBytes !== null));
      const missingDisruptionCoverage = [...disruptionPhases].flatMap((phase) =>
        OSCAR_COMPOSE_SERVICES.filter((service) => !disruptionSamples.some((item) =>
          item.phase === phase && item.composeService === service)).map((service) => `${phase}/${service}`));
      this.outcome(
        "performance", "performance", "retain exact expected service-disruption metrics", remoteTarget,
        "only explicitly registered supported restore/restart phases are exempted from steady-state checks while every raw sample remains reported",
        unregistered.length
          ? `unregistered disruption phases: ${unregistered.join(", ")}`
          : missingHostCoverage.length
            ? `missing successful OSCAR host samples: ${missingHostCoverage.join(", ")}`
          : missingDisruptionCoverage.length
            ? `missing raw disruption samples: ${missingDisruptionCoverage.join(", ")}`
          : disruptionSamples.length
            ? `${disruptionSamples.length} raw samples retained for ${[...disruptionPhases].join(", ")}`
            : "no raw samples were captured for the expected disruption phase",
        unregistered.length || missingHostCoverage.length || missingDisruptionCoverage.length ||
          !disruptionSamples.length
          ? "incorrect" : "correct", 0,
      );
    }

    const incomplete = steadyContainers.filter((item) => {
      const identityMissing = item.containerId === null || item.containerState === null ||
        item.containerHealth === null || item.restartCount === null || item.oomKilled === null;
      const runningStatsMissing = item.containerState === "running" && (
        item.containerStatsAvailable !== true || unavailableNumber(item.cpuPercent) ||
        unavailableNumber(item.memoryUsedBytes) || unavailableNumber(item.memoryLimitBytes) ||
        unavailableNumber(item.memoryPercent) || unavailableNumber(item.pids)
      );
      return identityMissing || runningStatsMissing;
    });
    this.outcome(
      "performance", "performance", "validate OSCAR container metric samples", remoteTarget,
      disruptionPhases.size
        ? "every steady-state service sample has complete identity, state, health, restart, OOM, and running resource data"
        : "every observed service has complete identity, state, health, restart, OOM, and running resource data",
      incomplete.length
        ? `incomplete samples: ${[...new Set(incomplete.map(containerSampleLabel))].join(", ")}`
        : "all required container samples are complete",
      incomplete.length ? "incorrect" : "correct", 0,
    );

    const stopped = steadyContainers.filter((item) =>
      item.containerId !== null && item.containerState !== null && item.containerState !== "running");
    this.outcome(
      "performance", "performance", "detect stopped OSCAR containers", remoteTarget,
      disruptionPhases.size
        ? "gateway, oscar, and postgres remain running in every steady-state sample"
        : "gateway, oscar, and postgres remain running in every sample",
      stopped.length
        ? `non-running: ${[...new Set(stopped.map((item) =>
          `${containerSampleLabel(item)}=${item.containerState}`))].join(", ")}`
        : "all observed service containers remained running",
      stopped.length ? "incorrect" : "correct", 0,
    );

    const unhealthy = steadyContainers.filter((item) =>
      item.containerId !== null && item.containerHealth !== null && item.containerHealth !== "healthy");
    this.outcome(
      "performance", "performance", "detect unhealthy OSCAR containers", remoteTarget,
      disruptionPhases.size
        ? "gateway, oscar, and postgres remain healthy in every steady-state sample"
        : "gateway, oscar, and postgres remain healthy in every sample",
      unhealthy.length
        ? `not healthy: ${[...new Set(unhealthy.map((item) =>
          `${containerSampleLabel(item)}=${item.containerHealth}`))].join(", ")}`
        : "all observed service containers remained healthy",
      unhealthy.length ? "incorrect" : "correct", 0,
    );

    const oomTargets = [...new Set(containers
      .filter((item) => item.oomKilled)
      .map((item) => containerSampleLabel(item)))];
    this.outcome(
      "performance", "performance", "detect container OOM kills", remoteTarget,
      "no sampled OSCAR service container is OOM-killed",
      oomTargets.length ? `OOM-killed: ${oomTargets.join(", ")}` : "none",
      oomTargets.length ? "incorrect" : "correct", 0,
    );

    const changedRestarts: string[] = [];
    const restartIdentities = new Set(containers.flatMap((item) =>
      item.containerId && item.composeService ? [`${item.composeService}/${item.containerId}`] : []));
    for (const identity of restartIdentities) {
      const counts = new Set(containers
        .filter((item) => `${item.composeService}/${item.containerId}` === identity && item.restartCount !== null)
        .map((item) => item.restartCount as number));
      if (counts.size > 1) changedRestarts.push(`${identity.split("/")[0]}/${identity.split("/")[1]?.slice(0, 12)}`);
    }
    this.outcome(
      "performance", "performance", "detect container restarts", remoteTarget,
      "each OSCAR container identity keeps a constant restart count during the run",
      changedRestarts.length
        ? `restart count changed: ${changedRestarts.join(", ")}`
        : "no restart count changed",
      changedRestarts.length ? "incorrect" : "correct", 0,
    );

    const identityIssues: string[] = [];
    for (const service of OSCAR_COMPOSE_SERVICES) {
      const serviceSamples = steadyContainers.filter((item) => item.composeService === service);
      if (disruptionPhases.size) {
        for (const phase of steadyRequiredPhases) {
          const identities = [...new Set(serviceSamples
            .filter((item) => item.phase === phase)
            .flatMap((item) => item.containerId ? [item.containerId] : []))];
          if (identities.length > 1) {
            identityIssues.push(
              `${service} used multiple container IDs in ${phase} (${identities.map((id) => id.slice(0, 12)).join(", ")})`,
            );
          }
        }
      } else {
        const identities = [...new Set(serviceSamples.flatMap((item) =>
          item.containerId ? [item.containerId] : []))];
        if (identities.length > 1) {
          identityIssues.push(`${service} used multiple container IDs (${identities.map((id) => id.slice(0, 12)).join(", ")})`);
        }
      }
      const absentPhases = steadyRequiredPhases.filter((phase) => {
        const phaseSamples = serviceSamples.filter((item) => item.phase === phase);
        return !phaseSamples.some((item) => item.containerId !== null) ||
          phaseSamples.some((item) => item.containerId === null);
      });
      if (absentPhases.length) identityIssues.push(`${service} absent in ${absentPhases.join(",")}`);
    }
    this.outcome(
      "performance", "performance", "detect service disappearance or recreation", remoteTarget,
      disruptionPhases.size
        ? "each OSCAR Compose service keeps one identity within every pre/post steady-state phase and is present in each"
        : "each OSCAR Compose service keeps one container identity and is present in every required phase",
      identityIssues.length ? identityIssues.join("; ") : "service identities remained present and stable",
      identityIssues.length ? "incorrect" : "correct", 0,
    );
  }

  finalize(startedAt: Date, finishedAt = new Date()): {exitCode: number; outputDir: string} {
    const nonPerformanceCheckCount = this.functional.filter((item) => item.scenario !== "performance").length;
    this.addPerformanceHealthChecks();
    const aggregate = this.aggregate();
    writeFileSync(join(this.outputDir, "functional-results.csv"), toCsv(this.functional, FUNCTIONAL_COLUMNS));
    writeFileSync(join(this.outputDir, "errors.csv"), toCsv(this.errors, ERROR_COLUMNS));
    writeFileSync(join(this.outputDir, "performance.csv"), toCsv(this.metrics, METRIC_COLUMNS));
    writeFileSync(
      join(this.outputDir, "storage-performance.csv"),
      toCsv(this.storageMetrics, STORAGE_METRIC_COLUMNS),
    );
    writeFileSync(join(this.outputDir, "summary.csv"), toCsv(aggregate, AGGREGATE_COLUMNS));

    const overall = aggregate.find((row) => row.section === "correctness" && row.group === "all");
    const failures = this.functional.filter((item) => item.status === "incorrect");
    const warnings = this.errors.filter((item) => item.severity === "warning");
    const fatalErrors = this.errors.filter((item) => item.severity === "error");
    const performance = aggregate.filter((row) => row.section === "performance");
    const topCpu = [...performance]
      .filter((row) => row.peakCpuPercent !== null)
      .sort((a, b) => (b.peakCpuPercent ?? 0) - (a.peakCpuPercent ?? 0))[0];
    const topMemory = [...performance]
      .filter((row) => row.peakMemoryBytes !== null)
      .sort((a, b) => (b.peakMemoryBytes ?? 0) - (a.peakMemoryBytes ?? 0))[0];
    const status = failures.length === 0 && fatalErrors.length === 0 && nonPerformanceCheckCount > 0 ? "PASS" : "FAIL";
    const durationSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1_000;
    const failureLines = failures.slice(0, 10).map((item) =>
      `- ${item.scenario} / ${item.action}: expected ${item.expected}; observed ${item.observed || item.error || "no result"}`,
    );
    const narrative = [
      `# OSCAR regression report — ${status}`,
      "",
      `Run \`${this.runId}\` started ${startedAt.toISOString()} and completed ${finishedAt.toISOString()} in ${durationSeconds.toFixed(1)} seconds.`,
      "",
      `OSCAR produced ${overall?.correct ?? 0} correct, ${overall?.incorrect ?? 0} incorrect, and ${overall?.skipped ?? 0} skipped checks (${overall?.accuracyPercent ?? "n/a"}% accuracy over evaluated checks).`,
      this.errors.length
        ? `${this.errors.length} runtime issue(s) were captured (${warnings.length} warning(s)); see \`errors.csv\` and evidence files.`
        : "No browser, API, or sampler errors were captured.",
      topCpu ? `Peak sampled CPU was ${topCpu.peakCpuPercent}% for \`${topCpu.group}\`.` : "CPU sampling was unavailable.",
      topMemory ? `Peak sampled memory was ${topMemory.peakMemoryBytes} bytes for \`${topMemory.group}\`.` : "Memory sampling was unavailable.",
      "",
      "## Incorrect checks",
      "",
      ...(failureLines.length ? failureLines : fatalErrors.length
        ? [`No functional assertion failed, but ${fatalErrors.length} runtime error(s) made this run fail.`]
        : nonPerformanceCheckCount === 0
          ? ["No non-performance functional checks were evaluated; an empty run is invalid."]
          : ["None."]),
      "",
      "## Report files",
      "",
      "- `functional-results.csv`: one row per expected OSCAR behavior.",
      "- `performance.csv`: timestamped runner, host, and container CPU/memory samples.",
      "- `storage-performance.csv`: PostgreSQL, archive, journal, media, backup, and batch counters.",
      "- `summary.csv`: correctness counts and aggregate resource measurements.",
      "- `errors.csv`: browser, API, cleanup, and sampling errors.",
      "- `evidence/`: screenshots and supporting artifacts.",
      "- `downloads/`: generated OSCAR reports and alarm exports.",
      "",
    ].join("\n");
    writeFileSync(join(this.outputDir, "summary.md"), narrative);
    writeFileSync(join(this.outputDir, "run.json"), `${JSON.stringify({
      schemaVersion: 2,
      runId: this.runId,
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      environment: this.metadata,
      counts: overall,
      files: {
        functional: "functional-results.csv",
        performance: "performance.csv",
        storagePerformance: "storage-performance.csv",
        summary: "summary.csv",
        errors: "errors.csv",
        narrative: "summary.md",
      },
    }, null, 2)}\n`);
    return {exitCode: status === "PASS" ? 0 : 1, outputDir: this.outputDir};
  }
}
