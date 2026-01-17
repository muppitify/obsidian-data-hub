// quickadd-core.js — Shared utility functions for QuickAdd scripts
//
// This is a reference library. Copy required sections into your script.
// QuickAdd scripts are self-contained - they cannot import from other files.
//
// Sections:
//   1. STRING UTILITIES
//   2. YAML UTILITIES
//   3. CSV PARSING
//   4. DATE UTILITIES
//   5. FILE/FOLDER OPERATIONS
//   6. HTTP HELPERS
//   7. PROGRESS TRACKING
//   8. SECRETS LOADING
//   9. ENTITY UPSERT (Generic)
//   10. VISUAL PICKER MODAL
//   11. IMPORT LIMIT SELECTOR
//
// iOS compatible: uses app.vault.adapter and obsidian.requestUrl

// ============================================================================
// 1. STRING UTILITIES
// ============================================================================

/**
 * Zero-pad a number to 2 digits
 * @param {number} n - Number to pad
 * @returns {string} - Zero-padded string
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Format a date as YYYY-MM-DD in local timezone
 * @param {Date} d - Date object (defaults to now)
 * @returns {string} - ISO date string
 */
function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Sanitize a string for use as a filename
 * @param {string} s - Input string
 * @param {number} maxLength - Maximum length (default 200)
 * @returns {string} - Safe filename
 */
function safeFilename(s, maxLength = 200) {
  let result = String(s ?? "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (result.length > maxLength) {
    result = result.substring(0, maxLength).trim();
  }

  // Remove leading dots, dashes, spaces
  result = result.replace(/^[\s.\-]+/, "");

  return result || "Untitled";
}

/**
 * Sanitize a string for use in a wikilink
 * @param {string} name - Input string
 * @returns {string} - Safe wikilink text
 */
function sanitizeForWikilink(name) {
  return String(name ?? "")
    .replace(/[\[\]|#^]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a string (lowercase, trim)
 * @param {string} s - Input string
 * @returns {string} - Normalized string
 */
function normalise(s) {
  return String(s ?? "").toLowerCase().trim();
}

// Alias for American spelling
const normalize = normalise;

/**
 * Strip HTML tags from a string
 * @param {string} html - HTML string
 * @returns {string} - Plain text
 */
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

/**
 * Decode HTML entities to their character equivalents
 * @param {string} s - String with HTML entities
 * @returns {string} - Decoded string
 */
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

  // Handle numeric entities (decimal and hex)
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}

/**
 * Wrap a name in wikilink syntax [[name]]
 * @param {string} name - Name to wrap
 * @returns {string} - Wikilink string
 */
function toWikilink(name) {
  const s = sanitizeForWikilink(name);
  if (!s) return "";
  if (s.startsWith("[[") && s.endsWith("]]")) return s;
  return `[[${s}]]`;
}

/**
 * Convert a file path to a wikilink
 * @param {string} filePath - File path
 * @returns {string} - Wikilink string
 */
function pathToWikilink(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/").replace(/\.md$/i, "");
  if (!p) return "";
  return `[[${p}]]`;
}

/**
 * Strip wikilink syntax from a value
 * @param {string} v - Wikilink string
 * @returns {string} - Plain text
 */
function stripWikilink(v) {
  return String(v || "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .split("#")[0]
    .trim();
}

// ============================================================================
// 2. YAML UTILITIES
// ============================================================================

/**
 * Escape a string for safe use in YAML (double-quoted)
 * @param {string} s - Input string
 * @returns {string} - Quoted YAML string
 */
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

/**
 * Create a YAML block scalar (multiline text)
 * @param {string} key - YAML key
 * @param {string} text - Multiline text
 * @returns {string} - YAML block scalar
 */
function yamlBlockScalar(key, text) {
  const t = String(text ?? "").trim();
  if (!t) return `${key}: ""`;

  // Escape lines that could break YAML (document markers)
  const lines = t.split("\n").map((l) => {
    if (/^\s*---\s*$/.test(l) || /^\s*\.\.\.\s*$/.test(l)) {
      return `  \\${l.trim()}`;
    }
    return `  ${l}`;
  });

  return `${key}: |\n${lines.join("\n")}`;
}

/**
 * Create a YAML array
 * @param {string} key - YAML key
 * @param {string[]} arr - Array of values
 * @returns {string} - YAML array
 */
function yamlArray(key, arr) {
  const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
  if (!a.length) return `${key}: []`;
  return `${key}:\n${a.map((x) => `  - ${quoteYamlString(x)}`).join("\n")}`;
}

/**
 * Add a YAML string field if value is non-empty
 * @param {string[]} lines - Lines array to append to
 * @param {string} key - YAML key
 * @param {string} value - Value
 */
function yamlMaybeString(lines, key, value) {
  const v = String(value ?? "").trim();
  if (!v) return;
  lines.push(`${key}: ${quoteYamlString(v)}`);
}

/**
 * Add a YAML number field if value is valid and non-zero
 * @param {string[]} lines - Lines array to append to
 * @param {string} key - YAML key
 * @param {number} value - Value
 */
function yamlMaybeNumber(lines, key, value) {
  if (value === null || value === undefined) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return;
  lines.push(`${key}: ${n}`);
}

// ============================================================================
// 3. CSV PARSING
// ============================================================================

/**
 * Parse a CSV string into headers and rows
 * @param {string} text - CSV content
 * @returns {{headers: string[], rows: Object[]}} - Parsed CSV data
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]);
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

/**
 * Parse a single CSV line handling quoted fields
 * @param {string} line - CSV line
 * @returns {string[]} - Array of field values
 */
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

// ============================================================================
// 4. DATE UTILITIES
// ============================================================================

/**
 * Parse various date formats to YYYY-MM-DD
 * Handles: DD/MM/YYYY, M/D/YYYY, MM/DD/YYYY, YYYY-MM-DD
 * @param {string} dateStr - Date string
 * @returns {string} - ISO date string
 */
function parseDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try DD/MM/YYYY (Australian format - day first)
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, first, second, year] = ddmmyyyy;
    // Assume DD/MM/YYYY (Australian) - day is first
    const day = first.padStart(2, "0");
    const month = second.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Try ISO format with time
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return s;
}

/**
 * Parse published date (handles YYYY, YYYY-MM, YYYY-MM-DD)
 * @param {string} publishedDateRaw - Published date string
 * @returns {string} - Full ISO date
 */
function parsePublishedDate(publishedDateRaw) {
  const s = String(publishedDateRaw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

/**
 * Add days to a date
 * @param {Date} date - Starting date
 * @param {number} days - Days to add (can be negative)
 * @returns {Date} - New date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format a date option for suggester display
 * @param {Date} date - Date object
 * @param {string} label - Human-readable label
 * @returns {{label: string, value: string}} - Option object
 */
function formatDateOption(date, label) {
  const dateStr = localISODate(date);
  return { label: `${label} (${dateStr})`, value: dateStr };
}

/**
 * Prompt for a date with common recent options
 * @param {Object} qa - QuickAdd API
 * @param {string} title - Prompt title
 * @returns {Promise<string>} - Selected date (YYYY-MM-DD)
 */
async function promptForDate(qa, title = "Date") {
  const today = new Date();
  
  const options = [
    formatDateOption(today, "Today"),
    formatDateOption(addDays(today, -1), "Yesterday"),
    formatDateOption(addDays(today, -2), "2 days ago"),
    formatDateOption(addDays(today, -3), "3 days ago"),
    formatDateOption(addDays(today, -4), "4 days ago"),
    formatDateOption(addDays(today, -5), "5 days ago"),
    formatDateOption(addDays(today, -6), "6 days ago"),
    formatDateOption(addDays(today, -7), "1 week ago"),
    { label: "Custom date...", value: "custom" },
  ];
  
  const selection = await qa.suggester(
    options.map(o => o.label),
    options.map(o => o.value)
  );
  
  if (!selection) return localISODate();
  
  if (selection === "custom") {
    const custom = (await qa.inputPrompt(title, "YYYY-MM-DD"))?.trim();
    return custom || localISODate();
  }
  
  return selection;
}

// ============================================================================
// 5. FILE/FOLDER OPERATIONS
// ============================================================================

/**
 * Ensure a folder exists (create if missing)
 * @param {Object} app - Obsidian app object
 * @param {string} folder - Folder path
 */
async function ensureFolder(app, folder) {
  const f = String(folder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!f) return;

  const exists = await app.vault.adapter.exists(f);
  if (exists) return;

  try {
    await app.vault.adapter.mkdir(f);
  } catch (e) {
    // Check if it exists now (race condition with another process)
    const nowExists = await app.vault.adapter.exists(f);
    if (!nowExists) {
      console.error(`Failed to create folder: ${f}`, e);
    }
  }
}

/**
 * Ensure a note exists (create with default content if missing)
 * @param {Object} app - Obsidian app object
 * @param {string} notePath - Path to the note
 * @param {string} defaultContent - Content to use if creating
 * @returns {Promise<Object>} - The file object
 */
async function ensureNote(app, notePath, defaultContent) {
  const norm = notePath.replace(/\\/g, "/");
  const exists = await app.vault.adapter.exists(norm);
  
  if (exists) {
    return app.vault.getAbstractFileByPath(norm);
  }

  const folder = norm.split("/").slice(0, -1).join("/");
  if (folder) await ensureFolder(app, folder);
  
  return await app.vault.create(norm, defaultContent);
}

/**
 * Find a file by its name (without path)
 * @param {Object} app - Obsidian app object
 * @param {string} fileName - File name to find
 * @returns {Object|null} - File object or null
 */
function findFileByName(app, fileName) {
  return app.vault.getFiles().find((f) => f.name === fileName) || null;
}

/**
 * Find an existing note by title using metadata cache
 * @param {Object} app - Obsidian app object
 * @param {Object|null} activeFile - Currently active file (for context)
 * @param {string} title - Title to search for
 * @returns {Object|null} - File object or null
 */
function findExistingNoteByTitle(app, activeFile, title) {
  return app.metadataCache.getFirstLinkpathDest(title, activeFile?.path || "") || null;
}

/**
 * Get frontmatter from a file using metadata cache
 * @param {Object} app - Obsidian app object
 * @param {Object} file - File object
 * @returns {Object|null} - Frontmatter object or null
 */
function getFrontmatter(app, file) {
  const cache = app?.metadataCache?.getFileCache(file);
  return cache?.frontmatter || null;
}

// ============================================================================
// 6. HTTP HELPERS
// ============================================================================

/**
 * HTTP GET returning ArrayBuffer (for binary data like images)
 * iOS compatible using obsidian.requestUrl
 * @param {Object} obsidian - Obsidian module
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<ArrayBuffer>} - Response body as ArrayBuffer
 */
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

/**
 * Download an image and save to vault
 * @param {Object} obsidian - Obsidian module
 * @param {Object} app - Obsidian app object
 * @param {string} imageUrl - URL of the image
 * @param {string} localPath - Local path to save to
 * @returns {Promise<string|null>} - Local path if successful, null otherwise
 */
async function downloadImage(obsidian, app, imageUrl, localPath) {
  if (!imageUrl) return null;

  try {
    // Handle relative URLs (e.g., TMDB poster paths)
    const fullUrl = imageUrl.startsWith("http")
      ? imageUrl
      : `https://image.tmdb.org/t/p/w500${imageUrl}`;

    const response = await obsidian.requestUrl({
      url: fullUrl,
      method: "GET",
    });

    if (response.arrayBuffer) {
      const folder = localPath.split("/").slice(0, -1).join("/");
      await ensureFolder(app, folder);
      await app.vault.adapter.writeBinary(localPath, response.arrayBuffer);
      return localPath;
    }
  } catch (e) {
    console.error(`Failed to download image: ${imageUrl}`, e);
  }
  return null;
}

/**
 * Get file extension from URL
 * @param {string} url - URL to extract extension from
 * @returns {string} - Extension with dot (e.g., ".jpg")
 */
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(jpg|jpeg|png|webp)$/i);
    if (m) return "." + m[1].toLowerCase().replace("jpeg", "jpg");
  } catch {}
  return ".jpg";
}

