# Loopi Plug-And-Play UX Implementation Plan

This document turns the current onboarding and usability findings into a concrete delivery plan.

It focuses on three goals:

1. Make first-run success much more likely.
2. Replace manual JSON-heavy setup with guided settings screens.
3. Preserve the current dependency-free orchestration core while adding a friendlier control plane around it.

## Authoring Rule For This Plan

This plan is intentionally written for a less sophisticated coding agent that may implement the work later.

That means each phase should be read as:

- change these exact areas first
- do not invent a different architecture unless the plan explicitly says to
- update tests and docs in the same phase as the code
- stop and fix failing tests before moving to the next phase
- preserve existing CLI adapter behavior unless the plan explicitly says to change it

When executing any phase in this document, the implementing agent should:

1. Read the files listed under "Read first".
2. Make the code changes only in the files listed under "Edit these files" unless a clear dependency forces a nearby change.
3. Add or update tests listed under "Tests to add or update".
4. Run the verification commands listed under "Verify".
5. Confirm that the "Done when" conditions are all true before moving on.

## Problem Summary

Today, Loopi is strongest once a user already understands the model ecosystem and has a working local setup. The main friction points are:

- no true fresh-install setup flow
- `doctor` depends on `shared/task.json`, so it is not a real first-run health check
- provider-only setups are not fully validated before execution
- the beginner wizard offers static agent choices rather than detected usable agents
- built-in plan `useCase` templates exist but are not exposed in the CLI
- advanced settings still require manual JSON editing
- some loop-setting names are more implementation-centric than user-centric
- adapter install/auth knowledge exists only inside formatted error strings

The result is a product that is technically capable but still feels operator-driven rather than plug-and-play.

## Product Direction

Recommended direction:

- keep `src/orchestrator.js`, `src/task-config.js`, and the adapter/runtime layer as the engine
- add structured setup and capability metadata to the backend
- add a separate local control-plane UI package for settings, task composition, and run monitoring
- keep the CLI fully supported as a power-user path

This preserves the current architecture while making UX improvements incremental instead of disruptive.

## Guiding Constraints

- The orchestration core should remain dependency-free at runtime.
- Windows remains the primary platform.
- Existing CLI adapters must keep working.
- The new UX layer should sit on top of existing validation and run-state infrastructure rather than duplicating logic.
- Authentication flows for third-party CLIs should be launched and guided by Loopi, but not silently bypassed or faked.

## Success Criteria

The work is successful when all of the following are true:

- A new user can open Loopi and see what is installed, what is missing, and what must be authenticated before any task exists.
- A provider-only workflow can be validated without running a real task.
- The default wizard or UI only recommends agents that are actually usable.
- Common settings can be configured without touching `shared/task.json`.
- The system can launch install or login helpers where safe, then re-check readiness automatically.
- Runs, steps, and artifacts are visible in a UI without requiring users to inspect files manually.

## Scope

In scope:

- setup diagnostics
- structured adapter metadata
- improved CLI onboarding
- provider-aware health checks
- settings UI
- task composer UI
- run history and artifact views
- optional one-click installer helpers for supported npm-based CLIs

Out of scope for the first pass:

- replacing the orchestrator runtime
- rewriting adapter execution semantics
- automatic third-party account creation or secret provisioning
- removing the JSON config path for advanced users

## Architecture Recommendation

### Core principle

Add a control-plane layer around the current runtime rather than embedding UI logic into the orchestrator.

### Recommended shape

- `src/` remains the runtime, validation, adapters, and persistence engine.
- Add a small internal service layer that exposes structured setup, config, and run operations to both CLI and UI callers.
- Add a separate UI app package, likely something like `apps/desktop` or `apps/ui`.
- Start with a local web UI backed by a local Node process. If packaging is later needed, wrap that UI in a desktop shell.

### Why this shape

- It respects the dependency-free core rule.
- It avoids duplicating validation logic in frontend code.
- It lets the CLI and UI share the same backend contracts.
- It keeps packaging decisions flexible.

