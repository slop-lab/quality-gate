set dotenv-load
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

qg_cli := "packages/cli/dist/index.mjs"

default:
  @just --list

bootstrap:
  pnpm install --frozen-lockfile
  just build
  node {{qg_cli}} hooks install

build:
  @node scripts/build.mjs

test: build
  @pnpm exec node --test packages/*/dist/**/*.test.js

format:
  pnpm exec biome format --write .

qg *args: build
  @node {{qg_cli}} {{args}}

# Full rule scan, then the configured Biome/build/test hook checks.
ci: build
  @node {{qg_cli}} check --full
  @node {{qg_cli}} run-hook pre-commit

# Validate and preview all eight public npm packages without publishing.
release-check: ci
  npm pack --workspaces --dry-run --include-workspace-root=false
