.PHONY: setup dev demos test lint check

NODE24_PREFIX := $(if $(wildcard /opt/homebrew/opt/node@24/bin/node),/opt/homebrew/opt/node@24/bin:,)
PNPM := env PATH="$(NODE24_PREFIX)$(PATH)" corepack pnpm

setup:  ## install and lock dependencies
	$(PNPM) install --frozen-lockfile
	env PATH="$(NODE24_PREFIX)$(PATH)" node scripts/prepare-container-images.mjs

dev:  ## run the controller and Live Observatory locally
	$(PNPM) dev

demos:  ## regenerate the pinned synthetic replay demonstrations
	$(PNPM) --filter @code-nest/controller exec tsx ../../scripts/generate-demonstrations.ts

test:  ## run the test suite
	$(PNPM) test

lint:  ## run formatting checks, lint, and strict typecheck
	$(PNPM) lint
	$(PNPM) typecheck

check: lint test  ## aggregate gate