## Workstreams

This plan is easiest to deliver through five workstreams that can overlap after the backend contracts are stable.

### 1. Setup and diagnostics

Goal:

- make setup status visible before task creation

Deliverables:

- a task-independent setup diagnostic flow
- provider-aware readiness checks in setup mode
- structured install/auth/path status for each adapter
- actionable next steps for each failure state

### 2. Config simplification

Goal:

- turn the current config model into a beginner-facing settings model

Deliverables:

- a normalized "beginner settings" view over the current config
- role, provider, and context forms built from validated backend schemas
- progressive disclosure for advanced fields

### 3. CLI onboarding improvements

Goal:

- improve first-run success even before the full UI ships

Deliverables:

- `doctor` that works with or without `shared/task.json`
- a `setup` command or equivalent onboarding path
- wizards that prefer detected usable agents over static menus
- first-class `useCase` selection for planning-oriented flows
- better recommended defaults based on available tools

### 4. Control-plane UI

Goal:

- provide an intuitive settings and run-management experience

Deliverables:

- setup screen
- settings screen
- task composer
- run dashboard
- artifact and history views

### 5. Installer and packaging polish

Goal:

- reduce manual external setup where it is safe to do so

Deliverables:

- one-click install helpers for supported npm-distributed CLIs
- guided auth launch buttons
- optional packaged desktop distribution later

## Phase 0: Contracts And Refactor Prep

Purpose:

- carve out the backend seams needed for both CLI and UI without changing user-facing behavior yet

Read first:

- `src/adapters/index.js`
- `src/cli-doctor.js`
- `tests/adapters.test.js`
- `tests/cli.test.js`

Edit these files:

- `src/adapters/index.js`
- new `src/setup-service.js`
- new `src/provider-service.js` or equivalent helper
- `src/cli-doctor.js`

Implementation steps:

1. Add structured adapter metadata in or near `src/adapters/index.js` for each supported CLI.
2. Include at least these fields for each adapter: `id`, `displayName`, `docsUrl`, `installHint`, `loginHint`, `envOverride`, and a way to resolve the executable path.
3. Extract setup-state logic into a new service module instead of leaving it embedded only in `formatPreflightError(...)`.
4. Create a provider helper that can check readiness from raw provider config without requiring a full task run.
5. Define stable plain-object result shapes for:
   - adapter status
   - auth status
   - resolved path
   - provider readiness
   - recommended next action
6. Update `src/cli-doctor.js` to consume the new services instead of duplicating setup logic.

Do not do this:

- do not remove existing adapter fallback behavior
- do not change actual run invocation semantics in this phase
- do not add frontend code in this phase

Tests to add or update:

- `tests/adapters.test.js`
- add tests for new setup service module
- add tests for provider helper module

Verify:

- `npm.cmd test`

Done when:

- backend can answer "what is installed and usable?" without requiring `shared/task.json`
- backend can answer "is this provider ready?" from raw provider settings
- backend exposes structured next steps rather than only human-readable error strings

## Phase 1: Doctor And Setup CLI

Purpose:

- fix the first-run onboarding path immediately

Read first:

- `src/cli-commands.js`
- `src/cli-doctor.js`
- `src/task-config.js`
- `docs/cli.md`

Edit these files:

- `src/cli-commands.js`
- `src/cli-doctor.js`
- `docs/cli.md`
- `README.md`

Implementation steps:

1. Redesign `doctor` so it can run with no `shared/task.json`.
2. Split doctor behavior into:
   - environment mode with no task file required
   - task mode that validates an existing task file
3. In environment mode, check all supported CLI adapters and report status as one of:
   - ready
   - installed but needs login
   - missing
   - unusable
