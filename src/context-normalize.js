/**
 * Context Normalize Module
 * Normalizes supported source files into plain text and performs deterministic
 * fixed-window chunking.
 *
 * Chunk storage rule: the raw slice of the normalized source is written to
 * disk unchanged. Trimming or reflow would silently destroy the overlap
 * region between adjacent chunks, which defeats the purpose of overlap. We
 * only trim when deriving metadata (section labels).
 */

const fs = require('fs').promises;
const path = require('path');

// Fixed-window chunking constants.
const TARGET_CHARS_PER_CHUNK = 2500;
const CHUNK_OVERLAP_CHARS = 200;

// Maximum characters that should appear as a section label. Labels are
// metadata, so we keep them short.
const MAX_SECTION_LABEL_CHARS = 80;

// Supported file type categories. PASSTHROUGH_EXTENSIONS is also exported
// because the context index fallback path needs the same set to decide
// which files are safe to read as text when the cache is unavailable.
const PASSTHROUGH_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.sql', '.csv',
  '.js', '.ts', '.py', '.html', '.css'
]);

const EXTRACTABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.ipynb']);

/**
 * Determines the extractor type for a given file extension.
 */
function getExtractor(ext) {
  if (PASSTHROUGH_EXTENSIONS.has(ext)) return 'passthrough';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.ipynb') return 'ipynb';
  return null;
}

/**
 * Determines a short source type label for a file extension.
 */
function getSourceType(ext) {
  if (PASSTHROUGH_EXTENSIONS.has(ext)) return 'text';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.ipynb') return 'notebook';
  return 'unknown';
}

/**
 * Normalizes a Windows/Unix mixed line-ending buffer to `\n` for consistent
 * chunking downstream. Keeps the semantic content of the file identical.
 */
function normalizeLineEndings(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function readPassthrough(filePath) {
  return normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
}

async function extractPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  const text = normalizeLineEndings(data.text || '').trim();
  if (!text) {
    return {
      skipped: true,
      skipReason: 'PDF text extraction returned no text; OCR required'
    };
  }
  return text;
}

/**
 * Extracts text from a `.docx` file by reading `word/document.xml` out of the
 * zip and walking its paragraph structure. We use a paragraph split so blank
 * lines between paragraphs are preserved — a single-pass `<w:t>` sweep would
 * lose that structure.
 */
async function extractDocx(filePath) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(filePath);
  const xmlData = zip.readAsText('word/document.xml');
  if (!xmlData) {
    return {
      skipped: true,
      skipReason: 'DOCX does not contain readable word/document.xml'
    };
  }

  const paragraphBlocks = xmlData.split(/<\/w:p>/);
  const paragraphTexts = [];
  const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;

  for (const block of paragraphBlocks) {
    const parts = [];
    let match;
    wtRegex.lastIndex = 0;
    while ((match = wtRegex.exec(block)) !== null) {
      parts.push(decodeXmlEntities(match[1]));
    }
    const joined = parts.join('');
    if (joined.trim()) {
      paragraphTexts.push(joined);
    }
  }

  const result = paragraphTexts.join('\n\n').trim();
  if (!result) {
    return {
      skipped: true,
      skipReason: 'DOCX extraction produced no readable text'
    };
  }
  return result;
}

/**
 * Decodes the small set of XML entities that appear in DOCX `<w:t>` bodies.
 * Numeric references are decoded where possible; unknown entities are
 * returned verbatim so we never silently corrupt content.
 */
function decodeXmlEntities(value) {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

/**
 * Flattens a Jupyter notebook into readable text. Markdown cells are rendered
 * as prose, code cells as fenced code blocks. Cell outputs are intentionally
 * ignored in this pass.
 */
async function extractIpynb(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  let notebook;
  try {
    notebook = JSON.parse(raw);
  } catch (e) {
    return {
      skipped: true,
      skipReason: `Invalid JSON in notebook: ${e.message}`
    };
  }

  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  const sourceName = path.basename(filePath, '.ipynb');
  const header = `# Notebook: ${sourceName}`;
  const lines = [header, ''];

  let codeCellIndex = 0;
  let contentCellCount = 0;

  for (const cell of cells) {
    const cellType = cell && cell.cell_type;
    const rawSource = Array.isArray(cell && cell.source)
      ? cell.source.join('')
      : (cell && cell.source) || '';
    const source = normalizeLineEndings(rawSource);

    if (cellType === 'markdown' && source.trim()) {
      lines.push(source.trim());
      lines.push('');
      contentCellCount += 1;
    } else if (cellType === 'code' && source.trim()) {
      codeCellIndex += 1;
      lines.push(`### Code cell ${codeCellIndex}`);
      lines.push('```');
      lines.push(source.trim());
      lines.push('```');
      lines.push('');
      contentCellCount += 1;
    }
  }

  if (contentCellCount === 0) {
    return {
      skipped: true,
      skipReason: 'Notebook has no markdown or code content'
    };
  }

  return lines.join('\n').trimEnd();
}

/**
 * Extracts text content from a supported source file. Returns either a
 * string or `{skipped, skipReason}`. Any unexpected error becomes a skip
 * rather than a crash so one bad file does not abort a whole cache build.
 */
async function extractText(filePath, ext) {
  try {
    if (PASSTHROUGH_EXTENSIONS.has(ext)) return await readPassthrough(filePath);
    if (ext === '.pdf') return await extractPdf(filePath);
    if (ext === '.docx') return await extractDocx(filePath);
    if (ext === '.ipynb') return await extractIpynb(filePath);
    return { skipped: true, skipReason: `Unsupported file type: ${ext}` };
  } catch (error) {
    return { skipped: true, skipReason: `Extraction failed: ${error.message}` };
  }
}

/**
 * Lines that should never be used as a section label because they are
 * structural markers rather than prose — markdown fences, code cell headers,
 * or pure punctuation.
 */
function isUsableSectionLabelLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^-{3,}$|^={3,}$|^\*{3,}$/.test(trimmed)) return false;
  if (!/[A-Za-z0-9]/.test(trimmed)) return false;
  return true;
}

