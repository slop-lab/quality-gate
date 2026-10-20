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
  @node --test --test-reporter=./packages/cli/dist/node-test-reporter.mjs packages/*/dist/**/*.test.js

format:
  @node scripts/run-task.mjs format

qg *args: build
  @node {{qg_cli}} {{args}}

# Full rule scan and the shared Biome/build/test checks.
ci: build
  @node {{qg_cli}} check --full

# Validate and preview all eight public npm packages without publishing.
release-check: ci
  @node scripts/run-task.mjs pack