4. In task mode, continue to validate `shared/task.json`, but also report provider readiness for configured providers.
5. If a new `setup` command makes the UX clearer, add it in `src/cli-commands.js` and document it. If not, keep the feature inside `doctor`.
6. Show env override information such as `LOOPI_*` path settings in the output where relevant.
7. Update README and CLI docs so the first-run instructions match the new behavior.

Do not do this:

- do not require a user to create `shared/task.json` before setup checks
- do not print vague failures if a specific next action is known

Tests to add or update:

- `tests/cli.test.js`
- tests for doctor with no task file
- tests for provider-only validation
- tests for mixed CLI and provider setups

Verify:

- `npm.cmd test`

Done when:

- `npm run cli -- doctor` is useful on a brand-new install
- provider-only users get meaningful validation without needing a real task
- users see clear next actions before opening the wizard

## Phase 2: Wizard And Config UX Upgrade

Purpose:

- reduce failure after setup and remove common JSON editing

Read first:

- `src/cli-wizard.js`
- `src/cli-prompts.js`
- `src/task-config.js`
- `src/use-case-loader.js`
- `shared/task.example.json`
- `docs/cli.md`

Edit these files:

- `src/cli-wizard.js`
- `src/cli-prompts.js`
- `src/task-config.js`
- `shared/task.example.json`
- `docs/cli.md`
- `README.md`

Implementation steps:

1. Make the wizard query real setup status before showing agent choices.
2. Rank agent choices so ready agents appear first.
3. Separate agents that need login from agents that are fully ready.
4. Hide missing agents from the default beginner path, or place them in a clearly separate section.
5. Remove the beginner-facing assumption that `claude`, `codex`, and `gemini` should be the default if nothing is configured.
6. Expose `useCase` as a first-class choice when `mode` is `plan` or `one-shot`.
7. Load available use-case choices from `config/use-cases/*.json` instead of hardcoding a second list in the CLI.
8. Present the planning flow as separate choices such as:
   - `Mode: plan`
   - `Use case: coding`
   - `Plan loops: 3`
9. Add loop-setting prompts to the advanced path and, where appropriate, to the beginner path.
10. Add a new dedicated `settings.planLoops` field.
11. Use `planLoops` for:
   - standalone `plan` mode plan-review-synthesis cycles
   - the plan stage inside each `one-shot` outer cycle
12. Keep `settings.qualityLoops` as the canonical config name for total one-shot outer reruns of the whole sequence.
13. In docs and prompts, define the one-shot nesting clearly:
   - `qualityLoops` = rerun the entire one-shot sequence
   - `planLoops` = number of plan cycles inside each one-shot sequence
   - `sectionImplementLoops` = implementation-review-repair loops for each section inside each one-shot sequence
14. Rename `settings.implementLoopsPerUnit` to `settings.sectionImplementLoops` as the clearer one-shot-specific config name.
15. Preserve backward compatibility by continuing to accept `implementLoopsPerUnit` as a deprecated alias during migration.
16. Use these user-facing labels in the CLI and UI:
   - `Plan loops`
   - `Quality loops`
   - `Implementation loops`
   - `Section implementation loops`
17. Add at least one explicit worked example to the docs:
   - `Mode: one-shot`
   - `Use case: paper`
   - `Plan loops: 4`
   - `Section implementation loops: 2`
   - `Quality loops: 2`
   - if the plan has 3 sections, that means `8` total plan cycles and `12` total section implementation cycles
18. Expand the advanced wizard so it can write the most important non-beginner settings without forcing manual JSON editing.
19. Add support in the advanced path for:
   - use case
   - roles
   - fallback
   - model and effort
   - loop settings
   - provider setup
   - context options
   - write permissions
20. Update example config and docs so users can see the new shape clearly.

Do not do this:

- do not expose every obscure config field in the beginner path
- do not break manual JSON compatibility
- do not remove advanced escape hatches for power users
- do not overload `qualityLoops` to mean plan-stage cycles inside one-shot
- do not remove the current one-shot outer-cycle meaning of `qualityLoops`
- do not use spaces in persisted config keys; use spaces only in CLI or UI labels

