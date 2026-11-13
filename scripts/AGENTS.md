# Purpose

Operational and build automation scripts for the repository.

## Ownership

Project Maintainers and DevOps Agents.

## Local Contracts

- Scripts must use Node.js 26+ native APIs and declare `citty` contracts where applicable.

## Work Guidance

- Keep scripts focused on project automation; do not duplicate `@francogp/auditor` CLI commands.

## Verification

- Validate scripts with `npm run auditor:lint`.

## Child DOX Index

- [dev/AGENTS.md](dev/AGENTS.md): Docker-first development orchestration scripts.
