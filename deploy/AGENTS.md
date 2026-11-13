# Purpose

Docker production deployment helpers.

## Ownership

Project Maintainers and DevOps Agents.

## Local Contracts

- Scripts must remain idempotent, use `set -euo pipefail`, and never embed hardcoded secrets or external project names.
- Multi-stage `Dockerfile` `builder` must install `git` and `npm@latest` (`>= 12.2.2`), copy `.npmrc` (`allow-git=all`), and rewrite `ssh://git@github.com/` to `https://github.com/` so `npm ci` can resolve public Git devDependencies like `@francogp/auditor` in CI without SSH keys.

## Work Guidance

- Keep shared Docker and environment bootstrap logic in `deploy-common.sh` for use by root `deploy-install.sh` and `deploy-update.sh`.

## Verification

- Validate shell scripts and DOX integrity with `npm run auditor:lint`.

## Child DOX Index

- [deploy-common.sh](deploy-common.sh): Shared Docker, `.env`, and Compose lifecycle helpers.
