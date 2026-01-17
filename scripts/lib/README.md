# QuickAdd Shared Library

This folder contains shared utility functions and documentation for QuickAdd scripts.

## Development Process

When creating new utility functions:

1. **Design first** - Add the function to `quickadd-core.js` with JSDoc comments
2. **Document** - Update this README with the new function
3. **Implement** - Copy the function into the relevant scripts
4. **Reference** - Update each script's header comment to list the copied function

This ensures consistency and makes it clear which functions are shared utilities.

---

## Important: QuickAdd Scripts are Self-Contained

QuickAdd does not support ES6 imports or CommonJS `require()` from other files. Each script must be completely self-contained with all functions it needs.

**The `quickadd-core.js` file is a reference library** - copy the functions you need into your script.

## File Structure

```
scripts/
├── lib/
│   ├── quickadd-core.js    # Reference library (copy-paste from here)
│   └── README.md           # This file
├── books.js                # Unified book script
├── shows.js                # Unified shows script (movies + TV)
├── health.js               # Unified health script
├── fitness.js              # Unified fitness script
└── archive/                # Old scripts (kept for reference)
```

## Unified Domain Scripts

Each domain script supports multiple input modes via a menu:

| Script | Modes |
|--------|-------|
| `books.js` | Manual, CSV Import, (Future: API, Extension) |
| `shows.js` | Manual, CSV Import, API Import (Emby, Prime, etc.) |
| `health.js` | CSV Import, (Future: API) |
| `fitness.js` | Manual, CSV Import, (Future: API) |

## Function Categories in quickadd-core.js

### 1. String Utilities
- `pad2(n)` - Zero-pad to 2 digits
- `localISODate(d)` - Format date as YYYY-MM-DD
- `safeFilename(s, maxLength)` - Sanitize for filenames
- `sanitizeForWikilink(name)` - Remove wikilink-breaking chars
- `normalise(s)` / `normalize(s)` - Lowercase + trim
- `stripHtml(html)` - Remove HTML tags
- `decodeHtmlEntities(s)` - Decode HTML entities
- `toWikilink(name)` - Wrap in `[[]]`
- `pathToWikilink(filePath)` - Convert path to wikilink
- `stripWikilink(v)` - Remove `[[]]` syntax

### 2. YAML Utilities
- `quoteYamlString(s)` - Escape for YAML double-quoted string
- `yamlBlockScalar(key, text)` - Multiline YAML text
- `yamlArray(key, arr)` - YAML array
- `yamlMaybeString(lines, key, value)` - Add string if non-empty
- `yamlMaybeNumber(lines, key, value)` - Add number if valid

### 3. CSV Parsing
- `parseCSV(text)` - Parse CSV to `{headers, rows}`
- `parseCSVLine(line)` - Parse single line with quote handling

### 4. Date Utilities
- `parseDate(dateStr)` - Parse DD/MM/YYYY, M/D/YYYY, YYYY-MM-DD
- `parsePublishedDate(raw)` - Handle YYYY, YYYY-MM, YYYY-MM-DD
- `addDays(date, days)` - Add/subtract days
- `promptForDate(qa, title)` - Date picker with recent options

### 5. File/Folder Operations
- `ensureFolder(app, folder)` - Create folder if missing
- `ensureNote(app, path, content)` - Create note if missing
- `findFileByName(app, fileName)` - Find file by name
- `findExistingNoteByTitle(app, activeFile, title)` - Find via metadata cache
- `getFrontmatter(app, file)` - Get frontmatter from file

### 6. HTTP Helpers
- `httpGetBuffer(obsidian, url, timeoutMs)` - GET binary data
- `downloadImage(obsidian, app, imageUrl, localPath)` - Download and save image
- `extFromUrl(url)` - Get file extension from URL

### 7. Progress Tracking
- `createProgressTracker(app, file, prefix)` - Create progress tracker
  - `.load()` - Load progress from file
  - `.save(progress)` - Save progress to file
  - `.markProcessed(id)` - Mark item as processed
  - `.isProcessed(id)` - Check if item was processed
  - `.resetByPrefix(prefix)` - Reset items with prefix
  - `.resetAll()` - Reset all progress

### 8. Secrets Loading
- `loadSecrets(app, secretsFile)` - Load from JSON file

