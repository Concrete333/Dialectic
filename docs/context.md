# Context Guide

You can attach a context folder to a task with top-level `context.dir`:

```json
"context": {
  "dir": "./context",
  "maxFilesPerPhase": {
    "plan": 8,
    "implement": 12,
    "review": 10
  },
  "maxCharsPerPhase": {
    "plan": 20000,
    "implement": 30000,
    "review": 24000
  },
  "deliveryPolicy": {
    "planInitial": "full",
    "planReview": "digest",
    "reviewInitial": "full",
    "reviewParallel": "full",
    "reviewSynthesis": "digest",
    "implementInitial": "full",
    "implementReview": "full",
    "implementRepair": "digest"
  }
}
```

## Folder Conventions

- `shared/`: reused in every phase when budget allows
- `plan/`: planning-specific material
- `implement/`: implementation-specific material
- `review/`: review-specific material
- `examples/`: reusable examples
- `schema/`: treated like implement-phase context
- `rubric/`: treated like review-phase context

`maxFilesPerPhase` limits how many files are selected for a phase. `maxCharsPerPhase` limits the total text budget before provider-specific limits are applied.

## Delivery Policy

`context.deliveryPolicy` accepts `full`, `digest`, or `none` for these stage keys:

- `planInitial`
- `planReview`
- `reviewInitial`
- `reviewParallel`
- `reviewSynthesis`
- `implementInitial`
- `implementReview`
- `implementRepair`

Stage defaults:

| Stage key | Default |
| --- | --- |
| `planInitial` | `full` |
| `planReview` | `digest` |
| `reviewInitial` | `full` |
| `reviewParallel` | `full` |
| `reviewSynthesis` | `digest` |
| `implementInitial` | `full` |
| `implementReview` | `full` |
| `implementRepair` | `digest` |

## Key Notes

- `reviewSynthesis` governs plan-mode synthesis, review-mode synthesis, and one-shot review synthesis.
- `deliveryPolicy.default` is a starting value, not a lock.
- `reviewParallel` still defaults to `full`. If review-mode token usage is your main cost driver, `reviewParallel: "digest"` is the highest-signal override to try first.
- The digest is built mechanically from the selected files, so it stays compact without a second summarization pass.
- `maxInputChars` on a provider limits the rendered digest section, not the entire final prompt.
- Runtime `[context]` log lines report actual emitted context chars and note later-cycle downgrades such as `(cycle 2 downgrade from full)`.
- Set `LOOPI_SILENT=1` to suppress those log lines in CI or scripted runs.
- Set a stage to `none` to omit context entirely for that step.

## Tuning Workflow

1. Measure a baseline with `npm run measure:context`.
2. If review-mode cost is the main issue, try `reviewParallel: "digest"` first.
3. For broader savings, try `deliveryPolicy.default: "digest"` and then restore specific stages such as `implementInitial` or `reviewInitial` to `full`.
4. Use `none` only for stages that are safe without direct context.

If you want more control, set `context.manifest` to a JSON manifest file. Manifest entries can annotate files with `phase`, `priority`, or `purpose`, and those annotations are merged into the context index during selection.

## Prepared Context Cache

Loopi builds a **prepared context cache** inside your context directory at `.loopi-context/`. This cache normalizes and chunks source files so that:

- **PDF, DOCX, and Jupyter Notebook** files are extracted into plain text
- **Large extracted text** is split into fixed-size chunks (default 2500 chars with 200-char overlap)
- **Code and text files** (`.js`, `.ts`, `.py`, `.md`, `.txt`, etc.) pass through as plain text
- The active manifest/control file is used for overrides, but is **not** exposed as promptable context

Treat `.loopi-context/` as generated output. Do not edit it by hand.

### Prepare Once, Reuse Across Runs

Prepare the cache explicitly:

```powershell
npm run cli -- context prepare
```

That command reads the current task's `context` config, scans the context root once, writes `.loopi-context/`, and records the preparation inputs in `manifest.json`.

