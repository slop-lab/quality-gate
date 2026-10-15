set dotenv-load
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

packages := "packages/core packages/test-utils packages/rules-git packages/rules-files packages/rules-package-manager packages/rules-test packages/cli"
quality_gate := "packages/cli/dist/index.cjs"

default:
  @just --list

install:
  pnpm install

bootstrap:
  pnpm install --frozen-lockfile
  just build

build:
  pnpm exec tsc -b {{packages}}
  pnpm --dir packages/cli run bundle

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