### 9. Entity Upsert (Generic)
- `createEntityUpsert(config)` - Create entity upsert helper
  - `.ensureCategory(app)` - Ensure category note exists
  - `.createNote(app, name)` - Create entity note
  - `.upsert(app, name)` - Get or create entity, return wikilink
  - `.upsertAndLink(app, file, names, field)` - Upsert and update frontmatter

### 10. Visual Picker Modal
- `createVisualPickerModal(obsidian, app, items, config)` - Create modal class
- `pickWithVisualModal(obsidian, app, items, config)` - Show modal, return selection

### 11. Import Limit Selector
- `promptImportLimit(qa, totalAvailable)` - "Just 1", "First 5", etc.

### 12. Search Utilities
- `stringSimilarity(s1, s2)` - Calculate fuzzy match score (0-1)
- `searchByTitle(items, query, options)` - Search items with fuzzy matching
  - `options.titleField` - Field name for title (default: "title")
  - `options.additionalFields` - Additional fields to search
  - `options.minScore` - Minimum similarity (default: 0.3)
  - `options.maxResults` - Max results (default: 15)
- `readTrackerData(app, trackerFile)` - Read tracker JSON file
- `displaySearchResults(app, qa, Notice, results, formatItem)` - Show results and open selected

### 13. Incremental Update Utilities
For handling partial data imports (e.g., health data from multiple sources):

- `readExistingFrontmatter(app, notePath)` - Read existing note's frontmatter
- `detectDataSources(data, sourceFields)` - Check which data sources are present
- `hasNewDataSources(existingSources, newSources)` - Check if new data has sources not in existing
- `mergeDataBySources(existingData, newData, newSources, sourceFields)` - Merge with new data taking precedence

### 14. Series/Show Utilities

- `normalizeSeriesName(name)` - Strip "Season X", "S1", etc. and normalize unicode
- `searchVaultForSeries(app, searchName, seriesFolder)` - Find existing series by partial match
- `findExistingSeriesInVault(app, seriesName, seriesFolder)` - Find series by exact name
- `parseEpisodeInfo(episodeTitle)` - Parse "S01E05", "Season 1 Episode 5", "Episode 3", etc.

### 15. Episode Title Matching Utilities

For matching streaming service episode titles to TMDB episode numbers:

- `extractPartNumber(title)` - Extract part numbers like "Part 1", "Pt. 2", "(1)" from titles
- `normalizeTitle(title)` - Normalize title for comparison (lowercase, strip punctuation)
- `normalizeBaseTitle(title)` - Normalize title after stripping part numbers
- `cleanEpisodeTitle(csvTitle, seriesName)` - Strip streaming service prefixes
- `isTitlePrefix(csvTitle, tmdbTitle)` - Check if source title is prefix of TMDB title

### 16. Episode Cache & Matching

For building episode caches and matching with confidence scoring:

- `buildEpisodeCacheFromVault(app, seriesName, seriesFolder)` - Build cache of episodes from vault files
- `findTmdbEpisodeByTitle(cache, season, csvTitle, partNum, epNum, seriesName)` - Match with confidence
- `findEpisodeAcrossSeasons(cache, title, assumedSeason, partNum, epNum, seriesName)` - Cross-season search

The matching system uses confidence scores:
- **1.0**: Exact title match or exact part match
- **0.85**: CSV title is prefix of TMDB with matching part numbers
- **0.7**: Base titles match but parts differ (TMDB may combine parts)
- **0.5-0.9**: Fuzzy word-similarity matches

### 17. Interactive Episode Picker

For prompting user selection when title matching fails or has low confidence:

- `promptEpisodeSelection(qa, Notice, seriesName, season, csvEp, csvTitle, cache, progress, showAllSeasons, offset)` - Paginated picker
- `saveEpisodeMapping(app, progressFile, seriesName, episodeKey, mapping)` - Save user's selection
- `markEpisodeSkipped(app, progressFile, seriesName, episodeKey)` - Mark episode as skipped

Returns:
- `{action: "select", episode: N, season: S}` - User selected episode
- `{action: "skip"}` - User chose to skip
- `{action: "cancel"}` - User cancelled import

## Key Patterns

### Progress Tracking with Prefixes

Use prefixed IDs to enable selective reset:

```javascript
const progress = createProgressTracker(app, ".obsidian/progress.json", "emby-");

// Mark processed
await progress.markProcessed("item-123"); // Stored as "emby-item-123"

// Reset only Emby items
await progress.resetByPrefix("emby-");
```