After that, normal runs consume the prepared cache directly instead of rebuilding it on every Loopi run.

Re-run `npm run cli -- context prepare` when you:

- add, remove, or edit files in the context root
- change `context.include` or `context.exclude`
- switch `context.manifest`
- edit manifest annotations such as `phase`, `priority`, or `purpose`

If the prepared cache is missing or no longer matches the current task's context config, Loopi stops with a clear message telling you to prepare it again.

### What the prepare step does

When `npm run cli -- context prepare` runs, it:

1. Scans the context folder for all files matching your `include` / `exclude` patterns
2. Skips `node_modules/`, `.git/`, `.loopi-context/`, and the active manifest/control file automatically
3. Normalizes each source file using the appropriate extractor
4. Chunks large normalized text into fixed-window segments
5. Writes chunk files under `.loopi-context/normalized/` with a `manifest.json`
6. On subsequent prepares, only rebuilds sources whose content or manifest metadata changed

Chunked sources are still selected through the normal phase/shared/examples flow, but Loopi also applies a small per-source chunk cap during selection so one long source cannot flood the prompt by itself.

### Supported file types

| Extension(s) | Extractor | Behavior |
| --- | --- | --- |
| `.md`, `.txt` | passthrough | Content extracted unchanged |
| `.json`, `.yaml`, `.yml`, `.sql`, `.csv` | passthrough | Content extracted unchanged |
| `.js`, `.ts`, `.py`, `.html`, `.css` | passthrough | Content extracted unchanged |
| `.ipynb` | ipynb flattener | Markdown cells as prose, code cells as fenced blocks |
| `.docx` | docx extractor | Plain text extracted from DOCX (requires `adm-zip`) |
| `.pdf` | pdf extractor | Plain text extracted from PDF (requires `pdf-parse`) |
| Other | skipped | Marked as skipped; not included in context |

If extraction fails, a dependency is missing, or a file does not produce usable text, Loopi marks that source as skipped with a clear reason in the cache manifest instead of silently injecting partial content. Those skipped-source diagnostics also flow into normal `context-selection` artifacts during a run, so unsupported or OCR-only files do not disappear without explanation.

### Cache directory structure

```
context/
  .loopi-context/
    manifest.json          # Source inventory with hashes and chunk metadata
    normalized/
      shared/
        guidelines.md__chunk-001.md
        large-doc.md__chunk-001.md
        large-doc.md__chunk-002.md
        notebook.ipynb__chunk-001.md
```

### Chunk labels in prompts

When chunks reach the prompt, they are labelled with the **original source path** plus chunk metadata, and with a section label when Loopi can infer one:

```
--- context/shared/large-doc.md [chunk 1/3] - Assessment Details ---
--- context/shared/large-doc.md [chunk 2/3] - Literature Review ---
--- context/shared/large-doc.md [chunk 3/3] - Submission Rules ---
```

Single-chunk files display without a chunk suffix, and section labels appear only when Loopi can infer a useful heading.

### Optional dependencies

PDF and DOCX extraction require optional dependencies. Install them with:

```bash
npm install pdf-parse adm-zip
```

If these packages are missing, PDF and DOCX files are marked as skipped during the prepare step. The cache still works for all other file types.

### Current non-goals

The prepared context cache is intentionally a middle ground, not a full retrieval system. Today it does **not** do any of the following:

- OCR for scanned or image-only PDFs
- PowerPoint or slide deck parsing such as `.ppt` or `.pptx`
- Semantic retrieval, embeddings, reranking, or vector search

If you need those behaviors later, they should be added explicitly as a follow-on feature rather than assumed from the current cache pipeline.

### Cache invalidation

The cache is **content-aware** during preparation: it uses SHA-256 hashes to detect source changes, and it also hashes the active manifest/control file so metadata edits invalidate affected cache reuse. Editing a source file or changing manifest annotations will rebuild the affected sources the next time you run `npm run cli -- context prepare`. Deleting `.loopi-context/` also forces a full rebuild the next time you prepare.
