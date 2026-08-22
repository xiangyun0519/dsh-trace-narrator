# Public Delivery and Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `dsh-trace-narrator` understandable, installable, and release-ready for DSH users without changing the report-generation runtime.

**Architecture:** Keep the project as a DSH plugin distributed as an npm package, with a source-install fallback for contributors. Add public-facing proof of value through a redacted sample report and a short README path. Use CI to verify the same test, typecheck, build, and package checks before a future release.

**Tech Stack:** Node.js 20+, pnpm, TypeScript, Vitest, tsup, npm, GitHub Actions.

---

### Task 1: Complete the package publication contract

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Create: `LICENSE`

**Steps:**

1. Bump the unpublished package to the next patch version and add npm discovery metadata: keywords, repository, homepage, bugs URL, and public package access configuration.
2. Add the MIT license file referenced by the package metadata and README badge, and record the public-delivery changes in the changelog.
3. Run `pnpm pack --dry-run` and confirm the tarball includes the built library, bundle patch, README, package metadata, and license.

### Task 2: Add a usable public demo path

**Files:**
- Modify: `README.md`
- Create: `examples/demo-report.md`
- Create: `docs/release.md`

**Steps:**

1. Put the target user, concrete problem, 30-second result, and install choices before the long feature list.
2. Add a fully synthetic, redacted report so a visitor can see the output without installing DSH.
3. Document source installation, npm publication prerequisites, release verification, and the current product boundary.
4. Keep all example data synthetic and avoid promising a public viewer or hosted service.

### Task 3: Add public repository validation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-package.mjs`

**Steps:**

1. Run install with the lockfile, tests, typecheck, build, and npm package manifest check on pushes and pull requests.
2. Assert required package files and reject source, test, environment, log, or distribution files before publication.
3. Use the repository's existing pnpm scripts and Node 20 so CI verifies the actual published package path.
4. Do not add npm credentials or automatic publishing in this change.

### Task 4: Verify and record the change

**Steps:**

1. Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm pack --dry-run`, and `git diff --check`.
2. Inspect the final diff and confirm the unrelated `dist/` and `package.json.gbk.bak.staged` files remain unstaged.
3. Create a local Conventional Commit containing only the requested public-delivery files.
4. Do not push or publish until the user explicitly authorizes those external actions.
