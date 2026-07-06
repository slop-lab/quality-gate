set dotenv-load

packages := "packages/core packages/test-utils packages/rules-git packages/rules-package-manager packages/rules-test packages/cli"
quality_gate := "packages/cli/dist/index.js"

default:
  @just --list

install:
  pnpm install

build:
  tsc -b {{packages}}

test: build
  node --test packages/*/dist/**/*.test.js

lint:
  biome lint .

format:
  biome format --write .

biome-check:
  biome check .

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
