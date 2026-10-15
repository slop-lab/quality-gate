set dotenv-load
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

packages := "packages/core packages/test-utils packages/rules-git packages/rules-files packages/rules-package-manager packages/rules-test packages/cli"
qg_cli := "packages/cli/dist/index.cjs"

default:
  @just --list

install:
  pnpm install

bootstrap:
  pnpm install --frozen-lockfile
  just build

build:
  pnpm exec tsc -b {{packages}}
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
