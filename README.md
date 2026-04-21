# Dialectic

Dialectic makes AI coding agents challenge each other in structured, controllable workflows.

Instead of pushing every step through one model, Dialectic lets you assign different agents to planning, implementation, and review, then control how many times the workflow loops. That gives you two things a single-agent tool cannot: better results from different model perspectives, and direct control over how much compute and token spend each stage gets.

Dialectic is a source-available orchestration runtime for teams that want AI coding workflows to be **inspectable, replayable, and tunable** instead of opaque.

## Why Teams Use Dialectic

### 1. Different agents critique each other

A single coding agent has one training history, one alignment profile, one set of defaults, and one set of blind spots. When it reviews its own output, it tends to agree with itself.

Dialectic is built around structured disagreement.

A plan written by one agent can be reviewed by another. An implementation produced by one model can be challenged by a different reviewer. A synthesis step then reconciles the disagreements into a final decision instead of letting one model dominate the whole workflow.

This matters because different agents fail differently. That is the point.

With Dialectic, you can:

- use one agent to plan, another to implement, and another to review
- run parallel reviews so you can see where agents agree and where they conflict
- force stage-to-stage handoffs through structured artifacts instead of loose chat memory
- keep reviewers read-only while the chosen implementer is allowed to write

Dialectic is not multi-agent for novelty. It is multi-agent so different models can expose each other's blind spots.

### 2. You control the cost, roles, and refinement loops

Most AI tools hide retries, refinement, and model choice inside one runtime. Dialectic puts those decisions in your hands.

You choose:

- which model plans
- which model writes
- which model reviews
- which steps stay read-only
- how many times the workflow loops

That means you can spend expensive tokens where judgment matters most, use cheaper or free models where execution is good enough, and still improve quality through structured review and repair cycles.

A common pattern looks like this:

- use your smartest model to plan
- use a cheaper or free coding agent to implement
- use a different model to review and challenge the result
- repeat the loop until the output is good enough

This gives you direct control over the quality/cost tradeoff instead of forcing every stage through one model at one price point.

Dialectic exposes three independent loop controls:

| Setting | Used by | What it controls |
| --- | --- | --- |
| `qualityLoops` | `plan`, `one-shot` | Outer quality cycles |
| `implementLoops` | `implement`, `one-shot` | Implement -> review -> repair cycles |
| `implementLoopsPerUnit` | `one-shot` | Per-unit implement/review/repair cycles |

These loops are explicit, inspectable, and tunable per task. Every pass writes artifacts, records which agent ran which stage, and makes the workflow's behavior visible.

### 3. Bring your own working context

Most AI tools work from whatever is already in the repo, whatever fits in the prompt, or whatever happens to be in the current chat.

Dialectic lets you attach an explicit `context` folder to a task so the workflow has reference material to reason against during planning, implementation, and review.

That context can include things like:

- design docs
- research notes
- example code
- schemas
- specifications
- contracts or policy documents
- review rubrics
- supporting project files

This matters because better workflows need better reference material.

Instead of hoping one model remembers the right details, you can point Dialectic at the exact body of material that should shape the work. That gives you control over not just which agents run and how many times they loop, but what source material they reason against.

## What A Typical Run Looks Like

One practical Dialectic workflow looks like this:

1. Attach a `context` folder with the docs, examples, schemas, specs, or other reference material that matters
2. Plan with Claude
3. Implement with Codex or OpenCode
4. Review with Gemini or another model
5. Repeat the implement -> review -> repair cycle until the result is strong enough
6. Save the scratchpad and structured per-run artifacts
7. Re-run later with different agents, loop counts, fallback rules, provider assignments, or context rules

Dialectic is not trying to replace the individual agent tools. It is the workflow layer above them.

## What Dialectic Actually Gives You

