#!/usr/bin/env bash
set -euo pipefail

repository=${1:?repository URL is required}
branch=${2:?source branch is required}
expected_commit=${3:?expected commit is required}
destination=${4:?destination path is required}

account_home=$(getent passwd "$(id -u)" | cut -d: -f6)
if [[ -z "$account_home" || "$account_home" == /mnt/* ]]; then
  printf 'Could not resolve a native Linux account home.\n' >&2
  exit 6
fi
export HOME=$account_home
unset T3CODE_HOME COPILOT_HOME

case "$(uname -m)" in
  x86_64) ;;
  *)
    printf 'Expected x86_64 WSL, found %s\n' "$(uname -m)" >&2
    exit 5
    ;;
esac

required_tools=(curl file g++ git make python3 sha256sum tar)
missing_tools=()
for tool in "${required_tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing_tools+=("$tool")
  fi
done
if ((${#missing_tools[@]} > 0)); then
  printf 'Missing WSL tools: %s\n' "${missing_tools[*]}" >&2
  printf '%s\n' \
    'Ubuntu install command: sudo apt-get update && sudo apt-get install -y ca-certificates curl file git build-essential python3 inotify-tools util-linux' \
    >&2
  exit 3
fi

node_version=24.20.0
node_root="$HOME/.local/t3code-validation-node-v${node_version}-linux-x64"
node_is_compatible() {
  "$1" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major === 24 && minor >= 13 ? 0 : 1);
  ' >/dev/null 2>&1
}

if command -v node >/dev/null 2>&1 && node_is_compatible "$(command -v node)"; then
  node_path=$(command -v node)
else
  node_path="$node_root/bin/node"
  if [[ ! -x "$node_path" ]]; then
    archive="$HOME/.cache/node-v${node_version}-linux-x64.tar.xz"
    mkdir -p "$(dirname "$archive")" "$HOME/.local"
    curl -fsSL \
      "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-x64.tar.xz" \
      -o "$archive"
    extracted="$HOME/.local/node-v${node_version}-linux-x64"
    if [[ ! -d "$extracted" ]]; then
      tar -xJf "$archive" -C "$HOME/.local"
    fi
    if [[ "$extracted" != "$node_root" && ! -e "$node_root" ]]; then
      mv "$extracted" "$node_root"
    fi
  fi
fi
export PATH="$(dirname "$node_path"):$PATH"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v corepack >/dev/null 2>&1; then
  printf 'Node.js is present but corepack is unavailable.\n' >&2
  exit 3
fi

source_root="$HOME/.cache/t3code-phase1-validation/source-${expected_commit:0:12}"
source_created=0
if [[ ! -d "$source_root/.git" ]]; then
  mkdir -p "$(dirname "$source_root")"
  git clone --filter=blob:none --no-checkout "$repository" "$source_root"
  source_created=1
fi
if [[ "$source_created" = 0 ]] &&
  [[ -n "$(git -C "$source_root" status --porcelain --untracked-files=no)" ]]; then
  printf 'WSL source checkout has tracked changes: %s\n' "$source_root" >&2
  exit 4
fi

git -C "$source_root" fetch --no-tags origin "$branch"
git -C "$source_root" merge-base --is-ancestor "$expected_commit" FETCH_HEAD
git -C "$source_root" checkout --detach "$expected_commit"
test "$(git -C "$source_root" rev-parse HEAD)" = "$expected_commit"
if [[ -n "$(git -C "$source_root" status --porcelain --untracked-files=no)" ]]; then
  printf 'WSL source checkout is not clean after checkout: %s\n' "$source_root" >&2
  exit 4
fi

cd "$source_root"
corepack pnpm install \
  --frozen-lockfile \
  --filter=@t3tools/monorepo \
  --filter=t3... \
  --reporter=append-only

pty_package=$(
  node -e "console.log(require.resolve('node-pty/package.json', { paths: ['$source_root/apps/server'] }))"
)
pty_directory=$(dirname "$pty_package")
(
  cd "$pty_directory"
  npx --yes node-gyp rebuild
)

test -f "$pty_directory/build/Release/pty.node"
mkdir -p "$(dirname "$destination")"
cp "$pty_directory/build/Release/pty.node" "$destination"
file "$destination"
