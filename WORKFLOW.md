# Workflow

Everyday commands (run from the repo root). `make help` lists them all.

| Command | What it does |
|---|---|
| `make setup` | One-time after cloning: install deps + enable git hooks |
| `make dev` | Run the app locally |
| `make test` | Full suite: unit + build + e2e |
| `make test-unit` | Fast unit tests only |
| `make test-e2e` | Browser end-to-end tests |
| `make check` | Type-check |
| `make push` | Fast checks, then `git push` |
| `make deploy` | Test → build → ship to the VPS → tag the release |

## Day-to-day loop

```bash
git checkout -b my-change     # work on a branch
make dev                      # build the thing
make test                     # verify
git add -A && git commit -m "…"
make push                     # pushes (pre-push hook re-runs the fast gate)
```

Opening a pull request on GitHub runs **CI** (`.github/workflows/ci.yml`): type-check,
unit tests, build, and e2e. Merge when it's green.

## Releasing to production

One-time: copy `.deploy.env.example` → `.deploy.env` and fill in your VPS details.
The `DEPLOY_USER` needs passwordless sudo for `systemctl restart foundry` (add a
sudoers line for just that command).

Then, from a clean `main`:

```bash
make deploy
```

This refuses to run on a dirty tree, runs the test gate, builds, `rsync`s the build
to the VPS, installs production deps (rebuilding native modules), restarts the
service, and tags the release (`release-YYYYMMDD-HHMMSS`).

Roll back by checking out an earlier tag and running `make deploy` again, or restore
a DB backup (see `app/DEPLOY.md`).

## First-time GitHub setup

This repo has no remote yet. Create an empty repo on GitHub, then:

```bash
git remote add origin git@github.com:<you>/foundry.git
git push -u origin main
```

CI runs automatically from then on.
