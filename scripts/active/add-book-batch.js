// add-book-batch.js — QuickAdd batch import script for Obsidian
//
// Reads a CSV file with book data and imports each book using Google Books
// (with Apple Books fallback). Pre-fills format and purchase date from CSV.
//
// CSV format (first row is header):
//   Name,Type,Date
//   "Book Title",kindle,26/11/2025
//
// Usage:
//   1. Place your CSV file(s) anywhere in your vault
//   2. Run this script via QuickAdd
//   3. Select the CSV file to import from
//   4. Select the store (Amazon, Apple, Google, Physical, Other)
//   5. For each book: select from search results, confirm import
//   6. Progress is tracked per-CSV - you can resume if interrupted
//
// Progress tracking:
//   - Progress saved to: .obsidian/book-import-progress-{csvname}.json
//   - Each CSV has its own progress file
//   - To re-import books from a CSV, delete its progress file and run again
//   - The script will detect existing book notes and handle duplicates
//
// iOS compatible: uses obsidian.requestUrl() and app.vault.adapter

// ----------------------------
// Batch Import Settings
// ----------------------------
const BATCH_SETTINGS = {
  // Path to CSV file (relative to vault root)
  csvPath: "books.csv",

  // CSV column names (case-insensitive)
  columns: {
    name: "Name",
    type: "Type",
    date: "Date",
  },

  // Map CSV "Type" values to format field values
  // Keys are lowercase for matching, values are what gets stored
  typeMapping: {
    paperback: "paperback",
    hardback: "hardback",
    hardcover: "hardback",
    kindle: "kindle",
    ebook: "ebook",
    audiobook: "audiobook",
  },

  // Progress tracking file (stores which CSV rows have been processed)
  progressFile: ".obsidian/book-import-progress.json",

  // If true, shows a summary before starting
  showSummary: true,

  // If true, allows skipping books
  allowSkip: true,
};

// ----------------------------
// Book Settings (same as add-book-google-2.js)
// ----------------------------
const SETTINGS = {
  noteFolder: "books/books",
  coverFolder: "books/covers",
  apiKey: "",
  country: "AU",
  langRestrict: "en",
  maxPick: 30,
  libraryCategoryWikilink: "[[Books]]",

  multiFormat: {
    promptWhenExistingFound: true,
    bookKeyField: "bookKey",
    relatedEditionsField: "related_editions",
  },

  authorUpsert: {
    enabled: true,
    authorFolder: "People",
    categoryPeoplePath: "Categories/People.md",
    categoryAuthorsPath: "Categories/Authors.md",
    booksBaseName: "Books.base",
    booksBaseBlock: "Author",
    peopleTag: "People",
  },

  // Genre upsert behaviour
  genreUpsert: {
    enabled: true,
    folder: "Genres",
    categoryPath: "Categories/Genres.md",
    baseName: "Genre.base",
    tag: "Genres",
  },

  // Store upsert behaviour (for purchasedStore)
  storeUpsert: {
    enabled: true,
    folder: "Stores",
    categoryPath: "Categories/Stores.md",
    baseName: "Stores.base",
    tag: "Stores",
  },

  // Format upsert behaviour
  formatUpsert: {
    enabled: true,
    folder: "Formats",
    categoryPath: "Categories/Formats.md",
    baseName: "Formats.base",
    tag: "Formats",
  },

  prompts: {
    purchasedStoreOptions: ["Amazon", "Apple", "Google", "Physical", "Other"],
    formatOptions: ["paperback", "hardback", "kindle", "ebook", "audiobook", "other", ""],
    statusOptions: ["not-started", "reading", "finished", "abandoned"],
  },

  secrets: {
    enabled: true,
    file: ".obsidian/quickadd-secrets.json",
    keyName: "googleBooksApiKey",
  },

  showCoverImageInSearch: true,

  // Apple Books fallback (used when Google has no results)
  appleBooks: {
    enabled: true,
    country: "au",
    lang: "en_au",
    maxResults: 40,
  },
};

// ----------------------------
// CSV Parsing
// ----------------------------
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h.toLowerCase().trim()] = values[idx] || "";
    });
    row._lineNumber = i + 1;
    rows.push(row);
  }

  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

// Parse DD/MM/YYYY to YYYY-MM-DD
function parseDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  // Try DD/MM/YYYY or D/M/YYYY
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  return s; // Return as-is if unrecognized
}

// Map CSV type to format
function mapType(typeStr) {
  const key = String(typeStr || "").toLowerCase().trim();
  return BATCH_SETTINGS.typeMapping[key] || key || "";
}

// ----------------------------
// Progress Tracking (per-CSV)
// ----------------------------
function getProgressFilePath(csvPath) {
  // Create a unique progress file for each CSV
  const safeName = csvPath.replace(/[\/\\:*?"<>|]/g, "_").replace(/\.csv$/i, "");
  return `.obsidian/book-import-progress-${safeName}.json`;
}

async function loadProgress(app, csvPath) {
  try {
    const progressFile = getProgressFilePath(csvPath);
    const exists = await app.vault.adapter.exists(progressFile);
    if (!exists) return { processed: [], csvPath };
    const raw = await app.vault.adapter.read(progressFile);
    return JSON.parse(raw);
  } catch {
    return { processed: [], csvPath };
  }
}

async function saveProgress(app, csvPath, progress) {
  try {
    const progressFile = getProgressFilePath(csvPath);
    const folder = progressFile.split("/").slice(0, -1).join("/");
    if (folder) await app.vault.adapter.mkdir(folder).catch(() => {});
    await app.vault.adapter.write(progressFile, JSON.stringify({ ...progress, csvPath }, null, 2));
  } catch (e) {
    console.error("Failed to save progress:", e);
  }
}

async function markProcessed(app, csvPath, lineNumber) {
  const progress = await loadProgress(app, csvPath);
  if (!progress.processed.includes(lineNumber)) {
    progress.processed.push(lineNumber);
    await saveProgress(app, csvPath, progress);
  }
}

async function resetProgress(app, csvPath) {
  await saveProgress(app, csvPath, { processed: [] });
}

// ----------------------------
// Utilities (from add-book-google-2.js)
// ----------------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}
function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function normalise(s) {
  return String(s ?? "").toLowerCase().trim();
}
function safeFilename(s, maxLength = 200) {
  let result = String(s ?? "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (result.length > maxLength) {
    result = result.substring(0, maxLength).trim();
  }
  result = result.replace(/^[\s.\-]+/, "");
  return result || "Untitled";
}

function sanitizeForWikilink(name) {
  return String(name ?? "")
    .replace(/[\[\]|#^]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(s) {
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  let result = s;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, "g"), char);
  }
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  return result;
}

function stripHtml(html) {
  const s = String(html ?? "");
  let result = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p>/gi, "")
    .replace(/<\/?i>/gi, "")
    .replace(/<\/?b>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return decodeHtmlEntities(result);
}

function toWikilink(name) {
  const s = sanitizeForWikilink(name);
  if (!s) return "";
  if (s.startsWith("[[") && s.endsWith("]]")) return s;
  return `[[${s}]]`;
}

function pathToWikilink(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/").replace(/\.md$/i, "");
  if (!p) return "";
  return `[[${p}]]`;
}

function parsePublishedDate(publishedDateRaw) {
  const s = String(publishedDateRaw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

function quoteYamlString(s) {
  const v = String(s ?? "");
  const escaped = v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function yamlBlockScalar(key, text) {
  const t = String(text ?? "").trim();
  if (!t) return `${key}: ""`;
  const lines = t.split("\n").map((l) => {
    if (/^\s*---\s*$/.test(l) || /^\s*\.\.\.\s*$/.test(l)) {
      return `  \\${l.trim()}`;
    }
    return `  ${l}`;
  });
  return `${key}: |\n${lines.join("\n")}`;
}

function yamlArray(key, arr) {
  const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!a.length) return `${key}: []`;
  return `${key}:\n${a.map((x) => `  - ${quoteYamlString(x)}`).join("\n")}`;
}

function yamlMaybeString(lines, key, value) {
  const v = String(value ?? "").trim();
  if (!v) return;
  lines.push(`${key}: ${quoteYamlString(v)}`);
}

function yamlMaybeNumber(lines, key, value) {
  if (value === null || value === undefined) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return;
  lines.push(`${key}: ${n}`);
}

// ----------------------------
// HTTP & File Operations
// ----------------------------
async function httpGetBuffer(obsidian, url, timeoutMs = 30000) {
  if (!obsidian?.requestUrl) {
    throw new Error("obsidian.requestUrl is not available");
  }
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms downloading ${url}`));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      obsidian.requestUrl({
        url: String(url),
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Obsidian QuickAdd)",
          Accept: "image/*,*/*;q=0.8",
        },
      }),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} downloading ${url}`);
    }
    return response.arrayBuffer;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(jpg|jpeg|png|webp)$/i);
    if (m) return "." + m[1].toLowerCase().replace("jpeg", "jpg");
  } catch {}
  return ".jpg";
}

