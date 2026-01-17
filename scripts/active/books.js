// books.js — Unified QuickAdd script for Obsidian
//
// Manages book notes from various sources:
//   - Manual: Search Google Books (with Apple Books fallback)
//   - CSV Import: Batch import from CSV file
//   - Future: Goodreads API, Kindle highlights extension
//
// Creates book notes with full metadata, downloads covers,
// and creates/links Author, Genre, Store, and Format notes.
//
// iOS compatible: uses app.vault.adapter and obsidian.requestUrl
//
// ============================================================================
// Utilities copied from lib/quickadd-core.js:
//   - String: pad2, localISODate, safeFilename, sanitizeForWikilink, normalise,
//             decodeHtmlEntities, toWikilink, stripWikilink
//   - YAML: quoteYamlString, yamlBlockScalar, yamlArray
//   - File: ensureFolder, ensureNote, findFileByName, findExistingNoteByTitle
//   - HTTP: httpGetBuffer, downloadImage, extFromUrl
//   - Secrets: loadSecrets
//   - Visual Picker: createVisualPickerModal, pickWithVisualModal
//   - Search: stringSimilarity, searchByTitle (as searchBooks)
// ============================================================================

// ============================================================================
// SETTINGS
// ============================================================================
const SETTINGS = {
  // Script paths
  syncTrackerPath: "scripts/active/sync-tracker.js",

  // Where to create book notes
  noteFolder: "books/books",

  // Where to save covers
  coverFolder: "books/covers",

  // Google Books
  apiKey: "", // loaded from secrets
  country: "AU",
  langRestrict: "en",

  // Picker size
  maxPick: 30,

  // Library category front matter
  libraryCategoryWikilink: "[[Books]]",

  // Multi-format / duplicate handling
  multiFormat: {
    promptWhenExistingFound: true,
    bookKeyField: "bookKey",
    relatedEditionsField: "related_editions",
  },

  // Author upsert behaviour
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

  // Prompts
  prompts: {
    purchasedStoreOptions: ["Amazon", "Apple", "Google", "Physical", "Other"],
    formatOptions: ["paperback", "hardback", "kindle", "ebook", "audiobook", "other", ""],
    statusOptions: ["not-started", "reading", "finished", "abandoned"],
  },

  // Secrets file
  secrets: {
    enabled: true,
    file: ".obsidian/quickadd-secrets.json",
    keyName: "googleBooksApiKey",
  },

  // Cover thumbnails in search modal
  showCoverImageInSearch: true,

  // Apple Books fallback
  appleBooks: {
    enabled: true,
    country: "au",
    lang: "en_au",
    maxResults: 40,
  },

  // CSV batch import
  csvProgressFile: ".obsidian/book-import-progress.json",
};

// ============================================================================
// STRING UTILITIES
// ============================================================================
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
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
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

// ============================================================================
// YAML UTILITIES
// ============================================================================
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

// ============================================================================
// FILE OPERATIONS
// ============================================================================
async function ensureFolder(app, folder) {
  const f = String(folder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!f) return;
  await app.vault.adapter.mkdir(f).catch(() => {});
}

async function ensureNote(app, obsidian, notePath, content) {
  const norm = obsidian?.normalizePath ? obsidian.normalizePath(notePath) : notePath.replace(/\\/g, "/");
  const af = app.vault.getAbstractFileByPath(norm);
  if (af) return af;
  const folder = norm.split("/").slice(0, -1).join("/");
  if (folder) await app.vault.adapter.mkdir(folder).catch(() => {});
  return await app.vault.create(norm, content);
}

function findFileByName(app, fileName) {
  return app.vault.getFiles().find((f) => f.name === fileName) || null;
}

function findExistingNoteByTitle(app, activeFile, title) {
  return app.metadataCache.getFirstLinkpathDest(title, activeFile?.path || "") || null;
}

function getFrontmatter(app, file) {
  const cache = app?.metadataCache?.getFileCache(file);
  return cache?.frontmatter || null;
}

// ============================================================================
// SECRETS LOADING
// ============================================================================
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

