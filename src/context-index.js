/**
 * Context Index Module
 *
 * Separates context preparation from context consumption.
 *
 * - `prepareContextIndex(...)` builds or refreshes the prepared cache inside
 *   `.loopi-context/`.
 * - `buildContextIndex(...)` consumes an already-prepared cache and returns a
 *   `files` list suitable for phase-aware selection.
 */

const fs = require('fs').promises;
const path = require('path');
const {
  ensureContextCache,
  readPreparedContextManifest,
  CACHE_DIR_NAME,
  buildPreparedConfigMetadata,
  comparePreparedConfig
} = require('./context-cache');

async function resolveContextDir(contextConfig, taskRootDir) {
  const contextDir = path.resolve(taskRootDir, contextConfig.dir);

  try {
    const stats = await fs.stat(contextDir);
    if (!stats.isDirectory()) {
      throw new Error(`Context directory "${contextDir}" exists but is not a directory.`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Context directory "${contextDir}" does not exist.`);
    }
    throw error;
  }

  return contextDir;
}

function getPreparedCacheInstruction(contextDir, reason = null) {
  const reasonPrefix = reason ? `${reason}. ` : '';
  return `${reasonPrefix}Prepared context cache not available for "${contextDir}". Run "npm run cli -- context prepare" from the project root, then retry the run.`;
}

async function prepareContextIndex(contextConfig, taskRootDir) {
  const contextDir = await resolveContextDir(contextConfig, taskRootDir);
  const manifest = await ensureContextCache(contextConfig, taskRootDir);
  const files = await buildFilesFromCache(contextDir, manifest);

  return {
    rootDir: contextDir,
    cacheDir: path.join(contextDir, CACHE_DIR_NAME),
    builtAt: manifest.builtAt || Date.now(),
    manifest,
    files
  };
}

/**
 * Builds a context index from a previously prepared cache.
 *
 * @param {Object} contextConfig Normalized context configuration
 * @param {string} taskRootDir Root directory of the task
 * @returns {Promise<Object>} `{ rootDir, files, builtAt }`
 */
async function buildContextIndex(contextConfig, taskRootDir) {
  const contextDir = await resolveContextDir(contextConfig, taskRootDir);
  const cacheManifest = await readPreparedContextManifest(contextDir);
  if (!cacheManifest) {
    throw new Error(getPreparedCacheInstruction(contextDir));
  }

  const expectedPreparedConfig = buildPreparedConfigMetadata(contextConfig, taskRootDir, contextDir);
  const preparedConfigMismatch = comparePreparedConfig(
    cacheManifest.preparedConfig,
    expectedPreparedConfig
  );
  if (preparedConfigMismatch) {
    throw new Error(
      getPreparedCacheInstruction(
        contextDir,
        `Prepared context cache is out of date (${preparedConfigMismatch})`
      )
    );
  }

  const files = await buildFilesFromCache(contextDir, cacheManifest);
  return { rootDir: contextDir, files, builtAt: cacheManifest.builtAt || Date.now() };
}

/**
 * Builds an index entry per source chunk from the cache manifest. Skipped
 * sources are kept as explicit entries so diagnostics flow downstream.
 */
async function buildFilesFromCache(contextDir, cacheManifest) {
  const files = [];
  const cacheDir = path.join(contextDir, CACHE_DIR_NAME);

  for (const source of cacheManifest.sources) {
    if (source.skipped) {
      files.push({
        filePath: path.join(contextDir, source.sourceRelativePath),
        relativePath: source.sourceRelativePath,
        phase: source.phase || 'shared',
        sizeBytes: source.sizeBytes ?? 0,
        content: null,
        skipped: true,
        skipReason: source.skipReason || 'Skipped during cache build',
        sourceType: source.sourceType || 'unknown',
        extractor: source.extractor || null,
        priority: source.priority ?? 0,
        purpose: source.purpose ?? null
      });
      continue;
    }

    for (const output of source.outputs) {
      const chunkPath = path.join(cacheDir, output.cacheRelativePath);
      const displayPath = output.displayPath || source.sourceRelativePath;
      const relativePath = buildChunkRelativePath(displayPath, output.chunkOrdinal, output.chunkCount);
      const baseEntry = {
        filePath: chunkPath,
        relativePath,
        displayPath,
        phase: source.phase || 'shared',
        sizeBytes: output.charCount ?? 0,
        content: null,
        sourceType: source.sourceType || 'unknown',
        extractor: source.extractor || null,
        priority: source.priority ?? 0,
        purpose: source.purpose ?? null,
        sourceRelativePath: source.sourceRelativePath,
        chunkOrdinal: output.chunkOrdinal,
        chunkCount: output.chunkCount,
        sectionLabel: output.sectionLabel || null,
        isChunk: true,
        cacheRelativePath: output.cacheRelativePath
      };

      try {
        await fs.access(chunkPath);
      } catch (error) {
        files.push({
          ...baseEntry,
          skipped: true,
          skipReason: `Chunk file missing: ${error.message}`,
          deferredContent: false
        });
        continue;
      }

      files.push({
        ...baseEntry,
        skipped: false,
        skipReason: null,
        deferredContent: true
      });
    }
  }

  return files;
}

function buildChunkRelativePath(displayPath, chunkOrdinal, chunkCount) {
  if (!displayPath) {
    return `(unknown)#chunk-${String(chunkOrdinal).padStart(3, '0')}`;
  }
  if (!Number.isInteger(chunkCount) || chunkCount <= 1) {
    return displayPath;
  }
  return `${displayPath}#chunk-${String(chunkOrdinal).padStart(3, '0')}`;
}

module.exports = {
  buildContextIndex,
  prepareContextIndex,
  buildFilesFromCache
};
