// Export Books to CSV - QuickAdd Script for Obsidian
// ===================================================
// Exports all book notes to a comprehensive CSV file with all metadata.
//
// Usage:
//   1. Run this script via QuickAdd
//   2. Choose the output location (or accept default)
//   3. CSV will be saved to the selected location
//
// The script reads from the Books folder and extracts all frontmatter properties.
// Works on both desktop and iOS.

const SETTINGS = {
  bookFolder: "books/books",  // Match add-book.js folder structure
  defaultFilename: "books-export.csv",  // Default filename
  
  // CSV columns in order (matches frontmatter schema)
  columns: [
    "title",
    "subtitle",
    "author",
    "genre",
    "publisher",
    "publishDate",
    "totalPage",
    "isbn13",
    "isbn10",
    "format",
    "purchasedStore",
    "purchasedDate",
    "readingStatus",
    "readingStarted",
    "readingDone",
    "rating",
    "source",
    "google_volume_id",
    "appleTrackId",
    "bookKey",
    "localCoverImage",
    "via",
    "related_editions",
    "created",
    "description",
    "ai_summary",
  ],
};

module.exports = {
  entry: start,
  settings: {
    name: "Export Books to CSV",
    author: "QuickAdd Script",
    options: {},
  },
};

async function start(params, settings) {
  const { app, obsidian, quickAddApi: qa } = params;
  const Notice = obsidian?.Notice;

  // Get all folders in the vault
  const folders = getAllFolders(app);
  const folderOptions = [
    "/ (vault root)",
    ...folders.sort(),
  ];

  // Pick folder
  const selectedFolder = await qa.suggester(
    folderOptions,
    ["", ...folders.sort()]
  );

  if (selectedFolder === null || selectedFolder === undefined) {
    if (Notice) new Notice("Export cancelled.");
    return;
  }

  // Pick filename
  const filename = await qa.inputPrompt(
    "Filename",
    SETTINGS.defaultFilename,
    SETTINGS.defaultFilename
  );

  if (!filename || !filename.trim()) {
    if (Notice) new Notice("Export cancelled.");
    return;
  }

  // Build final path
  const cleanFilename = filename.trim().endsWith(".csv") 
    ? filename.trim() 
    : filename.trim() + ".csv";
  
  const finalPath = selectedFolder 
    ? `${selectedFolder}/${cleanFilename}`
    : cleanFilename;

  // Get all markdown files in the Books folder
  const allFiles = app.vault.getMarkdownFiles();
  const bookFiles = allFiles.filter((f) => f.path.startsWith(SETTINGS.bookFolder + "/"));

  if (bookFiles.length === 0) {
    if (Notice) new Notice(`No book notes found in ${SETTINGS.bookFolder}/`);
    return;
  }

  // Extract data from each book
  const books = [];
  for (const file of bookFiles) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;

    if (!fm) continue;

    const book = {};
    
    for (const col of SETTINGS.columns) {
      const value = fm[col];
      book[col] = normalizeValue(value);
    }
    
    // Use title from frontmatter, fallback to filename
    if (!book.title) {
      book.title = file.basename;
    }

    books.push(book);
  }

  if (books.length === 0) {
    if (Notice) new Notice("No books with frontmatter found.");
    return;
  }

  // Sort by title
  books.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  // Generate CSV header
  const header = SETTINGS.columns.join(",");
  
  // Generate CSV rows
  const rows = books.map((book) => {
    return SETTINGS.columns.map((col) => escapeCSV(book[col] || "")).join(",");
  });

  const csvContent = [header, ...rows].join("\n");

  // Ensure parent folder exists
  const folderPath = finalPath.split("/").slice(0, -1).join("/");
  if (folderPath) {
    await app.vault.adapter.mkdir(folderPath).catch(() => {});
  }

  // Write to file
  await app.vault.adapter.write(finalPath, csvContent);

  if (Notice) new Notice(`Exported ${books.length} books to ${finalPath}`);
}

// Normalize frontmatter values for CSV export
function normalizeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  
  // Handle arrays (author, genre, related_editions, etc.)
  if (Array.isArray(value)) {
    // Strip wikilinks and join with semicolons
    return value
      .map((v) => stripWikilink(String(v || "")))
      .filter(Boolean)
      .join("; ");
  }
  
  // Handle wikilinks in strings
  if (typeof value === "string") {
    return stripWikilink(value);
  }
  
  // Handle numbers
  if (typeof value === "number") {
    return String(value);
  }
  
  return String(value);
}

// Strip wikilink syntax: [[Note]] -> Note, [[Path/Note|Alias]] -> Alias
function stripWikilink(str) {
  const s = String(str || "").trim();
  
  // Match [[...]] pattern
  const match = s.match(/^\[\[([^\]]+)\]\]$/);
  if (!match) return s;
  
  const inner = match[1];
  
  // Check for alias: [[Note|Alias]]
  const pipeIndex = inner.indexOf("|");
  if (pipeIndex !== -1) {
    return inner.substring(pipeIndex + 1).trim();
  }
  
  // Check for path: [[Path/Note]] -> Note
  const slashIndex = inner.lastIndexOf("/");
  if (slashIndex !== -1) {
    return inner.substring(slashIndex + 1).trim();
  }
  
  return inner.trim();
}

// Get all folders in the vault
function getAllFolders(app) {
  const folders = new Set();
  
  for (const file of app.vault.getAllLoadedFiles()) {
    if (file.children !== undefined) {
      // It's a folder (TFolder has children property)
      if (file.path) {
        folders.add(file.path);
      }
    }
  }
  
  return Array.from(folders);
}

// Escape value for CSV (handle commas, quotes, newlines)
function escapeCSV(value) {
  const str = String(value || "");
  
  // Replace newlines with spaces for single-line CSV
  const cleaned = str.replace(/[\r\n]+/g, " ").trim();
  
  // If contains comma, quote, or special chars, wrap in quotes
  if (cleaned.includes(",") || cleaned.includes('"') || cleaned.includes(";")) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  
  return cleaned;
}
