set dotenv-load
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

qg_cli := "packages/cli/dist/index.mjs"

default:
  @just --list

install:
  pnpm install

bootstrap:
  pnpm install --frozen-lockfile
  just build
  node {{qg_cli}} hooks install

hooks-install: build
  node {{qg_cli}} hooks install

build:
  pnpm exec tsc -b
  pnpm exec tsdown

test: build
  pnpm exec node --test packages/*/dist/**/*.test.js

lint:
  pnpm exec biome lint .

format:
  pnpm exec biome format --write .

biome-check:
  pnpm exec biome check .

qg-full: build
  node {{qg_cli}} check --full

qg-changed: build
  node {{qg_cli}} check --changed

qg-rules: build
  node {{qg_cli}} rules

qg *args: build
  node {{qg_cli}} {{args}}

check: biome-check qg-full

ci: check test

# Validate and preview all eight public npm packages without publishing.
release-check: ci
  npm pack --workspaces --dry-run --include-workspace-root=false
