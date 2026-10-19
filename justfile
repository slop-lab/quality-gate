set dotenv-load
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

qg_cli := "packages/cli/dist/index.mjs"

default:
  @just --list

bootstrap:
  @node scripts/run-task.mjs install
  @just build
  @node {{qg_cli}} hooks install

build:
  @node scripts/run-task.mjs build

test: build
  @node --test --test-reporter=./scripts/test-reporter.mjs packages/*/dist/**/*.test.js

format:
  @node scripts/run-task.mjs format

qg *args: build
  @node {{qg_cli}} {{args}}

# Full rule scan, then the configured Biome/build/test hook checks.
ci: build
  @node {{qg_cli}} check --full
  @node {{qg_cli}} run-hook pre-commit

# Validate and preview all eight public npm packages without publishing.
release-check: ci
  @node scripts/run-task.mjs pack
