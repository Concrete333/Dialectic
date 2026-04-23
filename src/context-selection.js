/**
 * Context Selection Module
 *
 * Takes a context index and produces a curated, bounded context pack for a
 * specific phase. Chunk-aware: it caps how many chunks from the same source
 * file can land in one prompt so a single long document cannot crowd out
 * everything else.
 *
 * Selection is async because cache-backed chunk entries store their content
 * on disk and only get read when the selector decides to keep them. Doing
 * that read asynchronously avoids blocking the event loop inside the
 * orchestrator's hot path.
 */

const fs = require('fs').promises;

// Maximum characters to include per file before truncation.
const MAX_CHARS_PER_FILE = 4000;
const TRUNCATION_MARKER = '\n[...truncated]';

// Hard per-source chunk caps by phase. Stops one very long source from
// eating the whole prompt budget.
const MAX_CHUNKS_PER_SOURCE_BY_PHASE = Object.freeze({
  plan: 2,
  implement: 3,
  review: 2,
  'one-shot': 2
});
const DEFAULT_MAX_CHUNKS_PER_SOURCE = 2;

function getMaxChunksPerSource(phase) {
  return MAX_CHUNKS_PER_SOURCE_BY_PHASE[phase] ?? DEFAULT_MAX_CHUNKS_PER_SOURCE;
}

function getSourceKey(file) {
  return file.sourceRelativePath || file.displayPath || file.relativePath || '(unknown)';
}

function getDisplayPath(file) {
  return file.displayPath || file.sourceRelativePath || file.relativePath || '(unknown)';
}

/**
 * Collects one diagnostic per distinct skipped source so downstream artifacts
 * can report which prepared files dropped out of the pack (and why) without
 * duplicating an entry per missing chunk.
 */
function collectSkippedSourceDiagnostics(files) {
  if (!Array.isArray(files) || files.length === 0) return [];

  const diagnostics = [];
  const seen = new Set();

  for (const file of files) {
    if (!file || !file.skipped) continue;

    const sourceKey = getSourceKey(file);
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);

    diagnostics.push({
      relativePath: file.sourceRelativePath || file.displayPath || file.relativePath || '(unknown)',
      displayPath: getDisplayPath(file),
      phase: file.phase || 'shared',
      skipReason: file.skipReason || 'Skipped',
      sourceType: file.sourceType || null,
      extractor: file.extractor || null
    });
  }

  return diagnostics;
}

/**
 * Resolves the content for one index entry. Cache-backed chunks carry
 * `deferredContent: true` and are read from disk lazily. On read failure the
 * entry is marked skipped in place so the caller can surface a diagnostic.
 *
 * Returns the content string, or `null` when the entry cannot contribute.
 */
async function resolveFileContent(file) {
  if (!file || file.skipped) return null;

  if (typeof file.content === 'string') return file.content;

  if (!file.deferredContent) return null;

  try {
    const loaded = await fs.readFile(file.filePath, 'utf-8');
    file.content = loaded;
    file.deferredContent = false;
    return loaded;
  } catch (error) {
    file.skipped = true;
    file.skipReason = `Failed to read deferred content: ${error.message}`;
    file.deferredContent = false;
    return null;
  }
}

/**
 * Selects context files for a specific phase based on bucket ordering and
 * budget constraints.
 *
 * @param {Object} contextIndex The context index from `buildContextIndex`.
 * @param {string} phase One of `plan`, `implement`, `review`, `one-shot`.
 * @param {Object} [options] Selection options.
 * @returns {Promise<Object>} Context pack with selected files and metadata.
 */
