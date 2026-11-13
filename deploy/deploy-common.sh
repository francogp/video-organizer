#!/usr/bin/env bash
set -euo pipefail

# Shared lifecycle helpers for Docker production deployment.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "Error: deploy/deploy-common.sh must be sourced, not executed directly." >&2
  exit 1
fi

readonly COLOR_INFO='\033[0;36m'
readonly COLOR_WARN='\033[0;33m'
readonly COLOR_ERR='\033[0;31m'
readonly COLOR_RESET='\033[0m'

log_info() {
  printf '%b[INFO]%b %s\n' "${COLOR_INFO}" "${COLOR_RESET}" "$1"
}

log_warn() {
  printf '%b[WARN]%b %s\n' "${COLOR_WARN}" "${COLOR_RESET}" "$1"
}

log_error() {
  printf '%b[ERROR]%b %s\n' "${COLOR_ERR}" "${COLOR_RESET}" "$1" >&2
}

resolve_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/.." && pwd
}

detect_real_user() {
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    echo "${SUDO_USER}"
  else
    id -un
  fi
}

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    log_error "Run this script as root or with sudo."
    exit 1
  fi
}

ensure_docker_installed() {
  if ! command -v docker >/dev/null 2>&1; then
    log_info "Installing Docker Engine and Compose plugin..."
    curl -fsSL https://get.docker.com | sh
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log_error "'docker compose' v2 plugin is required."
    exit 1
  fi
}

add_user_to_docker_group() {
  local real_user="$1"
  if [[ -n "${real_user}" && "${real_user}" != "root" ]] && command -v usermod >/dev/null 2>&1; then
    usermod -aG docker "${real_user}" || true
    log_info "Added user '${real_user}' to the docker group."
  fi
}

read_env_value() {
  local env_file="$1"
  local key="$2"
  local default_val="${3:-}"
  local raw
  raw="$(grep -E "^${key}=" "${env_file}" | tail -n1 | cut -d'=' -f2- | tr -d '[:space:]' || true)"
  echo "${raw:-${default_val}}"
}

ensure_env_file() {
  local repo_root="$1"
  local env_file="${repo_root}/.env"
  local example_file="${repo_root}/.env.example"

  if [[ ! -f "${env_file}" ]]; then
    if [[ ! -f "${example_file}" ]]; then
      log_error "Missing .env.example in ${repo_root}."
      exit 1
    fi
    cp "${example_file}" "${env_file}"
    log_warn "Created ${env_file} from .env.example. Review volume paths before processing real media."
  fi

  local puid pgid
  puid="$(read_env_value "${env_file}" "PUID" "1000")"
  pgid="$(read_env_value "${env_file}" "PGID" "1000")"

  local path_keys=(
    CONFIG_DIR
    INPUT_DIR
    OUTPUT_MOVIES_DIR
    OUTPUT_ANIMATED_MOVIES_DIR
    OUTPUT_TV_SHOWS_DIR
    OUTPUT_ANIMATED_SERIES_DIR
  )

  for key in "${path_keys[@]}"; do
    local val
    val="$(read_env_value "${env_file}" "${key}")"
    if [[ -z "${val}" ]]; then
      log_error "Missing required .env variable: ${key}"
      exit 1
    fi
    local resolved="${val}"
    if [[ "${val}" != /* ]]; then
      resolved="${repo_root}/${val#./}"
    fi
    mkdir -p "${resolved}"
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
      chown -R "${puid}:${pgid}" "${resolved}" || true
    fi
  done
}

compose_up_build() {
  local repo_root="$1"
  cd "${repo_root}"
  docker compose config -q
  docker compose up -d --build --remove-orphans
}

verify_api_health() {
  local repo_root="$1"
  local app_port
  app_port="$(read_env_value "${repo_root}/.env" "APP_PORT" "3000")"
  local url="http://127.0.0.1:${app_port}/api/state"

  for _ in $(seq 1 15); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      log_info "Health check passed: ${url}"
      return 0
    fi
    sleep 2
  done

  log_warn "Container started, but ${url} did not respond within 30s."
  return 0
}

print_status_summary() {
  local repo_root="$1"
  local app_port
  app_port="$(read_env_value "${repo_root}/.env" "APP_PORT" "3000")"
  docker compose ps
  log_info "Plex Video Organizer is running on http://localhost:${app_port}"
}
