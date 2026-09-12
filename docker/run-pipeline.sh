#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
    check | update | force | pricing) ;;
    *)
        echo "usage: run-pipeline <check|update|force|pricing>" >&2
        exit 2
        ;;
esac

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
if [[ "$MODE" != "check" ]]; then
    : "${OLLAMA_API_KEY:?OLLAMA_API_KEY is required}"
fi

REMOTE="https://x-access-token@github.com/srnoob2570/ollama-cloud-catalog.git"
CLONE_DIR="/tmp/ollama-cloud-catalog"
LOCK_FILE="/tmp/run-pipeline.lock"
ASKPASS="/tmp/.git-askpass"

# No TTY prompts: git reads the token through GIT_ASKPASS instead, so it never
# shows up in process arguments or error output.
export GIT_TERMINAL_PROMPT=0

# Catalog and pricing both rewrite catalog.json via merge-back, so runs must
# not overlap. -w bounds the wait so a stuck holder cannot pile up waiters.
exec 9>"$LOCK_FILE"
flock -w 1800 9 || {
    echo "another run holds the lock; giving up" >&2
    exit 1
}

echo "==> run-pipeline ${MODE} starting at $(date -u +%FT%TZ)"

printf '#!/bin/sh\necho "$GITHUB_TOKEN"\n' >"$ASKPASS"
chmod 700 "$ASKPASS"
export GIT_ASKPASS="$ASKPASS"

rm -rf "$CLONE_DIR"
git clone --depth 1 "$REMOTE" "$CLONE_DIR"
cd "$CLONE_DIR"
bun install --frozen-lockfile

if [[ "$MODE" == "check" ]]; then
    status=0
    timeout 900 bun src/update-catalog.ts check || status=$?
    case "$status" in
        0) echo "==> catalog is current" ;;
        1) echo "==> catalog is stale, an update run would rebuild it" ;;
        *) exit "$status" ;;
    esac
    exit 0
fi

# Commit and push only when a pipeline touched an artifact. A successful push
# purges both files from jsDelivr; a failed purge is a warning, not a failure.
publish() {
    local message="$1"
    if [[ -z "$(git status --porcelain catalog.json pricing.json)" ]]; then
        echo "==> artifacts unchanged, nothing to commit"
        return 0
    fi
    git add catalog.json pricing.json
    git -c user.name="ollama-cloud-catalog-bot" \
        -c user.email="bot@users.noreply.github.com" \
        commit -m "$message"
    git push origin HEAD:main
    echo "==> published: $message"
    for file in catalog.json pricing.json; do
        curl -fsS "https://purge.jsdelivr.net/gh/srnoob2570/ollama-cloud-catalog@main/${file}" >/dev/null ||
            echo "warning: jsDelivr purge failed for ${file}" >&2
    done
}

case "$MODE" in
    update)
        before="$(git rev-parse HEAD)"
        timeout 900 bun src/update-catalog.ts update
        publish "chore: refresh ollama cloud catalog"
        # A rebuild re-extracts specs for every model but leaves new ones
        # without a rate; refresh pricing now instead of waiting for Monday.
        if [[ "$(git rev-parse HEAD)" != "$before" ]]; then
            timeout 900 bun src/update-pricing.ts
            publish "chore: refresh ollama cloud pricing"
        fi
        ;;
    force)
        timeout 900 bun src/update-catalog.ts update --force
        publish "chore: force-refresh ollama cloud capabilities"
        ;;
    pricing)
        timeout 900 bun src/update-pricing.ts
        publish "chore: refresh ollama cloud pricing"
        ;;
esac
