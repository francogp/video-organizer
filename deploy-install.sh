#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/deploy-common.sh
source "${SCRIPT_DIR}/deploy/deploy-common.sh"

REPO_ROOT="$(resolve_repo_root)"
REAL_USER="$(detect_real_user)"

require_root
ensure_docker_installed
add_user_to_docker_group "${REAL_USER}"
ensure_env_file "${REPO_ROOT}"
compose_up_build "${REPO_ROOT}"
verify_api_health "${REPO_ROOT}"
print_status_summary "${REPO_ROOT}"