/**
 * Derives a short, human-readable label from a chunk. Prefers markdown
 * headings when one appears early in the chunk, then the first usable prose
 * line. Returns `null` if nothing suitable is found.
 */
function extractSectionLabel(text, maxLength = MAX_SECTION_LABEL_CHARS) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const lines = text.split(/\n/);
  const headingLine = lines.find((line) => /^\s{0,3}#{1,6}\s+\S/.test(line));
  const candidate = headingLine
    ? headingLine.replace(/^\s*#{1,6}\s+/, '').trim()
    : (lines.find(isUsableSectionLabelLine) || '').trim();

  if (!candidate) return null;

  if (candidate.length > maxLength) {
    return candidate.slice(0, maxLength - 3) + '...';
  }
  return candidate;
}

/**
 * Performs deterministic fixed-window chunking on normalized text.
 *
 * Guarantees:
 *   - Chunk text is stored verbatim (no trimming) so the configured overlap
 *     characters are always present in the adjacent chunk.
 *   - When the text fits in a single chunk, one chunk covering the whole
 *     string is produced.
 *   - Empty or whitespace-only text produces zero chunks. Callers decide
 *     whether that counts as "skipped".
 *   - The loop always advances by at least one character per iteration, so
 *     pathological `overlapChars >= targetChars` configurations cannot hang.
 */
function chunkText(text, targetChars = TARGET_CHARS_PER_CHUNK, overlapChars = CHUNK_OVERLAP_CHARS) {
  if (typeof text !== 'string' || text.length === 0 || !text.trim()) {
    return [];
  }

  // Small files take the fast path so callers do not have to special-case
  // single-chunk results.
  if (text.length <= targetChars) {
    return [{
      text,
      chunkOrdinal: 1,
      chunkCount: 1,
      sectionLabel: extractSectionLabel(text)
    }];
  }

  const safeTarget = Math.max(1, targetChars);
  const safeOverlap = Math.max(0, Math.min(overlapChars, safeTarget - 1));

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + safeTarget, text.length);

    // Prefer to break at a newline boundary so chunks contain whole lines
    // whenever possible. Only do this when there is a newline strictly after
    // `start` — otherwise we fall back to a hard character boundary.
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      }
    }

    const chunkContent = text.slice(start, end);
    chunks.push({
      text: chunkContent,
      chunkOrdinal: 0,
      chunkCount: 0,
      sectionLabel: extractSectionLabel(chunkContent)
    });

    if (end >= text.length) break;

    // Always advance by at least one character. `safeOverlap` is clamped so
    // nextStart is strictly greater than start even in the degenerate case.
    const nextStart = end - safeOverlap;
    start = nextStart > start ? nextStart : start + 1;
  }

  const chunkCount = chunks.length;
  for (let i = 0; i < chunkCount; i++) {
    chunks[i].chunkOrdinal = i + 1;
    chunks[i].chunkCount = chunkCount;
  }

  return chunks;
}

/**
 * Normalizes one source file into text chunks, plus the metadata the cache
 * manifest needs to decide whether to reuse an entry.
 */
async function normalizeSourceFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const extractor = getExtractor(ext);
  const sourceType = getSourceType(ext);

  if (!extractor) {
    return {
      skipped: true,
      skipReason: `Unsupported file type: ${ext}`,
      extractor: null,
      sourceType,
      chunks: []
    };
  }

  const extractResult = await extractText(filePath, ext);

  if (extractResult && typeof extractResult === 'object' && extractResult.skipped) {
    return {
      skipped: true,
      skipReason: extractResult.skipReason,
      extractor,
      sourceType,
      chunks: []
    };
  }

  const chunks = chunkText(extractResult);

  // An extractor that returned text but no chunks means the file was empty
  // or whitespace-only. Surface that as an explicit skip so the file does
  // not silently disappear from the prompt pipeline.
  if (chunks.length === 0) {
    return {
      skipped: true,
      skipReason: 'Source contains no readable text',
      extractor,
      sourceType,
      chunks: []
    };
  }

  return {
    skipped: false,
    skipReason: null,
    extractor,
    sourceType,
    chunks
  };
}

module.exports = {
  normalizeSourceFile,
  chunkText,
  extractText,
  extractSectionLabel,
  getExtractor,
  getSourceType,
  normalizeLineEndings,
  PASSTHROUGH_EXTENSIONS,
  EXTRACTABLE_EXTENSIONS,
  TARGET_CHARS_PER_CHUNK,
  CHUNK_OVERLAP_CHARS
};
