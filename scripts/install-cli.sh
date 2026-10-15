#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bin_directory=${QUALITY_GATE_BIN_DIR:-${XDG_BIN_HOME:-${HOME}/.local/bin}}
launcher="$bin_directory/quality-gate"
marker="# quality-gate source launcher: $repository_root"

if [[ ${1:-} == "--uninstall" ]]; then
  if [[ -f "$launcher" ]] && head -n 2 "$launcher" | grep -Fqx "$marker"; then
    rm -f "$launcher"
    echo "Removed $launcher"
  else
    echo "No Quality Gate launcher for this checkout at $launcher"
  fi
  exit 0
fi

mise_binary=$(command -v mise)
mkdir -p "$bin_directory"

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

{
  echo "#!/bin/sh"
  echo "$marker"
  printf "exec "
  shell_quote "$mise_binary"
  printf " exec -C "
  shell_quote "$repository_root"
  printf " -- node packages/cli/dist/index.js \"\$@\"\n"
} > "$launcher"
chmod +x "$launcher"

"$launcher" rules > /dev/null
echo "Installed $launcher"
case ":$PATH:" in
  *":$bin_directory:"*) ;;
  *) echo "Add $bin_directory to PATH before using quality-gate." ;;
esac
