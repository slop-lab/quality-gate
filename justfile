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
  @node --test --test-reporter=./packages/checks/dist/node-test-reporter.mjs packages/*/dist/**/*.test.js scripts/*.test.mjs

format:
  @node scripts/run-task.mjs format

qg *args: build
  @node {{qg_cli}} {{args}}

# Full rule scan and the shared Biome/build/test checks.
ci: build
  @node {{qg_cli}} check --full

# Validate and preview all fourteen public npm packages without publishing.
release-check: ci
  @node scripts/run-task.mjs pack
