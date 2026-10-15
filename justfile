set dotenv-load

packages := "packages/core packages/test-utils packages/rules-git packages/rules-files packages/rules-package-manager packages/rules-test packages/cli"
quality_gate := "packages/cli/dist/index.js"

default:
  @just --list

install:
  pnpm install

# Reproducible setup for a fresh clone.
bootstrap:
  pnpm install --frozen-lockfile
  pnpm exec tsc -b {{packages}}

# Install the CLI from this checkout. Re-run after moving the checkout.
install-cli: bootstrap
  bash scripts/install-cli.sh

uninstall-cli:
  bash scripts/install-cli.sh --uninstall

build:
  pnpm exec tsc -b {{packages}}

test: build
  pnpm exec node --test packages/*/dist/**/*.test.js

lint:
  pnpm exec biome lint .

format:
  pnpm exec biome format --write .

biome-check:
  pnpm exec biome check .

qg-full: build
  node {{quality_gate}} check --full

qg-changed: build
  node {{quality_gate}} check --changed

qg-rules: build
  node {{quality_gate}} rules

quality-gate *args: build
  node {{quality_gate}} {{args}}

check: biome-check qg-full

ci: check test