// ============================================================================
// 7. PROGRESS TRACKING
// ============================================================================

/**
 * Create a progress tracking helper for import scripts
 * @param {Object} app - Obsidian app object
 * @param {string} progressFile - Path to progress JSON file
 * @param {string} idPrefix - Prefix for progress IDs (e.g., "emby-", "prime-")
 * @returns {Object} - Progress tracking helper
 */
function createProgressTracker(app, progressFile, idPrefix = "") {
  const getDefault = () => ({
    processedIds: [],
    fetchedItems: {},
    metadata: {},
  });

  return {
    async load() {
      try {
        const exists = await app.vault.adapter.exists(progressFile);
        if (!exists) return getDefault();
        const raw = await app.vault.adapter.read(progressFile);
        const loaded = JSON.parse(raw);
        return { ...getDefault(), ...loaded };
      } catch {
        return getDefault();
      }
    },

    async save(progress) {
      try {
        const folder = progressFile.split("/").slice(0, -1).join("/");
        if (folder) await app.vault.adapter.mkdir(folder).catch(() => {});
        await app.vault.adapter.write(progressFile, JSON.stringify(progress, null, 2));
      } catch (e) {
        console.error("Failed to save progress:", e);
      }
    },

    async markProcessed(id) {
      const progress = await this.load();
      const fullId = idPrefix + id;
      if (!progress.processedIds.includes(fullId)) {
        progress.processedIds.push(fullId);
        await this.save(progress);
      }
    },

    async isProcessed(id) {
      const progress = await this.load();
      return progress.processedIds.includes(idPrefix + id);
    },

    async resetByPrefix(prefix = idPrefix) {
      const progress = await this.load();
      progress.processedIds = progress.processedIds.filter(
        id => !id.startsWith(prefix)
      );
      await this.save(progress);
    },

    async resetAll() {
      await this.save(getDefault());
    },

    async setMetadata(key, value) {
      const progress = await this.load();
      progress.metadata[key] = value;
      await this.save(progress);
    },

    async getMetadata(key) {
      const progress = await this.load();
      return progress.metadata[key];
    },
  };
}

// ============================================================================
// 8. SECRETS LOADING
// ============================================================================

/**
 * Load secrets from the secrets JSON file
 * @param {Object} app - Obsidian app object
 * @param {string} secretsFile - Path to secrets file (default: .obsidian/quickadd-secrets.json)
 * @returns {Promise<Object>} - Secrets object
 */