- Explicit plan, implement, review, and repair stages instead of one long prompt thread
- Multi-agent and multi-provider workflows with controlled write access
- Structured artifacts and handoffs you can inspect instead of relying on chat history alone
- Cost-aware model assignment across stages
- Independent loop counts for outer quality cycles, implement/repair cycles, and per-unit one-shot cycles
- Controlled reference context through a task-level `context` folder
- Context and fallback controls you can tune for cost, reliability, and review quality

## Who It Is For

- Developers who already use more than one coding agent or model
- Agencies and platform teams that want repeatable coding workflows instead of prompt-by-prompt improvisation
- Local-first teams that need explicit control over write access, context delivery, provider routing, and cost

## Requirements

- Windows is the primary platform today. The CLI and test workflow are exercised most heavily in Windows PowerShell.
- Node.js 20 or newer
- At least one supported AI coding CLI installed and authenticated
- A local Git repository for the project you want the agents to work on

## Install

```powershell
git clone <your-repo-url>
cd Dialectic
npm install
```

You only need to install the agent CLIs you actually want to use. Starting with one is fine, but Dialectic becomes more valuable as soon as you run different agents against each other.

## Supported Agents

Dialectic works with multiple coding-agent CLIs, and it can also route stages to OpenAI-compatible HTTP providers.