### Entity Upsert Pattern

Create reusable upsert helpers for any entity type:

```javascript
const genreUpsert = createEntityUpsert({
  folder: "Genres",
  categoryPath: "Categories/Genres.md",
  categoryLink: "[[Categories/Genres]]",
  tag: "Genres",
  baseName: "Genre.base",
});

// Use it
const link = await genreUpsert.upsert(app, "Action");
// Returns "[[Action]]" and creates note if needed
```

### Watch Entry Return Pattern

All watch/create functions should return `{path, created}`:

```javascript
async function createWatchLogEntry(app, data) {
  // Check for existing
  const existing = findExistingWatch(app, data);
  if (existing) {
    return { path: existing.path, created: false };
  }
  
  // Create new
  const path = await createWatch(app, data);
  return { path, created: true };
}

// Usage - only update counts if new
const result = await createWatchLogEntry(app, data);
if (result.created) {
  await updateMovieWatched(app, movieName, date);
} else {
  console.log("Skipping duplicate watch");
}
```

## Secrets File

Store API keys in `.obsidian/quickadd-secrets.json`:

```json
{
  "googleBooksApiKey": "your_google_key",
  "tmdbApiKey": "your_tmdb_key",
  "embyServerUrl": "http://server:8096",
  "embyApiKey": "your_emby_key",
  "embyUserId": "your_user_id"
}
```

Load with:

```javascript
const secrets = await loadSecrets(app);
const apiKey = secrets.tmdbApiKey;
```

### Vault Tracker Sync

After imports, sync the vault tracker to update JSON snapshots:

```javascript
async function syncVaultTracker(app, Notice) {
  try {
    const trackerPath = "scripts/sync-tracker.js";
    const trackerExists = await app.vault.adapter.exists(trackerPath);
    if (!trackerExists) return;
    
    const trackerCode = await app.vault.adapter.read(trackerPath);
    const trackerModule = {};
    const moduleFunc = new Function("module", "exports", "require", trackerCode);
    moduleFunc(trackerModule, {}, () => {});
    
    if (trackerModule.exports?.syncTracker) {
      // Sync only the domain this script manages
      await trackerModule.exports.syncTracker(app, { 
        domains: ["books"], // or "shows", "health", "workouts"
        silent: true 
      });
    }
  } catch (e) {
    console.error("Failed to sync vault tracker:", e);
  }
}
```

Call at the end of each handler:

```javascript
await handleManual(app, qa, obsidian, Notice);
await syncVaultTracker(app, Notice);  // Update tracker after changes
```

## Creating a New Script

1. Start with the basic structure:

```javascript
// your-script.js — QuickAdd script for Obsidian
// Description of what it does
//
// ============================================================================
// Utilities copied from lib/quickadd-core.js:
//   - String: pad2, localISODate, safeFilename, sanitizeForWikilink
//   - YAML: quoteYamlString
//   - File: ensureFolder, ensureNote, getFrontmatter
// ============================================================================

// ===== SETTINGS =====
const SETTINGS = {
  folders: { /* ... */ },
  categories: { /* ... */ },
  // ...
};

// ===== UTILITIES (from quickadd-core.js) =====
function pad2(n) { return String(n).padStart(2, "0"); }
function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
// ... (paste other needed functions)

// ===== YOUR LOGIC =====
// (script-specific functions)

// ===== VAULT TRACKER SYNC =====
async function syncVaultTracker(app, Notice) { /* ... */ }

// ===== ENTRY POINT =====
module.exports = async (params) => {
  const app = params?.app;
  const qa = params?.quickAddApi;
  const obsidian = params?.obsidian;

  if (!app || !qa) {
    throw new Error("QuickAdd context missing");
  }

  const Notice = obsidian?.Notice || globalThis.Notice;

  // Your script logic here
  
  // Sync tracker after making changes
  await syncVaultTracker(app, Notice);
};
```

2. Copy needed functions from `quickadd-core.js` 
3. **Document which functions were copied** in the header comment
4. Implement your domain-specific logic
5. Call `syncVaultTracker()` at the end if your script modifies tracked data
6. Test with "Just 1" option before running full imports

## See Also

- **Main README**: `scripts/README.md` - Overview of all scripts and features
- **Vault Tracker**: `scripts/sync-tracker.js` - JSON snapshot generator