// ============================================================================
// HTTP / IMAGE DOWNLOAD
// ============================================================================
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

// ============================================================================
// GOOGLE BOOKS API
// ============================================================================
async function googleBooksSearch(obsidian, query, { apiKey, country, langRestrict }) {
  const u = new URL("https://www.googleapis.com/books/v1/volumes");
  u.searchParams.set("q", query);
  u.searchParams.set("printType", "books");
  u.searchParams.set("maxResults", "40");
  if (country) u.searchParams.set("country", country);
  if (langRestrict) u.searchParams.set("langRestrict", langRestrict);
  if (apiKey) u.searchParams.set("key", apiKey);

  const response = await obsidian.requestUrl({ url: u.toString(), method: "GET" });
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

function tokenise(q) {
  return normalise(q).split(/[^a-z0-9]+/g).map((t) => t.trim()).filter(Boolean);
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

// ============================================================================
// APPLE BOOKS API
// ============================================================================
async function appleBooksSearch(obsidian, query, { country, lang, maxResults }) {
  const searchUrl = `https://itunes.apple.com/search?` +
    new URLSearchParams({
      term: query,
      country: country || "au",
      lang: lang || "en_au",
      media: "ebook",
      entity: "ebook",
      limit: String(maxResults || 40),
    }).toString();

  const response = await obsidian.requestUrl({ url: searchUrl, method: "GET" });
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
  const authors = authorStr ? authorStr.split(/\s+&\s+|\s+and\s+/i).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
  const genres = Array.isArray(r.genres) ? r.genres.map((g) => String(g).trim()).filter(Boolean) : [];
  let coverUrl = r.artworkUrl600 || r.artworkUrl512 || r.artworkUrl100 || r.artworkUrl60 || "";
  coverUrl = coverUrl.replace(/\/\d+x\d+bb\./i, "/600x600bb.");
  let publishDate = "";
  if (r.releaseDate) {
    const d = new Date(r.releaseDate);
    if (!isNaN(d.getTime())) publishDate = d.toISOString().slice(0, 10);
  }
  return {
    volumeId: "",
    appleTrackId: r.trackId ? String(r.trackId) : "",
    title, subtitle: "", authors, publisher: "", publishDate,
    totalPage: 0, categories: genres, genres,
    description: stripHtml(r.description || ""),
    link: String(r.trackViewUrl || "").trim(),
    previewLink: "", coverUrl, isbn13: "", isbn10: "", language: "",
    source: "apple-books",
  };
}

// ============================================================================
// BOOK KEY / DUPLICATE DETECTION
// ============================================================================
function computeBookKey(meta) {
  const title = normalise(meta?.title || "");
  const firstAuthor = normalise((meta?.authors && meta.authors[0]) || "");
  return [title, firstAuthor].filter(Boolean).join("|");
}

function stripWikilinkValue(v) {
  return String(v || "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].split("#")[0].trim();
}

function isInBooksFolder(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/");
  const prefix = SETTINGS.noteFolder.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return p.startsWith(prefix);
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

    if (meta?.volumeId && volId && volId === meta.volumeId) score = Math.max(score, 100);
    if (meta?.isbn13 && isbn13 && isbn13 === meta.isbn13) score = Math.max(score, 90);
    const appleId = String(fm.appleTrackId || "").trim();
    if (meta?.appleTrackId && appleId && appleId === meta.appleTrackId) score = Math.max(score, 100);
    if (wantedKey && storedKey && storedKey === wantedKey) score = Math.max(score, 80);

    const fmTitle = normalise(fm.title || "");
    const metaTitle = normalise(meta.title || "");
    const fmAuthorRaw = Array.isArray(fm.author) ? fm.author[0] : fm.author;
    const fmAuthorName = normalise(stripWikilinkValue(fmAuthorRaw));
    const metaFirstAuthor = normalise((meta.authors && meta.authors[0]) || "");

    const titleMatches = fmTitle && metaTitle && fmTitle === metaTitle;
    const authorMatches = fmAuthorName && metaFirstAuthor && fmAuthorName.includes(metaFirstAuthor);
    if (titleMatches && authorMatches) score = Math.max(score, 70);
    if (score >= 70) candidates.push({ file: f, score, fm });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

// ============================================================================
// ENTITY UPSERTS
// ============================================================================
async function createAuthorNote(app, obsidian, authorTitle) {
  const cfg = SETTINGS.authorUpsert;
  const categoryPeopleLink = `[[${cfg.categoryPeoplePath.replace(/\.md$/, "")}]]`;
  const typeAuthorsLink = `[[${cfg.categoryAuthorsPath.replace(/\.md$/, "")}]]`;
  const booksBaseFile = findFileByName(app, cfg.booksBaseName);
  const authorFilePath = obsidian?.normalizePath
    ? obsidian.normalizePath(`${cfg.authorFolder}/${authorTitle}.md`)
    : `${cfg.authorFolder}/${authorTitle}.md`;
  const existing = app.vault.getAbstractFileByPath(authorFilePath);
  if (existing) return existing;
  const booksSection = booksBaseFile ? `\n## Books\n\n![[${booksBaseFile.path}#${cfg.booksBaseBlock}]]\n` : "";
  const content = `---
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
  const names = (Array.isArray(authorNames) ? authorNames : authorNames ? [authorNames] : [])
    .map((n) => stripWikilinkValue(n)).filter(Boolean);
  if (!names.length) return;
  const links = [];
  for (const name of names) {
    const existing = findExistingNoteByTitle(app, bookFile, name);
    if (existing) { links.push(`[[${existing.basename}]]`); continue; }
    const created = await createAuthorNote(app, obsidian, name);
    links.push(`[[${created.basename}]]`);
  }
  const seen = new Set();
  const unique = links.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  await app.fileManager.processFrontMatter(bookFile, (fm) => {
    fm.author = unique;
    delete fm.authors;
  });
}

async function createEntityNote(app, obsidian, cfg, entityName) {
  const categoryLink = `[[${cfg.categoryPath.replace(/\.md$/, "")}]]`;
  const safeName = safeFilename(sanitizeForWikilink(entityName));
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

async function upsertAndLinkEntity({ app, obsidian, bookFile, entityName, cfg, fieldName }) {
  if (!cfg.enabled) return "";
  const name = String(entityName || "").trim();
  if (!name) return "";
  await ensureNote(app, obsidian, cfg.categoryPath, `---\ntags:\n  - categories\n---\n\n![[${cfg.baseName}]]\n`);
  let link;
  const existing = findExistingNoteByTitle(app, bookFile, name);
  if (existing) {
    link = `[[${existing.basename}]]`;
  } else {
    const created = await createEntityNote(app, obsidian, cfg, name);
    if (!created) return "";
    link = `[[${created.basename}]]`;
  }
  await app.fileManager.processFrontMatter(bookFile, (fm) => { fm[fieldName] = link; });
  return link;
}

async function upsertAndLinkGenresForBook({ app, obsidian, bookFile, genres }) {
  const cfg = SETTINGS.genreUpsert;
  if (!cfg.enabled) return [];
  await ensureNote(app, obsidian, cfg.categoryPath, `---\ntags:\n  - categories\n---\n\n![[${cfg.baseName}]]\n`);
  const genreList = Array.isArray(genres) ? genres : genres ? [genres] : [];
  const cleaned = genreList.map((g) => String(g || "").trim()).filter(Boolean);
  if (!cleaned.length) return [];
  const links = [];
  for (const name of cleaned) {
    const existing = findExistingNoteByTitle(app, bookFile, name);
    if (existing) { links.push(`[[${existing.basename}]]`); continue; }
    const created = await createEntityNote(app, obsidian, cfg, name);
    if (created) links.push(`[[${created.basename}]]`);
  }
  if (!links.length) return [];
  const seen = new Set();
  const unique = links.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
  await app.fileManager.processFrontMatter(bookFile, (fm) => { fm.genre = unique; });
  return unique;
}

// ============================================================================
// BUILD FRONTMATTER
// ============================================================================
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
  if (Array.isArray(extra.relatedEditions) && extra.relatedEditions.length) {
    lines.push(yamlArray(SETTINGS.multiFormat.relatedEditionsField, extra.relatedEditions));
  }
  lines.push(`via: ${quoteYamlString(meta.link || "")}`);
  lines.push(`source: ${quoteYamlString(meta.source || "google-books")}`);
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

// ============================================================================
// VISUAL PICKER MODAL
// ============================================================================
function createBookSuggestModal(obsidian, app, books) {
  const SuggestModal = obsidian?.SuggestModal;
  if (!SuggestModal) throw new Error("Obsidian SuggestModal is not available");

  return class BookSuggestModal extends SuggestModal {
    constructor() {
      super(app);
      this.books = books;
      this.setPlaceholder("Search by title, author, or publisher");
      this.emptyStateText = "No matches";
      this.limit = 200;
      this.onChoose = null;
    }
    getItemText(book) { return String(book?.title || ""); }
    getSuggestions(query) {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return this.books;
      return this.books.filter((book) => {
        const title = String(book.title || "").toLowerCase();
        const author = String((book.authors || []).join(", ") || "").toLowerCase();
        const publisher = String(book.publisher || "").toLowerCase();
        return title.includes(q) || author.includes(q) || publisher.includes(q);
      });
    }
    renderSuggestion(book, el) {
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.gap = "12px";
      el.style.padding = "8px 10px";
      const coverImageUrl = book.coverUrl || "";
      if (SETTINGS.showCoverImageInSearch && coverImageUrl) {
        const img = el.createEl("img", { attr: { src: coverImageUrl, alt: `Cover for ${book.title}` } });
        img.style.pointerEvents = "none";
        img.style.width = "44px";
        img.style.height = "66px";
        img.style.objectFit = "cover";
        img.style.borderRadius = "4px";
        img.style.flex = "0 0 auto";
      }
      const textContainer = el.createEl("div");
      textContainer.style.display = "flex";
      textContainer.style.flexDirection = "column";
      textContainer.style.minWidth = "0";
      const titleEl = textContainer.createEl("div", { text: book.title || "" });
      titleEl.style.fontWeight = "600";
      const publisher = book.publisher ? `, ${book.publisher}` : "";
      const publishDate = book.publishDate ? `(${parsePublishedDate(book.publishDate)})` : "";
      const totalPage = book.totalPage ? `, p${book.totalPage}` : "";
      const subtitle = `${(book.authors || []).join(", ") || "Unknown"}${publisher}${publishDate}${totalPage}`;
      const small = textContainer.createEl("small", { text: subtitle });
      small.style.opacity = "0.8";
      el.addEventListener("click", () => { this.onChooseSuggestion(book); });
    }
    onChooseSuggestion(book) {
      if (typeof this.onChoose === "function") this.onChoose(book);
      this.close();
    }
  };
}

async function pickBookWithModal({ app, obsidian, books }) {
  return await new Promise((resolve) => {
    const ModalClass = createBookSuggestModal(obsidian, app, books);
    const modal = new ModalClass();
    let chosen = false;
    modal.onChoose = (book) => { chosen = true; resolve(book || null); };
    modal.onClose = () => { if (!chosen) resolve(null); };
    modal.open();
  });
}

// ============================================================================
// ATOMIC FILE CREATION
// ============================================================================
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

// ============================================================================
// MANUAL MODE
// ============================================================================
async function handleManual(app, qa, obsidian, Notice) {
  while (true) {
    const query = (await qa.inputPrompt("Book search", "Enter title and/or author keywords (or leave blank to stop)"))?.trim();
    if (!query) {
      if (Notice) new Notice("Book adding finished.");
      return;
    }

    const queryTokens = tokenise(query);
    let picked = null;
    let bookSource = "google-books";

    // Search Google Books
    if (Notice) new Notice("Searching Google Books...");
    try {
      const data = await googleBooksSearch(obsidian, query, {
        apiKey: SETTINGS.apiKey,
        country: SETTINGS.country,
        langRestrict: SETTINGS.langRestrict,
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      if (items.length) {
        const mapped = items.map((it) => {
          const vi = it?.volumeInfo || {};
          const isbns = extractISBNs(vi.industryIdentifiers);
          const authors = Array.isArray(vi.authors) ? vi.authors : [];
          const categories = Array.isArray(vi.categories) ? vi.categories : [];
          const coverUrl = bestCoverUrl(vi.imageLinks);
          const v = {
            volumeId: String(it.id || "").trim(),
            title: String(vi.title || "").trim(),
            subtitle: String(vi.subtitle || "").trim(),
            authors, publisher: String(vi.publisher || "").trim(),
            publishDate: String(vi.publishedDate || "").trim(),
            totalPage: vi.pageCount ?? 0, categories,
            genres: categories.map((c) => String(c).trim()).filter(Boolean),
            description: stripHtml(vi.description || ""),
            link: String(vi.canonicalVolumeLink || vi.infoLink || "").trim(),
            previewLink: String(vi.previewLink || "").trim(),
            coverUrl, ...isbns, language: String(vi.language || "").trim(),
            source: "google-books",
          };
          return { score: scoreItem(queryTokens, v), v };
        }).sort((a, b) => b.score - a.score).slice(0, SETTINGS.maxPick).map((x) => x.v);

        const preAction = await qa.suggester(
          [`Select from ${mapped.length} Google results`, "Try Apple Books instead", "Search again", "Stop"],
          ["select", "apple", "retry", "stop"]
        );
        if (preAction === "stop") { if (Notice) new Notice("Book adding finished."); return; }
        if (preAction === "retry") continue;
        if (preAction === "apple") { mapped.length = 0; }
        else if (preAction === "select") {
          picked = await pickBookWithModal({ app, obsidian, books: mapped });
        }
      }
    } catch (e) {
      if (Notice) new Notice(`Google search failed: ${e.message}`);
    }

    // Apple Books fallback
    if (!picked) {
      const action = await qa.suggester(
        ["Try Apple Books instead", "Search again with different terms", "Stop adding books"],
        ["apple", "retry", "stop"]
      );
      if (action === "stop" || !action) { if (Notice) new Notice("Book adding finished."); return; }
      if (action === "retry") continue;

      if (action === "apple" && SETTINGS.appleBooks.enabled) {
        if (Notice) new Notice("Searching Apple Books...");
        try {
          const appleData = await appleBooksSearch(obsidian, query, SETTINGS.appleBooks);
          const appleResults = Array.isArray(appleData?.results) ? appleData.results : [];
          if (!appleResults.length) { if (Notice) new Notice("No Apple Books results either."); continue; }
          const qNorm = query.toLowerCase().trim();
          const appleRanked = appleResults.map((r) => ({ r, ...scoreAppleResult(r, qNorm) }))
            .sort((a, b) => b.score - a.score).slice(0, SETTINGS.maxPick);
          const appleBooks = appleRanked.map((x) => mapAppleResultToBook(x.r));

          const appleAction = await qa.suggester(
            [`Select from ${appleBooks.length} Apple results`, "Search again", "Stop"],
            ["select", "retry", "stop"]
          );
          if (appleAction === "stop") { if (Notice) new Notice("Book adding finished."); return; }
          if (appleAction === "retry") continue;
          if (appleAction === "select") {
            picked = await pickBookWithModal({ app, obsidian, books: appleBooks });
            if (picked) bookSource = "apple-books";
          }
        } catch (e) {
          if (Notice) new Notice(`Apple search failed: ${e.message}`);
        }
      }
    }

    if (!picked) continue;

    // Prompts
    const purchasedStore = await qa.suggester(SETTINGS.prompts.purchasedStoreOptions, SETTINGS.prompts.purchasedStoreOptions);
    const purchasedDate = ((await qa.inputPrompt("Purchased date", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
    const format = await qa.suggester(SETTINGS.prompts.formatOptions.map((x) => (x ? x : "(blank)")), SETTINGS.prompts.formatOptions);
    const readingStatus = await qa.suggester(SETTINGS.prompts.statusOptions, SETTINGS.prompts.statusOptions);
    let readingStarted = "", readingDone = "", rating = "";
    if (readingStatus !== "not-started") {
      readingStarted = ((await qa.inputPrompt("Reading started", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
      readingDone = ((await qa.inputPrompt("Reading done", "YYYY-MM-DD (leave blank if unknown)")) || "").trim();
      const ratingRaw = ((await qa.inputPrompt("Rating", "0-10 (leave blank if none)")) || "").trim();
      rating = ratingRaw === "" ? "" : Number(ratingRaw);
    }

    // Cover download
    let localCoverImage = "";
    if (picked.coverUrl) {
      try {
        const coverBaseName = picked.authors?.[0]
          ? safeFilename(`${picked.title} - ${picked.authors[0]}`)
          : safeFilename(picked.title) || "cover";
        const cover = await downloadCoverToVault({
          app, obsidian, coverUrl: picked.coverUrl,
          destFolder: SETTINGS.coverFolder,
          destFilenameBase: coverBaseName,
        });
        if (cover.ok) localCoverImage = cover.localPath;
      } catch {
        if (Notice) new Notice("Cover download failed. Note will be created without local cover.");
      }
    }

    const meta = {
      volumeId: picked.volumeId || "", appleTrackId: picked.appleTrackId || "",
      title: picked.title, subtitle: picked.subtitle, authors: picked.authors,
      genres: picked.genres, publisher: picked.publisher, publishDate: picked.publishDate,
      totalPage: picked.totalPage, isbn13: picked.isbn13 || "", isbn10: picked.isbn10 || "",
      localCoverImage, link: picked.link || picked.previewLink || "",
      description: picked.description, source: bookSource,
    };
    const prompts = { purchasedStore, purchasedDate, format, readingStatus, readingStarted, readingDone, rating };

    // Check for existing
    const existing = findExistingBookNote(app, meta);
    if (existing && existing.file) {
      const options = [`Update existing "${existing.file.basename}"`, "Create new note anyway", "Cancel"];
      const mode = await qa.suggester(options, ["update", "new", "cancel"]);
      if (mode === "cancel") { if (Notice) new Notice("Cancelled."); continue; }
      if (mode === "update") {
        await app.fileManager.processFrontMatter(existing.file, (fm) => {
          fm.purchasedStore = prompts.purchasedStore ?? "";
          fm.purchasedDate = prompts.purchasedDate ?? "";
          fm.format = prompts.format ?? "";
          if (localCoverImage && !String(fm.localCoverImage || "").trim()) fm.localCoverImage = localCoverImage;
        });
        await upsertAndLinkAuthorsForBook({ app, obsidian, bookFile: existing.file, authorNames: meta.authors });
        await upsertAndLinkGenresForBook({ app, obsidian, bookFile: existing.file, genres: meta.genres });
        await upsertAndLinkEntity({ app, obsidian, bookFile: existing.file, entityName: prompts.purchasedStore, cfg: SETTINGS.storeUpsert, fieldName: "purchasedStore" });
        await upsertAndLinkEntity({ app, obsidian, bookFile: existing.file, entityName: prompts.format, cfg: SETTINGS.formatUpsert, fieldName: "format" });
        if (Notice) new Notice(`Updated: ${existing.file.basename}`);
        await app.workspace.getLeaf(true).openFile(existing.file);
        continue;
      }
    }

    // Create new note
    const firstAuthor = meta.authors && meta.authors[0] ? meta.authors[0] : "";
    const baseFileName = firstAuthor ? safeFilename(`${meta.title} - ${firstAuthor}`) : safeFilename(meta.title) || "Untitled book";
    const bookKey = computeBookKey(meta);
    const content = buildFrontMatter(meta, prompts, { bookKey });
    const bookFile = await createBookNote(app, SETTINGS.noteFolder, baseFileName, content);

    await upsertAndLinkAuthorsForBook({ app, obsidian, bookFile, authorNames: meta.authors });
    await upsertAndLinkGenresForBook({ app, obsidian, bookFile, genres: meta.genres });
    await upsertAndLinkEntity({ app, obsidian, bookFile, entityName: prompts.purchasedStore, cfg: SETTINGS.storeUpsert, fieldName: "purchasedStore" });
    await upsertAndLinkEntity({ app, obsidian, bookFile, entityName: prompts.format, cfg: SETTINGS.formatUpsert, fieldName: "format" });

    await app.workspace.getLeaf(true).openFile(bookFile);
    if (Notice) new Notice(`Created: ${bookFile.basename}`);
  }
}

// ============================================================================
// CSV IMPORT MODE
// ============================================================================
async function handleCSVImport(app, qa, obsidian, Notice) {
  if (Notice) {
    new Notice("CSV Import for books - see add-book-batch.js for full implementation.\n\nThis will be migrated in a future update.", 5000);
  }
}

// ============================================================================
// VAULT TRACKER STATS
// ============================================================================
const TRACKER_FILE = ".obsidian/vault-tracker/books.json";

async function readTrackerStats(app) {
  try {
    const exists = await app.vault.adapter.exists(TRACKER_FILE);
    if (!exists) return null;
    const content = await app.vault.adapter.read(TRACKER_FILE);
    return JSON.parse(content);
  } catch (e) {
    console.error("Failed to read tracker stats:", e);
    return null;
  }
}

function formatBookStats(stats) {
  if (!stats) return "No tracker data yet";
  const s = stats.stats;
  const finished = s.byStatus?.finished || 0;
  const reading = s.byStatus?.reading || 0;
  return `${s.total} books (${finished} finished, ${reading} reading, ${s.uniqueAuthors} authors)`;
}

async function showPreImportStats(app, Notice) {
  // Sync tracker first to ensure stats are current
  const freshStats = await syncVaultTracker(app, null);
  const stats = freshStats || await readTrackerStats(app);
  if (stats && Notice) {
    new Notice(`📚 Current: ${formatBookStats(stats)}`, 4000);
  }
  return stats;
}

function showPostImportDiff(Notice, beforeStats, afterStats) {
  if (!Notice || !beforeStats || !afterStats) return;
  
  const before = beforeStats.stats;
  const after = afterStats.stats;
  
  const booksDiff = after.total - before.total;
  const authorsDiff = after.uniqueAuthors - before.uniqueAuthors;
  const finishedDiff = (after.byStatus?.finished || 0) - (before.byStatus?.finished || 0);
  
  const parts = [`📚 Books: ${before.total} → ${after.total}`];
  if (booksDiff !== 0) parts[0] += ` (${booksDiff > 0 ? '+' : ''}${booksDiff})`;
  if (authorsDiff !== 0) parts.push(`👤 Authors: ${before.uniqueAuthors} → ${after.uniqueAuthors} (${authorsDiff > 0 ? '+' : ''}${authorsDiff})`);
  if (finishedDiff !== 0) parts.push(`✅ Finished: ${before.byStatus?.finished || 0} → ${after.byStatus?.finished || 0} (${finishedDiff > 0 ? '+' : ''}${finishedDiff})`);
  
  if (booksDiff !== 0 || authorsDiff !== 0 || finishedDiff !== 0) {
    new Notice(`Import complete!\n\n${parts.join('\n')}`, 6000);
  }
}

// ============================================================================
// SEARCH EXISTING
// ============================================================================
function stringSimilarity(s1, s2) {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  
  // Simple word overlap
  const words1 = a.split(/\s+/);
  const words2 = b.split(/\s+/);
  const matches = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
  return matches.length / Math.max(words1.length, words2.length);
}

function searchBooks(trackerData, query) {
  if (!trackerData?.books || !query) return [];
  
  const q = query.toLowerCase().trim();
  const results = [];
  
  for (const book of trackerData.books) {
    const title = (book.title || "").toLowerCase();
    const authors = (book.author || []).join(" ").toLowerCase();
    
    // Exact match in title
    if (title.includes(q)) {
      results.push({ ...book, score: title === q ? 1 : 0.9, matchType: "title" });
    }
    // Match in author
    else if (authors.includes(q)) {
      results.push({ ...book, score: 0.7, matchType: "author" });
    }
    // Fuzzy match
    else {
      const similarity = stringSimilarity(title, q);
      if (similarity > 0.3) {
        results.push({ ...book, score: similarity, matchType: "fuzzy" });
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 15);
}

async function handleSearch(app, qa, Notice) {
  const trackerData = await readTrackerStats(app);
  if (!trackerData) {
    if (Notice) new Notice("No tracker data found. Run a sync first.", 3000);
    return;
  }
  
  const query = await qa.inputPrompt("Search books", "Enter title or author");
  if (!query?.trim()) return;
  
  const results = searchBooks(trackerData, query.trim());
  
  if (results.length === 0) {
    if (Notice) new Notice(`No matches found for "${query}"`, 3000);
    return;
  }
  
  // Format results for suggester
  const displayOptions = results.map(book => {
    const status = book.status === "finished" ? "✅" : book.status === "reading" ? "📖" : "📚";
    const author = book.author?.length ? ` by ${book.author[0]}` : "";
    const rating = book.rating ? ` ⭐${book.rating}` : "";
    return `${status} ${book.title}${author}${rating}`;
  });
  
  const selected = await qa.suggester(displayOptions, results);
  if (!selected) return;
  
  // Open the selected book
  const file = app.vault.getAbstractFileByPath(selected.path);
  if (file) {
    await app.workspace.getLeaf(true).openFile(file);
  } else {
    if (Notice) new Notice(`File not found: ${selected.path}`, 3000);
  }
}

// ============================================================================
// VAULT TRACKER SYNC
// ============================================================================
async function syncVaultTracker(app, Notice) {
  try {
    // Load sync-tracker module
    const trackerPath = SETTINGS.syncTrackerPath;
    const trackerExists = await app.vault.adapter.exists(trackerPath);
    if (!trackerExists) {
      console.log("Vault tracker not found, skipping sync");
      return null;
    }
    
    // Read and evaluate the tracker module
    const trackerCode = await app.vault.adapter.read(trackerPath);
    const trackerModule = {};
    const moduleFunc = new Function("module", "exports", "require", trackerCode);
    moduleFunc(trackerModule, {}, () => {});
    
    if (trackerModule.exports?.syncTracker) {
      const results = await trackerModule.exports.syncTracker(app, { domains: ["books"], silent: true });
      console.log("Vault tracker synced (books)");
      return results?.books || null;
    }
  } catch (e) {
    console.error("Failed to sync vault tracker:", e);
  }
  return null;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================
module.exports = async (params) => {
  const app = params?.app;
  const qa = params?.quickAddApi;
  const obsidian = params?.obsidian;

  if (!app || !qa) {
    throw new Error("QuickAdd context missing: expected params.app and params.quickAddApi.");
  }

  const Notice = obsidian?.Notice || globalThis.Notice;

  await loadSecrets(app);
  await ensureFolder(app, SETTINGS.noteFolder);
  await ensureFolder(app, SETTINGS.coverFolder);

  // Show current stats before import
  const beforeStats = await showPreImportStats(app, Notice);

  // Mode selection
  const mode = await qa.suggester(
    ["🔍 Search existing books", "Manual - Search Google/Apple Books", "CSV Import - Batch from file", "API Import (Future)"],
    ["search", "manual", "csv", "api"]
  );

  if (!mode) return;

  if (mode === "search") {
    await handleSearch(app, qa, Notice);
    return;
  }

  if (mode === "manual") {
    await handleManual(app, qa, obsidian, Notice);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  if (mode === "csv") {
    await handleCSVImport(app, qa, obsidian, Notice);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  if (mode === "api") {
    if (Notice) new Notice("API Import (Goodreads, LibraryThing) coming soon!", 3000);
  }
};
