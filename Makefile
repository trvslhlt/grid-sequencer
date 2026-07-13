.PHONY: up down restart logs shell lint format typecheck build-image run-image verify \
	bruit-kit-build backend-logs backend-shell backend-typecheck build-image-backend run-image-backend \
	seed-samples

# bruit-kit is bind-mounted read-only into this project's dev container
# (see docker-compose.yml) rather than copied in, so its own Docker setup
# owns building it, not this Makefile -- this just shells into it so `make
# up` always starts with a fresh dist/, without you needing to remember a
# separate step in another project's directory.
bruit-kit-build:
	cd ../bruit-kit && make up && make build

# Start the dev container (hot reload) in the background.
up: bruit-kit-build
	docker compose up --build -d

down:
	docker compose down

restart:
	docker compose restart app

logs:
	docker compose logs -f app

# Drop into a shell inside the running dev container.
shell:
	docker compose exec app sh

# lint/format/typecheck run inside the already-running dev container (`make
# up` first).
lint:
	docker compose exec app npm run lint

format:
	docker compose exec app npm run format

typecheck:
	docker compose exec app npm run typecheck

# Build the deployable production image (static build served by nginx).
# Context is the parent directory -- see Dockerfile's top comment for why.
build-image:
	docker build --target runtime -f Dockerfile -t grid-sequencer ..

# Run the built production image locally (make build-image first).
run-image:
	docker run --rm -p 8080:80 grid-sequencer

# Manual browser check of the golden path: toggling cells, row/column/cell
# context menus, adding each source type, play/stop (requires `make up`
# first).
verify:
	docker compose --profile tools run --rm verify

# Populates the sample library with a varied set of procedurally
# synthesized sounds (kick/snare/hats/bass/leads/pads/fx) -- run any time
# against a running backend (`make up` first), safe to run repeatedly
# (each run just adds another copy, see scripts/seed-sample-library.mjs).
seed-samples:
	node scripts/seed-sample-library.mjs

# --- backend equivalents ---

backend-logs:
	docker compose logs -f backend

backend-shell:
	docker compose exec backend sh

backend-typecheck:
	docker compose exec backend npx tsc --noEmit

# Build the deployable production image (compiled JS + prod deps only).
build-image-backend:
	docker build --target runtime -t grid-sequencer-backend ./backend

# Run the built production backend image locally (make build-image-backend first).
run-image-backend:
	docker run --rm -p 3002:3002 grid-sequencer-backend