| Agent | Install / docs | Auth / setup | Dialectic override |
| --- | --- | --- | --- |
| Claude Code | [Anthropic setup docs](https://docs.anthropic.com/en/docs/claude-code/getting-started) | Run `claude`, then follow the Anthropic / Claude login flow | `DIALECTIC_CLAUDE_PATH` |
| Codex CLI | [OpenAI Codex CLI getting started](https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started) | Run `codex auth login` or sign in when prompted | `DIALECTIC_CODEX_JS` |
| Gemini CLI | [Gemini CLI quickstart](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/index.md) | Run `gemini`, then choose your Google auth flow | `DIALECTIC_GEMINI_JS` |
| Kilo Code CLI | [Kilo Code CLI](https://kilocode.ai/cli) | Run `kilo auth login` and configure the provider you want to use | `DIALECTIC_KILO_PATH` |
| Qwen Code | [Qwen Code docs](https://qwenlm.github.io/qwen-code-docs/en/users/overview/) | Run `qwen`, then complete the Qwen OAuth / account setup | `DIALECTIC_QWEN_JS` |
| OpenCode | [OpenCode docs](https://opencode.ai/docs/) | Run `opencode`, then use `/connect` or `opencode auth login` to configure a provider | `DIALECTIC_OPENCODE_PATH` |

Any OpenAI-compatible HTTP endpoint can also be registered as a provider, whether that is a local inference server, an internal deployment, or a hosted service.

HTTP providers are always **read-only** in Dialectic today. They can plan, review, and synthesize, but they cannot be the implementer.

## Quick Start

After you install at least one agent CLI, validate your setup:

```powershell
npm run cli -- doctor
```

Then generate your first task interactively:

```powershell
npm run cli -- plan
```

Typical flow:

```text
What do you want the agents to do: Plan a small calculator app
Supported agents: 1) claude, 2) codex, 3) gemini, 4) kilo, 5) qwen, 6) opencode
Enter agent names or numbers separated by commas.
Which agents should help: 1,3
Run now? [Y/n]: y
Task written. Starting run...
```

If you answer `n` to `Run now?`, Dialectic writes `shared/task.json` and prints the command to run it later.

A good first run is not “use every model.” It is:

- one strong planner
- one implementer
- one different reviewer

That is usually enough to feel why the workflow matters.

## Modes

| Mode | Flow | Primary loop setting |
| --- | --- | --- |
| `plan` | initial plan -> review(s) -> synthesis | `qualityLoops` |
| `implement` | implement -> review(s) -> repair | `implementLoops` |
| `review` | initial review -> parallel reviews -> synthesis | (single pass by design) |
| `one-shot` | plan -> per-unit implement/review -> replan | `qualityLoops` + `implementLoopsPerUnit` |

For example, one-shot with `qualityLoops = 3` becomes:

```text
plan -> implement -> review -> plan -> implement -> review -> plan -> implement
```

The important point is not just that Dialectic has different modes. It is that each mode exposes a different kind of refinement loop, and you decide how much quality pressure and token spend a task deserves.

You can also assign different agents to different seats in the workflow. In `one-shot`, for example, `settings.oneShotOrigins` lets one agent own planning, another own implementation, and another own review. A separate `roles.fallback` target can be used if a primary provider fails.

## A Practical Cost / Quality Pattern

One of the simplest useful Dialectic patterns looks like this:

- use your smartest and most expensive model to plan
- use a cheaper or free coding agent to implement
- use another model to review and challenge the result
- repeat the review/repair cycle until the task is good enough

That is the point of Dialectic's loop system.

Instead of forcing every stage through one model at one price point, you can place expensive intelligence where judgment matters most, cheaper execution where it is sufficient, and structured critique where quality needs pressure.

## Why The Loop Controls Matter

Dialectic exposes three separate loop controls because different tasks need different kinds of refinement:

| Setting | Used by | What it controls |
| --- | --- | --- |
| `qualityLoops` | `plan`, `one-shot` | outer quality cycles |
| `implementLoops` | `implement`, `one-shot` | implement -> review -> repair cycles |
| `implementLoopsPerUnit` | `one-shot` | per-unit implement/review/repair cycles |

That means you can do things like:

- loop the plan multiple times before implementation starts
- keep implementation cheap but review-heavy
- run more repair cycles only when a task is broken into units
- increase quality pressure without paying for your most expensive model at every stage

These loops are explicit and inspectable. Every pass writes artifacts, records which agent ran which stage, and leaves behind a workflow you can review and rerun later.

## Licensing

Dialectic is licensed under the Business Source License 1.1 (`BUSL-1.1`).

- Non-production use is permitted, including evaluation, development, testing, research, and personal or other non-commercial experimentation.
- Production use requires a separate commercial license.
- On `2029-04-21`, this version converts to the Apache License, Version 2.0.
- For commercial licensing, contact: https://github.com/Concrete333

See [LICENSE](./LICENSE) for the full license text and [LICENSING.md](./LICENSING.md) for plain-language examples of what counts as non-production and production use.

## Troubleshooting

- Run `npm run cli -- doctor` first. It validates the current task configuration and checks that the selected CLI agents appear usable.
- If an agent is installed but not detected, set the matching `DIALECTIC_*` override.
- To find an installed CLI path on Windows, use `where.exe claude`, `where.exe codex`, `where.exe gemini`, and so on.
- On macOS or Linux, use `which claude`, `which codex`, `which gemini`, and so on.
- Advanced or developer override: set `DIALECTIC_PROJECT_ROOT` to point the CLI at a different project root.

## Deeper Documentation

The README is intentionally the front door. For deeper configuration and runtime details, see:

- [docs/cli.md](./docs/cli.md)
- [docs/config.md](./docs/config.md)
- [docs/context.md](./docs/context.md)
- [docs/providers.md](./docs/providers.md)

## Why Not Just Use Cursor, Codex, Or Copilot Alone?

Those tools are excellent at single-agent execution. Dialectic is for workflows where a single agent's blind spots are not acceptable.

- Route plan, implement, and review to agents trained by different organizations on different data, so a single model's failure mode does not become the workflow's failure mode
- Run implement → review → repair for as many cycles as the task needs, with a different reviewer each pass
- Give the workflow an explicit body of reference material through the `context` folder instead of relying only on repo state or chat history
- Mix CLI agents and OpenAI-compatible providers in the same workflow
- Control which step can write and which steps stay read-only
- Keep workflow state in structured artifacts instead of ephemeral chat context
- Tune context delivery, fallback behavior, and loop counts per task instead of accepting one default runtime model
