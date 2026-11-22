#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

suite_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="$suite_dir/.env"
apply=false
build_label=

usage() {
  cat <<'EOF'
Usage: scripts/rebind-active-release.sh [--apply] --build-label LABEL [--env-file FILE]

Discover the one running OSCAR Compose release through the configured strict-SSH
target. The default is a read-only preview. --apply atomically updates only
OSCAR_RELEASE_DIR, OSCAR_STORAGE_TARGET_ACK, and OSCAR_BUILD_LABEL in the private
runner environment. Destructive restore acknowledgements are never changed.
EOF
}

while (($#)); do
  case $1 in
    --apply) apply=true; shift ;;
    --build-label)
      (($# >= 2)) || { usage >&2; exit 64; }
      build_label=$2; shift 2 ;;
    --env-file)
      (($# >= 2)) || { usage >&2; exit 64; }
      env_file=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 64 ;;
  esac
done

[[ -n $build_label && $build_label != *$'\n'* && $build_label != *$'\r'* &&
   ${#build_label} -le 160 ]] || {
  echo "--build-label must be a non-empty, single-line artifact identity of at most 160 characters." >&2
  exit 64
}

[[ -f $env_file && ! -L $env_file ]] || {
  echo "Regression environment must be a regular, non-symlink file: $env_file" >&2
  exit 65
}
env_file=$(realpath -- "$env_file")
file_mode() {
  stat -c '%a' -- "$1" 2>/dev/null || stat -f '%Lp' -- "$1"
}
env_mode=$(file_mode "$env_file")
(( (8#$env_mode & 077) == 0 )) || {
  echo "Regression environment permissions must be 0600 or stricter: $env_file" >&2
  exit 65
}

env_value() {
  local name=$1
  awk -v name="$name" '
    index($0,"=") > 0 && substr($0,1,index($0,"=")-1) == name {
      count++; value=substr($0,index($0,"=")+1); sub(/\r$/, "", value)
    }
    END { if (count == 1 && length(value) > 0) print value; else exit 1 }
  ' "$env_file" || {
    echo "Expected exactly one non-empty $name entry in $env_file." >&2
    return 65
  }
}

ssh_target=$(env_value OSCAR_SSH_TARGET)
identity_file=$(realpath -- "$(env_value OSCAR_SSH_IDENTITY_FILE)")
viewer_host=$(env_value OSCAR_TEST_TARGET_ACK)
[[ $ssh_target =~ ^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$ ]] || {
  echo "OSCAR_SSH_TARGET is unsafe." >&2; exit 65;
}
[[ -f $identity_file && ! -L $identity_file ]] || {
  echo "OSCAR_SSH_IDENTITY_FILE is not a regular private key." >&2; exit 65;
}
key_mode=$(file_mode "$identity_file")
(( (8#$key_mode & 077) == 0 )) || {
  echo "OSCAR_SSH_IDENTITY_FILE permissions must be 0600 or stricter." >&2; exit 65;
}
for component in "$viewer_host" "$ssh_target"; do
  [[ -n $component && $component != *'|'* && $component != *$'\n'* && $component != *$'\r'* ]] || {
    echo "Target identity cannot be represented safely in the storage acknowledgement." >&2
    exit 65
  }
done

# Restore bindings carry an additional destructive authorization boundary. Never
# move a checkout that is armed for restore merely because another release is running.
if awk -F= '$1 ~ /^OSCAR_RESTORE_(TARGET|DISPOSABLE|DATA_LOSS|PATHS)_ACK$/ && length(substr($0,index($0,"=")+1)) > 0 {found=1} END {exit !found}' "$env_file"; then
  echo "Active-release rebinding is refused while destructive restore acknowledgements are populated." >&2
  exit 65
fi

remote_release=$(
  ssh -i "$identity_file" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 \
    "$ssh_target" 'bash -seu' <<'REMOTE'
mapfile -t containers < <(docker ps \
  --filter status=running \
  --filter label=com.docker.compose.project=oscar \
  --filter label=com.docker.compose.service=oscar \
  --format '{{.ID}}')
[[ ${#containers[@]} -eq 1 ]] || {
  echo "Expected exactly one running OSCAR Compose application container." >&2
  exit 66
}
container=${containers[0]}
release=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container")
config_files=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$container")
[[ $release == /* && $release != / && $release != *$'\n'* && $release != *$'\r'* &&
   -d $release && ! -L $release ]] || {
  echo "The running container does not identify a safe release directory." >&2
  exit 66
}
canonical=$(realpath -e -- "$release")
[[ $canonical == "$release" && -f $release/oscar.sh && ! -L $release/oscar.sh &&
   -f $release/compose.yaml && ! -L $release/compose.yaml &&
   ( $config_files == "$release/compose.yaml" ||
     ( $config_files == "$release/compose.yaml,$release/compose.octelium.yaml" &&
       -f $release/compose.octelium.yaml && ! -L $release/compose.octelium.yaml ) ) ]] || {
  echo "The running container release binding is noncanonical or incomplete." >&2
  exit 66
}
# The least-privilege regression account intentionally cannot read the release
# .env. The Docker-owned Compose labels are the authoritative reverse binding:
# the uniquely running project/service container names this exact working
# directory and exact compose file, both validated above.
printf '%s\n' "$release"
REMOTE
)

[[ $remote_release == /* && $remote_release != / && $remote_release != *'|'* &&
   $remote_release != *$'\n'* && $remote_release != *$'\r'* ]] || {
  echo "Remote active-release discovery returned an unsafe path." >&2
  exit 66
}
storage_ack="$viewer_host|$ssh_target|$remote_release|DISPOSABLE-STORAGE"

printf 'Active OSCAR release: %s\n' "$remote_release"
printf 'Build label: %s\n' "$build_label"
if ! $apply; then
  echo "Preview only; rerun with --apply after confirming this is the authorized disposable target."
  exit 0
fi

for name in OSCAR_RELEASE_DIR OSCAR_STORAGE_TARGET_ACK OSCAR_BUILD_LABEL; do
  count=$(awk -v name="$name" 'index($0,"=") > 0 && substr($0,1,index($0,"=")-1) == name {count++} END {print count+0}' "$env_file")
  [[ $count == 1 ]] || { echo "Expected exactly one $name entry before rebinding." >&2; exit 65; }
done

env_dir=$(dirname -- "$env_file")
temporary=$(mktemp "$env_dir/.oscar-regression-env.XXXXXX")
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT
NEW_RELEASE=$remote_release NEW_STORAGE_ACK=$storage_ack NEW_BUILD_LABEL=$build_label \
  awk '
    BEGIN { replacements["OSCAR_RELEASE_DIR"]=ENVIRON["NEW_RELEASE"];
            replacements["OSCAR_STORAGE_TARGET_ACK"]=ENVIRON["NEW_STORAGE_ACK"];
            replacements["OSCAR_BUILD_LABEL"]=ENVIRON["NEW_BUILD_LABEL"] }
    {
      separator=index($0,"="); name=separator ? substr($0,1,separator-1) : "";
      if (name in replacements) print name "=" replacements[name]; else print
    }
  ' "$env_file" >"$temporary"
chmod "$env_mode" "$temporary"
mv -f -- "$temporary" "$env_file"
trap - EXIT
echo "Updated the private regression binding atomically; secrets and restore acknowledgements were unchanged."
