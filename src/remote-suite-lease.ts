import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {randomBytes} from "node:crypto";

const TARGET_PATTERN = /^(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9_.-]+|\[[0-9A-Fa-f:]+\])$/;
const RELEASE_PATTERN = /^\/[A-Za-z0-9._/-]+$/;
const WINDOWS_RELEASE_PATTERN = /^[A-Za-z]:\\(?:[A-Za-z0-9._-]+\\)*[A-Za-z0-9._-]+$/;
const LOCK_ROOT_PATTERN = /^\/[A-Za-z0-9._/-]+$/;

export interface RemoteLeaseConfig {
  oscarSshTarget: string;
  oscarReleaseDirectory: string;
  sshIdentityFile?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function remoteLeaseShell(
  lockRoot = "/run/lock/oscar-regression-suite",
  expectedOwnerUid = 0,
): string {
  if (!LOCK_ROOT_PATTERN.test(lockRoot) || lockRoot === "/") {
    throw new Error("Remote regression lease root is unsafe");
  }
  if (!Number.isSafeInteger(expectedOwnerUid) || expectedOwnerUid < 0) {
    throw new Error("Remote regression lease owner is unsafe");
  }
  return `set -Eeuo pipefail
release_directory=$1
token=$2
[[ $release_directory == /* && $release_directory != / && $release_directory != *'/../'* ]]
[[ -d $release_directory && ! -L $release_directory ]]
canonical_release=$(cd -P -- "$release_directory" && pwd -P)
[[ $canonical_release == "$release_directory" ]]
[[ $token =~ ^[0-9a-f]{64}$ ]]
lock_root=${shellQuote(lockRoot)}
if [[ -e $lock_root || -L $lock_root ]]; then
  [[ -d $lock_root && ! -L $lock_root && $(stat -c %u -- "$lock_root") == ${expectedOwnerUid} && $(stat -c %a -- "$lock_root") == 700 ]]
else
  install -d -o ${expectedOwnerUid} -m 0700 -- "$lock_root"
fi
lock_file="$lock_root/suite.lock"
if [[ -e $lock_file || -L $lock_file ]]; then
  [[ -f $lock_file && ! -L $lock_file && $(stat -c %u -- "$lock_file") == ${expectedOwnerUid} && $(stat -c %a -- "$lock_file") == 600 ]]
else
  (umask 077; : >"$lock_file")
  chown ${expectedOwnerUid} -- "$lock_file"
  chmod 0600 -- "$lock_file"
fi
exec 9>>"$lock_file"
if ! flock -n 9; then
  printf 'OSCAR_REGRESSION_LEASE_CONTENDED\\n'
  exit 75
fi
printf 'OSCAR_REGRESSION_LEASE_ACQUIRED:%s\\n' "$token"
while IFS= read -r command; do
  [[ $command == "release:$token" ]] || exit 76
  exit 0
done
exit 0`;
}

function sshOptions(identityFile?: string): string[] {
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2",
    ...(identityFile ? ["-o", "IdentitiesOnly=yes", "-i", identityFile] : []),
  ];
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code));
  });
}

export function windowsLeasePowerShell(releaseDirectory: string, token: string): string {
  const escapedDir = releaseDirectory.replaceAll("'", "''");
  const escapedToken = token.replaceAll("'", "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$releaseDir = '${escapedDir}'`,
    `$token = '${escapedToken}'`,
    "if (-not (Test-Path -LiteralPath $releaseDir -PathType Container)) { throw 'Missing OSCAR_RELEASE_DIR' }",
    "$item = Get-Item -LiteralPath $releaseDir -Force",
    "if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked OSCAR_RELEASE_DIR refused' }",
    "$lockRoot = 'C:\\ProgramData\\oscar-regression-suite'",
    "New-Item -ItemType Directory -Force -Path $lockRoot | Out-Null",
    "$lockFile = Join-Path $lockRoot 'suite.lock'",
    "$signalFile = Join-Path $lockRoot (\"release-\" + $token + \".signal\")",
    "Remove-Item -LiteralPath $signalFile -Force -ErrorAction SilentlyContinue",
    "$selfCim = Get-CimInstance Win32_Process -Filter (\"ProcessId = \" + $PID) -ErrorAction SilentlyContinue",
    "$parentPid = if ($null -ne $selfCim) { [int]$selfCim.ParentProcessId } else { 0 }",
    "try {",
    "  $stream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)",
    "} catch [System.IO.IOException] {",
    "  [Console]::Out.WriteLine('OSCAR_REGRESSION_LEASE_CONTENDED')",
    "  [Console]::Out.Flush()",
    "  exit 75",
    "}",
    "try {",
    "  [Console]::Out.WriteLine(\"OSCAR_REGRESSION_LEASE_ACQUIRED:$token\")",
    "  [Console]::Out.Flush()",
    "  while ($true) {",
    "    if (Test-Path -LiteralPath $signalFile) {",
    "      Remove-Item -LiteralPath $signalFile -Force -ErrorAction SilentlyContinue",
    "      exit 0",
    "    }",
    "    if ($parentPid -gt 0 -and -not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {",
    "      exit 76",
    "    }",
    "    Start-Sleep -Milliseconds 250",
    "  }",
    "} finally {",
    "  Remove-Item -LiteralPath $signalFile -Force -ErrorAction SilentlyContinue",
    "  if ($null -ne $stream) { $stream.Dispose() }",
    "}",
  ].join("\n");
}

