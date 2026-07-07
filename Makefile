# Logbook — developer workflow
# Run `make help` for the list.

.DEFAULT_GOAL := help
.PHONY: help setup dev test test-unit test-e2e check push deploy release

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## One-time: install deps and enable git hooks
	cd app && npm ci
	git config core.hooksPath .githooks
	@echo "Setup complete. Git hooks enabled."

dev: ## Run the app locally (http://localhost:5173)
	cd app && npm run dev

test: ## Full test suite: unit + build + e2e
	cd app && npm test

test-unit: ## Fast unit tests only
	cd app && npm run test:unit

test-e2e: ## Browser end-to-end tests
	cd app && npm run test:e2e

check: ## Type-check (svelte-check)
	cd app && npm run check

push: ## Run fast checks, then push the current branch
	cd app && npm run test:unit && npm run build
	git push

deploy: ## Test, build, ship to the VPS, tag the release
	./scripts/deploy.sh

release: deploy ## Alias for deploy