Tests to add or update:

- wizard tests for setup-aware agent recommendations
- wizard tests for mode + useCase selection
- wizard tests for loop-setting prompts and generated config
- task-config tests for `planLoops`, `qualityLoops`, `sectionImplementLoops`, and deprecated aliases
- prompt parsing tests if menu shapes change
- task-config tests if new generated config shapes are written

Verify:

- `npm.cmd test`

Done when:

- fresh users are not funneled into agents they cannot run
- users can select `mode`, `useCase`, and loop counts directly in the CLI
- most common workflows can be created without manual JSON editing
- advanced options remain available without cluttering the beginner flow

### Phase 2A: Schema And CLI Checklist For Use Cases And Loops

Purpose:

- add the new loop model and CLI prompts in a safe, backward-compatible order

Current state before this phase:

- current code does **not** support separate `planLoops` inside `one-shot`
- current code uses `qualityLoops` for total outer one-shot cycles
- current code uses `implementLoopsPerUnit` for per-section one-shot implementation loops
- current CLI does **not** expose `useCase` or loop settings directly

Target state after this phase:

- `plan` mode supports `useCase` and `planLoops`
- `one-shot` mode supports all three separate loop controls:
  - `planLoops`
  - `sectionImplementLoops`
  - `qualityLoops`
- CLI prompts expose those controls directly
- normalized config returns the new canonical names even when deprecated aliases were used as input

Required one-shot execution model:

1. For each outer `qualityLoops` cycle, run the plan stage `planLoops` times.
2. After the final plan result for that outer cycle is ready, implement each planned section.
3. For each section, run the implement-review-repair loop `sectionImplementLoops` times.
4. If there is another outer `qualityLoops` cycle remaining, rerun the full sequence again using the one-shot replan flow.

Worked example the implementing agent must preserve:

- `Mode: one-shot`
- `Use case: paper`
- `Plan loops: 4`
- `Section implementation loops: 2`
- `Quality loops: 2`
- if the plan has 3 sections, that means:
  - `8` total plan cycles
  - `12` total section implementation cycles

Read first:

- `src/task-config.js`
- `src/cli-wizard.js`
- `src/cli-prompts.js`
- `tests/task-config.test.js`
- `tests/cli.test.js`
- `README.md`
- `docs/config.md`

Edit these files:

- `src/task-config.js`
- `src/cli-wizard.js`
- `src/cli-prompts.js`
- `tests/task-config.test.js`
- `tests/cli.test.js`
- `shared/task.example.json`
- `README.md`
- `docs/config.md`
- `docs/cli.md`

Implementation steps:

1. Add a new `normalizePlanLoops(rawTask)` helper in `src/task-config.js`.
2. Make `normalizePlanLoops(rawTask)` read `settings.planLoops` as the new primary field.
3. During migration, allow `settings.qualityLoops` to act as the fallback source for `planLoops` when `planLoops` is absent.
4. Validate `planLoops` as a positive integer and throw a clear error on invalid values.
5. Keep `settings.qualityLoops` as a separate field for total one-shot outer reruns.
6. Change `normalizeTaskConfig(...)` so `settings` includes all three loop values explicitly:
   - `planLoops`
   - `qualityLoops`
   - `sectionImplementLoops`
7. Add a new `normalizeSectionImplementLoops(rawTask)` helper.
8. Make `normalizeSectionImplementLoops(rawTask)` read `settings.sectionImplementLoops` as the new primary field.
9. During migration, allow `settings.implementLoopsPerUnit` as a deprecated alias when `sectionImplementLoops` is absent.
10. Preserve a clear fallback chain for `sectionImplementLoops`.
11. Use this fallback order unless a strong code-level reason forces a different one:
   - explicit `sectionImplementLoops`
   - deprecated `implementLoopsPerUnit`
   - explicit `implementLoops`
   - explicit `planLoops`
   - deprecated `qualityLoops` only when being used as the legacy plan-loop source
   - default `1`