function windowsReleaseSignalPowerShell(token: string): string {
  const escapedToken = token.replaceAll("'", "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    "$lockRoot = 'C:\\ProgramData\\oscar-regression-suite'",
    "New-Item -ItemType Directory -Force -Path $lockRoot | Out-Null",
    `$signalFile = Join-Path $lockRoot 'release-${escapedToken}.signal'`,
    "New-Item -ItemType File -Force -Path $signalFile | Out-Null",
  ].join("\n");
}

/** A host-wide lease that coordinates mutating suite runs from different runners. */
export class RemoteSuiteLease {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly token = randomBytes(32).toString("hex");
  private readonly windowsHost: boolean;

  constructor(private readonly config: RemoteLeaseConfig) {
    if (!TARGET_PATTERN.test(config.oscarSshTarget)) {
      throw new Error("OSCAR_SSH_TARGET must be a simple [user@]host for the remote suite lease");
    }
    this.windowsHost = WINDOWS_RELEASE_PATTERN.test(config.oscarReleaseDirectory) &&
      !config.oscarReleaseDirectory.split("\\").includes("..");
    const posixValid = RELEASE_PATTERN.test(config.oscarReleaseDirectory) &&
      config.oscarReleaseDirectory !== "/" &&
      !config.oscarReleaseDirectory.includes("/../");
    if (!posixValid && !this.windowsHost) {
      throw new Error("OSCAR_RELEASE_DIR is unsafe for the remote suite lease");
    }
  }

  async acquire(timeoutMs = 20_000): Promise<void> {
    if (this.child) throw new Error("Remote suite lease is already acquired");
    const command = this.windowsHost
      ? `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(
        windowsLeasePowerShell(this.config.oscarReleaseDirectory, this.token),
        "utf16le",
      ).toString("base64")}`
      : [
        "sudo", "-n", "bash", "-ceu", remoteLeaseShell(), "oscar-regression-lease",
        this.config.oscarReleaseDirectory, this.token,
      ].map(shellQuote).join(" ");
    const child = spawn("ssh", [
      ...sshOptions(this.config.sshIdentityFile),
      this.config.oscarSshTarget,
      command,
    ], {stdio: ["pipe", "pipe", "pipe"]});
    this.child = child;

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (stdout.length < 16_384) stdout += String(chunk).slice(0, 16_384 - stdout.length);
    });
    child.stderr.on("data", chunk => {
      if (stderr.length < 16_384) stderr += String(chunk).slice(0, 16_384 - stderr.length);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const expected = `OSCAR_REGRESSION_LEASE_ACQUIRED:${this.token}\n`;
        const timer = setTimeout(() => reject(new Error("Timed out acquiring remote regression lease")), timeoutMs);
        const inspect = () => {
          const normalized = stdout.replaceAll("\r\n", "\n");
          if (normalized.includes(expected)) {
            clearTimeout(timer);
            resolve();
          } else if (normalized.includes("OSCAR_REGRESSION_LEASE_CONTENDED")) {
            clearTimeout(timer);
            reject(new Error(
              `Another regression run holds the remote suite lease for ${this.config.oscarReleaseDirectory}`,
            ));
          }
        };
        child.stdout.on("data", inspect);
        child.once("error", error => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", code => {
          clearTimeout(timer);
          reject(new Error(
            `Remote regression lease exited before acquisition (status=${String(code)}): ${stderr.trim() || "no diagnostics"}`,
          ));
        });
      });
    } catch (error) {
      child.stdin.destroy();
      child.kill("SIGTERM");
      this.child = undefined;
      throw error;
    }
  }

  async release(timeoutMs = 10_000): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    const exited = waitForExit(child);
    if (this.windowsHost) {
      const releaseCommand = `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(
        windowsReleaseSignalPowerShell(this.token),
        "utf16le",
      ).toString("base64")}`;
      const signalChild = spawn("ssh", [
        ...sshOptions(this.config.sshIdentityFile),
        this.config.oscarSshTarget,
        releaseCommand,
      ], {stdio: ["ignore", "ignore", "ignore"]});
      signalChild.once("error", () => {});
    }
    child.stdin.end(`release:${this.token}\n`);
    const result = await Promise.race([
      exited.then(code => ({kind: "exit" as const, code})),
      new Promise<{kind: "timeout"}>((resolve) => setTimeout(() => resolve({kind: "timeout"}), timeoutMs)),
    ]);
    if (result.kind === "timeout") {
      child.kill("SIGTERM");
      const terminated = await Promise.race([
        exited.then(code => ({kind: "exit" as const, code})),
        new Promise<{kind: "timeout"}>((resolve) => setTimeout(() => resolve({kind: "timeout"}), 3_000)),
      ]);
      if (terminated.kind === "timeout") child.kill("SIGKILL");
      throw new Error("Remote regression lease did not release cleanly");
    }
    if (result.code !== 0) {
      throw new Error(`Remote regression lease release failed with status ${String(result.code)}`);
    }
  }
}
