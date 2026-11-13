# Purpose

Docker-first development orchestration scripts.

## Ownership

Project Maintainers and DevOps Agents.

## Local Contracts

- Verify Docker daemon health and `.env` configuration hash before launching Vite.

## Work Guidance

- Keep orchestration scripts idempotent using `docker compose up -d --wait`.

## Verification

- Validate with `npm run auditor:lint`.

## Child DOX Index

- [run_dev.ts](run_dev.ts): Docker-first development lifecycle orchestrator (`citty` + `docker compose`).
