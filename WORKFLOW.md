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

**Pushing to `main` deploys automatically.** When a push to `main` passes CI
(type-check, unit, build, e2e), the `deploy` job ships the build to the VPS and
restarts the service. So the release flow is just:

```bash
git push        # to main → CI runs → on green, auto-deploys
```

Work on a branch and open a PR when you want CI to run *without* deploying; only
merges/pushes to `main` go live.

### One-time CD setup (GitHub → server)

The deploy job authenticates with a dedicated SSH key stored as repo secrets.

1. Generate a deploy keypair locally:
   ```bash
   ssh-keygen -t ed25519 -f deploy_key -N "" -C "foundry-ci-deploy"
   ```
2. Authorize the public key on the server (as the deploy user):
   ```bash
   ssh victor@<host> 'cat >> ~/.ssh/authorized_keys' < deploy_key.pub
   ```
3. Add repo secrets (GitHub → Settings → Secrets and variables → Actions), or via gh:
   ```bash
   gh secret set DEPLOY_SSH_KEY < deploy_key      # the PRIVATE key
   gh secret set DEPLOY_HOST --body "<host>"
   gh secret set DEPLOY_USER --body "victor"
   ```
4. Delete the local private key: `rm deploy_key deploy_key.pub`

The deploy user still needs passwordless sudo for `systemctl restart foundry`
(already configured by `app/deploy/setup.sh`).

### Manual deploy (fallback)

`make deploy` still works for a manual push from a clean tree (uses `.deploy.env`
and tags a `release-*`). Roll back by restoring a DB backup (see `app/DEPLOY.md`)
or re-deploying an earlier commit.

## First-time GitHub setup

This repo has no remote yet. Create an empty repo on GitHub, then:

```bash
git remote add origin git@github.com:<you>/foundry.git
git push -u origin main
```

CI runs automatically from then on.