12. Keep `implementLoops` for standalone implement mode and shared implement-repair loops where that still makes sense.
13. Do not remove old keys from accepted input yet.
14. Mark old keys as deprecated in docs and comments, but still accept them for compatibility.
15. Update any returned normalized config shape, comments, and downstream callers to use:
   - `settings.planLoops`
   - `settings.qualityLoops`
   - `settings.sectionImplementLoops`
16. In the CLI wizard, add `useCase` selection for `plan` and `one-shot`.
17. In the CLI wizard, add loop prompts with mode-aware labels:
   - `plan`: ask for `Plan loops`
   - `one-shot`: ask for `Use case`, `Plan loops`, `Section implementation loops`, and `Quality loops`
   - `implement`: ask for `Implementation loops`
18. Write the new canonical keys into generated config files, not the deprecated aliases.
19. Update `shared/task.example.json` to show at least one one-shot example with all three loop controls present.
20. Update docs so the worked example is explicit:
   - `Mode: one-shot`
   - `Use case: paper`
   - `Plan loops: 4`
   - `Section implementation loops: 2`
   - `Quality loops: 2`
   - if the plan has 3 sections, that means `8` total plan cycles and `12` total section implementation cycles

Do not do this:

- do not collapse `planLoops` and `qualityLoops` back into one field
- do not remove support for `qualityLoops` or `implementLoopsPerUnit` input in the same change that introduces the new fields
- do not write deprecated keys from the wizard once the new keys exist
- do not change loop math silently; document the new semantics in the same phase

Tests to add or update:

- tests that `planLoops` is accepted and normalized
- tests that legacy `qualityLoops` still backfills `planLoops` when needed
- tests that `sectionImplementLoops` is accepted and normalized
- tests that legacy `implementLoopsPerUnit` still works as an alias
- tests that invalid `planLoops`, `qualityLoops`, and `sectionImplementLoops` reject clearly
- CLI wizard tests for:
  - `plan` + `useCase` + `planLoops`
  - `one-shot` + `useCase` + `planLoops` + `sectionImplementLoops` + `qualityLoops`
  - canonical keys written to config output

Verify:

- `npm.cmd test`

Done when:

- normalized config exposes `planLoops`, `qualityLoops`, and `sectionImplementLoops`
- deprecated loop keys are still accepted as input
- new wizard flows write only canonical loop keys
- docs explain the one-shot nesting clearly enough that a weaker agent would implement the same semantics

## Phase 3: Local Control-Plane Backend

Purpose:

- create the backend contract layer the UI will call

Read first:

- `src/collaboration-store.js`
- `src/orchestrator.js`
- `src/cli-presets.js`
- any service modules added in Phase 0

Edit these files:

- new `src/control-plane/` modules
- `src/collaboration-store.js` if new read helpers are needed
- `src/orchestrator.js` only where necessary
- `src/cli-presets.js` if preset APIs should be shared

Implementation steps:

1. Create a local control-plane service layer for UI and future CLI reuse.
2. Add service methods for:
   - setup status
   - provider testing
   - config load
   - config validate
   - config save
   - preset list/save/use
   - run launch
   - run list
   - run detail
   - artifact list/detail
3. Reuse existing backend modules instead of duplicating validation or persistence logic.
4. Keep response shapes plain and stable so a UI can call them directly.
5. Add read helpers to the collaboration store only if needed for run and artifact browsing.

Do not do this:

- do not move config validation into frontend code
- do not rewrite the orchestrator just to fit the service layer
- do not add network-facing remote APIs unless explicitly requested later

Tests to add or update:

- service-layer tests for config load/save/validate
- service-layer tests for run listing and artifact listing
- collaboration-store tests if new helpers are added

Verify:

- `npm.cmd test`

Done when:

- UI can perform all major user actions through stable local service calls
- config validation remains single-sourced in backend code
- run history comes directly from collaboration-store data

