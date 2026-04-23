const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { selectContextForPhase } = require('../src/context-selection.js');

const TRUNCATION_MARKER = '\n[...truncated]';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  [FAIL] ${name}`);
    console.error(`    ${error.message}`);
    failed += 1;
  }
}

// Helper to create a mock context index
function createMockIndex(files) {
  return {
    rootDir: '/mock/context',
    files: files.map(f => ({
      ...f,
      filePath: f.filePath || `/mock/context/${f.relativePath.replace(/\//g, path.sep)}`,
      skipped: f.skipped || false,
      skipReason: f.skipReason || null
    })),
    builtAt: Date.now()
  };
}

console.log('context-selection: selectContextForPhase');

(async () => {
  await test('Phase-matched files are preferred over shared files', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/guidelines.md', phase: 'shared', content: 'Shared guidelines.', sizeBytes: 20 },
      { relativePath: 'plan/approach.md', phase: 'plan', content: 'Plan approach.', sizeBytes: 15 },
      { relativePath: 'review/criteria.md', phase: 'review', content: 'Review criteria.', sizeBytes: 16 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 5, maxChars: 1000 });

    assert.strictEqual(pack.files.length, 2);
    assert.strictEqual(pack.files[0].relativePath, 'plan/approach.md');
    assert.strictEqual(pack.selectionReasons[0].reason, 'phase match');
    assert.strictEqual(pack.selectionReasons[0].bucket, 'phase');
    assert.strictEqual(pack.files[1].relativePath, 'shared/guidelines.md');
    assert.strictEqual(pack.selectionReasons[1].reason, 'shared context');
    assert.strictEqual(pack.selectionReasons[1].bucket, 'shared');
    assert.ok(!pack.files.some(f => f.relativePath === 'review/criteria.md'));
  });

  await test('Shared files appear when no phase-specific files exist', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/guidelines.md', phase: 'shared', content: 'Shared guidelines.', sizeBytes: 20 },
      { relativePath: 'shared/api.md', phase: 'shared', content: 'API docs.', sizeBytes: 10 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 5, maxChars: 1000 });

    assert.strictEqual(pack.files.length, 2);
    assert.ok(pack.files.every(f => f.phase === 'shared'));
  });

  await test('maxFiles budget is enforced', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/file1.md', phase: 'shared', content: 'File 1.', sizeBytes: 10 },
      { relativePath: 'shared/file2.md', phase: 'shared', content: 'File 2.', sizeBytes: 10 },
      { relativePath: 'shared/file3.md', phase: 'shared', content: 'File 3.', sizeBytes: 10 },
      { relativePath: 'shared/file4.md', phase: 'shared', content: 'File 4.', sizeBytes: 10 },
      { relativePath: 'shared/file5.md', phase: 'shared', content: 'File 5.', sizeBytes: 10 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 3, maxChars: 1000 });

    assert.strictEqual(pack.files.length, 3);
  });

  await test('maxChars budget is enforced (stops adding files once limit is reached)', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/small.md', phase: 'shared', content: 'Small.', sizeBytes: 10 },
      { relativePath: 'shared/medium.md', phase: 'shared', content: 'Medium content here.', sizeBytes: 30 },
      { relativePath: 'shared/large.md', phase: 'shared', content: 'Large file with lots of content that exceeds budget.', sizeBytes: 100 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 50 });

    assert.strictEqual(pack.files.length, 2);
    assert.ok(pack.totalChars <= 50);
  });

  await test('providerMaxInputChars reduces the effective char budget', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/file1.md', phase: 'shared', content: 'File 1 content.', sizeBytes: 20 },
      { relativePath: 'shared/file2.md', phase: 'shared', content: 'File 2 content.', sizeBytes: 20 },
      { relativePath: 'shared/file3.md', phase: 'shared', content: 'File 3 content.', sizeBytes: 20 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', {
      maxFiles: 10,
      maxChars: 1000,
      providerMaxInputChars: 100
    });

    assert.strictEqual(pack.effectiveMaxChars, 60);
    assert.ok(pack.totalChars <= 60);
  });

  await test('skipped sources are surfaced as explicit diagnostics', async () => {
    const index = createMockIndex([
      {
        relativePath: 'plan/guide.md',
        phase: 'plan',
        content: 'Plan guide.',
        sizeBytes: 11
      },
      {
        relativePath: 'shared/slides.pptx',
        phase: 'shared',
        skipped: true,
        skipReason: 'Unsupported file type: .pptx'
      },
      {
        relativePath: 'shared/reader.pdf',
        phase: 'shared',
        skipped: true,
        skipReason: 'PDF text extraction returned no text; OCR required',
        sourceType: 'pdf',
        extractor: 'pdf'
      }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 5, maxChars: 1000 });

    assert.strictEqual(pack.files.length, 1);
    assert.strictEqual(pack.skippedSourceCount, 2);
    assert.deepStrictEqual(pack.skippedSources.map((entry) => entry.relativePath), [
      'shared/slides.pptx',
      'shared/reader.pdf'
    ]);
    assert.ok(pack.skippedSources.some((entry) => entry.skipReason.includes('Unsupported file type')));
    assert.ok(pack.skippedSources.some((entry) => entry.skipReason.includes('OCR required')));
  });

  await test('Files over 4000 chars are truncated with [...truncated] marker', async () => {
    const longContent = 'x'.repeat(5000);
    const index = createMockIndex([
      { relativePath: 'shared/long.md', phase: 'shared', content: longContent, sizeBytes: 5000 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 10000 });

    assert.strictEqual(pack.files.length, 1);
    assert.strictEqual(pack.files[0].truncated, true);
    assert.strictEqual(pack.files[0].content.length, 4000 + TRUNCATION_MARKER.length);
    assert.ok(pack.files[0].content.endsWith(TRUNCATION_MARKER));
  });

  await test('Budget checks use truncated excerpts instead of full file length', async () => {
    const longContent = 'x'.repeat(5000);
    const index = createMockIndex([
      { relativePath: 'shared/long.md', phase: 'shared', content: longContent, sizeBytes: 5000 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', {
      maxFiles: 10,
      maxChars: 4500
    });

    assert.strictEqual(pack.files.length, 1);
    assert.strictEqual(pack.files[0].truncated, true);
    assert.ok(pack.totalChars <= 4500);
  });

  await test('Empty index returns an empty pack without error', async () => {
    const index = { rootDir: '/mock/context', files: [], builtAt: Date.now() };

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 1000 });

    assert.strictEqual(pack.files.length, 0);
    assert.strictEqual(pack.totalChars, 0);
    assert.strictEqual(pack.skippedCount, 0);
  });

  await test('selectionReasons correctly explains each selected file', async () => {
    const index = createMockIndex([
      { relativePath: 'plan/outline.md', phase: 'plan', content: 'Plan outline.', sizeBytes: 15, priority: 2 },
      { relativePath: 'shared/guidelines.md', phase: 'shared', content: 'Guidelines.', sizeBytes: 12 },
      { relativePath: 'examples/sample.md', phase: 'examples', content: 'Example.', sizeBytes: 10 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 1000 });

    assert.strictEqual(pack.selectionReasons.length, 3);

    const planReason = pack.selectionReasons.find(r => r.relativePath === 'plan/outline.md');
    assert.ok(planReason);
    assert.strictEqual(planReason.bucket, 'phase');
    assert.ok(planReason.reason.includes('phase match'));
    assert.ok(planReason.reason.includes('priority(2)'));

    const sharedReason = pack.selectionReasons.find(r => r.relativePath === 'shared/guidelines.md');
    assert.ok(sharedReason);
    assert.strictEqual(sharedReason.bucket, 'shared');
    assert.strictEqual(sharedReason.reason, 'shared context');
  });

  await test('skippedCount tracks files dropped due to budget', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/file1.md', phase: 'shared', content: 'File 1.', sizeBytes: 10 },
      { relativePath: 'shared/file2.md', phase: 'shared', content: 'File 2.', sizeBytes: 10 },
      { relativePath: 'shared/file3.md', phase: 'shared', content: 'File 3.', sizeBytes: 10 },
      { relativePath: 'shared/file4.md', phase: 'shared', content: 'File 4.', sizeBytes: 10 },
      { relativePath: 'shared/file5.md', phase: 'shared', content: 'File 5.', sizeBytes: 10 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 2, maxChars: 1000 });

    assert.strictEqual(pack.files.length, 2);
    assert.strictEqual(pack.skippedCount, 3);
  });

  await test('Files with manifest-provided priority are ranked above unscored files', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/low-priority.md', phase: 'shared', content: 'Low.', sizeBytes: 10 },
      { relativePath: 'shared/high-priority.md', phase: 'shared', content: 'High.', sizeBytes: 10, priority: 5 },
      { relativePath: 'shared/no-priority.md', phase: 'shared', content: 'None.', sizeBytes: 10 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 1000 });

    assert.strictEqual(pack.files[0].relativePath, 'shared/high-priority.md');
    assert.strictEqual(pack.selectionReasons[0].bucket, 'shared');
    assert.ok(pack.selectionReasons[0].reason.includes('priority(5)'));
  });

  await test('When providerMaxInputChars is very small, effective budget is correctly reduced', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/file.md', phase: 'shared', content: 'x'.repeat(100), sizeBytes: 100 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', {
      maxFiles: 10,
      maxChars: 10000,
      providerMaxInputChars: 50
    });

    assert.strictEqual(pack.effectiveMaxChars, 30);
    assert.strictEqual(pack.files.length, 0);
  });

  await test('Chunked sources are capped per source for plan selection', async () => {
    const index = createMockIndex([
      { relativePath: 'plan/reader.pdf#chunk-001', displayPath: 'plan/reader.pdf', sourceRelativePath: 'plan/reader.pdf', phase: 'plan', content: 'A', sizeBytes: 1, isChunk: true, chunkOrdinal: 1, chunkCount: 4 },
      { relativePath: 'plan/reader.pdf#chunk-002', displayPath: 'plan/reader.pdf', sourceRelativePath: 'plan/reader.pdf', phase: 'plan', content: 'B', sizeBytes: 1, isChunk: true, chunkOrdinal: 2, chunkCount: 4 },
      { relativePath: 'plan/reader.pdf#chunk-003', displayPath: 'plan/reader.pdf', sourceRelativePath: 'plan/reader.pdf', phase: 'plan', content: 'C', sizeBytes: 1, isChunk: true, chunkOrdinal: 3, chunkCount: 4 },
      { relativePath: 'plan/reader.pdf#chunk-004', displayPath: 'plan/reader.pdf', sourceRelativePath: 'plan/reader.pdf', phase: 'plan', content: 'D', sizeBytes: 1, isChunk: true, chunkOrdinal: 4, chunkCount: 4 },
      { relativePath: 'shared/guide.md', phase: 'shared', content: 'Guide.', sizeBytes: 6 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 1000 });

    const readerChunks = pack.files.filter(f => f.sourceRelativePath === 'plan/reader.pdf');
    assert.strictEqual(readerChunks.length, 2);
    assert.deepStrictEqual(readerChunks.map(f => f.relativePath), [
      'plan/reader.pdf#chunk-001',
      'plan/reader.pdf#chunk-002'
    ]);
    assert.ok(pack.files.some(f => f.relativePath === 'shared/guide.md'));
  });

  await test('Chunked sources are capped per source for implement selection', async () => {
    const index = createMockIndex([
      { relativePath: 'implement/notebook.ipynb#chunk-001', displayPath: 'implement/notebook.ipynb', sourceRelativePath: 'implement/notebook.ipynb', phase: 'implement', content: 'A', sizeBytes: 1, isChunk: true, chunkOrdinal: 1, chunkCount: 5 },
      { relativePath: 'implement/notebook.ipynb#chunk-002', displayPath: 'implement/notebook.ipynb', sourceRelativePath: 'implement/notebook.ipynb', phase: 'implement', content: 'B', sizeBytes: 1, isChunk: true, chunkOrdinal: 2, chunkCount: 5 },
      { relativePath: 'implement/notebook.ipynb#chunk-003', displayPath: 'implement/notebook.ipynb', sourceRelativePath: 'implement/notebook.ipynb', phase: 'implement', content: 'C', sizeBytes: 1, isChunk: true, chunkOrdinal: 3, chunkCount: 5 },
      { relativePath: 'implement/notebook.ipynb#chunk-004', displayPath: 'implement/notebook.ipynb', sourceRelativePath: 'implement/notebook.ipynb', phase: 'implement', content: 'D', sizeBytes: 1, isChunk: true, chunkOrdinal: 4, chunkCount: 5 },
      { relativePath: 'shared/reference.md', phase: 'shared', content: 'Reference.', sizeBytes: 10 }
    ]);

    const pack = await selectContextForPhase(index, 'implement', { maxFiles: 10, maxChars: 1000 });

    const notebookChunks = pack.files.filter(f => f.sourceRelativePath === 'implement/notebook.ipynb');
    assert.strictEqual(notebookChunks.length, 3);
    assert.deepStrictEqual(notebookChunks.map(f => f.relativePath), [
      'implement/notebook.ipynb#chunk-001',
      'implement/notebook.ipynb#chunk-002',
      'implement/notebook.ipynb#chunk-003'
    ]);
    assert.ok(pack.files.some(f => f.relativePath === 'shared/reference.md'));
  });

  await test('Chunked sources are capped per source for review selection', async () => {
    const index = createMockIndex([
      { relativePath: 'review/rubric.pdf#chunk-001', displayPath: 'review/rubric.pdf', sourceRelativePath: 'review/rubric.pdf', phase: 'review', content: 'A', sizeBytes: 1, isChunk: true, chunkOrdinal: 1, chunkCount: 4 },
      { relativePath: 'review/rubric.pdf#chunk-002', displayPath: 'review/rubric.pdf', sourceRelativePath: 'review/rubric.pdf', phase: 'review', content: 'B', sizeBytes: 1, isChunk: true, chunkOrdinal: 2, chunkCount: 4 },
      { relativePath: 'review/rubric.pdf#chunk-003', displayPath: 'review/rubric.pdf', sourceRelativePath: 'review/rubric.pdf', phase: 'review', content: 'C', sizeBytes: 1, isChunk: true, chunkOrdinal: 3, chunkCount: 4 },
      { relativePath: 'shared/assignment.md', phase: 'shared', content: 'Assignment.', sizeBytes: 11 }
    ]);

    const pack = await selectContextForPhase(index, 'review', { maxFiles: 10, maxChars: 1000 });

    const rubricChunks = pack.files.filter(f => f.sourceRelativePath === 'review/rubric.pdf');
    assert.strictEqual(rubricChunks.length, 2);
    assert.deepStrictEqual(rubricChunks.map(f => f.relativePath), [
      'review/rubric.pdf#chunk-001',
      'review/rubric.pdf#chunk-002'
    ]);
    assert.ok(pack.files.some(f => f.relativePath === 'shared/assignment.md'));
  });

  await test('Chunked sources are capped per source for one-shot selection', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/brief.pdf#chunk-001', displayPath: 'shared/brief.pdf', sourceRelativePath: 'shared/brief.pdf', phase: 'shared', content: 'A', sizeBytes: 1, isChunk: true, chunkOrdinal: 1, chunkCount: 4 },
      { relativePath: 'shared/brief.pdf#chunk-002', displayPath: 'shared/brief.pdf', sourceRelativePath: 'shared/brief.pdf', phase: 'shared', content: 'B', sizeBytes: 1, isChunk: true, chunkOrdinal: 2, chunkCount: 4 },
      { relativePath: 'shared/brief.pdf#chunk-003', displayPath: 'shared/brief.pdf', sourceRelativePath: 'shared/brief.pdf', phase: 'shared', content: 'C', sizeBytes: 1, isChunk: true, chunkOrdinal: 3, chunkCount: 4 },
      { relativePath: 'examples/sample.md', phase: 'examples', content: 'Example.', sizeBytes: 8 }
    ]);

    const pack = await selectContextForPhase(index, 'one-shot', { maxFiles: 10, maxChars: 1000 });

    const briefChunks = pack.files.filter(f => f.sourceRelativePath === 'shared/brief.pdf');
    assert.strictEqual(briefChunks.length, 2);
    assert.deepStrictEqual(briefChunks.map(f => f.relativePath), [
      'shared/brief.pdf#chunk-001',
      'shared/brief.pdf#chunk-002'
    ]);
    assert.ok(pack.files.some(f => f.relativePath === 'examples/sample.md'));
  });

  await test('Priority still reorders chunked entries inside the same bucket', async () => {
    const index = createMockIndex([
      { relativePath: 'shared/low.pdf#chunk-001', displayPath: 'shared/low.pdf', sourceRelativePath: 'shared/low.pdf', phase: 'shared', content: 'Low chunk.', sizeBytes: 20, isChunk: true, chunkOrdinal: 1, chunkCount: 2, priority: 1 },
      { relativePath: 'shared/high.pdf#chunk-001', displayPath: 'shared/high.pdf', sourceRelativePath: 'shared/high.pdf', phase: 'shared', content: 'High chunk.', sizeBytes: 20, isChunk: true, chunkOrdinal: 1, chunkCount: 2, priority: 9 },
      { relativePath: 'shared/none.pdf#chunk-001', displayPath: 'shared/none.pdf', sourceRelativePath: 'shared/none.pdf', phase: 'shared', content: 'No priority chunk.', sizeBytes: 20, isChunk: true, chunkOrdinal: 1, chunkCount: 2 }
    ]);

    const pack = await selectContextForPhase(index, 'plan', { maxFiles: 10, maxChars: 1000 });

    assert.deepStrictEqual(pack.files.map(f => f.relativePath), [
      'shared/high.pdf#chunk-001',
      'shared/low.pdf#chunk-001',
      'shared/none.pdf#chunk-001'
    ]);
    assert.ok(pack.selectionReasons[0].reason.includes('priority(9)'));
    assert.ok(pack.selectionReasons[1].reason.includes('priority(1)'));
  });

  await test('Deferred cached content is loaded only for selected files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopi-select-'));

    try {
      const selectedPath = path.join(tmpDir, 'selected.md');
      fs.writeFileSync(selectedPath, 'Selected content.', 'utf-8');

      const index = createMockIndex([
        {
          relativePath: 'plan/packet.pdf#chunk-001',
          displayPath: 'plan/packet.pdf',
          sourceRelativePath: 'plan/packet.pdf',
          phase: 'plan',
          content: null,
          deferredContent: true,
          isChunk: true,
          chunkOrdinal: 1,
          chunkCount: 2,
          filePath: selectedPath,
          sizeBytes: 17
        },
        {
          relativePath: 'shared/missing.pdf#chunk-001',
          displayPath: 'shared/missing.pdf',
          sourceRelativePath: 'shared/missing.pdf',
          phase: 'shared',
          content: null,
          deferredContent: true,
          isChunk: true,
          chunkOrdinal: 1,
          chunkCount: 2,
          filePath: path.join(tmpDir, 'missing.md'),
          sizeBytes: 12
        }
      ]);

      const pack = await selectContextForPhase(index, 'plan', { maxFiles: 1, maxChars: 1000 });

      assert.strictEqual(pack.files.length, 1);
      assert.strictEqual(pack.files[0].relativePath, 'plan/packet.pdf#chunk-001');
      assert.strictEqual(pack.files[0].displayPath, 'plan/packet.pdf');
      assert.strictEqual(pack.files[0].content, 'Selected content.');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
