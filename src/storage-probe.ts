import {execFile} from "node:child_process";
import {resolve} from "node:path";
import {promisify} from "node:util";
import type {SandboxIsolationSnapshot, SuiteConfig} from "./types.js";

const execFileAsync = promisify(execFile);
const TARGET_PATTERN = /^(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9_.-]+|\[[0-9A-Fa-f:]+\])$/;
const ACTION_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ARGUMENT_PATTERN = /^[A-Za-z0-9_./:@+=,-]{1,2048}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const REMOTE_WORKSPACE_PATTERN = /^\/tmp\/oscar-storage-regression\.[A-Za-z0-9]{6,32}$/;
const REMOTE_RESTORE_STATE_PATTERN = /^(?:complete:[0-9]{1,3}|running|terminated|cancelled)$/;

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function commandTimedOut(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {killed?: unknown; signal?: unknown};
  return candidate.killed === true && candidate.signal === "SIGTERM";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export class StorageProbeClient {
  private readonly target: string;
  private readonly releaseDirectory: string;
  private remoteWorkspace: string | undefined;
  private remoteScript: string | undefined;
  private readonly alarmBaselineRuns = new Set<string>();
  private installed = false;

  constructor(private readonly config: SuiteConfig, runId: string) {
    if (!config.oscarSshTarget || !TARGET_PATTERN.test(config.oscarSshTarget)) {
      throw new Error("OSCAR_SSH_TARGET must be a simple [user@]host for storage regression");
    }
    if (!config.oscarReleaseDirectory) throw new Error("OSCAR_RELEASE_DIR is required");
    this.target = config.oscarSshTarget;
    this.releaseDirectory = config.oscarReleaseDirectory;
    const acknowledgement =
      `${config.targetHost}|${this.target}|${this.releaseDirectory}|DISPOSABLE-STORAGE`;
    if (config.storageTargetAcknowledgement !== acknowledgement) {
      throw new Error(`OSCAR_STORAGE_TARGET_ACK must exactly equal ${acknowledgement}`);
    }
    if (!RUN_ID_PATTERN.test(runId.replaceAll(/[^A-Za-z0-9_-]+/g, "_"))) {
      throw new Error("Regression run ID cannot be represented safely for the storage probe");
    }
  }

  private commonOptions(): string[] {
    return [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=10",
      ...(this.config.sshIdentityFile
        ? ["-o", "IdentitiesOnly=yes", "-i", this.config.sshIdentityFile]
        : []),
    ];
  }

  private async verifyTargetBinding(): Promise<void> {
    const script = [
      "set -eu",
      "requested=$1",
      "test \"$requested\" != /",
      "test -d \"$requested\"",
      "test ! -L \"$requested\"",
      "canonical=$(realpath -e -- \"$requested\")",
      "test \"$canonical\" = \"$requested\"",
      "test \"$canonical\" != /",
      "test -f \"$canonical/oscar.sh\"",
      "test ! -L \"$canonical/oscar.sh\"",
      "test -f \"$canonical/compose.yaml\"",
      "test ! -L \"$canonical/compose.yaml\"",
      "mapfile -t containers < <(docker ps --filter status=running --filter label=com.docker.compose.project=oscar --filter label=com.docker.compose.service=oscar --format '{{.ID}}')",
      "test \"${#containers[@]}\" -eq 1",
      "active_release=$(docker inspect --format '{{ index .Config.Labels \"com.docker.compose.project.working_dir\" }}' \"${containers[0]}\")",
      "active_config=$(docker inspect --format '{{ index .Config.Labels \"com.docker.compose.project.config_files\" }}' \"${containers[0]}\")",
      "test \"$active_release\" = \"$canonical\"",
      "if [ \"$active_config\" = \"$canonical/compose.yaml,$canonical/compose.octelium.yaml\" ]; then test -f \"$canonical/compose.octelium.yaml\" && test ! -L \"$canonical/compose.octelium.yaml\"; else test \"$active_config\" = \"$canonical/compose.yaml\"; fi",
      "printf '%s\\n' \"$canonical\"",
    ].join("; ");
    const command = [
      "sudo", "-n", "bash", "-ceu", script, "oscar-storage-binding", this.releaseDirectory,
    ].map(shellQuote).join(" ");
    const {stdout} = await execFileAsync("ssh", [
      ...this.commonOptions(), this.target, command,
    ], {timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8"});
    const canonical = stdout.trim();
    if (canonical !== this.releaseDirectory || canonical.includes("\n") || canonical.includes("\r")) {
      throw new Error(
        "Storage probe refused: OSCAR_RELEASE_DIR is missing, linked, noncanonical, or not the uniquely running Compose release",
      );
    }
    const acknowledgement =
      `${this.config.targetHost}|${this.target}|${canonical}|DISPOSABLE-STORAGE`;
    if (this.config.storageTargetAcknowledgement !== acknowledgement) {
      throw new Error(`OSCAR_STORAGE_TARGET_ACK must exactly equal ${acknowledgement}`);
    }
  }

  private async createRemoteWorkspace(): Promise<void> {
    const command = [
      "umask 077",
      "workspace=$(mktemp -d /tmp/oscar-storage-regression.XXXXXXXX)",
      "chmod 700 \"$workspace\"",
      "printf '%s\\n' \"$workspace\"",
    ].join("; ");
    const {stdout} = await execFileAsync("ssh", [
      ...this.commonOptions(), this.target, command,
    ], {timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8"});
    const workspace = stdout.trim();
    if (!REMOTE_WORKSPACE_PATTERN.test(workspace)) {
      throw new Error("Storage probe could not create a private remote workspace");
    }
    this.remoteWorkspace = workspace;
    this.remoteScript = `${workspace}/probe.sh`;
  }

  private async removeRemoteWorkspace(): Promise<void> {
    const workspace = this.remoteWorkspace;
    if (!workspace || !REMOTE_WORKSPACE_PATTERN.test(workspace)) return;
    await execFileAsync("ssh", [
      ...this.commonOptions(), this.target, `rm -rf -- ${shellQuote(workspace)}`,
    ], {timeout: 20_000, maxBuffer: 1024 * 1024}).catch(() => undefined);
    this.remoteWorkspace = undefined;
    this.remoteScript = undefined;
  }

  private async waitForRestoreTermination(
    statusPath: string,
    pidPath: string,
    readyPath: string,
    activePath: string,
    cancelledPath: string,
  ): Promise<void> {
    const stateScript = [
      "set -euo pipefail",
      "status_path=$1",
      "pid_path=$2",
      "ready_path=$3",
      "active_path=$4",
      "cancelled_path=$5",
      "validate_control_file() {",
      "  control_path=$1",
      "  if [ -e \"$control_path\" ] || [ -L \"$control_path\" ]; then",
      "    [ -f \"$control_path\" ] && [ ! -L \"$control_path\" ] || return 1",
      "    [ \"$(stat -c '%u:%g:%a' -- \"$control_path\")\" = 0:0:600 ] || return 1",
      "  fi",
      "}",
      "while :; do",
      "  for control_path in \"$status_path\" \"$pid_path\" \"$ready_path\" \"$active_path\" \"$cancelled_path\"; do",
      "    validate_control_file \"$control_path\" || exit 74",
      "  done",
      "  ready=0; active=0; cancelled=0",
      "  [ -e \"$ready_path\" ] && ready=1",
      "  [ -e \"$active_path\" ] && active=1",
      "  [ -e \"$cancelled_path\" ] && cancelled=1",
      "  [ $((ready + active + cancelled)) -eq 1 ] || exit 74",
      "  if [ \"$ready\" -eq 1 ]; then gate_path=$ready_path; elif [ \"$active\" -eq 1 ]; then gate_path=$active_path; else gate_path=$cancelled_path; fi",
      "  [ \"$(cat -- \"$gate_path\")\" = armed ] || exit 74",
      "  if [ \"$ready\" -eq 1 ]; then",
      "    [ ! -e \"$status_path\" ] && [ ! -L \"$status_path\" ] || exit 74",
      "    if mv -T -- \"$ready_path\" \"$cancelled_path\" 2>/dev/null; then",
      "      validate_control_file \"$cancelled_path\" || exit 74",
      "      printf 'cancelled\\n'",
      "      exit 0",
      "    fi",
      "    continue",
      "  fi",
      "  if [ \"$cancelled\" -eq 1 ]; then",
      "    [ ! -e \"$status_path\" ] && [ ! -L \"$status_path\" ] || exit 74",
      "    printf 'cancelled\\n'",
      "    exit 0",
      "  fi",
      "  [ -e \"$pid_path\" ] || exit 75",
      "  identity=$(cat -- \"$pid_path\")",
      "  if [ \"$identity\" = not-launched ]; then",
      "    if [ -e \"$status_path\" ]; then",
      "      result=$(cat -- \"$status_path\")",
      "      case $result in ''|*[!0-9]*|????*) exit 75 ;; esac",
      "      [ \"$result\" -le 255 ] || exit 75",
      "      printf 'complete:%s\\n' \"$result\"",
      "    else",
      "      printf 'running\\n'",
      "    fi",
      "    exit 0",
      "  fi",
      "  read -r pid start pgid sid extra <<EOF",
      "$identity",
      "EOF",
      "  case $pid in ''|*[!0-9]*) exit 75 ;; esac",
      "  case $start in ''|*[!0-9]*) exit 75 ;; esac",
      "  case $pgid in ''|*[!0-9]*) exit 75 ;; esac",
      "  case $sid in ''|*[!0-9]*) exit 75 ;; esac",
      "  [ -z \"${extra:-}\" ] && [ \"$pid\" -gt 1 ] && [ \"$start\" -gt 0 ] || exit 75",
      "  [ \"$pid\" = \"$pgid\" ] && [ \"$pid\" = \"$sid\" ] || exit 75",
      "  running=0",
      "  if [ -r \"/proc/$pid/stat\" ] && kill -0 \"$pid\" 2>/dev/null; then",
      "    proc_stat=$(cat -- \"/proc/$pid/stat\")",
      "    proc_tail=${proc_stat##*) }",
      "    set -- $proc_tail",
      "    [ \"$#\" -ge 20 ] || exit 75",
      "    [ \"$3\" = \"$pgid\" ] && [ \"$4\" = \"$sid\" ] && [ \"${20}\" = \"$start\" ] && running=1",
      "  fi",
      "  processes=$(ps -eo pid=,pgid=,sid=) || exit 75",
      "  if awk -v pgid=\"$pgid\" -v sid=\"$sid\" '$2 == pgid || $3 == sid { found=1 } END { exit(found ? 0 : 1) }' <<<\"$processes\"; then",
      "    running=1",
      "  fi",
      "  if [ \"$running\" -eq 1 ]; then",
      "    printf 'running\\n'",
      "  elif [ -e \"$status_path\" ]; then",
      "    result=$(cat -- \"$status_path\")",
      "    case $result in ''|*[!0-9]*|????*) exit 75 ;; esac",
      "    [ \"$result\" -le 255 ] || exit 75",
      "    printf 'complete:%s\\n' \"$result\"",
      "  else",
      "    printf 'terminated\\n'",
      "  fi",
      "  exit 0",
      "done",
    ].join("\n");
    const stateCommand = [
      "sudo", "-n", "bash", "-ceu", stateScript,
      "oscar-storage-restore-state", statusPath, pidPath, readyPath, activePath, cancelledPath,
    ].map(shellQuote).join(" ");

    // A local SSH timeout must never make the reporter enter its post-restore
    // phase while the privileged restore still owns the deployment lock. Keep
    // retrying through transient SSH loss until the exact wrapper PID/start-time
    // pair is gone or its atomically published terminal status is visible.
    for (;;) {
      try {
        const {stdout} = await execFileAsync("ssh", [
          ...this.commonOptions(), this.target, stateCommand,
        ], {timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8"});
        const state = stdout.trim();
        if (!REMOTE_RESTORE_STATE_PATTERN.test(state)) {
          throw new Error(`Storage restore termination probe returned an invalid state: ${state}`);
        }
        if (state !== "running") return;
      } catch {
        // Without an authoritative remote state, treating disruption as ended
        // would make health/identity checks race an active restore. Retry.
      }
      await delay(2_000);
    }
  }

  private async restoreCommand(action: string, args: string[]): Promise<{
    command: string;
    statusPath: string;
    pidPath: string;
    readyPath: string;
    activePath: string;
    cancelledPath: string;
  }> {
    if (!this.remoteWorkspace || !this.remoteScript) {
      throw new Error("Storage restore probe is not installed");
    }
    const prefix = `${this.remoteWorkspace}/${action}`;
    const outputPath = `${prefix}.stdout`;
    const errorPath = `${prefix}.stderr`;
    const statusPath = `${prefix}.status`;
    const pidPath = `${prefix}.pid`;
    const readyPath = `${prefix}.ready`;
    const activePath = `${prefix}.active`;
    const cancelledPath = `${prefix}.cancelled`;
    const armScript = [
      "set -euo pipefail",
      "umask 077",
      "output_path=$1", "error_path=$2", "status_path=$3", "pid_path=$4",
      "ready_path=$5", "active_path=$6", "cancelled_path=$7",
      "for path in \"$output_path\" \"$error_path\" \"$status_path\" \"$pid_path\" \"$ready_path\" \"$active_path\" \"$cancelled_path\"; do",
      "  [ ! -e \"$path\" ] && [ ! -L \"$path\" ] || exit 72",
      "done",
      "set -C",
      ": >\"$output_path\"",
      ": >\"$error_path\"",
      "printf 'not-launched\\n' >\"$pid_path\"",
      "printf 'armed\\n' >\"$ready_path\"",
      "chmod 0600 \"$output_path\" \"$error_path\" \"$pid_path\" \"$ready_path\"",
    ].join("\n");
    const armCommand = [
      "sudo", "-n", "bash", "-ceu", armScript,
      "oscar-storage-restore-arm", outputPath, errorPath, statusPath, pidPath,
      readyPath, activePath, cancelledPath,
    ].map(shellQuote).join(" ");
    await execFileAsync("ssh", [
      ...this.commonOptions(), this.target, armCommand,
    ], {timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8"});

    const sessionSupervisor = [
      "set -euo pipefail",
      "pid_path=$1",
      "shift",
      "command=(\"$@\")",
      "self=$BASHPID",
      "[ \"$self\" -gt 1 ]",
      "proc_stat=$(cat -- \"/proc/$self/stat\")",
      "proc_tail=${proc_stat##*) }",
      "set -- $proc_tail",
      "[ \"$#\" -ge 20 ]",
      "pgid=$3", "sid=$4", "start=${20}",
      "[ \"$self\" = \"$pgid\" ] && [ \"$self\" = \"$sid\" ] && [ \"$start\" -gt 0 ] || exit 76",
      "[ -f \"$pid_path\" ] && [ ! -L \"$pid_path\" ] || exit 76",
      "[ \"$(stat -c '%u:%g:%a' -- \"$pid_path\")\" = 0:0:600 ]",
      "[ \"$(cat -- \"$pid_path\")\" = not-launched ]",
      "temporary=\"$pid_path.tmp.$self\"",
      "[ ! -e \"$temporary\" ] && [ ! -L \"$temporary\" ] || exit 76",
      "printf '%s %s %s %s\\n' \"$self\" \"$start\" \"$pgid\" \"$sid\" >\"$temporary\"",
      "chmod 0600 \"$temporary\"",
      "mv -fT -- \"$temporary\" \"$pid_path\"",
      "exec \"${command[@]}\"",
    ].join("\n");
    const wrapper = [
      "set -euo pipefail",
      "umask 077",
      "output_path=$1",
      "error_path=$2",
      "status_path=$3",
      "pid_path=$4",
      "ready_path=$5", "active_path=$6", "cancelled_path=$7",
      "shift 7",
      "for path in \"$output_path\" \"$error_path\" \"$pid_path\" \"$ready_path\"; do",
      "  [ -f \"$path\" ] && [ ! -L \"$path\" ] || exit 72",
      "  [ \"$(stat -c '%u:%g:%a' -- \"$path\")\" = 0:0:600 ] || exit 72",
      "done",
      "[ \"$(cat -- \"$ready_path\")\" = armed ] || exit 72",
      "[ \"$(cat -- \"$pid_path\")\" = not-launched ] || exit 72",
      "for path in \"$status_path\" \"$active_path\" \"$cancelled_path\"; do",
      "  [ ! -e \"$path\" ] && [ ! -L \"$path\" ] || exit 72",
      "done",
      "mv -T -- \"$ready_path\" \"$active_path\"",
      "[ -f \"$active_path\" ] && [ ! -L \"$active_path\" ] || exit 72",
      "[ \"$(stat -c '%u:%g:%a' -- \"$active_path\")\" = 0:0:600 ]",
      "identity_ready=0", "launcher_pid=", "completed=0",
      "pid=", "start=", "pgid=", "sid=",
      "load_identity() {",
      "  identity=$(cat -- \"$pid_path\") || return 2",
      "  [ \"$identity\" != not-launched ] || return 1",
      "  read -r candidate_pid candidate_start candidate_pgid candidate_sid candidate_extra <<EOF",
      "$identity",
      "EOF",
      "  case $candidate_pid in ''|*[!0-9]*) return 2 ;; esac",
      "  case $candidate_start in ''|*[!0-9]*) return 2 ;; esac",
      "  case $candidate_pgid in ''|*[!0-9]*) return 2 ;; esac",
      "  case $candidate_sid in ''|*[!0-9]*) return 2 ;; esac",
      "  [ -z \"${candidate_extra:-}\" ] && [ \"$candidate_pid\" -gt 1 ] && [ \"$candidate_start\" -gt 0 ] || return 2",
      "  [ \"$candidate_pid\" = \"$candidate_pgid\" ] && [ \"$candidate_pid\" = \"$candidate_sid\" ] || return 2",
      "  pid=$candidate_pid; start=$candidate_start; pgid=$candidate_pgid; sid=$candidate_sid",
      "  identity_ready=1",
      "}",
      "session_alive() {",
      "  [ \"$identity_ready\" -eq 1 ] || return 1",
      "  processes=$(ps -eo pid=,pgid=,sid=) || return 2",
      "  awk -v pgid=\"$pgid\" -v sid=\"$sid\" '$2 == pgid || $3 == sid { found=1 } END { exit(found ? 0 : 1) }' <<<\"$processes\"",
      "}",
      "signal_session() {",
      "  signal_name=$1",
      "  processes=$(ps -eo pid=,pgid=,sid=) || return 2",
      "  member_pids=$(awk -v pgid=\"$pgid\" -v sid=\"$sid\" '$2 == pgid || $3 == sid { print $1 }' <<<\"$processes\") || return 2",
      "  [ -z \"$member_pids\" ] || kill -\"$signal_name\" $member_pids 2>/dev/null || true",
      "}",
      "wait_for_session_quiet() {",
      "  while :; do",
      "    session_alive",
      "    session_result=$?",
      "    if [ \"$session_result\" -eq 0 ]; then sleep 1; continue; fi",
      "    [ \"$session_result\" -eq 1 ] && return 0",
      "    sleep 1",
      "  done",
      "}",
      "terminate_session() {",
      "  [ \"$identity_ready\" -eq 1 ] || return 0",
      "  if session_alive; then",
      "    signal_session TERM || true",
      "    for attempt in 1 2 3 4 5; do session_alive || break; sleep 1; done",
      "    session_alive && signal_session KILL || true",
      "  fi",
      "  wait_for_session_quiet",
      "}",
      "publish_status() {",
      "  publish_result=$1",
      "  case $publish_result in ''|*[!0-9]*|????*) return 1 ;; esac",
      "  [ \"$publish_result\" -le 255 ] || return 1",
      "  temporary=\"$status_path.tmp.$$\"",
      "  [ ! -e \"$temporary\" ] && [ ! -L \"$temporary\" ] || return 1",
      "  printf '%s\\n' \"$publish_result\" >\"$temporary\"",
      "  chmod 0600 \"$temporary\"",
      "  [ ! -e \"$status_path\" ] && [ ! -L \"$status_path\" ] || return 1",
      "  ln -- \"$temporary\" \"$status_path\"",
      "  rm -f -- \"$temporary\"",
      "}",
      "finalize_wrapper() {",
      "  original_status=$?",
      "  trap - EXIT TERM INT",
      "  set +e",
      "  if [ \"$completed\" -ne 1 ]; then",
      "    load_identity >/dev/null 2>&1 || true",
      "    if [ \"$identity_ready\" -eq 1 ]; then terminate_session; fi",
      "    if [ -n \"$launcher_pid\" ]; then kill -TERM \"$launcher_pid\" 2>/dev/null || true; wait \"$launcher_pid\" 2>/dev/null || true; fi",
      "    load_identity >/dev/null 2>&1 || true",
      "    if [ \"$identity_ready\" -eq 1 ]; then terminate_session; fi",
      "    if [ \"$identity_ready\" -eq 1 ] || { [ -z \"$launcher_pid\" ] && [ \"$(cat -- \"$pid_path\" 2>/dev/null)\" = not-launched ]; }; then",
      "      publish_status \"$original_status\" || true",
      "    fi",
      "  fi",
      "  exit \"$original_status\"",
      "}",
      "trap '' HUP",
      "trap finalize_wrapper EXIT",
      "trap 'exit 143' TERM",
      "trap 'exit 130' INT",
      "set +e",
      "setsid --fork --wait \"$@\" >\"$output_path\" 2>\"$error_path\" &",
      "launcher_pid=$!",
      "while :; do",
      "  load_identity >/dev/null 2>&1",
      "  identity_result=$?",
      "  [ \"$identity_result\" -eq 0 ] && break",
      "  [ \"$identity_result\" -eq 2 ] && exit 76",
      "  if [ ! -r \"/proc/$launcher_pid/stat\" ]; then break; fi",
      "  launcher_stat=$(cat -- \"/proc/$launcher_pid/stat\")",
      "  launcher_tail=${launcher_stat##*) }",
      "  set -- $launcher_tail",
      "  [ \"${1:-Z}\" = Z ] && break",
      "  sleep 0.05",
      "done",
      "if wait \"$launcher_pid\"; then result=0; else result=$?; fi",
      "[ \"$identity_ready\" -eq 1 ] && wait_for_session_quiet",
      "publish_status \"$result\" || exit 73",
      "completed=1",
      "cat -- \"$output_path\"",
      "cat -- \"$error_path\" >&2",
      "exit \"$result\"",
    ].join("\n");
    const command = [
      "sudo", "-n", "bash", "-ceu", wrapper,
      "oscar-storage-restore-wrapper", outputPath, errorPath, statusPath, pidPath,
      readyPath, activePath, cancelledPath,
      "bash", "-ceu", sessionSupervisor,
      "oscar-storage-restore-session", pidPath,
      "bash", this.remoteScript, "--release-dir", this.releaseDirectory, action, ...args,
    ].map(shellQuote).join(" ");
    return {command, statusPath, pidPath, readyPath, activePath, cancelledPath};
  }

  async install(): Promise<void> {
    if (this.installed) return;
    const source = resolve("scripts/oscar-storage-regression-probe.sh");
    await this.verifyTargetBinding();
    try {
      await this.createRemoteWorkspace();
      await execFileAsync("scp", [
        ...this.commonOptions(),
        source,
        `${this.target}:${this.remoteScript!}`,
      ], {timeout: 60_000, maxBuffer: 4 * 1024 * 1024});
      this.installed = true;
    } catch (error) {
      await this.removeRemoteWorkspace();
      throw error;
    }
  }

  async runJson<T>(action: string, args: string[] = []): Promise<T> {
    if (!ACTION_PATTERN.test(action)) throw new Error(`Unsafe storage probe action: ${action}`);
    if (args.some(argument => !ARGUMENT_PATTERN.test(argument))) {
      throw new Error("Storage probe argument contains unsupported characters");
    }
    const alarmRun = args[0] && RUN_ID_PATTERN.test(args[0]) ? args[0] : undefined;
    // Register cleanup before the remote call. A lost acknowledgement after the
    // baseline link must not strand a privileged marker in /tmp.
    if (action === "alarm-media-baseline" && alarmRun) this.alarmBaselineRuns.add(alarmRun);
    if (this.installed) await this.verifyTargetBinding();
    else await this.install();
    if (!this.remoteScript) throw new Error("Storage probe is not installed");
    const restore = action === "restore-drill" || action === "backup-check"
      ? await this.restoreCommand(action, args)
      : undefined;
    const command = restore?.command ?? [
      "sudo", "-n", "bash", this.remoteScript,
      "--release-dir", this.releaseDirectory,
      action,
      ...args,
    ].map(shellQuote).join(" ");
    let stdout: string;
    try {
      ({stdout} = await execFileAsync("ssh", [
        ...this.commonOptions(),
        this.target,
        command,
      ], {
        timeout: restore
          ? (this.config.storageRestoreProbeTimeoutMs ?? 7_200_000)
          : action === "stage-lifecycle-witness"
            ? Math.max(
              this.config.storageProbeTimeoutMs,
              this.config.storageArchiveTimeoutMs + 60_000,
            )
          : this.config.storageProbeTimeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
      }));
    } catch (error) {
      if (restore) {
        await this.waitForRestoreTermination(
          restore.statusPath,
          restore.pidPath,
          restore.readyPath,
          restore.activePath,
          restore.cancelledPath,
        );
      }
      if (restore && commandTimedOut(error)) {
        const label = action === "restore-drill" ? "Storage restore probe" : `Storage ${action} probe`;
        const resumePhase = action === "restore-drill" ? "post-restore" : "post-backup";
        throw new Error(
          `${label} exceeded its bounded ${this.config.storageRestoreProbeTimeoutMs ?? 7_200_000} ms deadline; ` +
          `the remote command reached a terminal state before ${resumePhase} checks resumed`,
          {cause: error},
        );
      }
      throw error;
    }
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!line) throw new Error(`Storage probe ${action} returned no JSON`);
    try {
      const result = JSON.parse(line) as T;
      if ((action === "alarm-media-forensics" || action === "alarm-media-cleanup") && alarmRun) {
        this.alarmBaselineRuns.delete(alarmRun);
      }
      return result;
    } catch (error) {
      throw new Error(`Storage probe ${action} returned invalid JSON`, {cause: error});
    }
  }

  async cleanup(): Promise<void> {
    if (!this.installed) {
      this.alarmBaselineRuns.clear();
      await this.removeRemoteWorkspace();
      return;
    }
    // Baselines are root-owned mode-0600 files in sticky /tmp. Ask the
    // installed, fail-closed probe to remove only the marker derived from each
    // validated run ID; the unprivileged SSH user cannot safely unlink it.
    let baselineCleanupError: unknown;
    for (const run of this.alarmBaselineRuns) {
      await this.verifyTargetBinding();
      if (!this.remoteScript) throw new Error("Storage probe is not installed");
      const cleanupCommand = [
        "sudo", "-n", "bash", this.remoteScript,
        "--release-dir", this.releaseDirectory,
        "alarm-media-cleanup", run,
      ].map(shellQuote).join(" ");
      try {
        await execFileAsync("ssh", [...this.commonOptions(), this.target, cleanupCommand], {
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        baselineCleanupError ??= error;
      }
    }
    if (baselineCleanupError) {
      // Retain both the installed helper and the exact run IDs so a caller's
      // outer/final emergency cleanup can retry the privileged removal.
      throw new Error("Unable to remove a privileged alarm-media baseline marker", {
        cause: baselineCleanupError,
      });
    }
    await this.removeRemoteWorkspace();
    this.installed = false;
    this.alarmBaselineRuns.clear();
  }

  async sandboxIsolationSnapshot(): Promise<SandboxIsolationSnapshot> {
    await this.verifyTargetBinding();
    const script = [
      "set -eu",
      "cd \"$1\"",
      "present=false",
      "if [ -f oscar-sandbox.sh ] && [ -f compose.sandbox.yaml ]; then present=true; fi",
      "state_mp=$(docker volume inspect --format '{{.Mountpoint}}' oscar_oscar_state)",
      "cfg_sha=$(sha256sum \"$state_mp/config.json\" | awk '{print $1}')",
      "ds_cnt=$(docker compose --project-name oscar --env-file .env --file compose.yaml exec -T postgres sh -eu -c 'PGPASSWORD=$(cat /run/secrets/postgres_bootstrap_password) PGOPTIONS=\"-csearch_path=oscar,public\" exec psql -tAq -U oscar_bootstrap -d gis -c \"SELECT count(*) FROM obs_datastreams WHERE lower(data::text) LIKE '\''%demolane%'\'' OR lower(data::text) LIKE '\''%demo-lane%'\'' OR lower(data::text) LIKE '\''%tutorial-lane%'\'';\"' </dev/null | tr -d '[:space:]')",
      "obs_cnt=$(docker compose --project-name oscar --env-file .env --file compose.yaml exec -T postgres sh -eu -c 'PGPASSWORD=$(cat /run/secrets/postgres_bootstrap_password) PGOPTIONS=\"-csearch_path=oscar,public\" exec psql -tAq -U oscar_bootstrap -d gis -c \"SELECT count(*) FROM obs WHERE result::text LIKE '\''%MSCU5285725%'\'' OR result::text LIKE '\''%OSCU4829106%'\'' OR result::text LIKE '\''%TRAINING SANDBOX%'\'';\"' </dev/null | tr -d '[:space:]')",
      "arch_dir=$(awk -F= '$1 == \"OSCAR_ARCHIVE_DIR\" { print substr($0, index($0, \"=\") + 1); exit }' .env)",
      "case \"$arch_dir\" in /*) ;; *) arch_dir=\"$(pwd -P)/$arch_dir\" ;; esac",
      "arch_sb_cnt=$(find \"$arch_dir\" -iname '*sandbox*' 2>/dev/null | wc -l | tr -d '[:space:]')",
      "sb_c=$(docker ps -aq --filter label=com.docker.compose.project=oscar-sandbox | wc -l | tr -d '[:space:]')",
      "sb_v=$(docker volume ls -q --filter name=^oscar_sandbox_ | wc -l | tr -d '[:space:]')",
      "printf '{\"sandboxScriptPresent\":%s,\"stateConfigSha256\":\"%s\",\"postgresSandboxDatastreamCount\":%s,\"postgresSandboxObsCount\":%s,\"archiveSandboxFileCount\":%s,\"sandboxContainerCount\":%s,\"sandboxVolumeCount\":%s}\\n' \"$present\" \"$cfg_sha\" \"${ds_cnt:-0}\" \"${obs_cnt:-0}\" \"${arch_sb_cnt:-0}\" \"${sb_c:-0}\" \"${sb_v:-0}\"",
    ].join("; ");
    const command = ["sudo", "-n", "bash", "-ceu", script, "oscar-sandbox-snap", this.releaseDirectory]
      .map(shellQuote)
      .join(" ");
    const {stdout} = await execFileAsync("ssh", [...this.commonOptions(), this.target, command], {
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!line) throw new Error("sandboxIsolationSnapshot returned empty output");
    return JSON.parse(line) as SandboxIsolationSnapshot;
  }

  async sandboxStart(port = 8444, ttlMinutes = 15): Promise<void> {
    await this.verifyTargetBinding();
    const script = [
      "set -eu",
      "cd \"$1\"",
      "bash oscar.sh sandbox start --port \"$2\" --ttl-minutes \"$3\" --track operator --allow-low-memory >/dev/null",
    ].join("; ");
    const command = [
      "sudo", "-n", "bash", "-ceu", script, "oscar-sandbox-start",
      this.releaseDirectory, String(port), String(ttlMinutes),
    ].map(shellQuote).join(" ");
    await execFileAsync("ssh", [...this.commonOptions(), this.target, command], {
      timeout: 240_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
  }

  async sandboxStop(): Promise<void> {
    await this.verifyTargetBinding();
    const script = [
      "set -eu",
      "cd \"$1\"",
      "if [ -f oscar-sandbox.sh ]; then bash oscar.sh sandbox stop >/dev/null; fi",
    ].join("; ");
    const command = [
      "sudo", "-n", "bash", "-ceu", script, "oscar-sandbox-stop", this.releaseDirectory,
    ].map(shellQuote).join(" ");
    await execFileAsync("ssh", [...this.commonOptions(), this.target, command], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
  }
}