async function selectContextForPhase(contextIndex, phase, options = {}) {
  const {
    maxFiles = 10,
    maxChars = 24000,
    providerMaxInputChars = null,
    steeringHint = null
  } = options;

  if (!contextIndex || !Array.isArray(contextIndex.files) || contextIndex.files.length === 0) {
    return emptyPack(phase, steeringHint);
  }

  const availableFiles = contextIndex.files.filter((f) => !f.skipped);

  if (availableFiles.length === 0) {
    const skippedSources = collectSkippedSourceDiagnostics(contextIndex.files);
    return {
      phase,
      files: [],
      totalChars: 0,
      skippedCount: contextIndex.files.length,
      skippedSourceCount: skippedSources.length,
      skippedSources,
      selectionReasons: [],
      appliedSteeringHint: steeringHint || null
    };
  }

  // If a provider's max input is known, reserve roughly 60% of it for context.
  const effectiveMaxChars = providerMaxInputChars
    ? Math.min(maxChars, Math.floor(providerMaxInputChars * 0.6))
    : maxChars;

  const orderedFiles = orderFilesByBucket(availableFiles, phase);

  const selectedFiles = [];
  const selectionReasons = [];
  const selectedChunksPerSource = new Map();
  const maxChunksPerSource = getMaxChunksPerSource(phase);
  let totalChars = 0;

  for (const file of orderedFiles) {
    if (selectedFiles.length >= maxFiles) break;

    const sourceKey = getSourceKey(file);
    const selectedFromSource = selectedChunksPerSource.get(sourceKey) ?? 0;
    if (file.isChunk && selectedFromSource >= maxChunksPerSource) continue;

    const fileContent = await resolveFileContent(file);
    if (typeof fileContent !== 'string') continue;

    const truncation = applyTruncation(fileContent);
    if (totalChars + truncation.content.length > effectiveMaxChars) continue;

    selectedFiles.push(buildSelectedEntry(file, truncation));
    if (file.isChunk) {
      selectedChunksPerSource.set(sourceKey, selectedFromSource + 1);
    }
    selectionReasons.push(buildSelectionReason(file, phase));
    totalChars += truncation.content.length;
  }

  const skippedCount = orderedFiles.length - selectedFiles.length;
  const skippedSources = collectSkippedSourceDiagnostics(contextIndex.files);

  return {
    phase,
    files: selectedFiles,
    totalChars,
    skippedCount,
    skippedSourceCount: skippedSources.length,
    skippedSources,
    selectionReasons,
    effectiveMaxChars,
    appliedSteeringHint: steeringHint || null
  };
}

function emptyPack(phase, steeringHint) {
  return {
    phase,
    files: [],
    totalChars: 0,
    skippedCount: 0,
    skippedSourceCount: 0,
    skippedSources: [],
    selectionReasons: [],
    appliedSteeringHint: steeringHint || null
  };
}

function orderFilesByBucket(files, phase) {
  const exactPhaseMatch = [];
  const shared = [];
  const examples = [];

  for (const file of files) {
    if (file.phase === phase) {
      exactPhaseMatch.push(file);
    } else if (file.phase === 'shared') {
      shared.push(file);
    } else if (file.phase === 'examples') {
      examples.push(file);
    }
  }

  return [
    ...sortBucket(exactPhaseMatch),
    ...sortBucket(shared),
    ...sortBucket(examples)
  ];
}

function sortBucket(files) {
  return files.slice().sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first.
    }
    return (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0); // Smaller files first.
  });
}

function applyTruncation(content) {
  if (content.length <= MAX_CHARS_PER_FILE) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(0, MAX_CHARS_PER_FILE) + TRUNCATION_MARKER,
    truncated: true
  };
}

function buildSelectedEntry(file, truncation) {
  const entry = {
    relativePath: file.relativePath,
    displayPath: getDisplayPath(file),
    phase: file.phase,
    content: truncation.content,
    truncated: truncation.truncated,
    sizeBytes: file.sizeBytes,
    priority: file.priority ?? 0,
    purpose: file.purpose ?? null
  };

  if (file.isChunk) {
    entry.isChunk = true;
    entry.sourceRelativePath = file.sourceRelativePath || file.relativePath;
    entry.chunkOrdinal = file.chunkOrdinal;
    entry.chunkCount = file.chunkCount;
    entry.sectionLabel = file.sectionLabel ?? null;
    entry.sourceType = file.sourceType ?? null;
    entry.extractor = file.extractor ?? null;
  }

  return entry;
}

function buildSelectionReason(file, phase) {
  let bucket = '';
  let reason = '';

  if (file.phase === phase) {
    bucket = 'phase';
    reason = 'phase match';
  } else if (file.phase === 'shared') {
    bucket = 'shared';
    reason = 'shared context';
  } else if (file.phase === 'examples') {
    bucket = 'examples';
    reason = 'example';
  }

  const priority = file.priority ?? 0;
  if (priority !== 0) {
    reason += ` + priority(${priority})`;
  }

  const entry = {
    relativePath: file.relativePath,
    displayPath: getDisplayPath(file),
    bucket,
    reason
  };

  if (file.isChunk) {
    entry.sourceRelativePath = file.sourceRelativePath || file.relativePath;
    entry.chunkOrdinal = file.chunkOrdinal;
    entry.chunkCount = file.chunkCount;
  }

  return entry;
}

module.exports = {
  selectContextForPhase,
  collectSkippedSourceDiagnostics
};
