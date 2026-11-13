#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/deploy-common.sh
source "${SCRIPT_DIR}/deploy/deploy-common.sh"

REPO_ROOT="$(resolve_repo_root)"
BRANCH="${1:-${DEPLOY_BRANCH:-main}}"

cd "${REPO_ROOT}"
log_info "Fetching latest changes for origin/${BRANCH}..."
git fetch --prune origin
git reset --hard "origin/${BRANCH}"

ensure_env_file "${REPO_ROOT}"
compose_up_build "${REPO_ROOT}"
verify_api_health "${REPO_ROOT}"
print_status_summary "${REPO_ROOT}"