async function downloadCoverToVault({ app, obsidian, coverUrl, destFolder, destFilenameBase }) {
  if (!coverUrl) return { ok: false, reason: "no coverUrl", localPath: "" };
  const folder = String(destFolder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  const base = safeFilename(destFilenameBase || "cover");
  const ext = extFromUrl(coverUrl);
  let localPath = `${folder}/${base}${ext}`;
  let i = 2;
  while (await app.vault.adapter.exists(localPath)) {
    localPath = `${folder}/${base} (${i})${ext}`;
    i++;
  }
  await app.vault.adapter.mkdir(folder).catch(() => {});
  const arrayBuffer = await httpGetBuffer(obsidian, coverUrl);
  await app.vault.adapter.writeBinary(localPath, arrayBuffer);
  return { ok: true, localPath };
}

async function ensureFolder(app, folder) {
  const f = String(folder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!f) return;
  await app.vault.adapter.mkdir(f).catch(() => {});
}

async function createBookNote(app, folder, baseName, content) {
  const f = String(folder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  const base = safeFilename(baseName || "Untitled");
  let attempt = 0;
  const maxAttempts = 10;
  while (attempt < maxAttempts) {
    const suffix = attempt === 0 ? "" : ` (${attempt + 1})`;
    const p = `${f}/${base}${suffix}.md`;
    try {
      return await app.vault.create(p, content);
    } catch (e) {
      if (e.message?.includes("already exists") || e.message?.includes("File already exists")) {
        attempt++;
        continue;
      }
      throw e;
    }
  }
  throw new Error(`Could not create unique file after ${maxAttempts} attempts`);
}

// ----------------------------
// Secrets
// ----------------------------
async function loadSecrets(app) {
  if (!SETTINGS.secrets.enabled) return;
  try {
    const secretsPath = SETTINGS.secrets.file;
    const exists = await app.vault.adapter.exists(secretsPath);
    if (!exists) return;
    const raw = await app.vault.adapter.read(secretsPath);
    const json = JSON.parse(raw);
    const key = String(json?.[SETTINGS.secrets.keyName] || "").trim();
    if (key) SETTINGS.apiKey = key;
  } catch {}
}

// ----------------------------
// Google Books API (iOS compatible)
// ----------------------------
async function googleBooksSearch(obsidian, query, { apiKey, country, langRestrict }) {
  const u = new URL("https://www.googleapis.com/books/v1/volumes");
  u.searchParams.set("q", query);
  u.searchParams.set("printType", "books");
  u.searchParams.set("maxResults", "40");
  if (country) u.searchParams.set("country", country);
  if (langRestrict) u.searchParams.set("langRestrict", langRestrict);
  if (apiKey) u.searchParams.set("key", apiKey);

  if (!obsidian?.requestUrl) {
    throw new Error("obsidian.requestUrl is not available");
  }

  const response = await obsidian.requestUrl({
    url: u.toString(),
    method: "GET",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Google Books search failed: HTTP ${response.status}`);
  }

  return typeof response.json === "object" ? response.json : JSON.parse(response.text || "{}");
}

function extractISBNs(industryIdentifiers) {
  const out = { isbn10: "", isbn13: "" };
  const arr = Array.isArray(industryIdentifiers) ? industryIdentifiers : [];
  for (const item of arr) {
    const t = String(item?.type || "").trim();
    const id = String(item?.identifier || "").trim();
    if (!id) continue;
    if (t === "ISBN_10") out.isbn10 = id;
    if (t === "ISBN_13") out.isbn13 = id;
  }
  return out;
}

function bestCoverUrl(imageLinks) {
  const il = imageLinks || {};
  return String(il.thumbnail || il.smallThumbnail || "").replace("&edge=curl", "");
}

// ----------------------------
// Apple Books API (fallback, iOS compatible)
// ----------------------------
async function appleBooksSearch(obsidian, query, { country, lang, maxResults }) {
  const searchUrl =
    `https://itunes.apple.com/search?` +
    new URLSearchParams({
      term: query,
      country: country || "au",
      lang: lang || "en_au",
      media: "ebook",
      entity: "ebook",
      limit: String(maxResults || 40),
    }).toString();

  if (!obsidian?.requestUrl) {
    throw new Error("obsidian.requestUrl is not available");
  }

  const response = await obsidian.requestUrl({
    url: searchUrl,
    method: "GET",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Apple Books search failed: HTTP ${response.status}`);
  }

  return typeof response.json === "object" ? response.json : JSON.parse(response.text || "{}");
}

function scoreAppleResult(r, queryNorm) {
  const rawTitle = String(r.trackName || "").replace(/\s+/g, " ").trim();
  const rawAuthor = String(r.artistName || "").replace(/\s+/g, " ").trim();
  const title = rawTitle.toLowerCase();
  const author = rawAuthor.toLowerCase();

  let score = 0;

  if (title === queryNorm) score += 1000;
  else if (title.startsWith(queryNorm)) score += 600;
  else if (title.includes(queryNorm)) score += 200;

  for (const token of queryNorm.split(" ").filter(Boolean)) {
    if (title.includes(token)) score += 25;
    if (author.includes(token)) score += 10;
  }

  const badPatterns = [/\bsummary\b/i, /\bstudy\s*guide\b/i, /\banalysis\b/i, /\bkey\s*takeaways\b/i, /\bworkbook\b/i];
  for (const rx of badPatterns) {
    if (rx.test(rawTitle)) score -= 2000;
  }

  const price = Number(r.price);
  if (Number.isFinite(price)) {
    if (price >= 12) score += 60;
    if (price >= 18) score += 40;
    if (price > 0 && price <= 6) score -= 120;
  }

  return { score, rawTitle, rawAuthor };
}

function mapAppleResultToBook(r) {
  const title = String(r.trackName || "").replace(/\s+/g, " ").trim();
  const authorStr = String(r.artistName || "").replace(/\s+/g, " ").trim();

  const authors = authorStr
    ? authorStr.split(/\s+&\s+|\s+and\s+/i).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)
    : [];

  const genres = Array.isArray(r.genres)
    ? r.genres.map((g) => String(g).trim()).filter(Boolean)
    : [];

  let coverUrl = r.artworkUrl600 || r.artworkUrl512 || r.artworkUrl100 || r.artworkUrl60 || "";
  coverUrl = coverUrl.replace(/\/\d+x\d+bb\./i, "/600x600bb.");

  let publishDate = "";
  if (r.releaseDate) {
    const d = new Date(r.releaseDate);
    if (!isNaN(d.getTime())) {
      publishDate = d.toISOString().slice(0, 10);
    }
  }

  return {
    volumeId: "",
    appleTrackId: r.trackId ? String(r.trackId) : "",
    title,
    subtitle: "",
    authors,
    publisher: "",
    publishDate,
    totalPage: 0,
    categories: genres,
    genres,
    description: stripHtml(r.description || ""),
    link: String(r.trackViewUrl || "").trim(),
    previewLink: "",
    coverUrl,
    isbn13: "",
    isbn10: "",
    language: "",
    source: "apple-books",
  };
}

function tokenise(q) {
  return normalise(q)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function scoreItem(queryTokens, vol) {
  const title = normalise(vol.title);
  const subtitle = normalise(vol.subtitle);
  const authors = normalise((vol.authors || []).join(" "));
  const lang = normalise(vol.language || "");
  const categories = normalise((vol.categories || []).join(" "));
  const publisher = normalise(vol.publisher || "");
  let score = 0;
  if (lang === "en") score += 10;
  for (const t of queryTokens) {
    if (title.includes(t)) score += 8;
    else if (subtitle.includes(t)) score += 4;
    else if (authors.includes(t)) score += 4;
    else if (publisher.includes(t)) score += 2;
    else if (categories.includes(t)) score += 1;
  }
  const junk = ["summary", "workbook", "analysis", "study guide", "key takeaways"];
  if (junk.some((j) => title.includes(j))) score -= 8;
  const pc = Number(vol.pageCount || 0);
  if (Number.isFinite(pc) && pc > 0) score += 2;
  return score;
}

// ----------------------------
// Multi-format helpers
// ----------------------------
function computeBookKey(meta) {
  const title = normalise(meta?.title || "");
  const firstAuthor = normalise((meta?.authors && meta.authors[0]) || "");
  return [title, firstAuthor].filter(Boolean).join("|");
}

function getFrontmatter(app, file) {
  const cache = app?.metadataCache?.getFileCache(file);
  return cache?.frontmatter || null;
}

function isInBooksFolder(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/");
  const prefix = SETTINGS.noteFolder.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return p.startsWith(prefix);
}

function stripWikilinkValue(v) {
  return String(v || "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("#")[0]
    .trim();
}

function findExistingBookNote(app, meta) {
  const keyField = SETTINGS.multiFormat.bookKeyField;
  const wantedKey = computeBookKey(meta);
  const candidates = [];

  for (const f of app.vault.getFiles()) {
    if (!f || f.extension !== "md") continue;
    if (!isInBooksFolder(f.path)) continue;
    const fm = getFrontmatter(app, f);
    if (!fm) continue;

    let score = 0;
    const volId = String(fm.google_volume_id || "").trim();
    const isbn13 = String(fm.isbn13 || "").trim();
    const storedKey = String(fm[keyField] || "").trim();

    // Strong ID matches (definitive)
    if (meta?.volumeId && volId && volId === meta.volumeId) score = Math.max(score, 100);
    if (meta?.isbn13 && isbn13 && isbn13 === meta.isbn13) score = Math.max(score, 90);
    
    // Apple Track ID match
    const appleId = String(fm.appleTrackId || "").trim();
    if (meta?.appleTrackId && appleId && appleId === meta.appleTrackId) score = Math.max(score, 100);
    
    if (wantedKey && storedKey && storedKey === wantedKey) score = Math.max(score, 80);

    // Title + Author match (both required for a valid match)
    const fmTitle = normalise(fm.title || "");
    const metaTitle = normalise(meta.title || "");
    const fmAuthorRaw = Array.isArray(fm.author) ? fm.author[0] : fm.author;
    const fmAuthorName = normalise(stripWikilinkValue(fmAuthorRaw));
    const metaFirstAuthor = normalise((meta.authors && meta.authors[0]) || "");

    const titleMatches = fmTitle && metaTitle && fmTitle === metaTitle;
    const authorMatches = fmAuthorName && metaFirstAuthor && fmAuthorName.includes(metaFirstAuthor);

    // Only count as match if BOTH title and author match (score 70)
    // Title alone or author alone is NOT enough - different books by same author should not match
    if (titleMatches && authorMatches) {
      score = Math.max(score, 70);
    }

    // Minimum threshold: only consider scores >= 70 (requires title+author or strong ID)
    if (score >= 70) candidates.push({ file: f, score, fm });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function normaliseFormatField(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  const s = String(v || "").trim();
  return s ? [s] : [];
}

function dedupePreserveOrder(list) {
  const out = [];
  const seen = new Set();
  for (const x of list || []) {
    const k = String(x || "").trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function formatAlreadyOwned(existingFormats, newFormat) {
  const normNew = normalise(newFormat || "");
  if (!normNew) return false;
  return existingFormats.some((f) => normalise(f) === normNew);
}

async function addPurchaseToExistingNote({ app, bookFile, meta, prompts, localCoverImage }) {
  const keyField = SETTINGS.multiFormat.bookKeyField;
  await app.fileManager.processFrontMatter(bookFile, (fm) => {
    const key = computeBookKey(meta);
    if (key) fm[keyField] = key;

    // Update purchase fields (overwrites previous values for same-format re-purchase)
    fm.purchasedStore = prompts.purchasedStore ?? "";
    fm.purchasedDate = prompts.purchasedDate ?? "";
    fm.format = prompts.format ?? "";

    // Only set cover if note doesn't already have one
    if (localCoverImage && !String(fm.localCoverImage || "").trim()) {
      fm.localCoverImage = localCoverImage;
    }

    // Keep IDs if missing
    if (!String(fm.google_volume_id || "").trim() && meta.volumeId) fm.google_volume_id = meta.volumeId;
    if (!String(fm.isbn13 || "").trim() && meta.isbn13) fm.isbn13 = meta.isbn13;
    if (!String(fm.isbn10 || "").trim() && meta.isbn10) fm.isbn10 = meta.isbn10;

    // Only set rating if missing and provided now
    if ((fm.rating === "" || fm.rating === null || fm.rating === undefined) && prompts.rating !== "" && prompts.rating !== null) {
      const n = Number(prompts.rating);
      if (Number.isFinite(n)) fm.rating = n;
    }
  });
}

async function linkEditions({ app, aFile, bFile }) {
  const relField = SETTINGS.multiFormat.relatedEditionsField;
  const aLink = pathToWikilink(aFile.path);
  const bLink = pathToWikilink(bFile.path);
  const addLink = async (file, linkToAdd) => {
    await app.fileManager.processFrontMatter(file, (fm) => {
      const existing = fm[relField];
      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
      fm[relField] = dedupePreserveOrder([...list, linkToAdd]).filter(Boolean);
    });
  };
  await addLink(aFile, bLink);
  await addLink(bFile, aLink);
}

// ----------------------------
// Book Picker Modal
// ----------------------------
function createBookSuggestModal(obsidian, app, showCoverImageInSearch, suggestion) {
  const SuggestModal = obsidian?.SuggestModal;
  if (!SuggestModal) throw new Error("Obsidian SuggestModal is not available in this context.");

  return class BookSuggestModal extends SuggestModal {
    constructor() {
      super(app);
      this.showCoverImageInSearch = showCoverImageInSearch;
      this.suggestion = suggestion;
      this.setPlaceholder("Search by title, author, or publisher");
      this.emptyStateText = "No matches";
      this.limit = 200;
      this.onChoose = null;
    }
    getItemText(book) {
      return String(book?.title || "");
    }
    getSuggestions(query) {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return this.suggestion;
      return this.suggestion.filter((book) => {
        const title = String(book.title || "").toLowerCase();
        const author = String((book.authors || []).join(", ") || "").toLowerCase();
        const publisher = String(book.publisher || "").toLowerCase();
        return title.includes(q) || author.includes(q) || publisher.includes(q);
      });
    }
    renderSuggestion(book, el) {
      el.addClass("book-suggestion-item");
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.gap = "12px";
      el.style.padding = "8px 10px";
      const coverImageUrl = book.coverUrl || "";
      if (this.showCoverImageInSearch && coverImageUrl) {
        const img = el.createEl("img", {
          cls: "book-cover-image",
          attr: { src: coverImageUrl, alt: `Cover Image for ${book.title || "book"}` },
        });
        img.style.pointerEvents = "none";
        img.style.width = "44px";
        img.style.height = "66px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "4px";
        img.style.flex = "0 0 auto";
      }
      const textContainer = el.createEl("div", { cls: "book-text-info" });
      textContainer.style.display = "flex";
      textContainer.style.flexDirection = "column";
      textContainer.style.minWidth = "0";
      const titleEl = textContainer.createEl("div", { text: book.title || "" });
      titleEl.style.fontWeight = "600";
      const publisher = book.publisher ? `, ${book.publisher}` : "";
      const publishDate = book.publishDate ? `(${parsePublishedDate(book.publishDate)})` : "";
      const totalPage = book.totalPage ? `, p${book.totalPage}` : "";
      const subtitle = `${(book.authors || []).join(", ") || "Unknown author"}${publisher}${publishDate}${totalPage}`;
      const small = textContainer.createEl("small", { text: subtitle });
      small.style.opacity = "0.8";
      el.addEventListener("click", () => {
        this.onChooseSuggestion(book);
      });
    }
    onChooseSuggestion(book) {
      if (typeof this.onChoose === "function") this.onChoose(book);
      this.close();
    }
  };
}

async function pickBookWithModal({ app, obsidian, books }) {
  return await new Promise((resolve) => {
    const ModalClass = createBookSuggestModal(obsidian, app, SETTINGS.showCoverImageInSearch, books);
    const modal = new ModalClass();
    let chosen = false;
    modal.onChoose = (book) => {
      chosen = true;
      resolve(book || null);
    };
    modal.onClose = () => {
      if (!chosen) resolve(null);
    };
    modal.open();
  });
}

// ----------------------------
// Front Matter Builder
// ----------------------------
function buildFrontMatter(meta, prompts, extra = {}) {
  const lines = [];
  lines.push("---");
  lines.push(yamlArray("categories", [SETTINGS.libraryCategoryWikilink]));
  lines.push(`created: ${localISODate()}`);
  lines.push(`title: ${quoteYamlString(meta.title || "")}`);
  if (meta.subtitle) lines.push(`subtitle: ${quoteYamlString(meta.subtitle)}`);
  const authorLinks = (meta.authorLinks || meta.authors || []).map(toWikilink).filter(Boolean);
  lines.push(yamlArray("author", authorLinks));
  if (Array.isArray(meta.genres) && meta.genres.length) lines.push(yamlArray("genre", meta.genres));
  yamlMaybeString(lines, "publisher", meta.publisher);
  const pub = parsePublishedDate(meta.publishDate);
  if (pub) lines.push(`publishDate: ${quoteYamlString(pub)}`);
  yamlMaybeNumber(lines, "totalPage", meta.totalPage);
  yamlMaybeString(lines, "isbn13", meta.isbn13);
  yamlMaybeString(lines, "isbn10", meta.isbn10);
  yamlMaybeString(lines, "localCoverImage", meta.localCoverImage);
  if (extra.bookKey) lines.push(`${SETTINGS.multiFormat.bookKeyField}: ${quoteYamlString(extra.bookKey)}`);
  lines.push(`purchasedStore: ${quoteYamlString(prompts.purchasedStore || "")}`);
  lines.push(`purchasedDate: ${quoteYamlString(prompts.purchasedDate || "")}`);
  lines.push(`format: ${quoteYamlString(prompts.format || "")}`);
  lines.push(`readingStatus: ${quoteYamlString(prompts.readingStatus || "")}`);
  lines.push(`readingStarted: ${quoteYamlString(prompts.readingStarted || "")}`);
  lines.push(`readingDone: ${quoteYamlString(prompts.readingDone || "")}`);
  if (prompts.rating === "" || prompts.rating === null || prompts.rating === undefined) {
    lines.push(`rating: ""`);
  } else {
    const n = Number(prompts.rating);
    lines.push(`rating: ${Number.isFinite(n) ? n : 0}`);
  }
  // Note: purchases array removed - each format gets its own note now
  // Purchase info is stored in purchasedStore, purchasedDate, and format fields
  if (Array.isArray(extra.relatedEditions) && extra.relatedEditions.length) {
    lines.push(yamlArray(SETTINGS.multiFormat.relatedEditionsField, extra.relatedEditions));
  }
  lines.push(`via: ${quoteYamlString(meta.link || "")}`);
  lines.push(`source: ${quoteYamlString(meta.source || "google-books")}`);

  // Source-specific IDs
  if (meta.source === "apple-books") {
    lines.push(`appleTrackId: ${quoteYamlString(meta.appleTrackId || "")}`);
  } else {
    lines.push(`google_volume_id: ${quoteYamlString(meta.volumeId || "")}`);
  }

  lines.push(yamlBlockScalar("description", meta.description || ""));
  lines.push(yamlBlockScalar("ai_summary", ""));
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

// ----------------------------
// Author Upsert
// ----------------------------
function stripWikilink(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("#")[0]
    .trim();
}

function normaliseToList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    if (s.includes("\n")) return s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (s.includes(";")) return s.split(";").map((x) => x.trim()).filter(Boolean);
    if (s.includes(" & ")) return s.split(" & ").map((x) => x.trim()).filter(Boolean);
    if (s.includes(" and ")) return s.split(" and ").map((x) => x.trim()).filter(Boolean);
    if (/,\s*/.test(s)) {
      const parts = s.split(/,\s*(?=[^\s,]+\s+[^\s,]+)/).map((x) => x.trim()).filter(Boolean);
      if (parts.length > 1) return parts;
    }
    return [s];
  }
  return [];
}

function findFileByName(app, fileName) {
  return app.vault.getFiles().find((f) => f.name === fileName) || null;
}

function findExistingNoteByTitle(app, activeFile, title) {
  return app.metadataCache.getFirstLinkpathDest(title, activeFile?.path || "") || null;
}

async function ensureNote(app, obsidian, notePath, content) {
  const norm = obsidian?.normalizePath ? obsidian.normalizePath(notePath) : notePath.replace(/\\/g, "/");
  const af = app.vault.getAbstractFileByPath(norm);
  if (af) return af;
  const folder = norm.split("/").slice(0, -1).join("/");
  if (folder) await app.vault.adapter.mkdir(folder).catch(() => {});
  return await app.vault.create(norm, content);
}

async function createAuthorNote(app, obsidian, authorTitle) {
  const cfg = SETTINGS.authorUpsert;
  const AUTHOR_FOLDER = cfg.authorFolder;
  const CATEGORY_PEOPLE_PATH = cfg.categoryPeoplePath;
  const CATEGORY_AUTHORS_PATH = cfg.categoryAuthorsPath;
  const categoryPeopleLink = `[[${CATEGORY_PEOPLE_PATH.replace(/\.md$/, "")}]]`;
  const typeAuthorsLink = `[[${CATEGORY_AUTHORS_PATH.replace(/\.md$/, "")}]]`;
  const booksBaseFile = findFileByName(app, cfg.booksBaseName);
  const authorFilePath = obsidian?.normalizePath
    ? obsidian.normalizePath(`${AUTHOR_FOLDER}/${authorTitle}.md`)
    : `${AUTHOR_FOLDER}/${authorTitle}.md`;
  const existing = app.vault.getAbstractFileByPath(authorFilePath);
  if (existing) return existing;
  const booksSection = booksBaseFile ? `\n## Books\n\n![[${booksBaseFile.path}#${cfg.booksBaseBlock}]]\n` : "";
  const content =
    `---
categories:
  - "${categoryPeopleLink}"
type:
  - "${typeAuthorsLink}"
tags:
  - ${cfg.peopleTag}
created: ${localISODate()}
---
${booksSection}`.trim() + "\n";
  return await app.vault.create(authorFilePath, content);
}

async function upsertAndLinkAuthorsForBook({ app, obsidian, bookFile, authorNames }) {
  const cfg = SETTINGS.authorUpsert;
  if (!cfg.enabled) return;
  await ensureNote(app, obsidian, cfg.categoryPeoplePath, `---\ntags:\n  - categories\n---\n\n![[People.base]]\n`);
  await ensureNote(app, obsidian, cfg.categoryAuthorsPath, `---\ntags:\n  - categories\n---\n`);
  const names = normaliseToList(authorNames).map(stripWikilink).filter(Boolean);
  if (!names.length) return;
  const links = [];
  for (const name of names) {
    const existing = findExistingNoteByTitle(app, bookFile, name);
    if (existing) {
      links.push(`[[${existing.basename}]]`);
      continue;
    }
    const created = await createAuthorNote(app, obsidian, name);
    links.push(`[[${created.basename}]]`);
  }
  const seen = new Set();
  const unique = links.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  await app.fileManager.processFrontMatter(bookFile, (frontmatter) => {
    frontmatter.author = unique;
    delete frontmatter.authors;
  });
}

// ----------------------------
// Genre upsert + linking
// ----------------------------
async function createGenreNote(app, obsidian, genreName) {
  const cfg = SETTINGS.genreUpsert;
  const categoryLink = `[[${cfg.categoryPath.replace(/\.md$/, "")}]]`;

  // Sanitize for both wikilink and filename safety
  const safeName = safeFilename(sanitizeForWikilink(genreName));
  if (!safeName) return null;

  const filePath = obsidian?.normalizePath
    ? obsidian.normalizePath(`${cfg.folder}/${safeName}.md`)
    : `${cfg.folder}/${safeName}.md`;

  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing) return existing;

  await app.vault.adapter.mkdir(cfg.folder).catch(() => {});

  const content = `---
categories:
  - "${categoryLink}"
tags:
  - ${cfg.tag}
created: ${localISODate()}
---

## Books

![[${cfg.baseName}]]
`;

  return await app.vault.create(filePath, content);
}

async function upsertAndLinkGenresForBook({ app, obsidian, bookFile, genres }) {
  const cfg = SETTINGS.genreUpsert;
  if (!cfg.enabled) return [];

  await ensureNote(
    app,
    obsidian,
    cfg.categoryPath,
    `---
tags:
  - categories
---

![[${cfg.baseName}]]
`
  );

  const genreList = Array.isArray(genres) ? genres : genres ? [genres] : [];
  const cleaned = genreList.map((g) => String(g || "").trim()).filter(Boolean);
  if (!cleaned.length) return [];

  const links = [];
  for (const name of cleaned) {
    const existing = findExistingNoteByTitle(app, bookFile, name);
    if (existing) {
      links.push(`[[${existing.basename}]]`);
      continue;
    }
    const created = await createGenreNote(app, obsidian, name);
    if (created) {
      links.push(`[[${created.basename}]]`);
    }
  }

  if (!links.length) return [];

  const seen = new Set();
  const unique = links.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));

  await app.fileManager.processFrontMatter(bookFile, (frontmatter) => {
    frontmatter.genre = unique;
  });

  return unique;
}

// ----------------------------
// Store upsert + linking (for purchasedStore)
// ----------------------------
async function createStoreNote(app, obsidian, storeName) {
  const cfg = SETTINGS.storeUpsert;
  const categoryLink = `[[${cfg.categoryPath.replace(/\.md$/, "")}]]`;

  // Sanitize for both wikilink and filename safety
  const safeName = safeFilename(sanitizeForWikilink(storeName));
  if (!safeName) return null;

  const filePath = obsidian?.normalizePath
    ? obsidian.normalizePath(`${cfg.folder}/${safeName}.md`)
    : `${cfg.folder}/${safeName}.md`;

  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing) return existing;

  await app.vault.adapter.mkdir(cfg.folder).catch(() => {});

  const content = `---
categories:
  - "${categoryLink}"
tags:
  - ${cfg.tag}
created: ${localISODate()}
---

## Books

![[${cfg.baseName}]]
`;

  return await app.vault.create(filePath, content);
}

async function upsertAndLinkStoreForBook({ app, obsidian, bookFile, storeName }) {
  const cfg = SETTINGS.storeUpsert;
  if (!cfg.enabled) return "";

  const name = String(storeName || "").trim();
  if (!name) return "";

  await ensureNote(
    app,
    obsidian,
    cfg.categoryPath,
    `---
tags:
  - categories
---

![[${cfg.baseName}]]
`
  );

  let link;
  const existing = findExistingNoteByTitle(app, bookFile, name);
  if (existing) {
    link = `[[${existing.basename}]]`;
  } else {
    const created = await createStoreNote(app, obsidian, name);
    if (!created) return "";
    link = `[[${created.basename}]]`;
  }

  await app.fileManager.processFrontMatter(bookFile, (frontmatter) => {
    frontmatter.purchasedStore = link;
  });

  return link;
}

// ----------------------------
// Format upsert + linking
// ----------------------------
async function createFormatNote(app, obsidian, formatName) {
  const cfg = SETTINGS.formatUpsert;
  const categoryLink = `[[${cfg.categoryPath.replace(/\.md$/, "")}]]`;

  // Sanitize for both wikilink and filename safety
  const safeName = safeFilename(sanitizeForWikilink(formatName));
  if (!safeName) return null;

  const filePath = obsidian?.normalizePath
    ? obsidian.normalizePath(`${cfg.folder}/${safeName}.md`)
    : `${cfg.folder}/${safeName}.md`;

  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing) return existing;

  await app.vault.adapter.mkdir(cfg.folder).catch(() => {});

  const content = `---
categories:
  - "${categoryLink}"
tags:
  - ${cfg.tag}
created: ${localISODate()}
---

## Books

![[${cfg.baseName}]]
`;

  return await app.vault.create(filePath, content);
}

async function upsertAndLinkFormatForBook({ app, obsidian, bookFile, formatName }) {
  const cfg = SETTINGS.formatUpsert;
  if (!cfg.enabled) return "";

  const name = String(formatName || "").trim();
  if (!name) return "";

  await ensureNote(
    app,
    obsidian,
    cfg.categoryPath,
    `---
tags:
  - categories
---

![[${cfg.baseName}]]
`
  );

  let link;
  const existing = findExistingNoteByTitle(app, bookFile, name);
  if (existing) {
    link = `[[${existing.basename}]]`;
  } else {
    const created = await createFormatNote(app, obsidian, name);
    if (!created) return "";
    link = `[[${created.basename}]]`;
  }

  await app.fileManager.processFrontMatter(bookFile, (frontmatter) => {
    frontmatter.format = link;
  });

  return link;
}

// ----------------------------
// Main Batch Import
// ----------------------------
module.exports = async (params) => {
  const app = params?.app;
  const qa = params?.quickAddApi;
  const obsidian = params?.obsidian;

  if (!app || !qa) {
    throw new Error("QuickAdd context missing: expected params.app and params.quickAddApi.");
  }

  await loadSecrets(app);
  await ensureFolder(app, SETTINGS.noteFolder);
  await ensureFolder(app, SETTINGS.coverFolder);

  const Notice = obsidian?.Notice || globalThis.Notice;

  // Find all CSV files in the vault
  const allFiles = app.vault.getFiles();
  const csvFiles = allFiles.filter((f) => f.extension?.toLowerCase() === "csv");

  if (csvFiles.length === 0) {
    if (Notice) new Notice("No CSV files found in vault.");
    return;
  }

  // Sort by path for easier browsing
  csvFiles.sort((a, b) => a.path.localeCompare(b.path));

  // Let user pick a CSV file
  const selectedCsv = await qa.suggester(
    csvFiles.map((f) => f.path),
    csvFiles
  );

  if (!selectedCsv) {
    if (Notice) new Notice("No CSV file selected.");
    return;
  }

  const csvPath = selectedCsv.path;
  if (Notice) new Notice(`Loading: ${csvPath}`);

  const csvText = await app.vault.adapter.read(csvPath);
  const { rows } = parseCSV(csvText);

  if (rows.length === 0) {
    if (Notice) new Notice("CSV file is empty or has no data rows.");
    return;
  }

  // Load progress (per-CSV)
  const progress = await loadProgress(app, csvPath);
  const remaining = rows.filter((r) => !progress.processed.includes(r._lineNumber));

  if (remaining.length === 0) {
    const reset = await qa.yesNoPrompt(
      "All books processed",
      `All ${rows.length} books from "${csvPath}" have been imported. Reset progress to start over?`
    );
    if (reset) {
      await resetProgress(app, csvPath);
      if (Notice) new Notice("Progress reset. Run the script again to start over.");
    }
    return;
  }

  // Show summary
  if (BATCH_SETTINGS.showSummary) {
    const proceed = await qa.yesNoPrompt(
      "Batch Import",
      `Found ${rows.length} books in CSV.\n${remaining.length} remaining to import.\n\nContinue?`
    );
    if (!proceed) return;
  }

  // Ask which store these books are from (applies to all books in this batch)
  const selectedStore = await qa.suggester(
    SETTINGS.prompts.purchasedStoreOptions,
    SETTINGS.prompts.purchasedStoreOptions
  );

  if (!selectedStore) {
    if (Notice) new Notice("No store selected. Import cancelled.");
    return;
  }

  if (Notice) new Notice(`Importing from: ${selectedStore}`);

  // Track skipped books for summary
  const skippedBooks = [];

  // Process each remaining book
  for (let idx = 0; idx < remaining.length; idx++) {
    const row = remaining[idx];
    const nameCol = BATCH_SETTINGS.columns.name.toLowerCase();
    const typeCol = BATCH_SETTINGS.columns.type.toLowerCase();
    const dateCol = BATCH_SETTINGS.columns.date.toLowerCase();

    const bookName = String(row[nameCol] || "").trim();
    const bookType = mapType(row[typeCol]);
    const bookDate = parseDate(row[dateCol]);

    if (!bookName) {
      await markProcessed(app, csvPath, row._lineNumber);
      continue;
    }

    // Show current book
    const progressText = `[${idx + 1}/${remaining.length}]`;
    if (Notice) new Notice(`${progressText} Searching: ${bookName}`);

    // Allow skip
    if (BATCH_SETTINGS.allowSkip) {
      const action = await qa.suggester(
        [`Import: ${bookName}`, "Skip this book", "Stop importing"],
        ["import", "skip", "stop"]
      );
      if (action === "stop") {
        if (Notice) new Notice("Batch import stopped. Progress saved.");
        break; // Break to show summary before exiting
      }
      if (action === "skip") {
        skippedBooks.push({ name: bookName, reason: "User skipped" });
        await markProcessed(app, csvPath, row._lineNumber);
        continue;
      }
    }

    // Search Google Books
    const queryTokens = tokenise(bookName);
    let data;
    try {
      data = await googleBooksSearch(obsidian, bookName, {
        apiKey: SETTINGS.apiKey,
        country: SETTINGS.country,
        langRestrict: SETTINGS.langRestrict,
      });
    } catch (e) {
      if (Notice) new Notice(`Search failed for "${bookName}": ${e.message}`);
      continue;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    
    let mapped = [];
    let picked = null;
    let bookSource = "google-books";

    if (items.length) {
      // Map and score Google results
      mapped = items
        .map((it) => {
          const vi = it?.volumeInfo || {};
          const isbns = extractISBNs(vi.industryIdentifiers);
          const authors = Array.isArray(vi.authors) ? vi.authors : [];
          const categories = Array.isArray(vi.categories) ? vi.categories : [];
          const coverUrl = bestCoverUrl(vi.imageLinks);
          const v = {
            volumeId: String(it.id || "").trim(),
            title: String(vi.title || "").trim(),
            subtitle: String(vi.subtitle || "").trim(),
            authors,
            publisher: String(vi.publisher || "").trim(),
            publishDate: String(vi.publishedDate || "").trim(),
            totalPage: vi.pageCount ?? 0,
            categories,
            genres: categories.map((c) => String(c).trim()).filter(Boolean),
            description: stripHtml(vi.description || ""),
            link: String(vi.canonicalVolumeLink || vi.infoLink || "").trim(),
            previewLink: String(vi.previewLink || "").trim(),
            coverUrl,
            ...isbns,
            language: String(vi.language || "").trim(),
            source: "google-books",
          };
          return { score: scoreItem(queryTokens, v), v };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, SETTINGS.maxPick)
        .map((x) => x.v);

      // Pick book from Google results
      picked = await pickBookWithModal({ app, obsidian, books: mapped });
    }

    // If no Google results or user cancelled, offer Apple Books fallback
    if (!picked && SETTINGS.appleBooks.enabled) {
      const noResults = !items.length;
      const message = noResults
        ? `No Google Books results for "${bookName}". Try Apple Books?`
        : `No book selected for "${bookName}". Try Apple Books?`;

      const tryApple = await qa.yesNoPrompt("Try Apple Books?", message);

      if (tryApple) {
        if (Notice) new Notice("Searching Apple Books...");

        try {
          const appleData = await appleBooksSearch(obsidian, bookName, {
            country: SETTINGS.appleBooks.country,
            lang: SETTINGS.appleBooks.lang,
            maxResults: SETTINGS.appleBooks.maxResults,
          });

          const appleResults = Array.isArray(appleData?.results) ? appleData.results : [];

          if (appleResults.length) {
            const qNorm = bookName.toLowerCase().trim();
            const appleRanked = appleResults
              .map((r) => ({ r, ...scoreAppleResult(r, qNorm) }))
              .sort((a, b) => b.score - a.score)
              .slice(0, SETTINGS.maxPick);

            const appleBooks = appleRanked.map((x) => mapAppleResultToBook(x.r));

            picked = await pickBookWithModal({ app, obsidian, books: appleBooks });
            if (picked) {
              bookSource = "apple-books";
            }
          } else {
            if (Notice) new Notice("No Apple Books results either.");
          }
        } catch (e) {
          if (Notice) new Notice(`Apple Books search failed: ${e.message}`);
        }
      }
    }

    // If still no pick, handle skip/stop
    if (!picked) {
      const action = await qa.suggester(["Skip this book", "Stop importing"], ["skip", "stop"]);
      if (action === "stop") break;
      skippedBooks.push({ name: bookName, reason: "No suitable match found" });
      await markProcessed(app, csvPath, row._lineNumber);
      continue;
    }

    // Pre-filled values from CSV
    const format = bookType;
    const purchasedDate = bookDate;

    // Build initial meta (without cover - we'll add it later if needed)
    const metaForCheck = {
      volumeId: picked.volumeId || "",
      appleTrackId: picked.appleTrackId || "",
      title: picked.title,
      authors: picked.authors,
      isbn13: picked.isbn13 || "",
      isbn10: picked.isbn10 || "",
      source: bookSource,
    };

    // CHECK FOR EXISTING NOTE FIRST (before downloading cover or prompts)
    const existing = findExistingBookNote(app, metaForCheck);

    if (existing && existing.file) {
      const existingFormats = normaliseFormatField(existing.fm?.format);
      const alreadyOwnsFormat = formatAlreadyOwned(existingFormats, format);

      // Same format = likely duplicate in CSV, ask user
      if (alreadyOwnsFormat) {
        const options = [
          `Add another ${format || "purchase"} to existing note (⚠️ already own this format)`,
          "Create a new note anyway (linked to existing)",
          "Cancel - skip this duplicate",
        ];
        const values = ["add", "new-linked", "cancel"];
        const mode = (await qa.suggester(options, values)) || "cancel";

        if (mode === "cancel") {
          await markProcessed(app, csvPath, row._lineNumber);
          continue; // Skip - no cover downloaded, no orphaned files
        }

        if (mode === "add") {
          // Adding to existing note - still need some prompts
          const purchasedStore = selectedStore; // From store selection at start
          const readingStatus = "not-started"; // Default for bulk import

          // Skip reading dates and rating if not started
          let readingStarted = "";
          let readingDone = "";
          let rating = "";

          if (readingStatus !== "not-started") {
            readingStarted = ((await qa.inputPrompt("Reading started", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
            readingDone = ((await qa.inputPrompt("Reading done", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
            const ratingRaw = ((await qa.inputPrompt("Rating", "0-10 (leave blank if none)")) || "").trim();
            rating = ratingRaw === "" ? "" : Number(ratingRaw);
          }

          const prompts = {
            purchasedStore: purchasedStore ?? "",
            purchasedDate: purchasedDate ?? "",
            format: format ?? "",
            readingStatus: readingStatus ?? "",
            readingStarted: readingStarted ?? "",
            readingDone: readingDone ?? "",
            rating,
          };

          // Download cover only if existing note doesn't have one
          let localCoverImage = "";
          if (picked.coverUrl && !String(existing.fm?.localCoverImage || "").trim()) {
            try {
              const coverBaseName = safeFilename(`${picked.title} - ${picked.authors?.[0] || "cover"}`);
              const cover = await downloadCoverToVault({
                app, obsidian, coverUrl: picked.coverUrl,
                destFolder: SETTINGS.coverFolder, destFilenameBase: coverBaseName,
              });
              if (cover.ok) localCoverImage = cover.localPath;
            } catch {}
          }

          const meta = { ...metaForCheck, localCoverImage, genres: picked.genres };
          await addPurchaseToExistingNote({ app, bookFile: existing.file, meta, prompts, localCoverImage });
          await upsertAndLinkAuthorsForBook({ app, obsidian, bookFile: existing.file, authorNames: picked.authors });
          await upsertAndLinkGenresForBook({ app, obsidian, bookFile: existing.file, genres: picked.genres });
          await upsertAndLinkStoreForBook({ app, obsidian, bookFile: existing.file, storeName: prompts.purchasedStore });
          await upsertAndLinkFormatForBook({ app, obsidian, bookFile: existing.file, formatName: prompts.format });
          if (Notice) new Notice(`Updated: ${picked.title} (added ${format})`);
          await markProcessed(app, csvPath, row._lineNumber);
          continue;
        }
        // mode === "new-linked" falls through to create new note below
      } else {
        // Different format - automatically create linked note
        if (Notice) new Notice(`Found existing note. Creating linked ${format || "format"} edition.`);
      }
    }

    // At this point: either no existing note, or creating a new linked note
    // Now get remaining prompts and download cover

    const purchasedStore = selectedStore; // From store selection at start
    const readingStatus = "not-started"; // Default for bulk import

    // Skip reading dates and rating if not started
    let readingStarted = "";
    let readingDone = "";
    let rating = "";

    if (readingStatus !== "not-started") {
      readingStarted = ((await qa.inputPrompt("Reading started", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
      readingDone = ((await qa.inputPrompt("Reading done", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
      const ratingRaw = ((await qa.inputPrompt("Rating", "0-10 (leave blank if none)")) || "").trim();
      rating = ratingRaw === "" ? "" : Number(ratingRaw);
    }

    // Custom filename if no author
    let customFilenameSuffix = "";
    if (!picked.authors || picked.authors.length === 0) {
      const defaultName = safeFilename(picked.title) || "Untitled book";
      customFilenameSuffix = (
        (await qa.inputPrompt(
          "No author found - customize filename?",
          `Default: "${defaultName}" (add editor, translator, or leave blank)`
        )) || ""
      ).trim();
    }

    // NOW download cover (after we know we're creating a note)
    let localCoverImage = "";
    if (picked.coverUrl) {
      try {
        let coverBaseName;
        if (customFilenameSuffix) {
          coverBaseName = safeFilename(`${picked.title} - ${customFilenameSuffix}`);
        } else if (picked.authors?.[0]) {
          coverBaseName = safeFilename(`${picked.title} - ${picked.authors[0]}`);
        } else {
          coverBaseName = safeFilename(picked.title) || "cover";
        }
        const cover = await downloadCoverToVault({
          app,
          obsidian,
          coverUrl: picked.coverUrl,
          destFolder: SETTINGS.coverFolder,
          destFilenameBase: coverBaseName,
        });
        if (cover.ok) localCoverImage = cover.localPath;
      } catch {
        if (Notice) new Notice("Cover download failed. Continuing without cover.");
      }
    }

    const meta = {
      volumeId: picked.volumeId || "",
      appleTrackId: picked.appleTrackId || "",
      title: picked.title,
      subtitle: picked.subtitle,
      authors: picked.authors,
      genres: picked.genres,
      publisher: picked.publisher,
      publishDate: picked.publishDate,
      totalPage: picked.totalPage,
      isbn13: picked.isbn13 || "",
      isbn10: picked.isbn10 || "",
      localCoverImage,
      link: picked.link || picked.previewLink || "",
      description: picked.description,
      customFilenameSuffix,
      source: bookSource,
    };

    const prompts = {
      purchasedStore: purchasedStore ?? "",
      purchasedDate: purchasedDate ?? "",
      format: format ?? "",
      readingStatus: readingStatus ?? "",
      readingStarted: readingStarted ?? "",
      readingDone: readingDone ?? "",
      rating,
    };

    // If we get here with an existing note, we're creating a linked edition
    // (same-format duplicates were already handled above before cover download)
    if (existing && existing.file) {
      const firstAuthor = meta.authors && meta.authors[0] ? meta.authors[0] : "";
      let baseFileName;
      if (meta.customFilenameSuffix) {
        baseFileName = safeFilename(`${meta.title} - ${meta.customFilenameSuffix}${prompts.format ? ` (${prompts.format})` : ""}`);
      } else if (firstAuthor) {
        baseFileName = safeFilename(`${meta.title} - ${firstAuthor}${prompts.format ? ` (${prompts.format})` : ""}`);
      } else {
        baseFileName = safeFilename(`${meta.title}${prompts.format ? ` (${prompts.format})` : ""}`) || "Untitled book";
      }
      const bookKey = computeBookKey(meta);
      const relatedEditions = [pathToWikilink(existing.file.path)].filter(Boolean);
      const content = buildFrontMatter(meta, prompts, { bookKey, relatedEditions });
      const bookFile = await createBookNote(app, SETTINGS.noteFolder, baseFileName, content);
      await upsertAndLinkAuthorsForBook({ app, obsidian, bookFile, authorNames: meta.authors });
      await upsertAndLinkGenresForBook({ app, obsidian, bookFile, genres: meta.genres });
      await upsertAndLinkStoreForBook({ app, obsidian, bookFile, storeName: prompts.purchasedStore });
      await upsertAndLinkFormatForBook({ app, obsidian, bookFile, formatName: prompts.format });
      await linkEditions({ app, aFile: existing.file, bFile: bookFile });
      if (Notice) new Notice(`Created: ${meta.title} (${prompts.format})`);
      await markProcessed(app, csvPath, row._lineNumber);
      continue;
    }

    // No existing note: create new
    const firstAuthor = meta.authors && meta.authors[0] ? meta.authors[0] : "";
    let baseFileName;
    if (meta.customFilenameSuffix) {
      baseFileName = safeFilename(`${meta.title} - ${meta.customFilenameSuffix}`);
    } else if (firstAuthor) {
      baseFileName = safeFilename(`${meta.title} - ${firstAuthor}`);
    } else {
      baseFileName = safeFilename(meta.title) || "Untitled book";
    }
    const bookKey = computeBookKey(meta);
    const content = buildFrontMatter(meta, prompts, { bookKey });
    const bookFile = await createBookNote(app, SETTINGS.noteFolder, baseFileName, content);
    await upsertAndLinkAuthorsForBook({ app, obsidian, bookFile, authorNames: meta.authors });
    await upsertAndLinkGenresForBook({ app, obsidian, bookFile, genres: meta.genres });
    await upsertAndLinkStoreForBook({ app, obsidian, bookFile, storeName: prompts.purchasedStore });
    await upsertAndLinkFormatForBook({ app, obsidian, bookFile, formatName: prompts.format });
    if (Notice) new Notice(`Created: ${meta.title}`);
    await markProcessed(app, csvPath, row._lineNumber);
  }

  // Show summary
  if (skippedBooks.length > 0) {
    // Save skipped books to a file for reference
    const skippedPath = ".obsidian/book-import-skipped.md";
    const skippedContent = [
      "# Skipped Books",
      "",
      `Import date: ${new Date().toISOString().split("T")[0]}`,
      "",
      "| Book | Reason |",
      "|------|--------|",
      ...skippedBooks.map((b) => `| ${b.name} | ${b.reason} |`),
      "",
    ].join("\n");
    await app.vault.adapter.write(skippedPath, skippedContent);

    if (Notice) new Notice(`Import complete! ${skippedBooks.length} book(s) skipped. See .obsidian/book-import-skipped.md`);
  } else {
    if (Notice) new Notice("Batch import complete!");
  }
};