async function loadSecrets(app, secretsFile = ".obsidian/quickadd-secrets.json") {
  try {
    const exists = await app.vault.adapter.exists(secretsFile);
    if (!exists) return {};
    const raw = await app.vault.adapter.read(secretsFile);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ============================================================================
// 9. ENTITY UPSERT (Generic)
// ============================================================================

/**
 * Create a generic entity upsert function
 * Use this pattern for Authors, Genres, Stores, WorkoutTypes, etc.
 * 
 * @param {Object} config - Configuration object
 * @param {string} config.folder - Folder to store entity notes
 * @param {string} config.categoryPath - Path to category note
 * @param {string} config.categoryLink - Wikilink to category
 * @param {string} config.tag - Tag to apply to entity notes
 * @param {string} config.baseName - Name of the base file for queries
 * @param {Function} config.buildContent - Function to build note content
 * @returns {Object} - Upsert helper object
 */
function createEntityUpsert(config) {
  const {
    folder,
    categoryPath,
    categoryLink,
    tag,
    baseName,
    buildContent,
  } = config;

  return {
    /**
     * Ensure the category note exists
     */
    async ensureCategory(app) {
      const exists = await app.vault.adapter.exists(categoryPath);
      if (!exists) {
        const categoryFolder = categoryPath.split("/").slice(0, -1).join("/");
        if (categoryFolder) await ensureFolder(app, categoryFolder);
        
        const content = `---
tags:
  - categories
---

![[${baseName}]]
`;
        await app.vault.create(categoryPath, content);
      }
    },

    /**
     * Create an entity note if it doesn't exist
     * @param {Object} app - Obsidian app object
     * @param {string} entityName - Name of the entity
     * @returns {Promise<Object|null>} - File object or null
     */
    async createNote(app, entityName) {
      const safeName = safeFilename(sanitizeForWikilink(entityName));
      if (!safeName) return null;

      const filePath = `${folder}/${safeName}.md`;
      const existing = app.vault.getAbstractFileByPath(filePath);
      if (existing) return existing;

      await ensureFolder(app, folder);

      const content = buildContent
        ? buildContent(entityName, safeName)
        : `---
categories:
  - "${categoryLink}"
tags:
  - ${tag}
created: ${localISODate()}
---

![[${baseName}]]
`;

      return await app.vault.create(filePath, content);
    },

    /**
     * Upsert an entity and return its wikilink
     * @param {Object} app - Obsidian app object
     * @param {string} entityName - Name of the entity
     * @returns {Promise<string>} - Wikilink to the entity
     */
    async upsert(app, entityName) {
      const name = String(entityName || "").trim();
      if (!name) return "";

      await this.ensureCategory(app);

      const safeName = safeFilename(sanitizeForWikilink(name));
      const existing = findExistingNoteByTitle(app, null, name);
      
      if (existing) {
        return `[[${existing.basename}]]`;
      }

      const created = await this.createNote(app, name);
      if (!created) return "";
      
      return `[[${created.basename}]]`;
    },

    /**
     * Upsert multiple entities and link them to a source note
     * @param {Object} app - Obsidian app object
     * @param {Object} sourceFile - The note to update with links
     * @param {string[]} entityNames - Array of entity names
     * @param {string} frontmatterField - Field name in frontmatter
     * @returns {Promise<string[]>} - Array of wikilinks
     */
    async upsertAndLink(app, sourceFile, entityNames, frontmatterField) {
      const names = Array.isArray(entityNames)
        ? entityNames.map(n => String(n || "").trim()).filter(Boolean)
        : entityNames
          ? [String(entityNames).trim()]
          : [];

      if (!names.length) return [];

      const links = [];
      for (const name of names) {
        const link = await this.upsert(app, name);
        if (link) links.push(link);
      }

      // Deduplicate
      const seen = new Set();
      const unique = links.filter(x => (seen.has(x) ? false : (seen.add(x), true)));

      // Update source note frontmatter
      if (sourceFile && unique.length > 0) {
        const file = typeof sourceFile === "string"
          ? app.vault.getAbstractFileByPath(sourceFile)
          : sourceFile;

        if (file) {
          await app.fileManager.processFrontMatter(file, (fm) => {
            fm[frontmatterField] = unique.length === 1 ? unique[0] : unique;
          });
        }
      }

      return unique;
    },
  };
}

// ============================================================================
// 10. VISUAL PICKER MODAL
// ============================================================================

/**
 * Create a visual picker modal with thumbnails
 * @param {Object} obsidian - Obsidian module
 * @param {Object} app - Obsidian app object
 * @param {Object[]} items - Array of items to display
 * @param {Object} config - Configuration object
 * @param {string} config.placeholder - Placeholder text
 * @param {Function} config.getTitle - Function to get item title
 * @param {Function} config.getSubtitle - Function to get item subtitle
 * @param {Function} config.getImageUrl - Function to get item image URL
 * @returns {Class} - Modal class
 */
function createVisualPickerModal(obsidian, app, items, config) {
  const SuggestModal = obsidian?.SuggestModal;
  if (!SuggestModal) throw new Error("Obsidian SuggestModal is not available");

  const {
    placeholder = "Search...",
    getTitle = (item) => item.title || item.name || "",
    getSubtitle = (item) => item.subtitle || "",
    getImageUrl = (item) => item.imageUrl || item.coverUrl || "",
    imageWidth = "44px",
    imageHeight = "66px",
  } = config;

  return class VisualPickerModal extends SuggestModal {
    constructor() {
      super(app);
      this.items = items;
      this.setPlaceholder(placeholder);
      this.emptyStateText = "No matches";
      this.limit = 200;
      this.onChoose = null;
    }

    getItemText(item) {
      return String(getTitle(item));
    }

    getSuggestions(query) {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return this.items;

      return this.items.filter((item) => {
        const title = String(getTitle(item)).toLowerCase();
        const subtitle = String(getSubtitle(item)).toLowerCase();
        return title.includes(q) || subtitle.includes(q);
      });
    }

    renderSuggestion(item, el) {
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.gap = "12px";
      el.style.padding = "8px 10px";

      const imageUrl = getImageUrl(item);
      if (imageUrl) {
        const img = el.createEl("img", {
          attr: {
            src: imageUrl,
            alt: `Image for ${getTitle(item)}`,
          },
        });
        img.style.pointerEvents = "none";
        img.style.width = imageWidth;
        img.style.height = imageHeight;
        img.style.objectFit = "cover";
        img.style.borderRadius = "4px";
        img.style.flex = "0 0 auto";
      }

      const textContainer = el.createEl("div");
      textContainer.style.display = "flex";
      textContainer.style.flexDirection = "column";
      textContainer.style.minWidth = "0";

      const titleEl = textContainer.createEl("div", { text: getTitle(item) });
      titleEl.style.fontWeight = "600";

      const subtitle = getSubtitle(item);
      if (subtitle) {
        const small = textContainer.createEl("small", { text: subtitle });
        small.style.opacity = "0.8";
      }

      el.addEventListener("click", () => {
        this.onChooseSuggestion(item);
      });
    }

    onChooseSuggestion(item) {
      if (typeof this.onChoose === "function") this.onChoose(item);
      this.close();
    }
  };
}

/**
 * Show a visual picker modal and return the selected item
 * @param {Object} obsidian - Obsidian module
 * @param {Object} app - Obsidian app object
 * @param {Object[]} items - Items to pick from
 * @param {Object} config - Modal configuration
 * @returns {Promise<Object|null>} - Selected item or null
 */
async function pickWithVisualModal(obsidian, app, items, config) {
  return await new Promise((resolve) => {
    const ModalClass = createVisualPickerModal(obsidian, app, items, config);
    const modal = new ModalClass();
    let chosen = false;
    modal.onChoose = (item) => {
      chosen = true;
      resolve(item || null);
    };
    modal.onClose = () => {
      if (!chosen) resolve(null);
    };
    modal.open();
  });
}

// ============================================================================
// 11. IMPORT LIMIT SELECTOR
// ============================================================================

/**
 * Prompt user to select how many items to import
 * @param {Object} qa - QuickAdd API
 * @param {number} totalAvailable - Total items available to import
 * @returns {Promise<number>} - Number of items to import (0 = cancel)
 */
async function promptImportLimit(qa, totalAvailable) {
  const options = [
    "Just 1 (test)",
    "First 5",
    "First 10",
    "First 25",
    "First 100",
    `All ${totalAvailable}`,
    "Cancel",
  ];
  const values = [1, 5, 10, 25, 100, totalAvailable, 0];

  const choice = await qa.suggester(options, values);
  return choice === undefined ? 0 : choice;
}

// ============================================================================
// 12. SEARCH UTILITIES
// ============================================================================

/**
 * Calculate string similarity for fuzzy matching
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} - Similarity score (0-1)
 */
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

/**
 * Search items by title with fuzzy matching
 * @param {Object[]} items - Array of items to search
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string} options.titleField - Field name for title (default: "title")
 * @param {string[]} options.additionalFields - Additional fields to search
 * @param {number} options.minScore - Minimum similarity score (default: 0.3)
 * @param {number} options.maxResults - Maximum results to return (default: 15)
 * @returns {Object[]} - Matching items with scores, sorted by relevance
 */
function searchByTitle(items, query, options = {}) {
  const {
    titleField = "title",
    additionalFields = [],
    minScore = 0.3,
    maxResults = 15,
  } = options;
  
  if (!items || !query) return [];
  
  const q = query.toLowerCase().trim();
  const results = [];
  
  for (const item of items) {
    const title = (item[titleField] || "").toLowerCase();
    
    // Exact match in title
    if (title.includes(q)) {
      results.push({ ...item, score: title === q ? 1 : 0.9, matchType: "title" });
      continue;
    }
    
    // Check additional fields
    let matched = false;
    for (const field of additionalFields) {
      const value = item[field];
      const fieldStr = Array.isArray(value) ? value.join(" ") : String(value || "");
      if (fieldStr.toLowerCase().includes(q)) {
        results.push({ ...item, score: 0.7, matchType: field });
        matched = true;
        break;
      }
    }
    if (matched) continue;
    
    // Fuzzy match on title
    const similarity = stringSimilarity(title, q);
    if (similarity >= minScore) {
      results.push({ ...item, score: similarity, matchType: "fuzzy" });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/**
 * Read tracker JSON file
 * @param {Object} app - Obsidian app object
 * @param {string} trackerFile - Path to tracker JSON file
 * @returns {Promise<Object|null>} - Parsed tracker data or null
 */
async function readTrackerData(app, trackerFile) {
  try {
    const exists = await app.vault.adapter.exists(trackerFile);
    if (!exists) return null;
    const content = await app.vault.adapter.read(trackerFile);
    return JSON.parse(content);
  } catch (e) {
    console.error("Failed to read tracker data:", e);
    return null;
  }
}

/**
 * Display search results and open selected item
 * @param {Object} app - Obsidian app object
 * @param {Object} qa - QuickAdd API
 * @param {Object} Notice - Notice class
 * @param {Object[]} results - Search results
 * @param {Function} formatItem - Function to format item for display
 * @returns {Promise<Object|null>} - Selected item or null
 */
async function displaySearchResults(app, qa, Notice, results, formatItem) {
  if (results.length === 0) {
    if (Notice) new Notice("No matches found", 3000);
    return null;
  }
  
  const displayOptions = results.map(formatItem);
  const selected = await qa.suggester(displayOptions, results);
  
  if (!selected) return null;
  
  // Open the selected item
  if (selected.path) {
    const file = app.vault.getAbstractFileByPath(selected.path);
    if (file) {
      await app.workspace.getLeaf(true).openFile(file);
    } else {
      if (Notice) new Notice(`File not found: ${selected.path}`, 3000);
    }
  }
  
  return selected;
}

// ============================================================================
// 13. INCREMENTAL UPDATE UTILITIES
// ============================================================================

/**
 * Read existing note frontmatter
 * @param {Object} app - Obsidian app object
 * @param {string} notePath - Path to the note
 * @returns {Promise<Object|null>} - Frontmatter object or null
 */
async function readExistingFrontmatter(app, notePath) {
  try {
    const exists = await app.vault.adapter.exists(notePath);
    if (!exists) return null;
    
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file) return null;
    
    const cache = app.metadataCache.getFileCache(file);
    return cache?.frontmatter || null;
  } catch (e) {
    console.error(`Failed to read frontmatter: ${notePath}`, e);
    return null;
  }
}

/**
 * Check which data sources are present in an object based on field mapping
 * @param {Object} data - Data object to check
 * @param {Object} sourceFields - Map of source name to array of field names
 * @returns {string[]} - Array of source names that have data
 */
function detectDataSources(data, sourceFields) {
  if (!data) return [];
  
  const sources = [];
  for (const [source, fields] of Object.entries(sourceFields)) {
    const hasData = fields.some(field => data[field] != null && data[field] !== "");
    if (hasData) sources.push(source);
  }
  return sources;
}

/**
 * Check if new data has sources not present in existing data
 * @param {string[]} existingSources - Sources in existing data
 * @param {string[]} newSources - Sources in new data
 * @returns {boolean} - True if there are new sources
 */
function hasNewDataSources(existingSources, newSources) {
  return newSources.some(s => !existingSources.includes(s));
}

/**
 * Merge existing data with new data, new data takes precedence
 * @param {Object} existingData - Existing frontmatter
 * @param {Object} newData - New data to merge
 * @param {string[]} newSources - Which sources the new data provides
 * @param {Object} sourceFields - Map of source name to field names
 * @returns {Object} - Merged data
 */
function mergeDataBySources(existingData, newData, newSources, sourceFields) {
  if (!existingData) return newData;
  
  const merged = { ...existingData };
  delete merged.position; // Remove Obsidian metadata
  
  // Get all fields that belong to new sources
  const newSourceFields = new Set();
  for (const source of newSources) {
    for (const field of (sourceFields[source] || [])) {
      newSourceFields.add(field.toLowerCase());
    }
  }
  
  // Overlay new data
  for (const [key, value] of Object.entries(newData)) {
    // Check if this key belongs to a new source (approximate match)
    const keyLower = key.toLowerCase();
    const belongsToNewSource = [...newSourceFields].some(f => keyLower.includes(f));
    
    if (belongsToNewSource && value != null && value !== "") {
      merged[key] = value;
    } else if (merged[key] === undefined && value != null && value !== "") {
      // Add new keys that don't exist yet
      merged[key] = value;
    }
  }
  
  return merged;
}

// ============================================================================
// 14. SERIES/SHOW UTILITIES
// ============================================================================

/**
 * Normalize series name for TMDB search
 * Strips "Season X", "S1", "Classic Season X", etc. from end of name
 * Also normalizes unicode characters (smart quotes, fancy dashes)
 * 
 * @param {string} name - Raw series name (e.g., "Dead Like Me Season 1")
 * @returns {string} - Normalized name (e.g., "Dead Like Me")
 * 
 * @example
 * normalizeSeriesName("Dead Like Me Season 1") // "Dead Like Me"
 * normalizeSeriesName("Two and a Half Men: Season 1") // "Two and a Half Men"
 * normalizeSeriesName("Jeremiah (Season 1)") // "Jeremiah"
 * normalizeSeriesName("Battlestar Galactica S1") // "Battlestar Galactica"
 */
function normalizeSeriesName(name) {
  let normalized = String(name || "").trim();
  
  // Normalize unicode dashes and quotes to ASCII equivalents
  normalized = normalized
    .replace(/[\u2010-\u2015\u2212]/g, "-")  // Various dashes to hyphen
    .replace(/[\u2018\u2019]/g, "'")         // Smart single quotes
    .replace(/[\u201C\u201D]/g, '"')         // Smart double quotes
    .replace(/\u00A0/g, " ");                // Non-breaking space to regular space
  
  // Strip "Season X", "S1", "Classic Season X", etc. from end of name
  normalized = normalized
    .replace(/\s*[:|-]\s*Season\s*\d+\s*$/i, "")
    .replace(/\s*\(Season\s*\d+\)\s*$/i, "")
    .replace(/\s+Season\s*\d+\s*$/i, "")
    .replace(/\s+S\d+\s*$/i, "");
  
  // Strip trailing punctuation
  normalized = normalized.replace(/[\s,\-:]+$/, "").trim();
  
  return normalized;
}

/**
 * Search vault for existing series by name (partial match)
 * Useful for finding if a series already exists before fetching from TMDB
 * 
 * @param {Object} app - Obsidian app object
 * @param {string} searchName - Series name to search for
 * @param {string} seriesFolder - Folder path for series (e.g., "shows/series")
 * @returns {Array<{name: string, path: string, file: TFile}>} - Matching series
 * 
 * @example
 * const matches = searchVaultForSeries(app, "Dead Like Me", "shows/series");
 * // Returns [{name: "Dead Like Me", path: "shows/series/Dead Like Me/Dead Like Me.md", file: TFile}]
 */
function searchVaultForSeries(app, searchName, seriesFolder) {
  const searchLower = searchName.toLowerCase();
  
  const matches = [];
  const files = app.vault.getFiles();
  
  for (const file of files) {
    if (!file.path.startsWith(seriesFolder + "/")) continue;
    if (!file.path.endsWith(".md")) continue;
    
    // Get the series folder name (parent folder)
    const parts = file.path.split("/");
    if (parts.length < 3) continue;
    
    // Check if this is a series note (series/SeriesName/SeriesName.md)
    const folderName = parts[parts.length - 2];
    const fileName = parts[parts.length - 1].replace(".md", "");
    
    if (folderName === fileName) {
      // This is a series note
      if (folderName.toLowerCase().includes(searchLower) ||
          searchLower.includes(folderName.toLowerCase())) {
        matches.push({
          name: folderName,
          path: file.path,
          file: file
        });
      }
    }
  }
  
  return matches;
}

/**
 * Find existing series note in vault by exact name
 * 
 * @param {Object} app - Obsidian app object
 * @param {string} seriesName - Exact series name
 * @param {string} seriesFolder - Folder path for series (e.g., "shows/series")
 * @returns {TFile|null} - The file if found, null otherwise
 * 
 * @example
 * const file = findExistingSeriesInVault(app, "Dead Like Me", "shows/series");
 */
function findExistingSeriesInVault(app, seriesName, seriesFolder) {
  const safeName = safeFilename(seriesName);
  const notePath = `${seriesFolder}/${safeName}/${safeName}.md`;
  return app.vault.getAbstractFileByPath(notePath);
}

/**
 * Parse episode info from episode title string
 * Handles various formats: "S1E5", "Season 1 Episode 5", "Episode 5", etc.
 * 
 * @param {string} episodeTitle - Episode title string
 * @returns {{season: number, episode: number}|null} - Parsed info or null
 * 
 * @example
 * parseEpisodeInfo("S01E05 - Pilot") // {season: 1, episode: 5}
 * parseEpisodeInfo("Season 2 Episode 10") // {season: 2, episode: 10}
 * parseEpisodeInfo("Episode 3: The Beginning") // {season: 1, episode: 3}
 */
function parseEpisodeInfo(episodeTitle) {
  if (!episodeTitle) return null;
  
  // Try patterns like "S1E5" or "Season 1 Episode 5"
  let match = episodeTitle.match(/(?:S|Season\s*)(\d+)\s*(?:E|Episode\s*)(\d+)/i);
  if (match) {
    return { season: parseInt(match[1]), episode: parseInt(match[2]) };
  }
  
  // Try "Episode X" pattern (assume season 1)
  match = episodeTitle.match(/Episode\s+(\d+)/i);
  if (match) {
    return { season: 1, episode: parseInt(match[1]) };
  }
  
  return null;
}

// ============================================================================
// 15. EPISODE MATCHING UTILITIES
// ============================================================================

/**
 * Extract part number from episode title
 * Handles patterns like "Part 1", "Pt. 2", "(1)", etc.
 * 
 * @param {string} title - Episode title
 * @returns {{title: string, part: number|null}} - Base title and part number
 * 
 * @example
 * extractPartNumber("The Living Legend (1)") // {title: "The Living Legend", part: 1}
 * extractPartNumber("Golden Triangle, Pt. 2") // {title: "Golden Triangle", part: 2}
 * extractPartNumber("Regular Episode") // {title: "Regular Episode", part: null}
 */
function extractPartNumber(title) {
  const s = String(title || "").trim();
  
  let part = null;
  let baseTitle = s;
  
  // Pattern: ", Pt. N" or ", Pt N" at end (Prime style like "Golden Triangle, Pt. 2")
  let match = s.match(/^(.+?),\s*Pt\.?\s*(\d+)$/i);
  if (match) {
    baseTitle = match[1].trim();
    part = parseInt(match[2], 10);
    return { title: baseTitle, part };
  }
  
  // Pattern: "- Part N" or ": Part N" at end
  match = s.match(/^(.+?)\s*[-–:]\s*Part\s*(\d+)$/i);
  if (match) {
    baseTitle = match[1].trim();
    part = parseInt(match[2], 10);
    return { title: baseTitle, part };
  }
  
  // Pattern: " Part N" at end (with space)
  match = s.match(/^(.+?)\s+Part\s*(\d+)$/i);
  if (match) {
    baseTitle = match[1].trim();
    part = parseInt(match[2], 10);
    return { title: baseTitle, part };
  }
  
  // Pattern: "(N)" at end - TMDB style like "The Living Legend (1)"
  match = s.match(/^(.+?)\s*\((\d+)\)$/);
  if (match) {
    baseTitle = match[1].trim();
    part = parseInt(match[2], 10);
    return { title: baseTitle, part };
  }
  
  // Pattern: " Pt. N" or " Pt N" (without comma)
  match = s.match(/^(.+?)\s+Pt\.?\s*(\d+)$/i);
  if (match) {
    baseTitle = match[1].trim();
    part = parseInt(match[2], 10);
    return { title: baseTitle, part };
  }
  
  return { title: baseTitle, part };
}

/**
 * Normalize a title for comparison (lowercase, strip punctuation)
 * @param {string} title - Title to normalize
 * @returns {string} - Normalized title
 */
function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize base title after stripping part numbers
 * @param {string} title - Episode title
 * @returns {string} - Normalized base title
 */
function normalizeBaseTitle(title) {
  const { title: baseTitle } = extractPartNumber(title);
  return normalizeTitle(baseTitle);
}

/**
 * Clean episode title from streaming service prefixes
 * Strips patterns like "SeriesName: Season X Episode Y Title"
 * 
 * @param {string} csvTitle - Raw episode title from CSV/API
 * @param {string} seriesName - Series name (optional, for matching)
 * @returns {{cleanedTitle: string, isGeneric: boolean, isPilot: boolean}}
 */
function cleanEpisodeTitle(csvTitle, seriesName = "") {
  let title = String(csvTitle || "").trim();
  if (!title) return { cleanedTitle: "", isGeneric: true, isPilot: false };
  
  const normalizedSeriesName = normalizeTitle(seriesName);
  
  // Step 1: Strip "SeriesName: Season X Episode Y " prefix
  // Pattern: "Chuck: Season 2 Episode 21 Chuck Versus the Colonel"
  const seasonEpPrefixMatch = title.match(/^(.+?):\s*Season\s*\d+\s*Episode\s*\d+\s+(.+)$/i);
  if (seasonEpPrefixMatch) {
    title = seasonEpPrefixMatch[2].trim();
  }
  
  // Step 2: Strip "SeriesName - " prefix (but check if something remains)
  const dashPrefixMatch = title.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (dashPrefixMatch) {
    const beforeDash = normalizeTitle(dashPrefixMatch[1]);
    const afterDash = dashPrefixMatch[2].trim();
    // Only strip if the prefix looks like the series name
    if (normalizedSeriesName && stringSimilarity(beforeDash, normalizedSeriesName) >= 0.7) {
      title = afterDash;
    }
  }
  
  // Step 3: Handle "(Pilot)" suffix
  if (/\(Pilot\)/i.test(title)) {
    title = title.replace(/\s*\(Pilot\)\s*/i, "").trim();
    return { cleanedTitle: title || "Pilot", isGeneric: false, isPilot: true };
  }
  
  // Step 4: Check if it's just "Pilot"
  if (/^Pilot$/i.test(title)) {
    return { cleanedTitle: "Pilot", isGeneric: false, isPilot: true };
  }
  
  // Step 5: Check for generic "Episode N" titles
  if (/^Episode\s*\d+$/i.test(title)) {
    return { cleanedTitle: title, isGeneric: true, isPilot: false };
  }
  
  return { cleanedTitle: title, isGeneric: false, isPilot: false };
}

/**
 * Check if CSV title is a prefix/subset of TMDB title
 * Handles cases like "Calderone's Return" vs "Calderone's Return The Hit List"
 * 
 * @param {string} csvTitle - CSV/source episode title
 * @param {string} tmdbTitle - TMDB episode title
 * @returns {boolean} - True if CSV is prefix of TMDB
 */
function isTitlePrefix(csvTitle, tmdbTitle) {
  const csv = normalizeTitle(csvTitle);
  const tmdb = normalizeTitle(tmdbTitle);
  
  if (!csv || !tmdb) return false;
  
  // Direct prefix check
  if (tmdb.startsWith(csv)) return true;
  
  // Check if all CSV words appear at the start of TMDB title in order
  const csvWords = csv.split(/\s+/);
  const tmdbWords = tmdb.split(/\s+/);
  
  if (csvWords.length <= tmdbWords.length) {
    const allMatch = csvWords.every((word, i) => {
      const tmdbWord = tmdbWords[i] || "";
      return tmdbWord.startsWith(word.substring(0, 3)) || word.startsWith(tmdbWord.substring(0, 3));
    });
    if (allMatch) return true;
  }
  
  return false;
}

// ============================================================================
// 16. EPISODE CACHE & MATCHING
// ============================================================================

/**
 * Build episode cache from vault files for a series
 * Extracts episode numbers and titles from existing episode notes
 * 
 * @param {Object} app - Obsidian app object
 * @param {string} seriesName - Series name
 * @param {string} seriesFolder - Folder path for series (e.g., "shows/series")
 * @returns {Object|null} - Cache object like {S1: [{number, title}], S2: [...]} or null
 * 
 * @example
 * const cache = buildEpisodeCacheFromVault(app, "Battlestar Galactica", "shows/series");
 * // {S1: [{number: 1, title: "Saga of a Star World"}, ...]}
 */
function buildEpisodeCacheFromVault(app, seriesName, seriesFolder) {
  const folderPath = `${seriesFolder}/${safeFilename(seriesName)}`;
  const files = app.vault.getFiles().filter((f) =>
    f.path.startsWith(folderPath + "/") &&
    f.basename.match(/^S\d+E\d+/)
  );

  if (files.length === 0) return null;

  const cache = {};
  for (const file of files) {
    // Parse S01E05 from filename
    const match = file.basename.match(/^S(\d+)E(\d+)/);
    if (!match) continue;

    const season = parseInt(match[1], 10);
    const episode = parseInt(match[2], 10);
    const seasonKey = `S${season}`;

    // Get title from filename (after " - ")
    const titleMatch = file.basename.match(/^S\d+E\d+\s*-\s*(.+)$/);
    const title = titleMatch ? titleMatch[1] : "";

    if (!cache[seasonKey]) cache[seasonKey] = [];
    cache[seasonKey].push({ number: episode, title });
  }

  // Sort each season by episode number
  for (const seasonKey of Object.keys(cache)) {
    cache[seasonKey].sort((a, b) => a.number - b.number);
  }

  return cache;
}

/**
 * Find TMDB episode by title matching with confidence scoring
 * Handles part numbers, fuzzy matching, and prefix matching
 * 
 * @param {Object} cache - Episode cache from buildEpisodeCacheFromVault
 * @param {number} season - Season number to search
 * @param {string} csvEpisodeTitle - Episode title from source
 * @param {number|null} csvPartNumber - Part number if known
 * @param {number|null} csvEpisodeNumber - Episode number from source (for pilot fallback)
 * @param {string} seriesName - Series name (for pilot detection)
 * @returns {{number: number, title: string, confidence: number}|null} - Best match or null
 */
function findTmdbEpisodeByTitle(cache, season, csvEpisodeTitle, csvPartNumber = null, csvEpisodeNumber = null, seriesName = "") {
  const seasonKey = `S${season}`;
  const seasonEpisodes = cache?.[seasonKey];
  if (!seasonEpisodes || seasonEpisodes.length === 0) return null;

  // Clean the title
  const { cleanedTitle, isGeneric, isPilot } = cleanEpisodeTitle(csvEpisodeTitle, seriesName);
  
  // Use cleaned title for matching
  const titleToMatch = cleanedTitle || csvEpisodeTitle;
  
  // Use provided part number, or try to extract from title
  const csvParsed = extractPartNumber(titleToMatch);
  const csvBaseTitle = normalizeBaseTitle(titleToMatch);
  const csvPart = csvPartNumber !== null ? csvPartNumber : csvParsed.part;
  
  // Handle pilot episodes specially
  if (isPilot && csvEpisodeNumber === 1) {
    const ep1 = seasonEpisodes.find(ep => ep.number === 1);
    if (ep1) {
      return { number: ep1.number, title: ep1.title, confidence: 0.8, method: "pilot" };
    }
  }
  
  // If title is generic ("Episode 1"), can't match by title
  if (isGeneric) {
    return null;
  }

  if (!csvBaseTitle) return null;

  // Find matches - prioritize part-number matches
  let exactPartMatch = null;
  let baseTitleMatches = [];
  let prefixMatches = [];
  let bestFuzzyMatch = null;
  let bestFuzzyScore = 0;

  for (const ep of seasonEpisodes) {
    const tmdbParsed = extractPartNumber(ep.title);
    const tmdbBaseTitle = normalizeBaseTitle(ep.title);
    const tmdbPart = tmdbParsed.part;

    // Check base title similarity
    const baseSimilarity = stringSimilarity(csvBaseTitle, tmdbBaseTitle);
    
    // Check if CSV title is a prefix of TMDB title
    const isPrefix = isTitlePrefix(csvBaseTitle, tmdbBaseTitle);
    
    // Exact base title match (high similarity)
    if (csvBaseTitle === tmdbBaseTitle || baseSimilarity >= 0.9) {
      // Both have part numbers - must match
      if (csvPart !== null && tmdbPart !== null) {
        if (csvPart === tmdbPart) {
          exactPartMatch = { number: ep.number, title: ep.title, confidence: 1.0, method: "exact-part" };
        }
        // Parts don't match - skip
      } else if (csvPart !== null && tmdbPart === null) {
        // CSV has part but TMDB doesn't - likely TMDB combines parts
        baseTitleMatches.push({ number: ep.number, title: ep.title, confidence: 0.7, method: "combined" });
      } else if (csvPart === null && tmdbPart !== null) {
        // TMDB has part but CSV doesn't
        baseTitleMatches.push({ number: ep.number, title: ep.title, confidence: 0.7, method: "split" });
      } else {
        // Neither has part - exact match
        exactPartMatch = { number: ep.number, title: ep.title, confidence: 1.0, method: "exact" };
      }
    } else if (isPrefix && csvPart !== null && tmdbPart !== null) {
      // CSV title is prefix AND both have part numbers
      if (csvPart === tmdbPart) {
        prefixMatches.push({ number: ep.number, title: ep.title, confidence: 0.85, method: "prefix-part" });
      }
    } else if (isPrefix && csvPart !== null && tmdbPart === null) {
      // CSV has part, TMDB doesn't but title is prefix
      prefixMatches.push({ number: ep.number, title: ep.title, confidence: 0.6, method: "prefix-combined" });
    } else if (baseSimilarity > bestFuzzyScore) {
      // Fuzzy match - apply part number penalty if mismatched
      let adjustedScore = baseSimilarity;
      if (csvPart !== null && tmdbPart !== null && csvPart !== tmdbPart) {
        adjustedScore *= 0.5; // Heavy penalty for part mismatch
      }
      if (adjustedScore > bestFuzzyScore) {
        bestFuzzyScore = adjustedScore;
        bestFuzzyMatch = { number: ep.number, title: ep.title, confidence: adjustedScore, method: "fuzzy" };
      }
    }
  }

  // Return best match in priority order
  if (exactPartMatch) return exactPartMatch;
  if (baseTitleMatches.length > 0) return baseTitleMatches[0];
  if (prefixMatches.length > 0) return prefixMatches[0];
  if (bestFuzzyMatch && bestFuzzyScore >= 0.5) return bestFuzzyMatch;

  return null;
}

/**
 * Search all seasons for an episode title match
 * Used when episode isn't found in the expected season
 * 
 * @param {Object} cache - Episode cache from buildEpisodeCacheFromVault
 * @param {string} episodeTitle - Episode title to find
 * @param {number} assumedSeason - Season to try first
 * @param {number|null} csvPartNumber - Part number if known
 * @param {number|null} csvEpisodeNumber - Episode number from source
 * @param {string} seriesName - Series name
 * @returns {{season: number, number: number, title: string, confidence: number}|null}
 */
function findEpisodeAcrossSeasons(cache, episodeTitle, assumedSeason = 1, csvPartNumber = null, csvEpisodeNumber = null, seriesName = "") {
  if (!cache) return null;
  
  // First try the assumed season
  const directMatch = findTmdbEpisodeByTitle(cache, assumedSeason, episodeTitle, csvPartNumber, csvEpisodeNumber, seriesName);
  if (directMatch && directMatch.confidence >= 0.7) {
    return { season: assumedSeason, ...directMatch };
  }
  
  // Search all other seasons
  let bestMatch = null;
  for (const seasonKey of Object.keys(cache)) {
    const seasonNum = parseInt(seasonKey.replace('S', ''), 10);
    if (seasonNum === assumedSeason) continue; // Already tried
    
    const match = findTmdbEpisodeByTitle(cache, seasonNum, episodeTitle, csvPartNumber, csvEpisodeNumber, seriesName);
    if (match && match.confidence >= 0.7) {
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestMatch = { season: seasonNum, ...match };
      }
    }
  }
  
  if (bestMatch) return bestMatch;
  
  // Return direct match even if low confidence (let caller decide)
  if (directMatch) {
    return { season: assumedSeason, ...directMatch };
  }
  
  return null;
}

// ============================================================================
// 17. INTERACTIVE EPISODE PICKER
// ============================================================================

/**
 * Prompt user to select correct episode when title matching fails or has low confidence
 * Shows paginated list of episodes sorted by proximity to expected position
 * 
 * @param {Object} qa - QuickAdd API
 * @param {Function} Notice - Notice constructor
 * @param {string} seriesName - Series name
 * @param {number} season - Expected season number
 * @param {number} csvEpisode - Episode number from source
 * @param {string} csvTitle - Episode title from source
 * @param {Object} cache - Episode cache from buildEpisodeCacheFromVault
 * @param {Object} progress - Progress object with manualEpisodeMappings and skippedEpisodes
 * @param {boolean} showAllSeasons - Show episodes from all seasons
 * @param {number} offset - Pagination offset
 * @returns {Promise<{action: string, episode?: number, season?: number}>}
 * 
 * Returns:
 * - {action: "select", episode: N, season: S} - User selected episode
 * - {action: "skip"} - User chose to skip
 * - {action: "cancel"} - User cancelled import
 */
async function promptEpisodeSelection(qa, Notice, seriesName, season, csvEpisode, csvTitle, cache, progress, showAllSeasons = false, offset = 0) {
  // Check for existing mapping
  const episodeKey = `S${season}E${csvEpisode}`;
  const existingMapping = progress?.manualEpisodeMappings?.[seriesName]?.[episodeKey];
  if (existingMapping !== undefined) {
    if (existingMapping === null) {
      return { action: "skip" };
    }
    if (typeof existingMapping === 'object') {
      return { action: "select", episode: existingMapping.episode, season: existingMapping.season };
    }
    return { action: "select", episode: existingMapping, season };
  }
  
  // Check if already skipped
  if (progress?.skippedEpisodes?.[seriesName]?.includes(episodeKey)) {
    return { action: "skip" };
  }
  
  // Build list of all episodes
  let allEpisodes = [];
  
  if (showAllSeasons && cache) {
    // Show episodes from ALL seasons
    for (const [seasonKey, episodes] of Object.entries(cache)) {
      const seasonNum = parseInt(seasonKey.replace('S', ''), 10);
      for (const ep of episodes) {
        allEpisodes.push({
          season: seasonNum,
          number: ep.number,
          title: ep.title,
          // Calculate distance from assumed season/episode for sorting
          distance: Math.abs(seasonNum - season) * 100 + Math.abs(ep.number - csvEpisode)
        });
      }
    }
    // Sort by distance (closer seasons and episode numbers first)
    allEpisodes.sort((a, b) => a.distance - b.distance);
  } else if (cache) {
    // Show only episodes from the specified season
    const seasonKey = `S${season}`;
    const seasonEpisodes = cache[seasonKey] || [];
    allEpisodes = seasonEpisodes.map(ep => ({
      season,
      number: ep.number,
      title: ep.title,
      distance: Math.abs(ep.number - csvEpisode)
    }));
    allEpisodes.sort((a, b) => a.distance - b.distance);
  }
  
  const PAGE_SIZE = 15;
  const totalEpisodes = allEpisodes.length;
  const hasMore = offset + PAGE_SIZE < totalEpisodes;
  
  // Get current page of episodes
  const episodesToShow = allEpisodes.slice(offset, offset + PAGE_SIZE);
  
  // Format CSV episode info for display
  const csvEpFormatted = `S${String(season).padStart(2, '0')}E${String(csvEpisode).padStart(2, '0')}`;
  const headerText = `── ${seriesName} ${csvEpFormatted}: "${csvTitle}" ──`;
  const pageInfo = totalEpisodes > PAGE_SIZE ? ` (${offset + 1}-${Math.min(offset + PAGE_SIZE, totalEpisodes)} of ${totalEpisodes})` : "";
  
  const options = [
    headerText + pageInfo,
    `⏭️ Skip this episode`,
  ];
  const optionValues = [
    "header",
    "skip",
  ];
  
  // Add "Show previous" option if not on first page
  if (offset > 0) {
    options.push(`▲ Show previous episodes...`);
    optionValues.push("previous");
  }
  
  // Add episode options
  options.push(...episodesToShow.map(ep => 
    `→ S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')} - ${ep.title}`
  ));
  optionValues.push(...episodesToShow.map(ep => ({ season: ep.season, episode: ep.number })));
  
  // Add "Show more" option if there are more episodes
  if (hasMore) {
    options.push(`▼ Show more episodes (${totalEpisodes - offset - PAGE_SIZE} remaining)...`);
    optionValues.push("more");
  }
  
  // Add "Show all seasons" option if not already showing
  if (!showAllSeasons && cache && Object.keys(cache).length > 1) {
    options.push(`🔍 Search all seasons...`);
    optionValues.push("allSeasons");
  }
  
  // Add cancel option
  options.push("❌ Cancel import");
  optionValues.push("cancel");
  
  // Show context notice (only on first page)
  if (Notice && offset === 0) {
    const seasonNote = showAllSeasons ? " (showing all seasons)" : "";
    new Notice(`Episode mismatch: ${seriesName} ${csvEpFormatted}\nSource title: "${csvTitle}"${seasonNote}`, 5000);
  }
  
  const selection = await qa.suggester(options, optionValues);
  
  // Handle selection
  if (selection === "header") {
    // Re-prompt if header selected
    return await promptEpisodeSelection(qa, Notice, seriesName, season, csvEpisode, csvTitle, cache, progress, showAllSeasons, offset);
  }
  
  if (selection === "previous") {
    return await promptEpisodeSelection(qa, Notice, seriesName, season, csvEpisode, csvTitle, cache, progress, showAllSeasons, Math.max(0, offset - PAGE_SIZE));
  }
  
  if (selection === "more") {
    return await promptEpisodeSelection(qa, Notice, seriesName, season, csvEpisode, csvTitle, cache, progress, showAllSeasons, offset + PAGE_SIZE);
  }
  
  if (selection === "allSeasons") {
    return await promptEpisodeSelection(qa, Notice, seriesName, season, csvEpisode, csvTitle, cache, progress, true, 0);
  }
  
  if (selection === "skip") {
    return { action: "skip" };
  }
  
  if (selection === "cancel" || selection === undefined) {
    return { action: "cancel" };
  }
  
  // User selected an episode
  return { action: "select", episode: selection.episode, season: selection.season };
}

/**
 * Save manual episode mapping to progress
 * @param {Object} app - Obsidian app object
 * @param {string} progressFile - Path to progress file
 * @param {string} seriesName - Series name
 * @param {string} episodeKey - Episode key like "S1E5"
 * @param {{season: number, episode: number}|null} mapping - Mapping or null for skip
 */
async function saveEpisodeMapping(app, progressFile, seriesName, episodeKey, mapping) {
  try {
    const exists = await app.vault.adapter.exists(progressFile);
    let progress = {};
    if (exists) {
      const raw = await app.vault.adapter.read(progressFile);
      progress = JSON.parse(raw);
    }
    
    if (!progress.manualEpisodeMappings) {
      progress.manualEpisodeMappings = {};
    }
    if (!progress.manualEpisodeMappings[seriesName]) {
      progress.manualEpisodeMappings[seriesName] = {};
    }
    
    progress.manualEpisodeMappings[seriesName][episodeKey] = mapping;
    
    await app.vault.adapter.write(progressFile, JSON.stringify(progress, null, 2));
  } catch (e) {
    console.error("Failed to save episode mapping:", e);
  }
}

/**
 * Mark episode as skipped in progress
 * @param {Object} app - Obsidian app object
 * @param {string} progressFile - Path to progress file
 * @param {string} seriesName - Series name
 * @param {string} episodeKey - Episode key like "S1E5"
 */
async function markEpisodeSkipped(app, progressFile, seriesName, episodeKey) {
  try {
    const exists = await app.vault.adapter.exists(progressFile);
    let progress = {};
    if (exists) {
      const raw = await app.vault.adapter.read(progressFile);
      progress = JSON.parse(raw);
    }
    
    if (!progress.skippedEpisodes) {
      progress.skippedEpisodes = {};
    }
    if (!progress.skippedEpisodes[seriesName]) {
      progress.skippedEpisodes[seriesName] = [];
    }
    
    if (!progress.skippedEpisodes[seriesName].includes(episodeKey)) {
      progress.skippedEpisodes[seriesName].push(episodeKey);
    }
    
    await app.vault.adapter.write(progressFile, JSON.stringify(progress, null, 2));
  } catch (e) {
    console.error("Failed to mark episode skipped:", e);
  }
}

// ============================================================================
// EXPORTS (for reference - copy needed functions into your script)
// ============================================================================

// This file is a reference library. QuickAdd scripts cannot import modules.
// Copy the functions you need into your script.

/*
RECOMMENDED COPY ORDER FOR NEW SCRIPTS:

1. Always include:
   - pad2, localISODate, safeFilename, sanitizeForWikilink
   - quoteYamlString
   - ensureFolder

2. For CSV imports, add:
   - parseCSV, parseCSVLine, parseDate
   - createProgressTracker or individual progress functions

3. For API integrations, add:
   - loadSecrets
   - httpGetBuffer (for binary) or just use obsidian.requestUrl

4. For entity linking, add:
   - findExistingNoteByTitle, ensureNote
   - createEntityUpsert pattern

5. For visual pickers, add:
   - createVisualPickerModal, pickWithVisualModal

6. For imports with limits, add:
   - promptImportLimit

7. For searching existing items, add:
   - stringSimilarity, searchByTitle
   - readTrackerData, displaySearchResults

8. For incremental updates (partial data), add:
   - readExistingFrontmatter
   - detectDataSources, hasNewDataSources
   - mergeDataBySources

9. For series/show imports, add:
   - normalizeSeriesName
   - searchVaultForSeries, findExistingSeriesInVault
   - parseEpisodeInfo

10. For episode matching (TMDB translation), add:
    - extractPartNumber, normalizeTitle, normalizeBaseTitle
    - cleanEpisodeTitle, isTitlePrefix
    - buildEpisodeCacheFromVault
    - findTmdbEpisodeByTitle, findEpisodeAcrossSeasons
    - promptEpisodeSelection (for low-confidence matches)
*/