## Phase 4: Settings UI And Task Composer

Purpose:

- give users an intuitive interface instead of hand-editing config

Key screens:

- Setup
  - cards for Claude, Codex, Gemini, Kilo, Qwen, OpenCode, and configured providers
  - status badges
  - install, login, detect, and test actions
- Settings
  - project root
  - agent enablement
  - provider configuration
  - model/effort preferences
  - default write permissions
  - context defaults
- Task Composer
  - prompt
  - mode
  - use case when relevant
  - plan loops
  - quality loops
  - section implementation loops for one-shot
  - selected agents
  - recommended role assignment
  - run now / save preset
- Run Dashboard
  - current run status
  - step timeline
  - artifacts
  - scratchpad/log shortcuts

Recommended UI behavior:

- beginner and advanced views
- inline validation from backend
- preserve raw JSON access as an advanced escape hatch
- show plain-language explanations for advanced concepts like `fallback`, `deliveryPolicy`, and `oneShotOrigins`

Suggested package shape:

- `apps/ui` for a browser-based control plane
- optional later `apps/desktop` wrapper if packaging is desired

Read first:

- control-plane service modules from Phase 3
- `src/task-config.js`
- `src/collaboration-store.js`

Edit these files:

- new `apps/ui` package or equivalent
- any small backend glue needed for the UI
- docs that explain how to launch the UI locally

Implementation steps:

1. Build the setup screen first, not the whole app at once.
2. Use backend service responses as the single source of truth for status badges and validation messages.
3. Build the settings screen second and expose only common settings in the default view.
4. Add an advanced section for power users instead of mixing advanced settings into the beginner layout.
5. Build the task composer third, with mode, prompt, selected agents, roles, loop settings, and run or save actions.
6. In the task composer, make `useCase` conditional:
   - show it for `plan`
   - show it for `one-shot`
   - hide it for `implement` and `review`
7. In the task composer and settings UI, keep the one-shot loop controls separate and clearly labeled:
   - `Plan loops`
   - `Quality loops`
   - `Section implementation loops`
8. Build the run dashboard fourth, using collaboration-store-backed service calls for run state and artifacts.
9. Add a raw JSON editor or viewer only as an advanced escape hatch.

Do not do this:

- do not duplicate backend validation in frontend code
- do not hardcode agent state in the UI
- do not block the release on desktop packaging

Tests to add or update:

- UI smoke tests if the chosen stack supports them
- backend integration tests that exercise the UI-facing service contracts

Verify:

- launch the UI locally and manually confirm setup, settings, task composer, and run dashboard flows
- `npm.cmd test` for backend regressions

Done when:

- a beginner can configure a working task without opening `shared/task.json`
- settings are understandable without reading docs first
- users can inspect past runs without browsing the filesystem

## Phase 5: Install And Auth Helpers

Purpose:

- reduce manual setup steps where safe

Key changes:

- Add adapter metadata for:
  - install command
  - login command
  - docs URL
  - known environment overrides
- Support one-click install for npm-distributed CLIs where the user explicitly approves it.
- Support one-click login launch that opens a terminal or subprocess with the correct command.
- Re-run readiness checks automatically after install or login actions complete.

Important limits:

- Do not attempt silent third-party auth.
- Do not store secrets unless a secure secret-storage decision is made explicitly.
- Treat install automation as opt-in and reversible.

Read first:

- adapter metadata from Phase 0
- setup service from Phase 0
- UI setup screen from Phase 4

Edit these files:

- adapter metadata definitions
- setup services
- UI setup screen
- docs for installation helpers

Implementation steps:

1. Add structured install commands and login commands to adapter metadata where safe and known.
2. Expose install and login actions through setup services.
3. Require explicit user approval before running install commands.
4. Launch login commands in a user-visible terminal or subprocess flow rather than trying to fake authentication.
5. Re-run readiness checks automatically after helper actions complete.
6. Update the UI so agent cards can show install, login, and re-test actions clearly.

Do not do this:

- do not silently install third-party tools
- do not store secrets without an approved storage design
- do not assume the same install command works on every platform unless tested

Tests to add or update:

- adapter metadata tests for helper fields
- setup-service tests for helper action wiring
- UI tests or manual QA for install/login action visibility

Verify:

- `npm.cmd test`
- manual QA on Windows for at least one installable npm-based CLI and one login flow

Done when:

- supported npm-based tools can be installed from inside Loopi with user approval
- login can be launched from the app without forcing users to read docs first
- setup status updates automatically after helper actions

## Mapping Findings To Deliverables

| Finding | Fix |
|---|---|
| `doctor` requires `shared/task.json` | Phase 1 task-independent environment diagnostics |
| provider-only setups are not validated early | Phase 1 provider-aware checks |
| wizard shows static agents | Phase 2 detected usable-agent flow |
| built-in use cases are hidden from the CLI | Phase 2 first-class use-case selection |
| default agents assume external tools exist | Phase 2 beginner defaults based on real availability |
| advanced config is JSON-heavy | Phase 2 stronger wizard, Phase 4 settings UI |
| one-shot loop semantics are overloaded and unclear | Phase 2 separate `planLoops`, `qualityLoops`, and `sectionImplementLoops` |
| adapter install/auth knowledge is trapped in strings | Phase 0 structured adapter metadata, Phase 5 helper actions |

## Testing Strategy

Add tests alongside each phase rather than waiting until the end.

### Backend tests

- adapter metadata shape tests
- setup service tests
- provider readiness tests
- doctor mode tests with and without task files
- wizard recommendation tests based on mocked availability
- control-plane service tests for config load/save and run listing

### Integration tests

- fresh-install simulation with no task file
- provider-only setup flow
- CLI-only setup flow with one authenticated agent
- mixed provider and CLI setup flow
- save config in UI/service, then run orchestrator successfully

### Manual QA

- Windows-first test pass for install detection and login launch
- verify path overrides and npm-global resolution behavior
- verify settings screen remains coherent when no agents are installed

## Delivery Order

Recommended order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5

Reason:

- it fixes the biggest onboarding gaps early
- it de-risks the UI by stabilizing backend contracts first
- it delivers value to CLI users before the UI is complete

## Risks And Mitigations

Risk:

- UI work could fork config logic from backend validation.

Mitigation:

- all config validation stays in backend modules and the UI only consumes validated service responses.

Risk:

- adapter-specific install and auth flows may drift over time.

Mitigation:

- keep adapter metadata centralized with tests and docs URL fallbacks.

Risk:

- adding a UI could bloat the core runtime.

Mitigation:

- keep the UI in a separate package and keep the orchestration core dependency-free.

Risk:

- one-click install may require elevated permissions or platform-specific handling.

Mitigation:

- make install helpers optional, explicit, and adapter-specific.

## Recommended First Milestone

If we want the highest-value first slice, build this milestone first:

- structured adapter setup metadata
- task-independent `doctor`
- provider-aware readiness checks in setup mode
- beginner wizard that recommends only usable agents

That milestone addresses the most painful onboarding issues before any UI framework work begins.

## Execution Template For Future Plans

For future implementation plans in this repo, use this structure so a less sophisticated agent can execute it reliably:

1. State the purpose in one sentence.
2. List "Read first" files.
3. List "Edit these files".
4. Write numbered implementation steps in the order they should be done.
5. Add a "Do not do this" section with guardrails.
6. List tests to add or update.
7. List exact verification commands.
8. End with "Done when" conditions that are concrete and testable.

## Stretch Follow-Up

Once the settings UI is stable, the next usability upgrades should be:

- run compare dashboards built on the collaboration store
- preset library management in the UI
- inline explanations for context budgeting and model-role assignment
- optional packaged desktop distribution for non-technical users
