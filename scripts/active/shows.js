// shows.js — Unified QuickAdd script for Obsidian
//
// Consolidates all show-related functionality:
//   - Manual TMDB search (movies & TV series)
//   - CSV import (generic watch history)
//   - API Import:
//     - Emby (Direct API)
//     - Emby (CSV + API)
//     - Prime (Extension queue)
//     - Future: Netflix, Apple TV, Disney+
//
// Creates series notes, movie notes, episode notes, and watch log entries.
// All modes use consistent {path, created} return pattern.
//
// iOS compatible: uses app.vault.adapter and obsidian.requestUrl
//
// ============================================================================
// Utilities copied from lib/quickadd-core.js:
//   - String: pad2, localISODate, safeFilename, sanitizeForWikilink
//   - YAML: quoteYamlString
//   - CSV: parseCSV, parseCSVLine
//   - Date: addDays, formatDateOption, promptForDate, parseDate
//   - File: ensureFolder, ensureNote
//   - Secrets: loadSecrets
//   - Progress: createProgressTracker pattern
//   - Visual Picker: createVisualPickerModal
//   - Import: promptImportLimit
//   - Search: stringSimilarity, searchByTitle (as searchShows)
//   - Series: normalizeSeriesName, searchVaultForSeries, findExistingSeriesInVault
//   - Episode Matching: extractPartNumber, normalizeTitle, normalizeBaseTitle,
//       cleanEpisodeTitle, isTitlePrefix, buildEpisodeCacheFromVault,
//       findTmdbEpisodeByTitle, findEpisodeAcrossSeasons, promptEpisodeSelection
// ============================================================================

// ============================================================================
// SETTINGS
// ============================================================================
const SETTINGS = {
  // Script paths
  syncTrackerPath: "scripts/active/sync-tracker.js",

  // Output folders
  folders: {
    movies: "shows/movies",
    series: "shows/series",
    watched: "shows/watched",
    covers: "shows/covers",
  },

  // Category wikilinks
  categories: {
    movies: "[[Movies]]",
    series: "[[Series]]",
    episodes: "[[Episodes]]",
    watched: "[[Watched]]",
  },

  // Progress tracking
  progressFile: ".obsidian/watch-import-progress.json",
  skippedLogFile: ".obsidian/watch-import-skipped.md",
  mismatchLogFile: ".obsidian/watch-episode-mismatches.md",

  // Secrets file
  secretsFile: ".obsidian/quickadd-secrets.json",

  // TMDB API
  tmdb: {
    baseUrl: "https://api.themoviedb.org/3",
    imageBaseUrl: "https://image.tmdb.org/t/p/w500",
  },

  // Max results in picker
  maxResults: 20,
  showPosterInSearch: true,

  // Genre upsert settings
  genreUpsert: {
    enabled: true,
    folder: "Genres",
    categoryPath: "Categories/Genres.md",
  },
  
  // Source mapping for CSV imports (source identifier -> wikilink)
  sourceMap: {
    prime: "[[Prime]]",
    netflix: "[[Netflix]]",
    emby: "[[Emby]]",
    stan: "[[Stan]]",
    youtube: "[[YouTube]]",
    "disney+": "[[Disney+]]",
    "apple tv+": "[[Apple TV+]]",
    dvd: "[[DVD]]",
    "blu-ray": "[[Blu-Ray]]",
    "4k blu-ray": "[[4K Blu-Ray]]",
    other: "[[Other]]",
  },
};

// ============================================================================
// SOURCE CONFIGURATIONS
// ============================================================================
const SOURCES = {
  embyDirect: {
    name: "Emby (Direct API)",
    wikilink: "[[Emby]]",
    prefix: "emby-",
    type: "api",
  },
  embyCsv: {
    name: "Emby (CSV)",
    wikilink: "[[Emby]]",
    prefix: "emby-csv-",
    type: "csv-api",
  },
  prime: {
    name: "Prime (Extension)",
    wikilink: "[[Prime]]",
    prefix: "prime-direct-",
    type: "extension",
    queueFile: ".obsidian/prime-import-queue.json",
  },
  netflix: {
    name: "Netflix (Extension)",
    wikilink: "[[Netflix]]",
    prefix: "netflix-",
    type: "extension",
    queueFile: ".obsidian/netflix-import-queue.json",
  },
  appletv: {
    name: "Apple TV (Future)",
    wikilink: "[[Apple TV]]",
    prefix: "appletv-",
    type: "extension",
    disabled: true,
  },
  disneyplus: {
    name: "Disney+ (Future)",
    wikilink: "[[Disney+]]",
    prefix: "disneyplus-",
    type: "extension",
    disabled: true,
  },
};

// Manual source options for manual mode
const MANUAL_SOURCE_OPTIONS = [
  "Prime", "Netflix", "Emby", "Stan", "YouTube",
  "Disney+", "Apple TV+", "DVD", "Blu-Ray", "4K Blu-Ray", "Other"
];

const MANUAL_SOURCE_MAP = {
  Prime: "[[Prime]]",
  Netflix: "[[Netflix]]",
  Emby: "[[Emby]]",
  Stan: "[[Stan]]",
  YouTube: "[[YouTube]]",
  "Disney+": "[[Disney+]]",
  "Apple TV+": "[[Apple TV+]]",
  DVD: "[[DVD]]",
  "Blu-Ray": "[[Blu-Ray]]",
  "4K Blu-Ray": "[[4K Blu-Ray]]",
  Other: "[[Other]]",
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

function safeFilename(s, maxLength = 100) {
  let result = String(s ?? "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (result.length > maxLength) {
    result = result.substring(0, maxLength).trim();
  }
  result = result.replace(/^[\s.\-]+/, "");
  return result || "Unknown";
}

function sanitizeForWikilink(name) {
  return String(name ?? "")
    .replace(/[\[\]|#^]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize series name for TMDB search
 * Strips "Season X", "S1", "Classic Season X", etc.
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
  // e.g., "Battlestar Galactica Classic Season 1" -> "Battlestar Galactica Classic"
  // e.g., "Two and a Half Men: Season 1" -> "Two and a Half Men"
  // e.g., "Jeremiah (Season 1)" -> "Jeremiah"
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
 * Search vault for existing series by name
 */
function searchVaultForSeries(app, searchName) {
  const searchLower = searchName.toLowerCase();
  const seriesFolder = SETTINGS.folders.series;
  
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
 * Returns { name, path, file } or null for consistency with searchVaultForSeries
 */
function findExistingSeriesInVault(app, seriesName) {
  const safeName = safeFilename(seriesName);
  const notePath = `${SETTINGS.folders.series}/${safeName}/${safeName}.md`;
  const file = app.vault.getAbstractFileByPath(notePath);
  if (file) {
    return {
      name: safeName,
      path: file.path,
      file: file
    };
  }
  return null;
}

// ============================================================================
// EPISODE MATCHING UTILITIES
// ============================================================================

/**
 * Extract part number from episode title
 * Handles patterns like "Part 1", "Pt. 2", "(1)", etc.
 */
function extractPartNumber(title) {
  const s = String(title || "").trim();
  
  let part = null;
  let baseTitle = s;
  
  // Pattern: ", Pt. N" or ", Pt N" at end
  let match = s.match(/^(.+?),\s*Pt\.?\s*(\d+)$/i);
  if (match) {
    return { title: match[1].trim(), part: parseInt(match[2], 10) };
  }
  
  // Pattern: "- Part N" or ": Part N" at end
  match = s.match(/^(.+?)\s*[-–:]\s*Part\s*(\d+)$/i);
  if (match) {
    return { title: match[1].trim(), part: parseInt(match[2], 10) };
  }
  
  // Pattern: " Part N" at end
  match = s.match(/^(.+?)\s+Part\s*(\d+)$/i);
  if (match) {
    return { title: match[1].trim(), part: parseInt(match[2], 10) };
  }
  
  // Pattern: "(N)" at end - TMDB style
  match = s.match(/^(.+?)\s*\((\d+)\)$/);
  if (match) {
    return { title: match[1].trim(), part: parseInt(match[2], 10) };
  }
  
  // Pattern: " Pt. N" or " Pt N"
  match = s.match(/^(.+?)\s+Pt\.?\s*(\d+)$/i);
  if (match) {
    return { title: match[1].trim(), part: parseInt(match[2], 10) };
  }
  
  return { title: baseTitle, part };
}

/**
 * Normalize a title for comparison
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
 */
function normalizeBaseTitle(title) {
  const { title: baseTitle } = extractPartNumber(title);
  return normalizeTitle(baseTitle);
}

/**
 * Clean episode title from streaming service prefixes
 */
function cleanEpisodeTitle(csvTitle, seriesName = "") {
  let title = String(csvTitle || "").trim();
  if (!title) return { cleanedTitle: "", isGeneric: true, isPilot: false };
  
  const normalizedSeriesName = normalizeTitle(seriesName);
  
  // Strip "SeriesName: Season X Episode Y " prefix
  const seasonEpPrefixMatch = title.match(/^(.+?):\s*Season\s*\d+\s*Episode\s*\d+\s+(.+)$/i);
  if (seasonEpPrefixMatch) {
    title = seasonEpPrefixMatch[2].trim();
  }
  
  // Strip "SeriesName - " prefix
  const dashPrefixMatch = title.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (dashPrefixMatch) {
    const beforeDash = normalizeTitle(dashPrefixMatch[1]);
    const afterDash = dashPrefixMatch[2].trim();
    if (normalizedSeriesName && stringSimilarity(beforeDash, normalizedSeriesName) >= 0.7) {
      title = afterDash;
    }
  }
  
  // Handle "(Pilot)" suffix
  if (/\(Pilot\)/i.test(title)) {
    title = title.replace(/\s*\(Pilot\)\s*/i, "").trim();
    return { cleanedTitle: title || "Pilot", isGeneric: false, isPilot: true };
  }
  
  if (/^Pilot$/i.test(title)) {
    return { cleanedTitle: "Pilot", isGeneric: false, isPilot: true };
  }
  
  if (/^Episode\s*\d+$/i.test(title)) {
    return { cleanedTitle: title, isGeneric: true, isPilot: false };
  }
  
  return { cleanedTitle: title, isGeneric: false, isPilot: false };
}

/**
 * Check if CSV title is a prefix of TMDB title
 */
function isTitlePrefix(csvTitle, tmdbTitle) {
  const csv = normalizeTitle(csvTitle);
  const tmdb = normalizeTitle(tmdbTitle);
  
  if (!csv || !tmdb) return false;
  if (tmdb.startsWith(csv)) return true;
  
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

/**
 * Build episode cache from vault files for a series
 */
function buildEpisodeCacheFromVault(app, seriesName) {
  const folderPath = `${SETTINGS.folders.series}/${safeFilename(seriesName)}`;
  const files = app.vault.getFiles().filter((f) =>
    f.path.startsWith(folderPath + "/") &&
    f.basename.match(/^S\d+E\d+/)
  );

  if (files.length === 0) return null;

  const cache = {};
  for (const file of files) {
    const match = file.basename.match(/^S(\d+)E(\d+)/);
    if (!match) continue;

    const season = parseInt(match[1], 10);
    const episode = parseInt(match[2], 10);
    const seasonKey = `S${season}`;

    const titleMatch = file.basename.match(/^S\d+E\d+\s*-\s*(.+)$/);
    const title = titleMatch ? titleMatch[1] : "";

    if (!cache[seasonKey]) cache[seasonKey] = [];
    cache[seasonKey].push({ number: episode, title });
  }

  for (const seasonKey of Object.keys(cache)) {
    cache[seasonKey].sort((a, b) => a.number - b.number);
  }

  return cache;
}

/**
 * Find TMDB episode by title matching with confidence scoring
 */
function findTmdbEpisodeByTitle(cache, season, csvEpisodeTitle, csvPartNumber = null, csvEpisodeNumber = null, seriesName = "") {
  const seasonKey = `S${season}`;
  const seasonEpisodes = cache?.[seasonKey];
  if (!seasonEpisodes || seasonEpisodes.length === 0) return null;

  const { cleanedTitle, isGeneric, isPilot } = cleanEpisodeTitle(csvEpisodeTitle, seriesName);
  const titleToMatch = cleanedTitle || csvEpisodeTitle;
  
  const csvParsed = extractPartNumber(titleToMatch);
  const csvBaseTitle = normalizeBaseTitle(titleToMatch);
  const csvPart = csvPartNumber !== null ? csvPartNumber : csvParsed.part;
  
  // Handle pilot episodes
  if (isPilot && csvEpisodeNumber === 1) {
    const ep1 = seasonEpisodes.find(ep => ep.number === 1);
    if (ep1) {
      return { number: ep1.number, title: ep1.title, confidence: 0.8, method: "pilot" };
    }
  }
  
  if (isGeneric) return null;
  if (!csvBaseTitle) return null;

  let exactPartMatch = null;
  let baseTitleMatches = [];
  let prefixMatches = [];
  let bestFuzzyMatch = null;
  let bestFuzzyScore = 0;

  for (const ep of seasonEpisodes) {
    const tmdbParsed = extractPartNumber(ep.title);
    const tmdbBaseTitle = normalizeBaseTitle(ep.title);
    const tmdbPart = tmdbParsed.part;

    const baseSimilarity = stringSimilarity(csvBaseTitle, tmdbBaseTitle);
    const isPrefix = isTitlePrefix(csvBaseTitle, tmdbBaseTitle);
    
    if (csvBaseTitle === tmdbBaseTitle || baseSimilarity >= 0.9) {
      if (csvPart !== null && tmdbPart !== null) {
        if (csvPart === tmdbPart) {
          exactPartMatch = { number: ep.number, title: ep.title, confidence: 1.0, method: "exact-part" };
        }
      } else if (csvPart !== null && tmdbPart === null) {
        baseTitleMatches.push({ number: ep.number, title: ep.title, confidence: 0.7, method: "combined" });
      } else if (csvPart === null && tmdbPart !== null) {
        baseTitleMatches.push({ number: ep.number, title: ep.title, confidence: 0.7, method: "split" });
      } else {
        exactPartMatch = { number: ep.number, title: ep.title, confidence: 1.0, method: "exact" };
      }
    } else if (isPrefix && csvPart !== null && tmdbPart !== null) {
      if (csvPart === tmdbPart) {
        prefixMatches.push({ number: ep.number, title: ep.title, confidence: 0.85, method: "prefix-part" });
      }
    } else if (isPrefix && csvPart !== null && tmdbPart === null) {
      prefixMatches.push({ number: ep.number, title: ep.title, confidence: 0.6, method: "prefix-combined" });
    } else if (baseSimilarity > bestFuzzyScore) {
      let adjustedScore = baseSimilarity;
      if (csvPart !== null && tmdbPart !== null && csvPart !== tmdbPart) {
        adjustedScore *= 0.5;
      }
      if (adjustedScore > bestFuzzyScore) {
        bestFuzzyScore = adjustedScore;
        bestFuzzyMatch = { number: ep.number, title: ep.title, confidence: adjustedScore, method: "fuzzy" };
      }
    }
  }

  if (exactPartMatch) return exactPartMatch;
  if (baseTitleMatches.length > 0) return baseTitleMatches[0];
  if (prefixMatches.length > 0) return prefixMatches[0];
  if (bestFuzzyMatch && bestFuzzyScore >= 0.5) return bestFuzzyMatch;

  return null;
}

/**
 * Search all seasons for an episode title match
 */
function findEpisodeAcrossSeasons(cache, episodeTitle, assumedSeason = 1, csvPartNumber = null, csvEpisodeNumber = null, seriesName = "") {
  if (!cache) return null;
  
  const directMatch = findTmdbEpisodeByTitle(cache, assumedSeason, episodeTitle, csvPartNumber, csvEpisodeNumber, seriesName);
  if (directMatch && directMatch.confidence >= 0.7) {
    return { season: assumedSeason, ...directMatch };
  }
  
  let bestMatch = null;
  for (const seasonKey of Object.keys(cache)) {
    const seasonNum = parseInt(seasonKey.replace('S', ''), 10);
    if (seasonNum === assumedSeason) continue;
    
    const match = findTmdbEpisodeByTitle(cache, seasonNum, episodeTitle, csvPartNumber, csvEpisodeNumber, seriesName);
    if (match && match.confidence >= 0.7) {
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestMatch = { season: seasonNum, ...match };
      }
    }
  }
  
  if (bestMatch) return bestMatch;
  if (directMatch) return { season: assumedSeason, ...directMatch };
  
  return null;
}

/**
 * Prompt user to select correct episode when matching fails or has low confidence
 */
async function promptEpisodeSelection(qa, Notice, seriesName, season, csvEpisode, csvTitle, cache, progress, showAllSeasons = false, offset = 0) {
  const episodeKey = `S${season}E${csvEpisode}`;
  const existingMapping = progress?.manualEpisodeMappings?.[seriesName]?.[episodeKey];
  if (existingMapping !== undefined) {
    if (existingMapping === null) return { action: "skip" };
    if (typeof existingMapping === 'object') {
      return { action: "select", episode: existingMapping.episode, season: existingMapping.season };
    }
    return { action: "select", episode: existingMapping, season };
  }
  
  if (progress?.skippedEpisodes?.[seriesName]?.includes(episodeKey)) {
    return { action: "skip" };
  }
  
  let allEpisodes = [];
  
  if (showAllSeasons && cache) {
    for (const [seasonKey, episodes] of Object.entries(cache)) {
      const seasonNum = parseInt(seasonKey.replace('S', ''), 10);
      for (const ep of episodes) {
        allEpisodes.push({
          season: seasonNum,
          number: ep.number,
          title: ep.title,
          distance: Math.abs(seasonNum - season) * 100 + Math.abs(ep.number - csvEpisode)
        });
      }
    }
    allEpisodes.sort((a, b) => a.distance - b.distance);
  } else if (cache) {
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
  const episodesToShow = allEpisodes.slice(offset, offset + PAGE_SIZE);
  
  const csvEpFormatted = `S${String(season).padStart(2, '0')}E${String(csvEpisode).padStart(2, '0')}`;
  const headerText = `── ${seriesName} ${csvEpFormatted}: "${csvTitle}" ──`;
  const pageInfo = totalEpisodes > PAGE_SIZE ? ` (${offset + 1}-${Math.min(offset + PAGE_SIZE, totalEpisodes)} of ${totalEpisodes})` : "";
  
  const options = [headerText + pageInfo, `⏭️ Skip this episode`];
  const optionValues = ["header", "skip"];
  
  if (offset > 0) {
    options.push(`▲ Show previous episodes...`);
    optionValues.push("previous");
  }
  
  options.push(...episodesToShow.map(ep => 
    `→ S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')} - ${ep.title}`
  ));
  optionValues.push(...episodesToShow.map(ep => ({ season: ep.season, episode: ep.number })));
  
  if (hasMore) {
    options.push(`▼ Show more episodes (${totalEpisodes - offset - PAGE_SIZE} remaining)...`);
    optionValues.push("more");
  }
  
  if (!showAllSeasons && cache && Object.keys(cache).length > 1) {
    options.push(`🔍 Search all seasons...`);
    optionValues.push("allSeasons");
  }
  
  options.push("❌ Cancel import");
  optionValues.push("cancel");
  
  if (Notice && offset === 0) {
    const seasonNote = showAllSeasons ? " (showing all seasons)" : "";
    new Notice(`Episode mismatch: ${seriesName} ${csvEpFormatted}\nSource title: "${csvTitle}"${seasonNote}`, 5000);
  }
  
  const selection = await qa.suggester(options, optionValues);
  
  if (selection === "header") {
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
  if (selection === "skip") return { action: "skip" };
  if (selection === "cancel" || selection === undefined) return { action: "cancel" };
  
  return { action: "select", episode: selection.episode, season: selection.season };
}

/**
 * Prompt user to confirm series identity when fuzzy matches exist in vault
 * Returns: { action: "existing"|"new"|"skip", match?: { name, file } }
 */
async function promptConfirmSeriesIdentity(qa, seriesName, vaultMatches) {
  // Truncate display name if too long or malformed
  const displayName = seriesName.length > 40 ? seriesName.substring(0, 40) + "..." : seriesName;
  
  const options = [
    `── Which show is "${displayName}"? ──`,
    ...vaultMatches.slice(0, 15).map(m => `📺 ${m.name}`),
    "✨ None of these - it's a new show",
    "⏭️ Skip this item",
  ];
  const values = ["header", ...vaultMatches.slice(0, 15), "new", "skip"];
  
  let selection = await qa.suggester(options, values);
  while (selection === "header") {
    selection = await qa.suggester(options, values);
  }
  
  if (selection === "skip") {
    return { action: "skip" };
  }
  if (selection === "new" || selection === undefined) {
    return { action: "new" };
  }
  return { action: "existing", match: selection };
}

/**
 * Prompt user to Add/Skip/Cancel a new series
 * Returns: "add" | "skip" | "cancel"
 */
async function promptSeriesAction(qa, seriesName) {
  const options = [
    `── "${seriesName}" (new series) ──`,
    "➕ Add Show (import from TMDB)",
    "⏭️ Skip Show (add to skip list)",
    "❌ Cancel Import (stop entirely)",
  ];
  const values = ["header", "add", "skip", "cancel"];
  
  let selection = await qa.suggester(options, values);
  while (selection === "header") {
    selection = await qa.suggester(options, values);
  }
  
  return selection || "cancel";
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

// ============================================================================
// CSV PARSING
// ============================================================================

/**
 * Parse CSV text into headers and rows
 * @param {string} text - CSV text content
 * @returns {{headers: string[], rows: Object[]}} - Parsed data
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
// DATE UTILITIES
// ============================================================================
function parseDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY (Australian format)
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // ISO with time
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return s;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDateOption(date, label) {
  const dateStr = localISODate(date);
  return { label: `${label} (${dateStr})`, value: dateStr };
}

async function promptForDate(qa, title = "Date watched") {
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
// CSV PARSING
// ============================================================================
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
// FILE/FOLDER OPERATIONS
// ============================================================================
async function ensureFolder(app, folder) {
  const f = String(folder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!f) return;

  const exists = await app.vault.adapter.exists(f);
  if (exists) return;

  try {
    await app.vault.adapter.mkdir(f);
  } catch (e) {
    const nowExists = await app.vault.adapter.exists(f);
    if (!nowExists) {
      console.error(`Failed to create folder: ${f}`, e);
    }
  }
}

async function ensureNote(app, notePath, defaultContent) {
  const exists = await app.vault.adapter.exists(notePath);
  if (!exists) {
    const folder = notePath.split("/").slice(0, -1).join("/");
    if (folder) await ensureFolder(app, folder);
    await app.vault.create(notePath, defaultContent);
  }
}

// ============================================================================
// SECRETS LOADING
// ============================================================================
async function loadSecrets(app) {
  try {
    const exists = await app.vault.adapter.exists(SETTINGS.secretsFile);
    if (!exists) return {};
    const raw = await app.vault.adapter.read(SETTINGS.secretsFile);
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ============================================================================
// PROGRESS TRACKING
// ============================================================================
function getDefaultProgress() {
  return {
    processedWatchIds: [],
    fetchedSeries: {},
    fetchedMovies: {},
    unfoundSeries: {},
    unfoundMovies: {},
    manualSeriesSelections: {},
    manualEpisodeMappings: {},
    skippedEpisodes: {},
    skippedSeries: {},    // { "PlatformName": { source: "netflix", skippedAt: "2026-01-14" } }
    seriesAliases: {},    // { "PlatformName": { tmdbName: "TMDB Name", tmdbId: 12345 } }
  };
}

async function loadProgress(app) {
  try {
    const exists = await app.vault.adapter.exists(SETTINGS.progressFile);
    if (!exists) return getDefaultProgress();
    const raw = await app.vault.adapter.read(SETTINGS.progressFile);
    const loaded = JSON.parse(raw);
    return { ...getDefaultProgress(), ...loaded };
  } catch {
    return getDefaultProgress();
  }
}

async function saveProgress(app, progress) {
  try {
    const folder = SETTINGS.progressFile.split("/").slice(0, -1).join("/");
    if (folder) await app.vault.adapter.mkdir(folder).catch(() => {});
    await app.vault.adapter.write(SETTINGS.progressFile, JSON.stringify(progress, null, 2));
  } catch (e) {
    console.error("Failed to save progress:", e);
  }
}

async function markWatchProcessed(app, watchId) {
  const progress = await loadProgress(app);
  if (!progress.processedWatchIds.includes(watchId)) {
    progress.processedWatchIds.push(watchId);
    await saveProgress(app, progress);
  }
}

async function markSeriesFetched(app, seriesName, tmdbId) {
  const progress = await loadProgress(app);
  progress.fetchedSeries[seriesName] = tmdbId;
  await saveProgress(app, progress);
}

// --- Skip Tracking ---
async function markSeriesSkipped(app, seriesName, source) {
  const progress = await loadProgress(app);
  progress.skippedSeries = progress.skippedSeries || {};
  progress.skippedSeries[seriesName] = {
    source,
    skippedAt: new Date().toISOString().split('T')[0]
  };
  await saveProgress(app, progress);
  console.log(`Marked series as skipped: "${seriesName}" (source: ${source})`);
}

async function removeSeriesFromSkipped(app, seriesName) {
  const progress = await loadProgress(app);
  if (progress.skippedSeries && progress.skippedSeries[seriesName]) {
    delete progress.skippedSeries[seriesName];
    await saveProgress(app, progress);
    console.log(`Removed series from skip list: "${seriesName}"`);
  }
}

function isSeriesSkipped(progress, seriesName) {
  return !!(progress.skippedSeries && progress.skippedSeries[seriesName]);
}

// --- Alias Tracking ---
async function addSeriesAlias(app, platformName, tmdbName, tmdbId) {
  // Don't add alias if names are identical (case-insensitive)
  if (platformName.toLowerCase().trim() === tmdbName.toLowerCase().trim()) return;
  
  const progress = await loadProgress(app);
  progress.seriesAliases = progress.seriesAliases || {};
  progress.seriesAliases[platformName] = { tmdbName, tmdbId };
  await saveProgress(app, progress);
  console.log(`Added alias: "${platformName}" → "${tmdbName}" (tmdbId: ${tmdbId})`);
}

function lookupSeriesByAlias(progress, platformName) {
  // Returns { tmdbName, tmdbId } or null
  if (!progress.seriesAliases) return null;
  return progress.seriesAliases[platformName] || null;
}

async function markMovieFetched(app, movieName, tmdbId) {
  const progress = await loadProgress(app);
  progress.fetchedMovies[movieName] = tmdbId;
  await saveProgress(app, progress);
}

async function resetProgressByPrefix(app, prefix) {
  const progress = await loadProgress(app);
  const before = (progress.processedWatchIds || []).length;
  const matching = (progress.processedWatchIds || []).filter(id => id.startsWith(prefix)).length;
  
  progress.processedWatchIds = (progress.processedWatchIds || []).filter(
    id => !id.startsWith(prefix)
  );
  
  const after = progress.processedWatchIds.length;
  console.log(`Reset progress: removed ${matching} items with prefix "${prefix}" (${before} → ${after})`);
  
  await saveProgress(app, progress);
}

// ============================================================================
// EPISODE MISMATCH LOGGING
// ============================================================================

/**
 * Write episode mismatch log to .obsidian/watch-episode-mismatches.md
 * Tracks episodes where source numbering differs from TMDB
 */
async function writeEpisodeMismatchLog(app, mismatches, source = "Import") {
  if (!mismatches || mismatches.length === 0) return;
  
  const logPath = SETTINGS.mismatchLogFile;
  const timestamp = new Date().toISOString();
  
  // Separate auto-matched from manual selections
  const autoMatched = mismatches.filter(m => m.autoMatched);
  const manual = mismatches.filter(m => !m.autoMatched);
  
  let content = `# Episode Title Matching Report\n\n`;
  content += `**Source:** ${source}\n`;
  content += `**Generated:** ${timestamp}\n\n`;
  content += `This report shows episodes where the source episode number differs from TMDB.\n`;
  content += `Most are automatically matched by title - the import used the TMDB episode number.\n\n`;
  
  if (autoMatched.length > 0) {
    content += `## ✅ Auto-Matched Episodes (${autoMatched.length})\n\n`;
    content += `These episodes were automatically matched by title.\n\n`;
    content += `| Series | Source Episode | Source Title | → | TMDB Episode | TMDB Title | Confidence |\n`;
    content += `|--------|----------------|--------------|---|--------------|------------|------------|\n`;
    
    for (const m of autoMatched) {
      const conf = m.confidence ? `${Math.round(m.confidence * 100)}%` : "-";
      content += `| ${m.series} | ${m.sourceEpisode} | ${m.sourceTitle} | → | ${m.tmdbEpisode} | ${m.tmdbTitle} | ${conf} |\n`;
    }
    content += `\n`;
  }
  
  if (manual.length > 0) {
    content += `## ⚠️ Manual Selections (${manual.length})\n\n`;
    content += `These episodes required manual selection (low confidence match).\n\n`;
    content += `| Series | Source Episode | Source Title | → | TMDB Episode | TMDB Title |\n`;
    content += `|--------|----------------|--------------|---|--------------|------------|\n`;
    
    for (const m of manual) {
      content += `| ${m.series} | ${m.sourceEpisode} | ${m.sourceTitle} | → | ${m.tmdbEpisode} | ${m.tmdbTitle} |\n`;
    }
    content += `\n`;
  }
  
  try {
    const folder = logPath.split("/").slice(0, -1).join("/");
    if (folder) await ensureFolder(app, folder);
    await app.vault.adapter.write(logPath, content);
    console.log(`Episode mismatch log written to: ${logPath}`);
  } catch (e) {
    console.error("Failed to write mismatch log:", e);
  }
}

// ============================================================================
// TMDB API
// ============================================================================
async function tmdbRequest(obsidian, apiKey, endpoint, params = {}) {
  const url = new URL(`${SETTINGS.tmdb.baseUrl}${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  }

  try {
    const response = await obsidian.requestUrl({
      url: url.toString(),
      method: "GET",
    });
    return response.json;
  } catch (e) {
    const is404 = e?.message?.includes("404") || e?.status === 404;
    if (!is404) {
      console.error(`TMDB API error: ${endpoint}`, e);
    }
    return null;
  }
}

async function searchTVShow(obsidian, apiKey, query) {
  const data = await tmdbRequest(obsidian, apiKey, "/search/tv", { query });
  return data?.results || [];
}

async function searchMovie(obsidian, apiKey, query, year = null) {
  const params = { query };
  if (year) params.year = year;
  const data = await tmdbRequest(obsidian, apiKey, "/search/movie", params);
  return data?.results || [];
}

async function getTVShowDetails(obsidian, apiKey, tvId) {
  return await tmdbRequest(obsidian, apiKey, `/tv/${tvId}`);
}

async function getTVSeasonDetails(obsidian, apiKey, tvId, seasonNumber) {
  return await tmdbRequest(obsidian, apiKey, `/tv/${tvId}/season/${seasonNumber}`);
}

async function getMovieDetails(obsidian, apiKey, movieId) {
  return await tmdbRequest(obsidian, apiKey, `/movie/${movieId}`);
}

// ============================================================================
// EMBY API
// ============================================================================
async function embyRequest(obsidian, serverUrl, apiKey, endpoint, params = {}) {
  const url = new URL(`${serverUrl}${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const response = await obsidian.requestUrl({
      url: url.toString(),
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    return response.json;
  } catch (e) {
    console.error(`Emby API error: ${endpoint}`, e);
    return null;
  }
}

async function getEmbyUsers(obsidian, serverUrl, apiKey) {
  const data = await embyRequest(obsidian, serverUrl, apiKey, "/Users");
  return data || [];
}

// Get item details by ID (used for CSV import to look up item type/metadata)
async function getEmbyItemById(obsidian, serverUrl, apiKey, userId, itemId) {
  const data = await embyRequest(obsidian, serverUrl, apiKey, `/Users/${userId}/Items/${itemId}`, {
    Fields: "Overview,SeriesName,SeasonName,ParentIndexNumber,IndexNumber,ProductionYear",
  });
  return data;
}

async function getEmbyPlayedItems(obsidian, serverUrl, apiKey, userId) {
  const data = await embyRequest(obsidian, serverUrl, apiKey, `/Users/${userId}/Items`, {
    Filters: "IsPlayed",
    SortBy: "DatePlayed",
    SortOrder: "Descending",
    IncludeItemTypes: "Movie,Episode",
    Recursive: "true",
    Fields: "BasicSyncInfo,DateCreated,DatePlayed,Genres,Overview,ParentId,Path,PremiereDate,ProductionYear,ProviderIds,SeriesName,SeasonName,ParentIndexNumber,IndexNumber,SortName,UserData",
    EnableUserData: "true",
    Limit: "10000",
  });
  return data?.Items || [];
}

// Fetch play history from Playback Reporting plugin (includes actual dates!)
async function getPlaybackReportingHistory(obsidian, serverUrl, apiKey, userId) {
  const endDate = localISODate();
  
  // API uses 'days' parameter (how many days back from end_date)
  // Use 365 days to get a full year of history
  console.log(`Fetching Playback Reporting history (last 365 days up to ${endDate})...`);
  
  const data = await embyRequest(obsidian, serverUrl, apiKey, `/user_usage_stats/UserPlaylist`, {
    user_id: userId,
    days: "365",
    end_date: endDate,
    filter: "",  // No filter - get all types
  });
  
  if (!data || !Array.isArray(data)) {
    console.log("Playback Reporting plugin not available or no data");
    return null;
  }
  
  console.log(`Playback Reporting returned ${data.length} records`);
  
  // Debug: Log first record to see actual field names
  if (data.length > 0) {
    console.log("Playback Reporting sample record:", JSON.stringify(data[0], null, 2));
  }
  
  return data;
}

// Get played items with dates - uses standard API as base, enriched with Playback Reporting dates
async function getEmbyPlayedItemsWithDates(obsidian, serverUrl, apiKey, userId) {
  // Always fetch from standard Emby API first (gets ALL played items)
  const standardItems = await getEmbyPlayedItems(obsidian, serverUrl, apiKey, userId);
  console.log(`Standard Emby API returned ${standardItems.length} played items`);
  
  if (!standardItems || standardItems.length === 0) {
    return [];
  }
  
  // Try to get dated history from Playback Reporting plugin
  const playbackHistory = await getPlaybackReportingHistory(obsidian, serverUrl, apiKey, userId);
  
  if (!playbackHistory || playbackHistory.length === 0) {
    console.log("Playback Reporting not available - using LastPlayedDate from standard API");
    return standardItems;
  }
  
  console.log(`Playback Reporting returned ${playbackHistory.length} records - enriching dates`);
  
  // Build a lookup map from Playback Reporting data
  // API returns: ItemId, ItemType, Date, and possibly ItemName, SeriesName, etc.
  const dateMap = new Map();
  for (const record of playbackHistory) {
    // Try various field name formats the API might use
    const id = record.ItemId || record.Id || record.item_id;
    const date = record.Date || record.date || record.PlaybackDate || record.last_played_date;
    const name = record.ItemName || record.Name || record.item_name;
    const seriesName = record.SeriesName || record.series_name;
    const seasonNum = record.SeasonNumber || record.season_number || record.ParentIndexNumber;
    const episodeNum = record.EpisodeNumber || record.episode_number || record.IndexNumber;
    
    if (date) {
      // Store by ID if available
      if (id) {
        dateMap.set(id, { date, record });
      }
      
      // Also store by name for matching
      if (seriesName && (seasonNum || episodeNum)) {
        const key = `${seriesName}-S${seasonNum || 1}E${episodeNum || 1}`.toLowerCase();
        dateMap.set(key, { date, record });
      } else if (name) {
        dateMap.set(name.toLowerCase(), { date, record });
      }
    }
  }
  
  console.log(`Built date lookup map with ${dateMap.size} entries`);
  
  // Enrich standard items with Playback Reporting dates where available
  let enriched = 0;
  for (const item of standardItems) {
    // Try to find date by ID
    let match = dateMap.get(item.Id);
    
    // Try by name+episode
    if (!match && item.Type === "Episode" && item.SeriesName) {
      const key = `${item.SeriesName}-S${item.ParentIndexNumber || 1}E${item.IndexNumber || 1}`.toLowerCase();
      match = dateMap.get(key);
    }
    
    // Try by movie name
    if (!match && item.Type === "Movie" && item.Name) {
      match = dateMap.get(item.Name.toLowerCase());
    }
    
    if (match) {
      item.PlaybackDate = match.date;
      item._fromPlaybackReporting = true;
      item._playbackRecord = match.record;  // Keep reference for debugging
      enriched++;
    }
  }
  
  console.log(`Enriched ${enriched}/${standardItems.length} items with Playback Reporting dates`);
  return standardItems;
}

function parseEmbyDate(dateStr) {
  if (!dateStr) return localISODate();
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return localISODate();
  return localISODate(date);
}

function getEmbyWatchDate(item) {
  const userData = item.UserData || {};
  
  if (item.PlaybackDate) return parseEmbyDate(item.PlaybackDate);
  if (userData.LastPlayedDate) return parseEmbyDate(userData.LastPlayedDate);
  if (userData.LastPlayed) return parseEmbyDate(userData.LastPlayed);
  if (item.DatePlayed) return parseEmbyDate(item.DatePlayed);
  
  return localISODate();
}

// ============================================================================
// IMAGE DOWNLOAD
// ============================================================================
async function downloadImage(obsidian, app, imageUrl, localPath) {
  if (!imageUrl) return null;

  try {
    const fullUrl = imageUrl.startsWith("http")
      ? imageUrl
      : `${SETTINGS.tmdb.imageBaseUrl}${imageUrl}`;

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

// ============================================================================
// GENRE UPSERT
// ============================================================================
async function createGenreNote(app, obsidian, genreName) {
  const cfg = SETTINGS.genreUpsert;
  if (!cfg.enabled) return null;

  const categoryLink = `[[${cfg.categoryPath.replace(/\.md$/, "")}]]`;
  const safeName = safeFilename(sanitizeForWikilink(genreName));
  if (!safeName) return null;

  const filePath = `${cfg.folder}/${safeName}.md`;

  await ensureFolder(app, cfg.folder);

  const exists = await app.vault.adapter.exists(filePath);
  if (exists) return filePath;

  const content = `---
categories:
  - "${categoryLink}"
title: ${quoteYamlString(genreName)}
created: ${quoteYamlString(localISODate())}
---

## Books

![[GenreBooks.base]]

## Movies

![[GenreMovies.base]]

## Series

![[GenreSeries.base]]
`;

  await app.vault.create(filePath, content);
  return filePath;
}

async function upsertAndLinkGenres(app, obsidian, noteFile, genres) {
  const cfg = SETTINGS.genreUpsert;
  if (!cfg.enabled) return [];

  await ensureNote(
    app,
    cfg.categoryPath,
    `---
categories:
  - "[[Categories]]"
title: "Genres"
---

![[Genre.base]]
`
  );

  const genreList = Array.isArray(genres) ? genres : genres ? [genres] : [];
  const cleaned = genreList.map((g) => String(g || "").trim()).filter(Boolean);
  if (!cleaned.length) return [];

  const links = [];
  for (const genreName of cleaned) {
    await createGenreNote(app, obsidian, genreName);
    const safeName = safeFilename(sanitizeForWikilink(genreName));
    links.push(`[[${safeName}]]`);
  }

  const seen = new Set();
  const unique = links.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));

  const file = typeof noteFile === "string"
    ? app.vault.getAbstractFileByPath(noteFile)
    : noteFile;

  if (file) {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.genre = unique;
    });
  }

  return unique;
}

function extractGenresFromTmdb(tmdbData) {
  if (!tmdbData?.genres || !Array.isArray(tmdbData.genres)) return [];
  return tmdbData.genres.map((g) => g.name).filter(Boolean);
}

// ============================================================================
// NOTE CREATION - Returns {path, created}
// ============================================================================
async function createSeriesNote(app, obsidian, seriesName, tmdbData) {
  const safeName = safeFilename(seriesName);
  const folderPath = `${SETTINGS.folders.series}/${safeName}`;
  const notePath = `${folderPath}/${safeName}.md`;

  const noteExists = await app.vault.adapter.exists(notePath);
  if (noteExists) {
    console.log(`Series note already exists: ${notePath}`);
    return { path: notePath, created: false };
  }

  await ensureFolder(app, folderPath);

  let localCoverImage = "";
  if (tmdbData?.poster_path) {
    const coverPath = `${SETTINGS.folders.covers}/series/${safeFilename(seriesName)}/series.jpg`;
    const downloaded = await downloadImage(obsidian, app, tmdbData.poster_path, coverPath);
    if (downloaded) localCoverImage = downloaded;
  }

  const content = `---
categories:
  - "${SETTINGS.categories.series}"
title: ${quoteYamlString(seriesName)}
tmdbId: ${tmdbData?.id || ""}
created: ${quoteYamlString(localISODate())}
status: "watching"
rating: 
droppedReason: ""
droppedAfter: ""
genre: ""
totalSeasons: ${tmdbData?.number_of_seasons || ""}
totalEpisodes: ${tmdbData?.number_of_episodes || ""}
firstAirDate: ${quoteYamlString(tmdbData?.first_air_date || "")}
firstWatched: ""
lastWatched: ""
overview: ${quoteYamlString(tmdbData?.overview || "")}
localCoverImage: ${quoteYamlString(localCoverImage)}
---
${localCoverImage ? `\n![[${localCoverImage}|200]]\n` : ""}
## Episodes

![[Episodes.base]]

## Watch History

![[SeriesWatchLog.base]]
`;

  await app.vault.create(notePath, content);
  return { path: notePath, created: true };
}

async function createMovieNote(app, obsidian, movieName, tmdbData) {
  const notePath = `${SETTINGS.folders.movies}/${safeFilename(movieName)}.md`;

  await ensureFolder(app, SETTINGS.folders.movies);

  const exists = await app.vault.adapter.exists(notePath);
  if (exists) {
    console.log(`Movie note already exists: ${notePath}`);
    return { path: notePath, created: false };
  }

  let localCoverImage = "";
  if (tmdbData?.poster_path) {
    const coverPath = `${SETTINGS.folders.covers}/movies/${safeFilename(movieName)}.jpg`;
    const downloaded = await downloadImage(obsidian, app, tmdbData.poster_path, coverPath);
    if (downloaded) localCoverImage = downloaded;
  }

  const content = `---
categories:
  - "${SETTINGS.categories.movies}"
title: ${quoteYamlString(movieName)}
tmdbId: ${tmdbData?.id || ""}
year: ${tmdbData?.release_date?.substring(0, 4) || ""}
created: ${quoteYamlString(localISODate())}
rating: 
genre: ""
overview: ${quoteYamlString(tmdbData?.overview || "")}
watched: false
watchCount: 0
firstWatched: ""
lastWatched: ""
localCoverImage: ${quoteYamlString(localCoverImage)}
---
${localCoverImage ? `\n![[${localCoverImage}|200]]\n` : ""}
## Watch History

![[MovieWatchLog.base]]
`;

  await app.vault.create(notePath, content);
  return { path: notePath, created: true };
}

async function createEpisodeNote(app, seriesName, seasonNum, episodeNum, episodeData) {
  const folderPath = `${SETTINGS.folders.series}/${safeFilename(seriesName)}`;
  const fileName = `S${pad2(seasonNum)}E${pad2(episodeNum)} - ${safeFilename(episodeData?.name || "Unknown")}.md`;
  const notePath = `${folderPath}/${fileName}`;

  await ensureFolder(app, folderPath);

  const exists = await app.vault.adapter.exists(notePath);
  if (exists) return { path: notePath, created: false };

  const safeName = safeFilename(seriesName);
  const seriesLink = `[[${safeName}/${safeName}|${sanitizeForWikilink(seriesName)}]]`;

  const content = `---
categories:
  - "${SETTINGS.categories.episodes}"
series: "${seriesLink}"
season: ${seasonNum}
episode: ${episodeNum}
title: ${quoteYamlString(episodeData?.name || "")}
airDate: ${quoteYamlString(episodeData?.air_date || "")}
overview: ${quoteYamlString(episodeData?.overview || "")}
watched: false
watchCount: 0
firstWatched: ""
lastWatched: ""
tmdbId: ${episodeData?.id || ""}
---
`;

  await app.vault.create(notePath, content);
  return { path: notePath, created: true };
}

// ============================================================================
// WATCH LOG - Returns {path, created}
// ============================================================================
function findEpisodeFile(app, seriesName, seasonNum, episodeNum) {
  const folderPath = `${SETTINGS.folders.series}/${safeFilename(seriesName)}`;
  const episodePrefix = `S${pad2(seasonNum)}E${pad2(episodeNum)}`;

  const files = app.vault.getFiles().filter((f) =>
    f.path.startsWith(folderPath + "/") &&
    f.basename.startsWith(episodePrefix)
  );

  return files.length > 0 ? files[0] : null;
}

async function createWatchLogEntry(app, data) {
  await ensureFolder(app, SETTINGS.folders.watched);

  // Check for existing watch entry
  const basePattern = data.type === "movie"
    ? `${data.date}-\\d+-${safeFilename(data.showName)}\\.md$`
    : `${data.date}-\\d+-${safeFilename(data.showName)}-S${pad2(data.season)}E${pad2(data.episode)}\\.md$`;

  const existingFiles = app.vault.getFiles().filter(f =>
    f.path.startsWith(SETTINGS.folders.watched + "/") &&
    new RegExp(basePattern).test(f.path)
  );

  if (existingFiles.length > 0) {
    console.log(`Watch entry already exists: ${existingFiles[0].path}`);
    return { path: existingFiles[0].path, created: false };
  }

  // Find unique filename
  let index = 1;
  let notePath;
  do {
    const fileName = data.type === "movie"
      ? `${data.date}-${index}-${safeFilename(data.showName)}.md`
      : `${data.date}-${index}-${safeFilename(data.showName)}-S${pad2(data.season)}E${pad2(data.episode)}.md`;
    notePath = `${SETTINGS.folders.watched}/${fileName}`;
    index++;
  } while (await app.vault.adapter.exists(notePath));

  let content;
  if (data.type === "movie") {
    content = `---
categories:
  - "${SETTINGS.categories.watched}"
date: ${quoteYamlString(data.date)}
created: ${quoteYamlString(localISODate())}
type: "movie"
movie: "[[${safeFilename(data.showName)}]]"
show: "[[${safeFilename(data.showName)}]]"
source: "${data.source || ""}"
rating: ${data.rating || ""}
---
`;
  } else {
    const safeShowName = safeFilename(data.showName);
    const seriesLink = `[[${safeShowName}/${safeShowName}|${sanitizeForWikilink(data.showName)}]]`;

    const episodeFile = findEpisodeFile(app, data.showName, data.season, data.episode);
    let episodeLink;
    if (episodeFile) {
      const linkPath = episodeFile.path.replace(/\.md$/, "");
      episodeLink = `[[${linkPath}]]`;
    } else {
      episodeLink = `[[${safeFilename(data.showName)}/S${pad2(data.season)}E${pad2(data.episode)}]]`;
    }

    content = `---
categories:
  - "${SETTINGS.categories.watched}"
date: ${quoteYamlString(data.date)}
created: ${quoteYamlString(localISODate())}
type: "episode"
show: "${seriesLink}"
episode: "${episodeLink}"
season: ${data.season}
episodeNum: ${data.episode}
episodeTitle: ${quoteYamlString(data.episodeTitle || "")}
source: "${data.source || ""}"
rating: ${data.rating || ""}
---
`;
  }

  await app.vault.create(notePath, content);
  return { path: notePath, created: true };
}

// ============================================================================
// UPDATE WATCHED STATUS
// ============================================================================
async function updateMovieWatched(app, movieName, watchDate) {
  const notePath = `${SETTINGS.folders.movies}/${safeFilename(movieName)}.md`;
  const file = app.vault.getAbstractFileByPath(notePath);

  if (!file) return;

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.watched = true;
    fm.watchCount = (fm.watchCount || 0) + 1;
    if (!fm.firstWatched) fm.firstWatched = watchDate;
    fm.lastWatched = watchDate;
  });
}

async function updateSeriesLastWatched(app, seriesName, watchDate) {
  const safeName = safeFilename(seriesName);
  const seriesNotePath = `${SETTINGS.folders.series}/${safeName}/${safeName}.md`;
  const file = app.vault.getAbstractFileByPath(seriesNotePath);

  if (!file) return;

  await app.fileManager.processFrontMatter(file, (fm) => {
    if (!fm.lastWatched || watchDate > fm.lastWatched) {
      fm.lastWatched = watchDate;
    }
    if (!fm.firstWatched || watchDate < fm.firstWatched) {
      fm.firstWatched = watchDate;
    }
  });
}

async function updateEpisodeWatched(app, seriesName, seasonNum, episodeNum, watchDate) {
  const file = findEpisodeFile(app, seriesName, seasonNum, episodeNum);
  if (!file) return;

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.watched = true;
    fm.watchCount = (fm.watchCount || 0) + 1;
    if (!fm.firstWatched) fm.firstWatched = watchDate;
    fm.lastWatched = watchDate;
  });

  await updateSeriesLastWatched(app, seriesName, watchDate);
}

// ============================================================================
// FETCH ALL EPISODES
// ============================================================================
async function fetchAndCreateAllEpisodes(app, obsidian, apiKey, seriesName, tmdbId, Notice) {
  const showDetails = await getTVShowDetails(obsidian, apiKey, tmdbId);
  if (!showDetails) return 0;

  const safeName = safeFilename(seriesName);
  const seriesNotePath = `${SETTINGS.folders.series}/${safeName}/${safeName}.md`;

  const genres = extractGenresFromTmdb(showDetails);
  if (genres.length > 0) {
    await upsertAndLinkGenres(app, obsidian, seriesNotePath, genres);
  }

  const seriesFile = app.vault.getAbstractFileByPath(seriesNotePath);
  if (seriesFile) {
    await app.fileManager.processFrontMatter(seriesFile, (fm) => {
      fm.totalSeasons = showDetails.number_of_seasons || 0;
      fm.totalEpisodes = showDetails.number_of_episodes || 0;
    });
  }

  const totalSeasons = showDetails.number_of_seasons || 0;
  let episodesCreated = 0;

  for (let s = 1; s <= totalSeasons; s++) {
    const seasonDetails = await getTVSeasonDetails(obsidian, apiKey, tmdbId, s);
    if (!seasonDetails) continue;

    if (seasonDetails.poster_path) {
      const seasonCoverPath = `${SETTINGS.folders.covers}/series/${safeFilename(seriesName)}/season-${s}.jpg`;
      await downloadImage(obsidian, app, seasonDetails.poster_path, seasonCoverPath);
    }

    const episodes = seasonDetails.episodes || [];
    for (const ep of episodes) {
      const result = await createEpisodeNote(app, seriesName, s, ep.episode_number, ep);
      if (result.created) episodesCreated++;
    }

    if (Notice && s % 2 === 0) {
      new Notice(`${seriesName}: Fetched ${s}/${totalSeasons} seasons...`);
    }
  }

  return episodesCreated;
}

// ============================================================================
// VISUAL PICKER MODAL
// ============================================================================
function createShowSuggestModal(obsidian, app, items, type) {
  const SuggestModal = obsidian?.SuggestModal;
  if (!SuggestModal) return null;

  return class ShowSuggestModal extends SuggestModal {
    constructor() {
      super(app);
      this.items = items;
      this.type = type;
      this.setPlaceholder(`Select ${type === "movie" ? "movie" : "series"}...`);
      this.emptyStateText = "No matches";
      this.limit = 200;
      this.onChoose = null;
    }

    getItemText(item) {
      return String(item?.title || item?.name || "");
    }

    getSuggestions(query) {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return this.items;

      return this.items.filter((item) => {
        const title = String(item.title || item.name || "").toLowerCase();
        const overview = String(item.overview || "").toLowerCase();
        return title.includes(q) || overview.includes(q);
      });
    }

    renderSuggestion(item, el) {
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.gap = "12px";
      el.style.padding = "8px 10px";

      const posterUrl = item.poster_path
        ? `${SETTINGS.tmdb.imageBaseUrl}${item.poster_path}`
        : "";

      if (SETTINGS.showPosterInSearch && posterUrl) {
        const img = el.createEl("img", {
          attr: {
            src: posterUrl,
            alt: `Poster for ${item.title || item.name}`,
          },
        });
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

      const title = item.title || item.name || "Unknown";
      const titleEl = textContainer.createEl("div", { text: title });
      titleEl.style.fontWeight = "600";

      let subtitle = "";
      if (this.type === "movie") {
        const year = item.release_date ? item.release_date.substring(0, 4) : "";
        subtitle = year ? `(${year})` : "";
      } else {
        const year = item.first_air_date ? item.first_air_date.substring(0, 4) : "";
        subtitle = year ? `(${year})` : "";
      }

      if (item.overview) {
        const shortOverview = item.overview.length > 80
          ? item.overview.substring(0, 80) + "..."
          : item.overview;
        subtitle += subtitle ? ` - ${shortOverview}` : shortOverview;
      }

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

async function pickShowWithModal({ app, obsidian, items, type }) {
  const ModalClass = createShowSuggestModal(obsidian, app, items, type);
  if (!ModalClass) return null;

  return await new Promise((resolve) => {
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
// IMPORT LIMIT PROMPT
// ============================================================================
async function promptImportLimit(qa, totalAvailable, sourceDescription = "") {
  // Build options based on how many are available
  const options = [];
  const values = [];
  
  // Singular/plural handling
  const itemWord = totalAvailable === 1 ? "show" : "shows";
  
  // Header showing what's available
  const header = sourceDescription 
    ? `${totalAvailable} ${itemWord} ready to import from ${sourceDescription}:`
    : `${totalAvailable} ${itemWord} ready to import:`;
  options.push(header);
  values.push(-1);  // Marker for header
  
  // If only 1 item, simple choice
  if (totalAvailable === 1) {
    options.push(`✅ Import 1 show`);
    values.push(1);
  } else {
    // Always offer "Just 1 (test)" first if more than 1 available
    options.push("Just 1 (test)");
    values.push(1);
    
    // Only show batch sizes that make sense
    if (totalAvailable > 5) {
      options.push("First 5");
      values.push(5);
    }
    if (totalAvailable > 10) {
      options.push("First 10");
      values.push(10);
    }
    if (totalAvailable > 25) {
      options.push("First 25");
      values.push(25);
    }
    if (totalAvailable > 100) {
      options.push("First 100");
      values.push(100);
    }
    
    // Always show "All X" option
    options.push(`✅ Import ${totalAvailable} shows`);
    values.push(totalAvailable);
  }
  
  // Cancel option
  options.push("❌ Cancel");
  values.push(0);

  const choice = await qa.suggester(options, values);
  
  // If header was selected (shouldn't happen but handle it), treat as cancel
  if (choice === -1 || choice === undefined) return 0;
  
  return choice;
}

// ============================================================================
// MODE HANDLERS
// ============================================================================

// --- MANUAL MODE ---
async function handleManual(params, apiKey) {
  const { app, qa, obsidian, Notice } = params;

  while (true) {
    // Step 1: Movie or Series?
    const type = await qa.suggester(
      ["Movie", "Series", "Stop adding"],
      ["movie", "series", "stop"]
    );

    if (type === "stop" || !type) {
      if (Notice) new Notice("Finished adding shows.");
      return;
    }

    // Step 2: Search term
    const query = (await qa.inputPrompt(
      `Search ${type === "movie" ? "movies" : "TV series"}`,
      "Enter title keywords (or leave blank to stop)"
    ))?.trim();

    if (!query) continue;

    // Step 3: Search TMDB
    if (Notice) new Notice(`Searching TMDB for "${query}"...`);

    let results;
    try {
      if (type === "movie") {
        results = await searchMovie(obsidian, apiKey, query);
      } else {
        results = await searchTVShow(obsidian, apiKey, query);
      }
    } catch (e) {
      if (Notice) new Notice(`Search failed: ${e.message}`);
      continue;
    }

    if (!results || results.length === 0) {
      if (Notice) new Notice("No results found. Try different keywords.");
      continue;
    }

    // Step 4: Show picker
    const picked = await pickShowWithModal({
      app,
      obsidian,
      items: results.slice(0, SETTINGS.maxResults),
      type,
    });

    if (!picked) continue;

    const showName = type === "movie" ? picked.title : picked.name;
    if (Notice) new Notice(`Selected: ${showName}`);

    // Step 5: Get full details
    let fullDetails;
    try {
      if (type === "movie") {
        fullDetails = await getMovieDetails(obsidian, apiKey, picked.id);
      } else {
        fullDetails = await getTVShowDetails(obsidian, apiKey, picked.id);
      }
    } catch (e) {
      fullDetails = picked;
    }

    // Step 6: Create note
    let noteResult;
    if (type === "movie") {
      noteResult = await createMovieNote(app, obsidian, showName, fullDetails || picked);

      if (noteResult.created) {
        const genres = extractGenresFromTmdb(fullDetails);
        if (genres.length > 0) {
          await upsertAndLinkGenres(app, obsidian, noteResult.path, genres);
        }
      }
    } else {
      noteResult = await createSeriesNote(app, obsidian, showName, fullDetails || picked);

      if (noteResult.created) {
        const genres = extractGenresFromTmdb(fullDetails);
        if (genres.length > 0) {
          await upsertAndLinkGenres(app, obsidian, noteResult.path, genres);
        }

        // Ask about fetching episodes
        const fetchEpisodes = await qa.yesNoPrompt(
          "Fetch Episodes?",
          `Fetch all episodes for "${showName}" from TMDB?\n(${fullDetails?.number_of_seasons || "?"} seasons, ${fullDetails?.number_of_episodes || "?"} episodes)`
        );

        if (fetchEpisodes) {
          if (Notice) new Notice(`Fetching episodes for "${showName}"...`);
          const episodesCreated = await fetchAndCreateAllEpisodes(app, obsidian, apiKey, showName, picked.id, Notice);
          if (Notice) new Notice(`Created ${episodesCreated} episode notes.`);
        }
      }
    }

    // Step 7: Ask about watch log
    const addWatch = await qa.yesNoPrompt(
      "Add Watch Log?",
      `Add a watch log entry for "${showName}"?`
    );

    if (addWatch) {
      const watchDate = await promptForDate(qa, "Date watched");
      const source = await qa.suggester(MANUAL_SOURCE_OPTIONS, MANUAL_SOURCE_OPTIONS);
      const ratingRaw = (await qa.inputPrompt("Rating", "1-10 (leave blank for none)"))?.trim();
      const rating = ratingRaw ? Number(ratingRaw) : "";

      if (type === "movie") {
        const watchResult = await createWatchLogEntry(app, {
          type: "movie",
          date: watchDate,
          showName,
          source: MANUAL_SOURCE_MAP[source] || source,
          rating,
        });

        if (watchResult.created) {
          await updateMovieWatched(app, showName, watchDate);
          if (Notice) new Notice(`Watch log added for "${showName}"`);
        } else {
          if (Notice) new Notice(`Watch already logged for "${showName}" on ${watchDate}`);
        }
      } else {
        const seasonRaw = (await qa.inputPrompt("Season number", "e.g., 1"))?.trim();
        const episodeRaw = (await qa.inputPrompt("Episode number", "e.g., 1"))?.trim();

        if (seasonRaw && episodeRaw) {
          const season = parseInt(seasonRaw, 10);
          const episode = parseInt(episodeRaw, 10);

          const watchResult = await createWatchLogEntry(app, {
            type: "episode",
            date: watchDate,
            showName,
            season,
            episode,
            source: MANUAL_SOURCE_MAP[source] || source,
            rating,
          });

          if (watchResult.created) {
            await updateEpisodeWatched(app, showName, season, episode, watchDate);
            if (Notice) new Notice(`Watch log added for "${showName}" S${season}E${episode}`);
          } else {
            if (Notice) new Notice(`Watch already logged for "${showName}" S${season}E${episode} on ${watchDate}`);
          }
        }
      }
    }

    // Open note
    const file = app.vault.getAbstractFileByPath(noteResult.path);
    if (file) {
      await app.workspace.getLeaf(true).openFile(file);
    }

    if (Notice) new Notice(`${noteResult.created ? "Created" : "Opened"}: ${showName}`);
  }
}

// --- PRIME EXTENSION HANDLER ---
async function handlePrimeExtension(params, apiKey, sourceConfig) {
  const { app, qa, obsidian, Notice } = params;

  // Load import queue
  const queueFile = sourceConfig.queueFile;
  let queue;
  try {
    const exists = await app.vault.adapter.exists(queueFile);
    if (!exists) {
      if (Notice) new Notice("No Prime import queue found.\n\nUse the Chrome extension to scrape watch history first.", 5000);
      return;
    }
    const raw = await app.vault.adapter.read(queueFile);
    queue = JSON.parse(raw);
  } catch (e) {
    if (Notice) new Notice(`Failed to load import queue: ${e.message}`);
    return;
  }

  if (!queue || !queue.items || queue.items.length === 0) {
    if (Notice) new Notice("Import queue is empty.", 3000);
    return;
  }

  console.log(`Prime import queue: ${queue.items.length} items`);

  // Load progress
  const progress = await loadProgress(app);
  const processedSet = new Set(progress.processedWatchIds || []);

  // Filter unprocessed items
  const toProcess = queue.items.filter(item => {
    const date = item.dateWatched ? item.dateWatched.substring(0, 10) : localISODate();
    const title = item.title || "";
    const uniqueId = `${sourceConfig.prefix}${date}-${title}`.toLowerCase();
    return !processedSet.has(uniqueId);
  });

  if (toProcess.length === 0) {
    const clearQueue = await qa.yesNoPrompt(
      "All items processed",
      `All ${queue.items.length} items have been imported.\n\nClear the import queue?`
    );
    if (clearQueue) {
      await app.vault.adapter.remove(queueFile);
      if (Notice) new Notice("Import queue cleared.");
    }
    return;
  }

  // Ask import limit (shows count in popup)
  const importLimit = await promptImportLimit(qa, toProcess.length, "Prime Video queue");
  if (importLimit === 0) {
    // User cancelled - offer to clear the queue
    const clearQueue = await qa.yesNoPrompt(
      "Import cancelled",
      "Clear the import queue?\n\n(If you keep it, Shows will auto-start Prime import next time)"
    );
    if (clearQueue) {
      await app.vault.adapter.remove(queueFile);
      if (Notice) new Notice("Import queue cleared.");
    }
    return;
  }

  const itemsToImport = toProcess.slice(0, importLimit);

  // Confirm
  const proceed = await qa.yesNoPrompt(
    "Prime Video Import",
    `Importing ${itemsToImport.length} item${itemsToImport.length === 1 ? "" : "s"}.\n\nThis will fetch metadata from TMDB.\n\nContinue?`
  );
  if (!proceed) {
    // User cancelled - offer to clear the queue
    const clearQueue = await qa.yesNoPrompt(
      "Import cancelled",
      "Clear the import queue?\n\n(If you keep it, Shows will auto-start Prime import next time)"
    );
    if (clearQueue) {
      await app.vault.adapter.remove(queueFile);
      if (Notice) new Notice("Import queue cleared.");
    }
    return;
  }

  // Process items
  let imported = 0;
  let seriesFetched = 0;
  let moviesFetched = 0;
  let skipped = 0;
  let newSkipped = 0;  // Count of series added to skip list this session
  
  // Track episode matching results for logging
  const episodeMismatches = [];
  
  // Track items already in vault (duplicate watch entries)
  const alreadyInVault = [];

  for (const item of itemsToImport) {
    const date = item.dateWatched ? item.dateWatched.substring(0, 10) : localISODate();
    const itemType = item.type;
    const title = item.title || "Unknown";
    const uniqueId = `${sourceConfig.prefix}${date}-${title}`.toLowerCase();

    try {
      if (itemType === "Movie") {
        // Check if already fetched
        if (!progress.fetchedMovies[title]) {
          const results = await searchMovie(obsidian, apiKey, title);
          const tmdbData = results[0];

          if (!tmdbData) {
            console.log(`Movie not found in TMDB: ${title}`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }

          const fullDetails = await getMovieDetails(obsidian, apiKey, tmdbData.id);
          await createMovieNote(app, obsidian, title, fullDetails || tmdbData);

          const genres = extractGenresFromTmdb(fullDetails);
          if (genres.length > 0) {
            const notePath = `${SETTINGS.folders.movies}/${safeFilename(title)}.md`;
            await upsertAndLinkGenres(app, obsidian, notePath, genres);
          }

          await markMovieFetched(app, title, tmdbData.id);
          moviesFetched++;
        }

        const watchResult = await createWatchLogEntry(app, {
          type: "movie",
          date,
          showName: title,
          source: sourceConfig.wikilink,
        });

        if (watchResult.created) {
          await updateMovieWatched(app, title, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${title} on ${date}`);
          alreadyInVault.push({ type: "movie", title, date });
        }
        await markWatchProcessed(app, uniqueId);

      } else if (itemType === "Series") {
        // Parse episode info from episodeTitle
        const episodeMatch = item.episodeTitle?.match(/(?:S|Season\s*)(\d+)\s*(?:E|Episode\s*)(\d+)/i);
        let season = episodeMatch ? parseInt(episodeMatch[1]) : null;
        let episode = episodeMatch ? parseInt(episodeMatch[2]) : null;
        
        // Also try "Episode X" pattern
        if (!season && !episode) {
          const epOnlyMatch = item.episodeTitle?.match(/Episode\s+(\d+)/i);
          if (epOnlyMatch) {
            season = 1;
            episode = parseInt(epOnlyMatch[1]);
          }
        }

        // Normalize the series name for search
        const rawSeriesName = title;
        
        // Skip items with invalid/malformed series names
        if (!rawSeriesName || rawSeriesName.length < 2 || /^[^a-zA-Z0-9]+$/.test(rawSeriesName)) {
          console.log(`Skipping malformed series name: "${rawSeriesName}"`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }
        
        const normalizedName = normalizeSeriesName(rawSeriesName);

        // Determine the actual series name to use
        let actualSeriesName = normalizedName;
        let tmdbId = null;

        // 1. Check if we already have this series fetched (by normalized or raw name)
        const alreadyFetchedNormalized = progress.fetchedSeries[normalizedName];
        const alreadyFetchedRaw = progress.fetchedSeries[rawSeriesName];
        
        if (alreadyFetchedNormalized) {
          actualSeriesName = normalizedName;
          tmdbId = alreadyFetchedNormalized;
        } else if (alreadyFetchedRaw) {
          actualSeriesName = rawSeriesName;
          tmdbId = alreadyFetchedRaw;
        } else {
          // 2. Check if series is in skip list
          if (isSeriesSkipped(progress, rawSeriesName) || isSeriesSkipped(progress, normalizedName)) {
            console.log(`Series "${rawSeriesName}" is in skip list, skipping`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }

          // 3. Check for known alias (instant match!)
          const aliasMatch = lookupSeriesByAlias(progress, rawSeriesName) 
                          || lookupSeriesByAlias(progress, normalizedName);
          if (aliasMatch) {
            console.log(`Alias match: "${rawSeriesName}" → "${aliasMatch.tmdbName}"`);
            actualSeriesName = aliasMatch.tmdbName;
            tmdbId = aliasMatch.tmdbId;
            // Proceed to episode matching
          }

          // 4. Check vault for existing series or fuzzy matches
          if (!tmdbId) {
            let existingInVault = findExistingSeriesInVault(app, normalizedName);
            const vaultMatches = searchVaultForSeries(app, normalizedName);
            
            // If we found fuzzy matches but no exact match, prompt user to confirm identity
            if (!existingInVault && vaultMatches.length > 0) {
              const identity = await promptConfirmSeriesIdentity(qa, rawSeriesName, vaultMatches);
              
              if (identity.action === "existing") {
                existingInVault = identity.match;
              } else if (identity.action === "skip") {
                console.log(`Skipping item with series "${rawSeriesName}" (user chose skip)`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
              // If "new", existingInVault stays null, proceed to Add/Skip/Cancel
            }

            if (existingInVault) {
              // Use existing series from vault
              actualSeriesName = existingInVault.name;
              const cache = app.metadataCache.getFileCache(existingInVault.file);
              tmdbId = cache?.frontmatter?.tmdbId || existingInVault.tmdbId || "vault-only";
              
              // Save alias for future imports
              await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
              progress.seriesAliases = progress.seriesAliases || {};
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
              
              await markSeriesFetched(app, actualSeriesName, tmdbId);
              progress.fetchedSeries[actualSeriesName] = tmdbId;
            }
          }

          // 5. New series - prompt Add/Skip/Cancel
          if (!tmdbId) {
            const action = await promptSeriesAction(qa, rawSeriesName);
            
            if (action === "cancel") {
              if (Notice) new Notice("Import cancelled by user.");
              return;
            }
            
            if (action === "skip") {
              await markSeriesSkipped(app, rawSeriesName, sourceConfig.prefix);
              progress.skippedSeries = progress.skippedSeries || {};
              progress.skippedSeries[rawSeriesName] = { source: sourceConfig.prefix, skippedAt: new Date().toISOString().split('T')[0] };
              skipped++;
              newSkipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            // action === "add" - Search TMDB
            if (Notice) new Notice(`Searching TMDB for: ${normalizedName}...`);
            
            // Try normalized name first
            let results = await searchTVShow(obsidian, apiKey, normalizedName);
            
            // If no results, try raw name
            if ((!results || results.length === 0) && normalizedName !== rawSeriesName) {
              console.log(`No results for "${normalizedName}", trying raw name...`);
              results = await searchTVShow(obsidian, apiKey, rawSeriesName);
            }
            
            // If still no results, try without "Classic"
            if ((!results || results.length === 0) && normalizedName.toLowerCase().includes("classic")) {
              const withoutClassic = normalizedName.replace(/\s*Classic\s*/i, " ").replace(/\s+/g, " ").trim();
              console.log(`No results, trying without "Classic": ${withoutClassic}`);
              results = await searchTVShow(obsidian, apiKey, withoutClassic);
            }
            
            if (!results || results.length === 0) {
              console.log(`Series not found in TMDB: ${rawSeriesName} (normalized: ${normalizedName})`);
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            // Let user pick if multiple results
            let tmdbData;
            if (results.length === 1) {
              tmdbData = results[0];
              if (Notice) new Notice(`Found: ${tmdbData.name}`);
            } else {
              // Multiple results - interactive selection with header
              if (Notice) new Notice(`${results.length} TMDB results for "${normalizedName}" - please select`);
              
              const headerText = `── Matching: "${rawSeriesName}" ──`;
              const options = [headerText, ...results.slice(0, SETTINGS.maxResults).map(r => `${r.name} (${r.first_air_date?.substring(0, 4) || "?"})`), "❌ Skip this series"];
              const values = ["header", ...results.slice(0, SETTINGS.maxResults), null];
              let selection = await qa.suggester(options, values);
              while (selection === "header") {
                selection = await qa.suggester(options, values);
              }
              tmdbData = selection;
              
              if (!tmdbData) {
                console.log(`User skipped series selection: ${normalizedName}`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }
            
            // Use the TMDB name as the actual series name
            actualSeriesName = tmdbData.name || normalizedName;
            tmdbId = tmdbData.id;
            
            await createSeriesNote(app, obsidian, actualSeriesName, tmdbData);
            await fetchAndCreateAllEpisodes(app, obsidian, apiKey, actualSeriesName, tmdbId, Notice);
            
            // Save alias if name differs from platform name
            await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
            progress.seriesAliases = progress.seriesAliases || {};
            if (rawSeriesName.toLowerCase() !== actualSeriesName.toLowerCase()) {
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
            }
            
            await markSeriesFetched(app, actualSeriesName, tmdbId);
            progress.fetchedSeries[actualSeriesName] = tmdbId;
            
            seriesFetched++;
          }
        }

        // ============================================================
        // EPISODE MATCHING - Translate source episode to TMDB episode
        // ============================================================
        
        // Build episode cache for this series
        const episodeCache = buildEpisodeCacheFromVault(app, actualSeriesName);
        
        // Variables to track the final episode to use
        let finalSeason = season;
        let finalEpisode = episode;
        let matchMethod = "number"; // Track how we found the episode
        let episodeMatchValid = false;
        
        // Get part number from episode title (for multi-part episodes)
        const { part: csvPart } = extractPartNumber(item.episodeTitle || "");
        
        // If we have episode info from parsing, try to match by title
        if (season && episode && item.episodeTitle && episodeCache) {
          // Try title-based matching within the expected season
          const titleMatch = findTmdbEpisodeByTitle(
            episodeCache, 
            season, 
            item.episodeTitle, 
            csvPart, 
            episode, 
            actualSeriesName
          );
          
          if (titleMatch && titleMatch.confidence >= 0.7) {
            // High confidence match - use it
            finalEpisode = titleMatch.number;
            matchMethod = titleMatch.method;
            episodeMatchValid = true;
            console.log(`Episode matched: "${item.episodeTitle}" → S${season}E${finalEpisode} (${matchMethod}, ${Math.round(titleMatch.confidence * 100)}%)`);
            
            // Track auto-matched episodes (where source episode differs from TMDB)
            if (episode !== finalEpisode) {
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`,
                sourceTitle: item.episodeTitle,
                tmdbEpisode: `S${String(season).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: titleMatch.title,
                confidence: titleMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            }
          } else {
            // Try searching across all seasons
            const crossSeasonMatch = findEpisodeAcrossSeasons(
              episodeCache, 
              item.episodeTitle, 
              season, 
              csvPart, 
              episode, 
              actualSeriesName
            );
            
            if (crossSeasonMatch && crossSeasonMatch.confidence >= 0.7) {
              finalSeason = crossSeasonMatch.season;
              finalEpisode = crossSeasonMatch.number;
              matchMethod = crossSeasonMatch.method + "-cross-season";
              episodeMatchValid = true;
              console.log(`Episode matched across seasons: "${item.episodeTitle}" → S${finalSeason}E${finalEpisode} (${matchMethod})`);
              
              // Track cross-season matches
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`,
                sourceTitle: item.episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: crossSeasonMatch.title,
                confidence: crossSeasonMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            } else {
              // Low confidence or no match - prompt user to select
              console.log(`Low confidence match for "${item.episodeTitle}" - prompting user...`);
              const selection = await promptEpisodeSelection(
                qa, Notice, actualSeriesName, season, episode, 
                item.episodeTitle || "Unknown", episodeCache, progress
              );
              
              if (selection.action === "select") {
                finalSeason = selection.season;
                finalEpisode = selection.episode;
                matchMethod = "manual";
                episodeMatchValid = true;
                
                // Track manual selection (low confidence match)
                episodeMismatches.push({
                  series: actualSeriesName,
                  sourceEpisode: `S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}`,
                  sourceTitle: item.episodeTitle,
                  tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                  tmdbTitle: episodeCache?.[`S${finalSeason}`]?.find(e => e.number === finalEpisode)?.title || "Unknown",
                  confidence: 0,
                  method: "manual-selection",
                  autoMatched: false,
                });
                
                // Save the manual mapping for future use
                if (!progress.manualEpisodeMappings) progress.manualEpisodeMappings = {};
                if (!progress.manualEpisodeMappings[actualSeriesName]) {
                  progress.manualEpisodeMappings[actualSeriesName] = {};
                }
                progress.manualEpisodeMappings[actualSeriesName][`S${season}E${episode}`] = { 
                  season: finalSeason, 
                  episode: finalEpisode 
                };
                await saveProgress(app, progress);
                
              } else if (selection.action === "skip") {
                // Save as skipped for future
                if (!progress.skippedEpisodes) progress.skippedEpisodes = {};
                if (!progress.skippedEpisodes[actualSeriesName]) {
                  progress.skippedEpisodes[actualSeriesName] = [];
                }
                if (!progress.skippedEpisodes[actualSeriesName].includes(`S${season}E${episode}`)) {
                  progress.skippedEpisodes[actualSeriesName].push(`S${season}E${episode}`);
                }
                await saveProgress(app, progress);
                
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              } else {
                // User cancelled - stop import
                if (Notice) new Notice("Import cancelled.", 3000);
                return;
              }
            }
          }
        } else if (!season || !episode) {
          // No season/episode parsed - prompt user
          if (Notice) new Notice(`Could not parse episode info from: "${item.episodeTitle}"`);
          
          // If we have episode cache, let user pick from list
          if (episodeCache) {
            const selection = await promptEpisodeSelection(
              qa, Notice, actualSeriesName, 1, 1, 
              item.episodeTitle || "Unknown", episodeCache, progress, true
            );
            
            if (selection.action === "select") {
              finalSeason = selection.season;
              finalEpisode = selection.episode;
              matchMethod = "manual-no-parse";
              episodeMatchValid = true;
            } else if (selection.action === "skip") {
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            } else {
              if (Notice) new Notice("Import cancelled.", 3000);
              return;
            }
          } else {
            // No cache - offer manual entry
            const action = await qa.suggester(
              [`Enter season/episode manually`, `Use S01E01 (default)`, `Skip this entry`],
              ["manual", "default", "skip"]
            );
            
            if (action === "skip" || action === undefined) {
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            } else if (action === "default") {
              finalSeason = 1;
              finalEpisode = 1;
              matchMethod = "default";
              episodeMatchValid = true;
            } else {
              const seasonStr = await qa.inputPrompt("Enter season number:", "1");
              const episodeStr = await qa.inputPrompt("Enter episode number:", "1");
              finalSeason = parseInt(seasonStr) || 1;
              finalEpisode = parseInt(episodeStr) || 1;
              matchMethod = "manual-entry";
              episodeMatchValid = true;
            }
          }
        } else {
          // Have season/episode but no cache or no title - use parsed numbers
          episodeMatchValid = true;
          matchMethod = "number-no-cache";
        }

        // Skip if no valid episode match
        if (!episodeMatchValid) {
          console.log(`No valid episode match for: ${actualSeriesName} - ${item.episodeTitle}`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }

        const watchResult = await createWatchLogEntry(app, {
          type: "episode",
          date,
          showName: actualSeriesName,
          season: finalSeason,
          episode: finalEpisode,
          episodeTitle: item.episodeTitle || "",
          source: sourceConfig.wikilink,
        });

        if (watchResult.created) {
          await updateEpisodeWatched(app, actualSeriesName, finalSeason, finalEpisode, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${actualSeriesName} S${season}E${episode} on ${date}`);
          alreadyInVault.push({
            type: "episode",
            title: actualSeriesName,
            season: finalSeason,
            episode: finalEpisode,
            episodeTitle: item.episodeTitle,
            date,
          });
        }
        await markWatchProcessed(app, uniqueId);
      }

      if (imported % 25 === 0 && Notice) {
        new Notice(`Imported ${imported}/${itemsToImport.length}...`);
      }

    } catch (e) {
      console.error(`Error processing: ${title}`, e);
      skipped++;
    }
  }

  // Write episode mismatch log if any
  if (episodeMismatches.length > 0) {
    await writeEpisodeMismatchLog(app, episodeMismatches, "Prime Video");
  }

  // Summary
  console.log("=".repeat(50));
  console.log("PRIME VIDEO IMPORT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Watch entries created: ${imported}`);
  console.log(`Series fetched: ${seriesFetched}`);
  console.log(`Movies fetched: ${moviesFetched}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Already in vault: ${alreadyInVault.length}`);
  console.log(`Episode mismatches logged: ${episodeMismatches.length}`);
  console.log("=".repeat(50));

  if (Notice) {
    let msg = `Prime import complete!\n${imported} watch entries created.`;
    if (seriesFetched > 0) msg += `\n${seriesFetched} new series fetched.`;
    if (moviesFetched > 0) msg += `\n${moviesFetched} new movies fetched.`;
    if (skipped > 0) msg += `\n${skipped} items skipped.`;
    if (newSkipped > 0) msg += `\n${newSkipped} series added to skip list.`;
    if (alreadyInVault.length > 0) {
      msg += `\n${alreadyInVault.length} already in vault:`;
      // Group by title for cleaner display
      const grouped = {};
      for (const item of alreadyInVault) {
        const key = item.title;
        if (!grouped[key]) grouped[key] = [];
        if (item.type === "episode") {
          grouped[key].push(`S${pad2(item.season)}E${pad2(item.episode)}`);
        } else {
          grouped[key].push("(movie)");
        }
      }
      // Show up to 5 titles in notice
      const titles = Object.keys(grouped).slice(0, 5);
      for (const title of titles) {
        const eps = grouped[title];
        if (eps.length <= 3) {
          msg += `\n  • ${title}: ${eps.join(", ")}`;
        } else {
          msg += `\n  • ${title}: ${eps.slice(0, 2).join(", ")} +${eps.length - 2} more`;
        }
      }
      if (Object.keys(grouped).length > 5) {
        msg += `\n  ...and ${Object.keys(grouped).length - 5} more titles`;
      }
    }
    if (episodeMismatches.length > 0) msg += `\n${episodeMismatches.length} episode translations logged.`;
    const remaining = toProcess.length - itemsToImport.length;
    if (remaining > 0) msg += `\n\n${remaining} more items remaining.`;
    new Notice(msg, 10000);
  }

  // Clean up queue file after successful import
  const remaining = toProcess.length - itemsToImport.length;
  if (remaining === 0) {
    // All items processed - delete the queue file automatically
    try {
      await app.vault.adapter.remove(queueFile);
      console.log("Prime import queue cleared (all items processed)");
    } catch (e) {
      console.error("Failed to clear queue file:", e);
    }
  }
}

// --- NETFLIX EXTENSION HANDLER ---
async function handleNetflixExtension(params, apiKey, sourceConfig) {
  const { app, qa, obsidian, Notice } = params;

  // Load import queue
  const queueFile = sourceConfig.queueFile;
  let queue;
  try {
    const exists = await app.vault.adapter.exists(queueFile);
    if (!exists) {
      if (Notice) new Notice("No Netflix import queue found.\n\nUse the Chrome extension to scrape viewing history first.", 5000);
      return;
    }
    const raw = await app.vault.adapter.read(queueFile);
    queue = JSON.parse(raw);
  } catch (e) {
    if (Notice) new Notice(`Failed to load import queue: ${e.message}`);
    return;
  }

  if (!queue || !queue.items || queue.items.length === 0) {
    if (Notice) new Notice("Import queue is empty.", 3000);
    return;
  }

  console.log(`Netflix import queue: ${queue.items.length} items`);

  // Load progress
  const progress = await loadProgress(app);
  const processedSet = new Set(progress.processedWatchIds || []);

  // Filter unprocessed items
  // Netflix uniqueId includes episode info to distinguish multiple episodes of same series on same day
  const toProcess = queue.items.filter(item => {
    const date = item.dateWatched ? item.dateWatched.substring(0, 10) : localISODate();
    const title = item.title || "";
    const episodeInfo = item.type === "Series" ? `-S${item.season || 1}-${item.episodeTitle || ""}` : "";
    const uniqueId = `${sourceConfig.prefix}${date}-${title}${episodeInfo}`.toLowerCase();
    return !processedSet.has(uniqueId);
  });

  if (toProcess.length === 0) {
    const clearQueue = await qa.yesNoPrompt(
      "All items processed",
      `All ${queue.items.length} items have been imported.\n\nClear the import queue?`
    );
    if (clearQueue) {
      await app.vault.adapter.remove(queueFile);
      if (Notice) new Notice("Import queue cleared.");
    }
    return;
  }

  // Ask import limit
  const importLimit = await promptImportLimit(qa, toProcess.length, "Netflix queue");
  if (importLimit === 0) {
    const clearQueue = await qa.yesNoPrompt(
      "Import cancelled",
      "Clear the import queue?\n\n(If you keep it, Shows will auto-start Netflix import next time)"
    );
    if (clearQueue) {
      await app.vault.adapter.remove(queueFile);
      if (Notice) new Notice("Import queue cleared.");
    }
    return;
  }

  const itemsToImport = toProcess.slice(0, importLimit);

  // Confirm
  const proceed = await qa.yesNoPrompt(
    "Netflix Import",
    `Importing ${itemsToImport.length} item${itemsToImport.length === 1 ? "" : "s"}.\n\nThis will fetch metadata from TMDB.\n\nContinue?`
  );
  if (!proceed) {
    const clearQueue = await qa.yesNoPrompt(
      "Import cancelled",
      "Clear the import queue?\n\n(If you keep it, Shows will auto-start Netflix import next time)"
    );
    if (clearQueue) {
      await app.vault.adapter.remove(queueFile);
      if (Notice) new Notice("Import queue cleared.");
    }
    return;
  }

  // Process items
  let imported = 0;
  let seriesFetched = 0;
  let moviesFetched = 0;
  let skipped = 0;
  let newSkipped = 0;  // Count of series added to skip list this session
  
  // Track episode mismatches for logging
  const episodeMismatches = [];
  
  // Track items already in vault
  const alreadyInVault = [];

  for (const item of itemsToImport) {
    const date = item.dateWatched ? item.dateWatched.substring(0, 10) : localISODate();
    const itemType = item.type; // "Movie" or "Series"
    const title = item.title || "Unknown";
    // Netflix uniqueId includes episode info to distinguish multiple episodes of same series on same day
    const episodeInfo = itemType === "Series" ? `-S${item.season || 1}-${item.episodeTitle || ""}` : "";
    const uniqueId = `${sourceConfig.prefix}${date}-${title}${episodeInfo}`.toLowerCase();

    try {
      if (itemType === "Movie") {
        // Handle movie
        if (!progress.fetchedMovies[title]) {
          const results = await searchMovie(obsidian, apiKey, title);
          const tmdbData = results[0];

          if (!tmdbData) {
            console.log(`Movie not found in TMDB: ${title}`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }

          const fullDetails = await getMovieDetails(obsidian, apiKey, tmdbData.id);
          await createMovieNote(app, obsidian, title, fullDetails || tmdbData);

          const genres = extractGenresFromTmdb(fullDetails);
          if (genres.length > 0) {
            const notePath = `${SETTINGS.folders.movies}/${safeFilename(title)}.md`;
            await upsertAndLinkGenres(app, obsidian, notePath, genres);
          }

          await markMovieFetched(app, title, tmdbData.id);
          moviesFetched++;
        }

        const watchResult = await createWatchLogEntry(app, {
          type: "movie",
          date,
          showName: title,
          source: sourceConfig.wikilink,
        });

        if (watchResult.created) {
          await updateMovieWatched(app, title, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${title} on ${date}`);
          alreadyInVault.push({ type: "movie", title, date });
        }
        await markWatchProcessed(app, uniqueId);

      } else if (itemType === "Series") {
        // Handle series - Netflix provides pre-parsed season and episodeTitle
        let season = item.season;
        // Ensure episodeTitle is a string (queue data may be corrupted from old versions)
        let episodeTitle = item.episodeTitle || "";
        if (typeof episodeTitle === 'object') {
          episodeTitle = episodeTitle.cleanedTitle || episodeTitle.title || String(episodeTitle);
        }
        const rawSeriesName = title;
        
        // Skip items with invalid/malformed series names
        if (!rawSeriesName || rawSeriesName.length < 2 || /^[^a-zA-Z0-9]+$/.test(rawSeriesName)) {
          console.log(`Skipping malformed series name: "${rawSeriesName}"`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }
        
        // Normalize series name for vault search
        const normalizedName = normalizeSeriesName(rawSeriesName);
        let actualSeriesName = rawSeriesName;
        let tmdbId = null;

        // 1. Check if already fetched (try both raw and normalized names)
        const alreadyFetchedRaw = progress.fetchedSeries[rawSeriesName];
        const alreadyFetchedNorm = progress.fetchedSeries[normalizedName];

        if (alreadyFetchedRaw) {
          actualSeriesName = rawSeriesName;
          tmdbId = alreadyFetchedRaw;
        } else if (alreadyFetchedNorm) {
          actualSeriesName = normalizedName;
          tmdbId = alreadyFetchedNorm;
        } else {
          // 2. Check if series is in skip list
          if (isSeriesSkipped(progress, rawSeriesName) || isSeriesSkipped(progress, normalizedName)) {
            console.log(`Series "${rawSeriesName}" is in skip list, skipping`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }

          // 3. Check for known alias (instant match!)
          const aliasMatch = lookupSeriesByAlias(progress, rawSeriesName) 
                          || lookupSeriesByAlias(progress, normalizedName);
          if (aliasMatch) {
            console.log(`Alias match: "${rawSeriesName}" → "${aliasMatch.tmdbName}"`);
            actualSeriesName = aliasMatch.tmdbName;
            tmdbId = aliasMatch.tmdbId;
            // Proceed to episode matching
          }

          // 4. Check vault for existing series or fuzzy matches
          if (!tmdbId) {
            let existingInVault = findExistingSeriesInVault(app, normalizedName);
            const vaultMatches = searchVaultForSeries(app, normalizedName);
            
            // If we found fuzzy matches but no exact match, prompt user to confirm identity
            if (!existingInVault && vaultMatches.length > 0) {
              const identity = await promptConfirmSeriesIdentity(qa, rawSeriesName, vaultMatches);
              
              if (identity.action === "existing") {
                existingInVault = identity.match;
              } else if (identity.action === "skip") {
                // User chose to skip this item directly from identity prompt
                console.log(`Skipping item with series "${rawSeriesName}" (user chose skip)`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
              // If "new", existingInVault stays null, proceed to Add/Skip/Cancel
            }

            if (existingInVault) {
              // Use existing series from vault
              actualSeriesName = existingInVault.name;
              const cache = app.metadataCache.getFileCache(existingInVault.file);
              tmdbId = cache?.frontmatter?.tmdbId || existingInVault.tmdbId || "vault-only";
              
              // Save alias for future imports
              await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
              progress.seriesAliases = progress.seriesAliases || {};
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
              
              await markSeriesFetched(app, actualSeriesName, tmdbId);
              progress.fetchedSeries[actualSeriesName] = tmdbId;
            }
          }

          // 5. New series - prompt Add/Skip/Cancel
          if (!tmdbId) {
            const action = await promptSeriesAction(qa, rawSeriesName);
            
            if (action === "cancel") {
              if (Notice) new Notice("Import cancelled by user.");
              return;
            }
            
            if (action === "skip") {
              await markSeriesSkipped(app, rawSeriesName, sourceConfig.prefix);
              progress.skippedSeries = progress.skippedSeries || {};
              progress.skippedSeries[rawSeriesName] = { source: sourceConfig.prefix, skippedAt: new Date().toISOString().split('T')[0] };
              skipped++;
              newSkipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            // action === "add" - Search TMDB
            const searchTerms = [rawSeriesName, normalizedName];
            let results = null;

            for (const term of searchTerms) {
              results = await searchTVShow(obsidian, apiKey, term);
              if (results && results.length > 0) break;
            }
            
            if (!results || results.length === 0) {
              console.log(`Series not found in TMDB: ${rawSeriesName} (normalized: ${normalizedName})`);
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }

            // Let user pick if multiple results
            let tmdbData;
            if (results.length === 1) {
              tmdbData = results[0];
            } else {
              // Add header showing what's being matched
              const headerText = `── Matching: "${rawSeriesName}" ──`;
              const options = [headerText, ...results.slice(0, 10).map(r => `${r.name} (${r.first_air_date?.substring(0, 4) || "?"})`), "❌ Skip this series"];
              const values = ["header", ...results.slice(0, 10), null];
              let selection = await qa.suggester(options, values);
              while (selection === "header") {
                selection = await qa.suggester(options, values);
              }
              tmdbData = selection;
              
              if (!tmdbData) {
                console.log(`User skipped series selection: ${normalizedName}`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }

            // Fetch full series details and create note
            const fullDetails = await getTVShowDetails(obsidian, apiKey, tmdbData.id);
            actualSeriesName = fullDetails?.name || tmdbData.name;
            tmdbId = tmdbData.id;

            await createSeriesNote(app, obsidian, actualSeriesName, fullDetails || tmdbData);
            
            // Fetch all episodes so episode matching can work
            await fetchAndCreateAllEpisodes(app, obsidian, apiKey, actualSeriesName, tmdbId, Notice);
            
            const genres = extractGenresFromTmdb(fullDetails);
            if (genres.length > 0) {
              const notePath = `${SETTINGS.folders.series}/${safeFilename(actualSeriesName)}/${safeFilename(actualSeriesName)}.md`;
              await upsertAndLinkGenres(app, obsidian, notePath, genres);
            }

            // Save alias if name differs from platform name
            await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
            progress.seriesAliases = progress.seriesAliases || {};
            if (rawSeriesName.toLowerCase() !== actualSeriesName.toLowerCase()) {
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
            }

            await markSeriesFetched(app, actualSeriesName, tmdbId);
            progress.fetchedSeries[actualSeriesName] = tmdbId;
            seriesFetched++;
          }
        }

        // Now find/validate episode number using TMDB
        let finalSeason = season || 1;
        let finalEpisode = 1;
        let matchMethod = "default";
        let episodeMatchValid = false;

        // Build episode cache for this series
        const seriesFolder = `${SETTINGS.folders.series}/${safeFilename(actualSeriesName)}`;
        const episodeCache = buildEpisodeCacheFromVault(app, actualSeriesName, seriesFolder);
        
        // Check for manual mapping from previous runs
        const episodeKey = `${finalSeason}|${episodeTitle}`;
        const manualMapping = progress.manualEpisodeMappings?.[actualSeriesName]?.[episodeKey];
        const isSkipped = progress.skippedEpisodes?.[actualSeriesName]?.[episodeKey];

        if (isSkipped) {
          console.log(`Skipping previously skipped: ${actualSeriesName} - ${episodeTitle}`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }

        if (manualMapping) {
          finalSeason = manualMapping.season;
          finalEpisode = manualMapping.episode;
          matchMethod = "manual-cached";
          episodeMatchValid = true;
        } else if (episodeTitle) {
          // Try to match episode by title
          // Note: findTmdbEpisodeByTitle and findEpisodeAcrossSeasons call cleanEpisodeTitle internally
          const { part: csvPartNumber } = extractPartNumber(episodeTitle);
          
          // Try TMDB matching
          const tmdbMatch = findTmdbEpisodeByTitle(episodeCache, finalSeason, episodeTitle, csvPartNumber, null, actualSeriesName);
          
          if (tmdbMatch && tmdbMatch.confidence >= 0.7) {
            // High confidence match in expected season
            finalEpisode = tmdbMatch.number;
            matchMethod = `tmdb-title-${Math.round(tmdbMatch.confidence * 100)}`;
            episodeMatchValid = true;
            
            // Log the match
            if (tmdbMatch.number !== 1 || tmdbMatch.confidence < 1.0) {
              episodeMismatches.push({
                series: actualSeriesName,
                netflixTitle: episodeTitle,
                tmdbSeason: finalSeason,
                tmdbEpisode: tmdbMatch.number,
                tmdbTitle: tmdbMatch.title,
                confidence: tmdbMatch.confidence,
                matchMethod,
              });
            }
          } else {
            // No match or low confidence in expected season - try cross-season matching
            const crossSeasonMatch = findEpisodeAcrossSeasons(
              episodeCache,
              episodeTitle,
              finalSeason,
              csvPartNumber,
              null,
              actualSeriesName
            );
            
            if (crossSeasonMatch && crossSeasonMatch.confidence >= 0.7) {
              // Found high confidence match in different season
              finalSeason = crossSeasonMatch.season;
              finalEpisode = crossSeasonMatch.number;
              matchMethod = crossSeasonMatch.method + "-cross-season";
              episodeMatchValid = true;
              
              // Log cross-season match
              episodeMismatches.push({
                series: actualSeriesName,
                netflixTitle: episodeTitle,
                tmdbSeason: crossSeasonMatch.season,
                tmdbEpisode: crossSeasonMatch.number,
                tmdbTitle: crossSeasonMatch.title,
                confidence: crossSeasonMatch.confidence,
                matchMethod,
              });
            } else {
              // Low confidence or no match - prompt user
              const selection = await promptEpisodeSelection(
                qa, Notice, actualSeriesName, finalSeason, null, episodeTitle,
                episodeCache, progress, false, 0
              );
              
              if (selection.action === "select") {
                finalSeason = selection.season;
                finalEpisode = selection.episode;
                matchMethod = "manual-selected";
                episodeMatchValid = true;

                // Save manual mapping
                if (!progress.manualEpisodeMappings) progress.manualEpisodeMappings = {};
                if (!progress.manualEpisodeMappings[actualSeriesName]) {
                  progress.manualEpisodeMappings[actualSeriesName] = {};
                }
                progress.manualEpisodeMappings[actualSeriesName][episodeKey] = {
                  season: selection.season,
                  episode: selection.episode,
                };
                await saveProgress(app, progress);
              } else if (selection.action === "skip") {
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              } else if (selection.action === "cancel") {
                // User cancelled - stop import entirely
                if (Notice) new Notice("Import cancelled by user.");
                return;
              } else {
                // Unknown action - skip this episode
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }
          }
        } else {
          // No episode title - ask user for season/episode
          const action = await qa.suggester(
            ["Enter manually", "Skip this item", "Use S01E01"],
            ["manual", "skip", "default"]
          );
          
          if (action === "skip" || action === undefined) {
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          } else if (action === "default") {
            finalSeason = 1;
            finalEpisode = 1;
            matchMethod = "default-no-title";
            episodeMatchValid = true;
          } else {
            const seasonInput = await qa.inputPrompt("Enter season number:");
            const episodeInput = await qa.inputPrompt("Enter episode number:");
            finalSeason = parseInt(seasonInput, 10) || 1;
            finalEpisode = parseInt(episodeInput, 10) || 1;
            matchMethod = "manual-input";
            episodeMatchValid = true;
          }
        }

        // Skip if no valid episode match
        if (!episodeMatchValid) {
          console.log(`No valid episode match for: ${actualSeriesName} - ${episodeTitle}`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }

        // Create watch log entry
        const watchResult = await createWatchLogEntry(app, {
          type: "episode",
          date,
          showName: actualSeriesName,
          season: finalSeason,
          episode: finalEpisode,
          episodeTitle: episodeTitle || "",
          source: sourceConfig.wikilink,
        });

        if (watchResult.created) {
          await updateEpisodeWatched(app, actualSeriesName, finalSeason, finalEpisode, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${actualSeriesName} S${finalSeason}E${finalEpisode} on ${date}`);
          alreadyInVault.push({
            type: "episode",
            title: actualSeriesName,
            season: finalSeason,
            episode: finalEpisode,
            episodeTitle,
            date,
          });
        }
        await markWatchProcessed(app, uniqueId);
      }

      if (imported % 25 === 0 && Notice) {
        new Notice(`Imported ${imported}/${itemsToImport.length}...`);
      }

    } catch (e) {
      console.error(`Error processing: ${title}`, e);
      skipped++;
    }
  }

  // Write episode mismatch log if any
  if (episodeMismatches.length > 0) {
    await writeEpisodeMismatchLog(app, episodeMismatches, "Netflix");
  }

  // Summary
  console.log("=".repeat(50));
  console.log("NETFLIX IMPORT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Watch entries created: ${imported}`);
  console.log(`Series fetched: ${seriesFetched}`);
  console.log(`Movies fetched: ${moviesFetched}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Already in vault: ${alreadyInVault.length}`);
  console.log(`Episode mismatches logged: ${episodeMismatches.length}`);
  console.log("=".repeat(50));

  if (Notice) {
    let msg = `Netflix import complete!\n${imported} watch entries created.`;
    if (seriesFetched > 0) msg += `\n${seriesFetched} new series fetched.`;
    if (moviesFetched > 0) msg += `\n${moviesFetched} new movies fetched.`;
    if (skipped > 0) msg += `\n${skipped} items skipped.`;
    if (newSkipped > 0) msg += `\n${newSkipped} series added to skip list.`;
    if (alreadyInVault.length > 0) {
      msg += `\n${alreadyInVault.length} already in vault:`;
      const grouped = {};
      for (const item of alreadyInVault) {
        const key = item.title;
        if (!grouped[key]) grouped[key] = [];
        if (item.type === "episode") {
          grouped[key].push(`S${pad2(item.season)}E${pad2(item.episode)}`);
        } else {
          grouped[key].push("(movie)");
        }
      }
      const titles = Object.keys(grouped).slice(0, 5);
      for (const titleKey of titles) {
        const eps = grouped[titleKey];
        if (eps.length <= 3) {
          msg += `\n  • ${titleKey}: ${eps.join(", ")}`;
        } else {
          msg += `\n  • ${titleKey}: ${eps.slice(0, 2).join(", ")} +${eps.length - 2} more`;
        }
      }
      if (Object.keys(grouped).length > 5) {
        msg += `\n  ...and ${Object.keys(grouped).length - 5} more titles`;
      }
    }
    if (episodeMismatches.length > 0) msg += `\n${episodeMismatches.length} episode translations logged.`;
    const remaining = toProcess.length - itemsToImport.length;
    if (remaining > 0) msg += `\n\n${remaining} more items remaining.`;
    new Notice(msg, 10000);
  }

  // Clean up queue file after successful import
  const remaining = toProcess.length - itemsToImport.length;
  if (remaining === 0) {
    try {
      await app.vault.adapter.remove(queueFile);
      console.log("Netflix import queue cleared (all items processed)");
    } catch (e) {
      console.error("Failed to clear queue file:", e);
    }
  }
}

// --- CSV IMPORT HANDLER ---
async function handleCSVImport(params, apiKey) {
  const { app, qa, obsidian, Notice } = params;

  // Find CSV files
  const allFiles = app.vault.getFiles();
  const csvFiles = allFiles
    .filter((f) => f.extension === "csv")
    .map((f) => f.path)
    .sort((a, b) => b.localeCompare(a));

  if (csvFiles.length === 0) {
    if (Notice) new Notice("No CSV files found in vault.");
    return;
  }

  const csvPath = await qa.suggester(csvFiles, csvFiles);
  if (!csvPath) return;

  // Read and parse CSV
  if (Notice) new Notice(`Reading ${csvPath}...`);
  const csvText = await app.vault.adapter.read(csvPath);
  const csvData = parseCSV(csvText);

  if (csvData.rows.length === 0) {
    if (Notice) new Notice("No data found in CSV.");
    return;
  }

  // Validate required columns
  const requiredColumns = ["date watched", "type", "title"];
  const missingColumns = requiredColumns.filter(col => !csvData.headers.map(h => h.toLowerCase()).includes(col));
  if (missingColumns.length > 0) {
    if (Notice) new Notice(`CSV missing required columns: ${missingColumns.join(", ")}\n\nExpected: date watched, type, title, episode title (optional), source (optional)`, 8000);
    return;
  }

  // Load progress
  const progress = await loadProgress(app);
  const processedSet = new Set(progress.processedWatchIds || []);
  const seenInRun = new Set();

  // Filter to unprocessed items
  const toProcess = csvData.rows.filter((row) => {
    const date = parseDate(row["date watched"]);
    const type = (row["type"] || "").toLowerCase();
    const title = row["title"] || "";
    const episodeTitle = row["episode title"] || "";

    // Generate unique ID
    const uniqueId = `csv-${date}-${title}-${episodeTitle}`.trim().toLowerCase();

    if (processedSet.has(uniqueId)) return false;
    if (seenInRun.has(uniqueId)) return false;
    seenInRun.add(uniqueId);

    // Filter by type
    return type === "movie" || type === "series";
  });

  if (toProcess.length === 0) {
    const reset = await qa.yesNoPrompt(
      "All items processed",
      `All ${csvData.rows.length} items in the CSV have already been imported.\n\nWould you like to reset progress and re-import?`
    );
    if (reset) {
      // Clear CSV-prefixed items from progress
      progress.processedWatchIds = (progress.processedWatchIds || []).filter(
        id => !id.startsWith("csv-")
      );
      await saveProgress(app, progress);
      if (Notice) new Notice("CSV progress reset. Please run import again.", 3000);
    }
    return;
  }

  if (Notice) new Notice(`Found ${toProcess.length} unprocessed items (of ${csvData.rows.length} total)`);

  // Ask how many to import
  const importLimit = await promptImportLimit(qa, toProcess.length, "CSV file");
  if (!importLimit) return;

  const itemsToImport = toProcess.slice(0, importLimit);

  // Confirm
  const proceed = await qa.yesNoPrompt(
    "CSV Watch History Import",
    `Importing ${itemsToImport.length} watch${itemsToImport.length === 1 ? "" : "es"}.\n\nThis will fetch metadata from TMDB for new series/movies.\n\nContinue?`
  );
  if (!proceed) return;

  // Ensure folders
  await ensureFolder(app, SETTINGS.folders.movies);
  await ensureFolder(app, SETTINGS.folders.series);
  await ensureFolder(app, SETTINGS.folders.watched);
  await ensureFolder(app, SETTINGS.folders.covers);
  await ensureFolder(app, `${SETTINGS.folders.covers}/movies`);
  await ensureFolder(app, `${SETTINGS.folders.covers}/series`);

  // Process items
  let imported = 0;
  let seriesFetched = 0;
  let moviesFetched = 0;
  let skipped = 0;
  let newSkipped = 0;  // Count of series added to skip list this session
  
  // Track episode matching results for logging
  const episodeMismatches = [];

  for (const row of itemsToImport) {
    const date = parseDate(row["date watched"]);
    const type = (row["type"] || "").toLowerCase();
    const rawTitle = row["title"] || "";
    const episodeTitle = row["episode title"] || "";
    const csvSource = (row["source"] || "").toLowerCase().trim();
    
    // Determine source wikilink
    const sourceWikilink = SETTINGS.sourceMap[csvSource] || SETTINGS.sourceMap["other"] || "[[Other]]";
    
    // Unique ID for progress tracking
    const uniqueId = `csv-${date}-${rawTitle}-${episodeTitle}`.trim().toLowerCase();

    try {
      if (type === "movie") {
        // Handle movie
        const movieName = rawTitle;
        
        if (!progress.fetchedMovies[movieName]) {
          const results = await searchMovie(obsidian, apiKey, movieName);
          const searchResult = results[0] || null;
          
          if (!searchResult || !searchResult.id) {
            console.log(`Movie not found in TMDB: ${movieName}`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }
          
          const fullDetails = await getMovieDetails(obsidian, apiKey, searchResult.id);
          await createMovieNote(app, obsidian, movieName, fullDetails || searchResult);
          
          const genres = extractGenresFromTmdb(fullDetails);
          if (genres.length > 0) {
            const movieNotePath = `${SETTINGS.folders.movies}/${safeFilename(movieName)}.md`;
            await upsertAndLinkGenres(app, obsidian, movieNotePath, genres);
          }
          
          await markMovieFetched(app, movieName, searchResult.id);
          moviesFetched++;
        }
        
        // Create watch log entry
        const watchResult = await createWatchLogEntry(app, {
          type: "movie",
          date,
          showName: movieName,
          source: sourceWikilink,
        });
        
        if (watchResult.created) {
          await updateMovieWatched(app, movieName, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${movieName} on ${date}`);
        }
        await markWatchProcessed(app, uniqueId);
        
      } else if (type === "series") {
        // Handle series - normalize name
        
        // Skip items with invalid/malformed series names
        if (!rawTitle || rawTitle.length < 2 || /^[^a-zA-Z0-9]+$/.test(rawTitle)) {
          console.log(`Skipping malformed series name: "${rawTitle}"`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }
        
        const normalizedName = normalizeSeriesName(rawTitle);
        let actualSeriesName = normalizedName;
        
        // Parse episode info from episode title
        const episodeMatch = episodeTitle?.match(/(?:S|Season\s*)(\d+)\s*(?:E|Episode\s*)(\d+)/i);
        let csvSeason = episodeMatch ? parseInt(episodeMatch[1]) : null;
        let csvEpisode = episodeMatch ? parseInt(episodeMatch[2]) : null;
        
        // Try "Episode X" pattern
        if (!csvSeason && !csvEpisode) {
          const epOnlyMatch = episodeTitle?.match(/Episode\s+(\d+)/i);
          if (epOnlyMatch) {
            csvSeason = 1;
            csvEpisode = parseInt(epOnlyMatch[1]);
          }
        }
        
        // 1. Check if series already fetched
        let tmdbId = progress.fetchedSeries[normalizedName] || progress.fetchedSeries[rawTitle];
        
        if (tmdbId) {
          // Series already fetched - use the name it was fetched under
          actualSeriesName = progress.fetchedSeries[normalizedName] ? normalizedName : rawTitle;
        } else {
          // 2. Check if series is in skip list
          if (isSeriesSkipped(progress, rawTitle) || isSeriesSkipped(progress, normalizedName)) {
            console.log(`Series "${rawTitle}" is in skip list, skipping`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }

          // 3. Check for known alias (instant match!)
          const aliasMatch = lookupSeriesByAlias(progress, rawTitle) 
                          || lookupSeriesByAlias(progress, normalizedName);
          if (aliasMatch) {
            console.log(`Alias match: "${rawTitle}" → "${aliasMatch.tmdbName}"`);
            actualSeriesName = aliasMatch.tmdbName;
            tmdbId = aliasMatch.tmdbId;
          }

          // 4. Check vault for existing series or fuzzy matches
          if (!tmdbId) {
            let existingInVault = findExistingSeriesInVault(app, normalizedName);
            const vaultMatches = searchVaultForSeries(app, normalizedName);
            
            // If we found fuzzy matches but no exact match, prompt user to confirm identity
            if (!existingInVault && vaultMatches.length > 0) {
              const identity = await promptConfirmSeriesIdentity(qa, rawTitle, vaultMatches);
              
              if (identity.action === "existing") {
                existingInVault = identity.match;
              } else if (identity.action === "skip") {
                console.log(`Skipping item with series "${rawTitle}" (user chose skip)`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
              // If "new", existingInVault stays null, proceed to Add/Skip/Cancel
            }

            if (existingInVault) {
              // Use existing series from vault
              actualSeriesName = existingInVault.name;
              const cache = app.metadataCache.getFileCache(existingInVault.file);
              tmdbId = cache?.frontmatter?.tmdbId || existingInVault.tmdbId || "vault-only";
              
              // Save alias for future imports
              await addSeriesAlias(app, rawTitle, actualSeriesName, tmdbId);
              progress.seriesAliases = progress.seriesAliases || {};
              progress.seriesAliases[rawTitle] = { tmdbName: actualSeriesName, tmdbId };
              
              await markSeriesFetched(app, actualSeriesName, tmdbId);
              progress.fetchedSeries[actualSeriesName] = tmdbId;
            }
          }

          // 5. New series - prompt Add/Skip/Cancel
          if (!tmdbId) {
            const action = await promptSeriesAction(qa, rawTitle);
            
            if (action === "cancel") {
              if (Notice) new Notice("Import cancelled by user.");
              return;
            }
            
            if (action === "skip") {
              await markSeriesSkipped(app, rawTitle, "csv");
              progress.skippedSeries = progress.skippedSeries || {};
              progress.skippedSeries[rawTitle] = { source: "csv", skippedAt: new Date().toISOString().split('T')[0] };
              skipped++;
              newSkipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            // action === "add" - Search TMDB
            if (Notice) new Notice(`Searching TMDB for: ${normalizedName}...`);
            
            let results = await searchTVShow(obsidian, apiKey, normalizedName);
            
            if ((!results || results.length === 0) && normalizedName !== rawTitle) {
              results = await searchTVShow(obsidian, apiKey, rawTitle);
            }
            
            if (!results || results.length === 0) {
              console.log(`Series not found in TMDB: ${rawTitle}`);
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            let tmdbData;
            if (results.length === 1) {
              tmdbData = results[0];
              if (Notice) new Notice(`Found: ${tmdbData.name}`);
            } else {
              if (Notice) new Notice(`${results.length} TMDB results - please select`);
              
              const headerText = `── Matching: "${rawTitle}" ──`;
              const options = [headerText, ...results.slice(0, SETTINGS.maxResults).map(r => `${r.name} (${r.first_air_date?.substring(0, 4) || "?"})`), "❌ Skip this series"];
              const values = ["header", ...results.slice(0, SETTINGS.maxResults), null];
              let selection = await qa.suggester(options, values);
              while (selection === "header") {
                selection = await qa.suggester(options, values);
              }
              tmdbData = selection;
              
              if (!tmdbData) {
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }
            
            actualSeriesName = tmdbData.name || normalizedName;
            tmdbId = tmdbData.id;
            
            await createSeriesNote(app, obsidian, actualSeriesName, tmdbData);
            await fetchAndCreateAllEpisodes(app, obsidian, apiKey, actualSeriesName, tmdbId, Notice);
            
            // Save alias if name differs from platform name
            await addSeriesAlias(app, rawTitle, actualSeriesName, tmdbId);
            progress.seriesAliases = progress.seriesAliases || {};
            if (rawTitle.toLowerCase() !== actualSeriesName.toLowerCase()) {
              progress.seriesAliases[rawTitle] = { tmdbName: actualSeriesName, tmdbId };
            }
            
            await markSeriesFetched(app, actualSeriesName, tmdbId);
            progress.fetchedSeries[actualSeriesName] = tmdbId;
            
            seriesFetched++;
          }
        }
        
        // ============================================================
        // EPISODE MATCHING - Translate CSV episode to TMDB episode
        // ============================================================
        
        const episodeCache = buildEpisodeCacheFromVault(app, actualSeriesName);
        
        let finalSeason = csvSeason || 1;
        let finalEpisode = csvEpisode || 1;
        let matchMethod = "number";
        let episodeMatchValid = false;
        
        const { part: csvPart } = extractPartNumber(episodeTitle);
        
        if (csvSeason && csvEpisode && episodeTitle && episodeCache) {
          const titleMatch = findTmdbEpisodeByTitle(
            episodeCache,
            csvSeason,
            episodeTitle,
            csvPart,
            csvEpisode,
            actualSeriesName
          );
          
          if (titleMatch && titleMatch.confidence >= 0.7) {
            finalEpisode = titleMatch.number;
            matchMethod = titleMatch.method;
            episodeMatchValid = true;
            
            if (csvEpisode !== finalEpisode) {
              console.log(`CSV episode matched: "${episodeTitle}" → S${csvSeason}E${finalEpisode} (${matchMethod})`);
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(csvSeason).padStart(2,'0')}E${String(csvEpisode).padStart(2,'0')}`,
                sourceTitle: episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: titleMatch.title,
                confidence: titleMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            }
          } else {
            const crossSeasonMatch = findEpisodeAcrossSeasons(
              episodeCache,
              episodeTitle,
              csvSeason,
              csvPart,
              csvEpisode,
              actualSeriesName
            );
            
            if (crossSeasonMatch && crossSeasonMatch.confidence >= 0.7) {
              finalSeason = crossSeasonMatch.season;
              finalEpisode = crossSeasonMatch.number;
              matchMethod = crossSeasonMatch.method + "-cross-season";
              episodeMatchValid = true;
              
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(csvSeason).padStart(2,'0')}E${String(csvEpisode).padStart(2,'0')}`,
                sourceTitle: episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: crossSeasonMatch.title,
                confidence: crossSeasonMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            } else {
              // Low confidence - prompt user
              const selection = await promptEpisodeSelection(
                qa, Notice, actualSeriesName, csvSeason, csvEpisode,
                episodeTitle, episodeCache, progress
              );
              
              if (selection.action === "select") {
                finalSeason = selection.season;
                finalEpisode = selection.episode;
                matchMethod = "manual";
                episodeMatchValid = true;
                
                episodeMismatches.push({
                  series: actualSeriesName,
                  sourceEpisode: `S${String(csvSeason).padStart(2,'0')}E${String(csvEpisode).padStart(2,'0')}`,
                  sourceTitle: episodeTitle,
                  tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                  tmdbTitle: episodeCache?.[`S${finalSeason}`]?.find(e => e.number === finalEpisode)?.title || "Unknown",
                  confidence: 0,
                  method: "manual-selection",
                  autoMatched: false,
                });
                
                if (!progress.manualEpisodeMappings) progress.manualEpisodeMappings = {};
                if (!progress.manualEpisodeMappings[actualSeriesName]) {
                  progress.manualEpisodeMappings[actualSeriesName] = {};
                }
                progress.manualEpisodeMappings[actualSeriesName][`S${csvSeason}E${csvEpisode}`] = {
                  season: finalSeason,
                  episode: finalEpisode
                };
                await saveProgress(app, progress);
                
              } else if (selection.action === "skip") {
                if (!progress.skippedEpisodes) progress.skippedEpisodes = {};
                if (!progress.skippedEpisodes[actualSeriesName]) {
                  progress.skippedEpisodes[actualSeriesName] = [];
                }
                if (!progress.skippedEpisodes[actualSeriesName].includes(`S${csvSeason}E${csvEpisode}`)) {
                  progress.skippedEpisodes[actualSeriesName].push(`S${csvSeason}E${csvEpisode}`);
                }
                await saveProgress(app, progress);
                
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              } else {
                if (Notice) new Notice("Import cancelled.", 3000);
                return;
              }
            }
          }
        } else if (!csvSeason || !csvEpisode) {
          // No episode info parsed - prompt user if we have cache
          if (episodeCache) {
            if (Notice) new Notice(`Could not parse episode info from: "${episodeTitle}"`);
            const selection = await promptEpisodeSelection(
              qa, Notice, actualSeriesName, 1, 1,
              episodeTitle || "Unknown", episodeCache, progress, true
            );
            
            if (selection.action === "select") {
              finalSeason = selection.season;
              finalEpisode = selection.episode;
              matchMethod = "manual-no-parse";
              episodeMatchValid = true;
            } else if (selection.action === "skip") {
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            } else {
              if (Notice) new Notice("Import cancelled.", 3000);
              return;
            }
          } else {
            // No cache - use defaults or prompt
            const action = await qa.suggester(
              [`Enter season/episode manually`, `Use S01E01 (default)`, `Skip this entry`],
              ["manual", "default", "skip"]
            );
            
            if (action === "skip" || action === undefined) {
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            } else if (action === "default") {
              finalSeason = 1;
              finalEpisode = 1;
              matchMethod = "default";
              episodeMatchValid = true;
            } else {
              const seasonStr = await qa.inputPrompt("Enter season number:", "1");
              const episodeStr = await qa.inputPrompt("Enter episode number:", "1");
              finalSeason = parseInt(seasonStr) || 1;
              finalEpisode = parseInt(episodeStr) || 1;
              matchMethod = "manual-entry";
              episodeMatchValid = true;
            }
          }
        } else {
          // Have episode info but no cache - use parsed numbers
          episodeMatchValid = true;
          matchMethod = "number-no-cache";
        }
        
        if (!episodeMatchValid) {
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }
        
        // Create watch log entry
        const watchResult = await createWatchLogEntry(app, {
          type: "episode",
          date,
          showName: actualSeriesName,
          season: finalSeason,
          episode: finalEpisode,
          episodeTitle: episodeTitle,
          source: sourceWikilink,
        });
        
        if (watchResult.created) {
          await updateEpisodeWatched(app, actualSeriesName, finalSeason, finalEpisode, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${actualSeriesName} S${finalSeason}E${finalEpisode} on ${date}`);
        }
        await markWatchProcessed(app, uniqueId);
      }
      
      if (imported % 25 === 0 && imported > 0 && Notice) {
        new Notice(`Imported ${imported}/${itemsToImport.length}...`);
      }
      
    } catch (e) {
      console.error(`Error processing row: ${rawTitle}`, e);
      skipped++;
    }
  }
  
  // Write episode mismatch log if any
  if (episodeMismatches.length > 0) {
    await writeEpisodeMismatchLog(app, episodeMismatches, "CSV Import");
  }
  
  // Summary
  console.log("=".repeat(50));
  console.log("CSV IMPORT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Watch entries created: ${imported}`);
  console.log(`Series fetched from TMDB: ${seriesFetched}`);
  console.log(`Movies fetched from TMDB: ${moviesFetched}`);
  console.log(`Items skipped: ${skipped}`);
  console.log(`Episode mismatches logged: ${episodeMismatches.length}`);
  console.log("=".repeat(50));
  
  if (Notice) {
    let msg = `CSV import complete!\n${imported} watch entries created.`;
    if (seriesFetched > 0) msg += `\n${seriesFetched} new series fetched from TMDB.`;
    if (moviesFetched > 0) msg += `\n${moviesFetched} new movies fetched from TMDB.`;
    if (skipped > 0) msg += `\n${skipped} items skipped.`;
    if (newSkipped > 0) msg += `\n${newSkipped} series added to skip list.`;
    if (episodeMismatches.length > 0) msg += `\n${episodeMismatches.length} episode translations logged.`;
    const remaining = toProcess.length - itemsToImport.length;
    if (remaining > 0) msg += `\n\n${remaining} more items remaining. Run again to continue.`;
    new Notice(msg, 10000);
  }
}

// --- EMBY DIRECT HANDLER ---
async function handleEmbyDirect(params, apiKey, sourceConfig) {
  const { app, qa, obsidian, Notice } = params;
  
  // Load Emby-specific secrets
  const secrets = await loadSecrets(app);
  const embyServerUrl = secrets.embyServerUrl;
  const embyApiKey = secrets.embyApiKey;
  let embyUserId = secrets.embyUserId;
  
  // Validate Emby configuration
  if (!embyServerUrl) {
    if (Notice) new Notice("Emby server URL not found.\nAdd 'embyServerUrl' to .obsidian/quickadd-secrets.json", 5000);
    return;
  }
  
  if (!embyApiKey) {
    if (Notice) new Notice("Emby API key not found.\nAdd 'embyApiKey' to .obsidian/quickadd-secrets.json", 5000);
    return;
  }
  
  // If no user ID, fetch users and let user select
  if (!embyUserId) {
    if (Notice) new Notice("Fetching Emby users...");
    const users = await getEmbyUsers(obsidian, embyServerUrl, embyApiKey);
    
    if (!users || users.length === 0) {
      if (Notice) new Notice("No Emby users found. Check your API key and server URL.", 5000);
      return;
    }
    
    if (users.length === 1) {
      embyUserId = users[0].Id;
      if (Notice) new Notice(`Using Emby user: ${users[0].Name}`);
    } else {
      const userNames = users.map(u => u.Name);
      const userIds = users.map(u => u.Id);
      embyUserId = await qa.suggester(userNames, userIds);
      if (!embyUserId) return;
    }
  }
  
  // Fetch played items
  if (Notice) new Notice("Connecting to Emby server...");
  
  const allItems = await getEmbyPlayedItemsWithDates(obsidian, embyServerUrl, embyApiKey, embyUserId);
  
  if (!allItems || allItems.length === 0) {
    if (Notice) new Notice("No played items found in Emby.");
    return;
  }
  
  // Filter to only items WITH dates from Playback Reporting
  // (Historical items without dates should have been imported already)
  const items = allItems.filter(item => item._fromPlaybackReporting || item.PlaybackDate);
  
  console.log(`Emby API total: ${allItems.length}, With Playback Reporting dates: ${items.length}`);
  
  if (items.length === 0) {
    if (Notice) new Notice(
      `No NEW watches found.\n\n` +
      `Emby has ${allItems.length} played items total, but none have dates from Playback Reporting.\n\n` +
      `The plugin only tracks watches AFTER installation.`,
      8000
    );
    return;
  }
  
  if (Notice) new Notice(`Found ${items.length} items with watch dates (of ${allItems.length} total)`, 3000);
  
  // Load progress
  const progress = await loadProgress(app);
  const processedSet = new Set(progress.processedWatchIds || []);
  
  // Count how many emby items are already processed
  const embyProcessed = [...processedSet].filter(id => id.startsWith(sourceConfig.prefix)).length;
  console.log(`Playback Reporting items: ${items.length}, Previously processed: ${embyProcessed}`);
  
  // Filter to unprocessed items
  const toProcess = items.filter(item => {
    const date = getEmbyWatchDate(item);
    const itemType = item.Type;
    
    let uniqueId;
    if (itemType === "Movie") {
      uniqueId = `${sourceConfig.prefix}${date}-${item.Name}`.toLowerCase();
    } else if (itemType === "Episode") {
      const seriesName = item.SeriesName || item.Name;
      const season = item.ParentIndexNumber || 1;
      const episode = item.IndexNumber || 1;
      uniqueId = `${sourceConfig.prefix}${date}-${seriesName}-S${season}E${episode}`.toLowerCase();
    } else {
      return false;
    }
    
    return !processedSet.has(uniqueId);
  });
  
  if (toProcess.length === 0) {
    const showWord = items.length === 1 ? "show" : "shows";
    const reset = await qa.yesNoPrompt(
      "All shows processed",
      `Emby has ${items.length} ${showWord} for this user and they have already been imported into the vault.\n\nWould you like to reset import tracking and re-import?`
    );
    if (reset) {
      await resetProgressByPrefix(app, sourceConfig.prefix);
      if (Notice) new Notice("Emby progress reset. Continuing with import...", 2000);
      
      // Re-filter with cleared progress - all items are now unprocessed
      toProcess.push(...items.filter(item => {
        const itemType = item.Type;
        return itemType === "Movie" || itemType === "Episode";
      }));
      
      console.log(`After reset: ${toProcess.length} items to process`);
    } else {
      return;
    }
  }
  
  // Ask how many to import (shows count in popup)
  const importLimit = await promptImportLimit(qa, toProcess.length, "Emby server");
  if (!importLimit) return;
  
  const itemsToImport = toProcess.slice(0, importLimit);
  
  // Confirm
  const proceed = await qa.yesNoPrompt(
    "Emby Watch History Import",
    `Importing ${itemsToImport.length} watch${itemsToImport.length === 1 ? "" : "es"}.\n\nThis will fetch metadata from TMDB for new series/movies.\n\nContinue?`
  );
  if (!proceed) return;
  
  // Ensure folders
  await ensureFolder(app, SETTINGS.folders.movies);
  await ensureFolder(app, SETTINGS.folders.series);
  await ensureFolder(app, SETTINGS.folders.watched);
  await ensureFolder(app, SETTINGS.folders.covers);
  await ensureFolder(app, `${SETTINGS.folders.covers}/movies`);
  await ensureFolder(app, `${SETTINGS.folders.covers}/series`);
  
  // Process items
  let imported = 0;
  let seriesFetched = 0;
  let moviesFetched = 0;
  let skipped = 0;
  let newSkipped = 0;  // Count of series added to skip list this session
  
  // Track episode matching results for logging
  const episodeMismatches = [];
  
  for (const item of itemsToImport) {
    const date = getEmbyWatchDate(item);
    const itemType = item.Type;
    const embyId = item.Id;
    
    try {
      if (itemType === "Movie") {
        const movieName = item.Name;
        const year = item.ProductionYear;
        const uniqueId = `${sourceConfig.prefix}${date}-${movieName}`.toLowerCase();
        
        // Check if we need to fetch from TMDB
        if (!progress.fetchedMovies[movieName]) {
          const results = await searchMovie(obsidian, apiKey, movieName, year);
          const searchResult = results[0] || null;
          
          if (!searchResult || !searchResult.id) {
            console.log(`Movie not found in TMDB: ${movieName}`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }
          
          const fullDetails = await getMovieDetails(obsidian, apiKey, searchResult.id);
          await createMovieNote(app, obsidian, movieName, fullDetails || searchResult);
          
          const genres = extractGenresFromTmdb(fullDetails);
          if (genres.length > 0) {
            const movieNotePath = `${SETTINGS.folders.movies}/${safeFilename(movieName)}.md`;
            await upsertAndLinkGenres(app, obsidian, movieNotePath, genres);
          }
          
          await markMovieFetched(app, movieName, searchResult.id);
          moviesFetched++;
        }
        
        // Create watch log entry
        const watchResult = await createWatchLogEntry(app, {
          type: "movie",
          date,
          showName: movieName,
          source: sourceConfig.wikilink,
          embyId,
        });
        
        if (watchResult.created) {
          await updateMovieWatched(app, movieName, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${movieName} on ${date}`);
        }
        await markWatchProcessed(app, uniqueId);
        
      } else if (itemType === "Episode") {
        const rawSeriesName = item.SeriesName || "Unknown Series";
        
        // Skip items with invalid/malformed series names
        if (!rawSeriesName || rawSeriesName.length < 2 || /^[^a-zA-Z0-9]+$/.test(rawSeriesName)) {
          console.log(`Skipping malformed series name: "${rawSeriesName}"`);
          skipped++;
          continue;
        }
        
        const normalizedName = normalizeSeriesName(rawSeriesName);
        let actualSeriesName = rawSeriesName;
        const embySeason = item.ParentIndexNumber || 1;
        const embyEpisode = item.IndexNumber || 1;
        const episodeTitle = item.Name || "";
        const uniqueId = `${sourceConfig.prefix}${date}-${rawSeriesName}-S${embySeason}E${embyEpisode}`.toLowerCase();
        
        // 1. Check if we already have this series fetched
        let tmdbId = progress.fetchedSeries[rawSeriesName] || progress.fetchedSeries[normalizedName];
        
        if (tmdbId) {
          actualSeriesName = progress.fetchedSeries[rawSeriesName] ? rawSeriesName : normalizedName;
        } else {
          // 2. Check if series is in skip list
          if (isSeriesSkipped(progress, rawSeriesName) || isSeriesSkipped(progress, normalizedName)) {
            console.log(`Series "${rawSeriesName}" is in skip list, skipping`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }

          // 3. Check for known alias (instant match!)
          const aliasMatch = lookupSeriesByAlias(progress, rawSeriesName) 
                          || lookupSeriesByAlias(progress, normalizedName);
          if (aliasMatch) {
            console.log(`Alias match: "${rawSeriesName}" → "${aliasMatch.tmdbName}"`);
            actualSeriesName = aliasMatch.tmdbName;
            tmdbId = aliasMatch.tmdbId;
          }

          // 4. Check vault for existing series or fuzzy matches
          if (!tmdbId) {
            let existingInVault = findExistingSeriesInVault(app, normalizedName);
            const vaultMatches = searchVaultForSeries(app, normalizedName);
            
            // If we found fuzzy matches but no exact match, prompt user to confirm identity
            if (!existingInVault && vaultMatches.length > 0) {
              const identity = await promptConfirmSeriesIdentity(qa, rawSeriesName, vaultMatches);
              
              if (identity.action === "existing") {
                existingInVault = identity.match;
              } else if (identity.action === "skip") {
                console.log(`Skipping item with series "${rawSeriesName}" (user chose skip)`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }

            if (existingInVault) {
              actualSeriesName = existingInVault.name;
              const cache = app.metadataCache.getFileCache(existingInVault.file);
              tmdbId = cache?.frontmatter?.tmdbId || existingInVault.tmdbId || "vault-only";
              
              // Save alias for future imports
              await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
              progress.seriesAliases = progress.seriesAliases || {};
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
              
              await markSeriesFetched(app, actualSeriesName, tmdbId);
              progress.fetchedSeries[actualSeriesName] = tmdbId;
            }
          }

          // 5. New series - prompt Add/Skip/Cancel
          if (!tmdbId) {
            const action = await promptSeriesAction(qa, rawSeriesName);
            
            if (action === "cancel") {
              if (Notice) new Notice("Import cancelled by user.");
              return;
            }
            
            if (action === "skip") {
              await markSeriesSkipped(app, rawSeriesName, sourceConfig.prefix);
              progress.skippedSeries = progress.skippedSeries || {};
              progress.skippedSeries[rawSeriesName] = { source: sourceConfig.prefix, skippedAt: new Date().toISOString().split('T')[0] };
              skipped++;
              newSkipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            // action === "add" - Search TMDB
            if (Notice) new Notice(`Fetching series: ${rawSeriesName}...`);
            
            const results = await searchTVShow(obsidian, apiKey, rawSeriesName);
            
            if (!results || results.length === 0) {
              console.log(`Series not found in TMDB: ${rawSeriesName}`);
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            let tmdbData;
            if (results.length === 1) {
              tmdbData = results[0];
            } else {
              const headerText = `── Matching: "${rawSeriesName}" ──`;
              const options = [headerText, ...results.slice(0, SETTINGS.maxResults).map(r => `${r.name} (${r.first_air_date?.substring(0, 4) || "?"})`), "❌ Skip this series"];
              const values = ["header", ...results.slice(0, SETTINGS.maxResults), null];
              let selection = await qa.suggester(options, values);
              while (selection === "header") {
                selection = await qa.suggester(options, values);
              }
              tmdbData = selection;
              
              if (!tmdbData) {
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }
            
            actualSeriesName = tmdbData.name || rawSeriesName;
            tmdbId = tmdbData.id;
            
            await createSeriesNote(app, obsidian, actualSeriesName, tmdbData);
            await fetchAndCreateAllEpisodes(app, obsidian, apiKey, actualSeriesName, tmdbId, Notice);
            
            // Save alias if name differs
            await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
            progress.seriesAliases = progress.seriesAliases || {};
            if (rawSeriesName.toLowerCase() !== actualSeriesName.toLowerCase()) {
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
            }
            
            await markSeriesFetched(app, actualSeriesName, tmdbId);
            progress.fetchedSeries[actualSeriesName] = tmdbId;
            seriesFetched++;
          }
        }
        
        // ============================================================
        // EPISODE MATCHING - Validate/correct Emby episode numbers
        // ============================================================
        
        // Build episode cache for this series
        const episodeCache = buildEpisodeCacheFromVault(app, actualSeriesName);
        
        // Variables to track the final episode to use
        let finalSeason = embySeason;
        let finalEpisode = embyEpisode;
        let matchMethod = "emby-direct";
        let episodeMatchValid = true;
        
        // Get part number from episode title (for multi-part episodes)
        const { part: embyPart } = extractPartNumber(episodeTitle);
        
        // If we have episode cache and episode title, try to validate/correct
        if (episodeCache && episodeTitle) {
          const titleMatch = findTmdbEpisodeByTitle(
            episodeCache,
            embySeason,
            episodeTitle,
            embyPart,
            embyEpisode,
            actualSeriesName
          );
          
          if (titleMatch && titleMatch.confidence >= 0.7) {
            // High confidence match
            if (titleMatch.number !== embyEpisode) {
              // Episode number differs - use TMDB number
              finalEpisode = titleMatch.number;
              matchMethod = titleMatch.method;
              console.log(`Emby episode corrected: "${episodeTitle}" S${embySeason}E${embyEpisode} → E${finalEpisode} (${matchMethod}, ${Math.round(titleMatch.confidence * 100)}%)`);
              
              // Track the mismatch
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(embySeason).padStart(2,'0')}E${String(embyEpisode).padStart(2,'0')}`,
                sourceTitle: episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: titleMatch.title,
                confidence: titleMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            }
            // If numbers match, all good - use Emby's numbers
          } else {
            // Try cross-season search
            const crossSeasonMatch = findEpisodeAcrossSeasons(
              episodeCache,
              episodeTitle,
              embySeason,
              embyPart,
              embyEpisode,
              actualSeriesName
            );
            
            if (crossSeasonMatch && crossSeasonMatch.confidence >= 0.7) {
              finalSeason = crossSeasonMatch.season;
              finalEpisode = crossSeasonMatch.number;
              matchMethod = crossSeasonMatch.method + "-cross-season";
              console.log(`Emby episode matched across seasons: "${episodeTitle}" → S${finalSeason}E${finalEpisode} (${matchMethod})`);
              
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(embySeason).padStart(2,'0')}E${String(embyEpisode).padStart(2,'0')}`,
                sourceTitle: episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: crossSeasonMatch.title,
                confidence: crossSeasonMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            } else if (titleMatch && titleMatch.confidence < 0.7) {
              // Low confidence match - prompt user
              console.log(`Low confidence match for Emby "${episodeTitle}" - prompting user...`);
              const selection = await promptEpisodeSelection(
                qa, Notice, actualSeriesName, embySeason, embyEpisode,
                episodeTitle, episodeCache, progress
              );
              
              if (selection.action === "select") {
                finalSeason = selection.season;
                finalEpisode = selection.episode;
                matchMethod = "manual";
                
                episodeMismatches.push({
                  series: actualSeriesName,
                  sourceEpisode: `S${String(embySeason).padStart(2,'0')}E${String(embyEpisode).padStart(2,'0')}`,
                  sourceTitle: episodeTitle,
                  tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                  tmdbTitle: episodeCache?.[`S${finalSeason}`]?.find(e => e.number === finalEpisode)?.title || "Unknown",
                  confidence: 0,
                  method: "manual-selection",
                  autoMatched: false,
                });
                
                // Save mapping
                if (!progress.manualEpisodeMappings) progress.manualEpisodeMappings = {};
                if (!progress.manualEpisodeMappings[actualSeriesName]) {
                  progress.manualEpisodeMappings[actualSeriesName] = {};
                }
                progress.manualEpisodeMappings[actualSeriesName][`S${embySeason}E${embyEpisode}`] = {
                  season: finalSeason,
                  episode: finalEpisode
                };
                await saveProgress(app, progress);
                
              } else if (selection.action === "skip") {
                if (!progress.skippedEpisodes) progress.skippedEpisodes = {};
                if (!progress.skippedEpisodes[actualSeriesName]) {
                  progress.skippedEpisodes[actualSeriesName] = [];
                }
                if (!progress.skippedEpisodes[actualSeriesName].includes(`S${embySeason}E${embyEpisode}`)) {
                  progress.skippedEpisodes[actualSeriesName].push(`S${embySeason}E${embyEpisode}`);
                }
                await saveProgress(app, progress);
                
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              } else {
                // User cancelled
                if (Notice) new Notice("Import cancelled.", 3000);
                return;
              }
            }
            // If no title match at all, trust Emby's numbers (they're usually correct)
          }
        }
        
        // Create watch log entry with final episode numbers
        const watchResult = await createWatchLogEntry(app, {
          type: "episode",
          date,
          showName: actualSeriesName,
          season: finalSeason,
          episode: finalEpisode,
          episodeTitle,
          source: sourceConfig.wikilink,
          embyId,
        });
        
        if (watchResult.created) {
          await updateEpisodeWatched(app, actualSeriesName, finalSeason, finalEpisode, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${actualSeriesName} S${finalSeason}E${finalEpisode} on ${date}`);
        }
        await markWatchProcessed(app, uniqueId);
      }
      
      if (imported % 25 === 0 && imported > 0 && Notice) {
        new Notice(`Imported ${imported}/${itemsToImport.length}...`);
      }
      
    } catch (e) {
      console.error(`Error processing item: ${item.Name}`, e);
      skipped++;
    }
  }
  
  // Write episode mismatch log if any
  if (episodeMismatches.length > 0) {
    await writeEpisodeMismatchLog(app, episodeMismatches, "Emby");
  }
  
  // Summary
  console.log("=".repeat(50));
  console.log("EMBY IMPORT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Watch entries created: ${imported}`);
  console.log(`Series fetched from TMDB: ${seriesFetched}`);
  console.log(`Movies fetched from TMDB: ${moviesFetched}`);
  console.log(`Items skipped: ${skipped}`);
  console.log(`Episode mismatches logged: ${episodeMismatches.length}`);
  console.log("=".repeat(50));
  
  if (Notice) {
    let msg = `Emby import complete!\n${imported} watch entries created.`;
    if (seriesFetched > 0) msg += `\n${seriesFetched} new series fetched from TMDB.`;
    if (moviesFetched > 0) msg += `\n${moviesFetched} new movies fetched from TMDB.`;
    if (skipped > 0) msg += `\n${skipped} items skipped.`;
    if (newSkipped > 0) msg += `\n${newSkipped} series added to skip list.`;
    if (episodeMismatches.length > 0) msg += `\n${episodeMismatches.length} episode translations logged.`;
    const remaining = toProcess.length - itemsToImport.length;
    if (remaining > 0) msg += `\n\n${remaining} more items remaining. Run again to continue.`;
    new Notice(msg, 10000);
  }
}

// --- EMBY CSV HANDLER ---
// Imports from Emby activity log CSV exports
// CSV format: watchdate, embyitemid, rawtitle
async function handleEmbyCsv(params, apiKey, sourceConfig) {
  const { app, qa, obsidian, Notice } = params;
  
  // Load Emby-specific secrets
  const secrets = await loadSecrets(app);
  const embyServerUrl = secrets.embyServerUrl;
  const embyApiKey = secrets.embyApiKey;
  let embyUserId = secrets.embyUserId;
  
  // Validate Emby configuration (needed to look up item details by ID)
  if (!embyServerUrl) {
    if (Notice) new Notice("Emby server URL not found.\nAdd 'embyServerUrl' to .obsidian/quickadd-secrets.json", 5000);
    return;
  }
  
  if (!embyApiKey) {
    if (Notice) new Notice("Emby API key not found.\nAdd 'embyApiKey' to .obsidian/quickadd-secrets.json", 5000);
    return;
  }
  
  // If no user ID, fetch users and let user select
  if (!embyUserId) {
    if (Notice) new Notice("Fetching Emby users...");
    const users = await getEmbyUsers(obsidian, embyServerUrl, embyApiKey);
    
    if (!users || users.length === 0) {
      if (Notice) new Notice("No Emby users found. Check your API key and server URL.", 5000);
      return;
    }
    
    if (users.length === 1) {
      embyUserId = users[0].Id;
      if (Notice) new Notice(`Using Emby user: ${users[0].Name}`);
    } else {
      const userNames = users.map(u => u.Name);
      const userIds = users.map(u => u.Id);
      embyUserId = await qa.suggester(userNames, userIds);
      if (!embyUserId) return;
    }
  }
  
  // Find CSV files containing "emby" in filename
  const allFiles = app.vault.getFiles();
  const csvFiles = allFiles
    .filter(f => f.extension === "csv" && f.path.toLowerCase().includes("emby"))
    .map(f => f.path)
    .sort((a, b) => b.localeCompare(a)); // Most recent first
  
  if (csvFiles.length === 0) {
    if (Notice) new Notice("No Emby CSV files found in vault.\n\nExport from Emby activitylog.db first.", 8000);
    return;
  }
  
  // Let user pick CSV file
  const csvPath = await qa.suggester(csvFiles, csvFiles);
  if (!csvPath) return;
  
  // Read and parse CSV
  if (Notice) new Notice(`Reading ${csvPath}...`);
  const csvText = await app.vault.adapter.read(csvPath);
  const csvData = parseCSV(csvText);
  
  if (csvData.rows.length === 0) {
    if (Notice) new Notice("No data found in CSV.");
    return;
  }
  
  console.log(`Emby CSV has ${csvData.rows.length} rows`);
  console.log(`CSV headers: ${csvData.headers.join(", ")}`);
  
  // Load progress
  const progress = await loadProgress(app);
  const processedSet = new Set(progress.processedWatchIds || []);
  
  // Filter to unprocessed items
  const toProcess = csvData.rows.filter(row => {
    const date = row.watchdate || row["watch date"] || "";
    const embyItemId = row.embyitemid || row["emby item id"] || row.itemid || "";
    const uniqueId = `${sourceConfig.prefix}${date}-${embyItemId}`.toLowerCase();
    return !processedSet.has(uniqueId);
  });
  
  if (toProcess.length === 0) {
    const reset = await qa.yesNoPrompt(
      "All items processed",
      `All ${csvData.rows.length} items in the CSV have already been imported.\n\nWould you like to reset progress and re-import?`
    );
    if (reset) {
      await resetProgressByPrefix(app, sourceConfig.prefix);
      if (Notice) new Notice("Emby CSV progress reset. Please run import again.", 3000);
    }
    return;
  }
  
  if (Notice) new Notice(`Found ${toProcess.length} unprocessed items (of ${csvData.rows.length} total)`);
  
  // Ask how many to import
  const importLimit = await promptImportLimit(qa, toProcess.length, "Emby CSV");
  if (!importLimit) return;
  
  const itemsToImport = toProcess.slice(0, importLimit);
  
  // Confirm
  const proceed = await qa.yesNoPrompt(
    "Emby CSV Watch History Import",
    `Importing ${itemsToImport.length} watch${itemsToImport.length === 1 ? "" : "es"}.\n\nThis will look up each item in Emby and fetch metadata from TMDB.\n\nContinue?`
  );
  if (!proceed) return;
  
  // Ensure folders
  await ensureFolder(app, SETTINGS.folders.movies);
  await ensureFolder(app, SETTINGS.folders.series);
  await ensureFolder(app, SETTINGS.folders.watched);
  await ensureFolder(app, SETTINGS.folders.covers);
  await ensureFolder(app, `${SETTINGS.folders.covers}/movies`);
  await ensureFolder(app, `${SETTINGS.folders.covers}/series`);
  
  // Process items
  let imported = 0;
  let seriesFetched = 0;
  let moviesFetched = 0;
  let skipped = 0;
  let skippedNoId = 0;
  let skippedNotFound = 0;
  let skippedAudio = 0;
  let newSkipped = 0;
  
  // Track episode mismatches
  const episodeMismatches = [];
  
  for (const row of itemsToImport) {
    const date = row.watchdate || row["watch date"] || localISODate();
    const embyItemId = row.embyitemid || row["emby item id"] || row.itemid || "";
    const rawTitle = row.rawtitle || row["raw title"] || row.title || "";
    const uniqueId = `${sourceConfig.prefix}${date}-${embyItemId}`.toLowerCase();
    
    // Skip rows with no Emby ID
    if (!embyItemId) {
      console.log(`Skipping (no Emby ID): ${rawTitle} on ${date}`);
      skippedNoId++;
      await markWatchProcessed(app, uniqueId);
      continue;
    }
    
    try {
      // Look up item details from Emby API
      const itemDetails = await getEmbyItemById(obsidian, embyServerUrl, embyApiKey, embyUserId, embyItemId);
      
      if (!itemDetails || !itemDetails.Type) {
        console.log(`Item not found in Emby (deleted?): ${embyItemId} (${rawTitle})`);
        skippedNotFound++;
        await markWatchProcessed(app, uniqueId);
        continue;
      }
      
      const itemType = itemDetails.Type;
      
      // Skip audio items
      if (itemType === "Audio" || itemType === "MusicVideo" || itemType === "MusicAlbum" || itemType === "AudioBook") {
        console.log(`Skipping audio: ${rawTitle}`);
        skippedAudio++;
        await markWatchProcessed(app, uniqueId);
        continue;
      }
      
      if (itemType === "Movie") {
        const movieName = itemDetails.Name;
        const year = itemDetails.ProductionYear;
        
        console.log(`Processing movie: ${movieName} (${date})`);
        
        // Check if we need to fetch from TMDB
        if (!progress.fetchedMovies[movieName]) {
          const results = await searchMovie(obsidian, apiKey, movieName, year);
          const searchResult = results[0] || null;
          
          if (!searchResult || !searchResult.id) {
            console.log(`Movie not found in TMDB: ${movieName}`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }
          
          const fullDetails = await getMovieDetails(obsidian, apiKey, searchResult.id);
          await createMovieNote(app, obsidian, movieName, fullDetails || searchResult);
          
          const genres = extractGenresFromTmdb(fullDetails);
          if (genres.length > 0) {
            const movieNotePath = `${SETTINGS.folders.movies}/${safeFilename(movieName)}.md`;
            await upsertAndLinkGenres(app, obsidian, movieNotePath, genres);
          }
          
          await markMovieFetched(app, movieName, searchResult.id);
          moviesFetched++;
        }
        
        // Create watch log entry
        const watchResult = await createWatchLogEntry(app, {
          type: "movie",
          date,
          showName: movieName,
          source: sourceConfig.wikilink,
          embyId: embyItemId,
        });
        
        if (watchResult.created) {
          await updateMovieWatched(app, movieName, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${movieName} on ${date}`);
        }
        await markWatchProcessed(app, uniqueId);
        
      } else if (itemType === "Episode") {
        const rawSeriesName = itemDetails.SeriesName || "Unknown Series";
        
        // Skip items with invalid/malformed series names
        if (!rawSeriesName || rawSeriesName.length < 2 || /^[^a-zA-Z0-9]+$/.test(rawSeriesName)) {
          console.log(`Skipping malformed series name: "${rawSeriesName}"`);
          skipped++;
          await markWatchProcessed(app, uniqueId);
          continue;
        }
        
        const normalizedName = normalizeSeriesName(rawSeriesName);
        let actualSeriesName = rawSeriesName;
        const embySeason = itemDetails.ParentIndexNumber || 1;
        const embyEpisode = itemDetails.IndexNumber || 1;
        const episodeTitle = itemDetails.Name || "";
        
        console.log(`Processing episode: ${rawSeriesName} S${embySeason}E${embyEpisode} (${date})`);
        
        // 1. Check if we already have this series fetched
        let tmdbId = progress.fetchedSeries[rawSeriesName] || progress.fetchedSeries[normalizedName];
        
        if (tmdbId) {
          actualSeriesName = progress.fetchedSeries[rawSeriesName] ? rawSeriesName : normalizedName;
        } else {
          // 2. Check if series is in skip list
          if (isSeriesSkipped(progress, rawSeriesName) || isSeriesSkipped(progress, normalizedName)) {
            console.log(`Series "${rawSeriesName}" is in skip list, skipping`);
            skipped++;
            await markWatchProcessed(app, uniqueId);
            continue;
          }
          
          // 3. Check for known alias
          const aliasMatch = lookupSeriesByAlias(progress, rawSeriesName) 
                          || lookupSeriesByAlias(progress, normalizedName);
          if (aliasMatch) {
            console.log(`Alias match: "${rawSeriesName}" → "${aliasMatch.tmdbName}"`);
            actualSeriesName = aliasMatch.tmdbName;
            tmdbId = aliasMatch.tmdbId;
          }
          
          // 4. Check vault for existing series or fuzzy matches
          if (!tmdbId) {
            let existingInVault = findExistingSeriesInVault(app, normalizedName);
            const vaultMatches = searchVaultForSeries(app, normalizedName);
            
            // If we found fuzzy matches but no exact match, prompt user
            if (!existingInVault && vaultMatches.length > 0) {
              const identity = await promptConfirmSeriesIdentity(qa, rawSeriesName, vaultMatches);
              
              if (identity.action === "existing") {
                existingInVault = identity.match;
              } else if (identity.action === "skip") {
                console.log(`Skipping item with series "${rawSeriesName}" (user chose skip)`);
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }
            
            if (existingInVault) {
              actualSeriesName = existingInVault.name;
              const cache = app.metadataCache.getFileCache(existingInVault.file);
              tmdbId = cache?.frontmatter?.tmdbId || existingInVault.tmdbId || "vault-only";
              
              // Save alias
              await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
              progress.seriesAliases = progress.seriesAliases || {};
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
              
              await markSeriesFetched(app, actualSeriesName, tmdbId);
              progress.fetchedSeries[actualSeriesName] = tmdbId;
            }
          }
          
          // 5. New series - prompt Add/Skip/Cancel
          if (!tmdbId) {
            const action = await promptSeriesAction(qa, rawSeriesName);
            
            if (action === "cancel") {
              if (Notice) new Notice("Import cancelled by user.");
              return;
            }
            
            if (action === "skip") {
              await markSeriesSkipped(app, rawSeriesName, sourceConfig.prefix);
              progress.skippedSeries = progress.skippedSeries || {};
              progress.skippedSeries[rawSeriesName] = { source: sourceConfig.prefix, skippedAt: new Date().toISOString().split('T')[0] };
              skipped++;
              newSkipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            // action === "add" - Search TMDB
            if (Notice) new Notice(`Fetching series: ${rawSeriesName}...`);
            
            const results = await searchTVShow(obsidian, apiKey, rawSeriesName);
            
            if (!results || results.length === 0) {
              console.log(`Series not found in TMDB: ${rawSeriesName}`);
              skipped++;
              await markWatchProcessed(app, uniqueId);
              continue;
            }
            
            let tmdbData;
            if (results.length === 1) {
              tmdbData = results[0];
            } else {
              const headerText = `── Matching: "${rawSeriesName}" ──`;
              const options = [headerText, ...results.slice(0, SETTINGS.maxResults).map(r => `${r.name} (${r.first_air_date?.substring(0, 4) || "?"})`), "❌ Skip this series"];
              const values = ["header", ...results.slice(0, SETTINGS.maxResults), null];
              let selection = await qa.suggester(options, values);
              while (selection === "header") {
                selection = await qa.suggester(options, values);
              }
              tmdbData = selection;
              
              if (!tmdbData) {
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              }
            }
            
            actualSeriesName = tmdbData.name || rawSeriesName;
            tmdbId = tmdbData.id;
            
            await createSeriesNote(app, obsidian, actualSeriesName, tmdbData);
            await fetchAndCreateAllEpisodes(app, obsidian, apiKey, actualSeriesName, tmdbId, Notice);
            
            // Save alias if name differs
            await addSeriesAlias(app, rawSeriesName, actualSeriesName, tmdbId);
            progress.seriesAliases = progress.seriesAliases || {};
            if (rawSeriesName.toLowerCase() !== actualSeriesName.toLowerCase()) {
              progress.seriesAliases[rawSeriesName] = { tmdbName: actualSeriesName, tmdbId };
            }
            
            await markSeriesFetched(app, actualSeriesName, tmdbId);
            progress.fetchedSeries[actualSeriesName] = tmdbId;
            seriesFetched++;
          }
        }
        
        // ============================================================
        // EPISODE MATCHING - Validate/correct Emby episode numbers
        // ============================================================
        
        const episodeCache = buildEpisodeCacheFromVault(app, actualSeriesName);
        
        let finalSeason = embySeason;
        let finalEpisode = embyEpisode;
        let matchMethod = "emby-csv-direct";
        
        const { part: embyPart } = extractPartNumber(episodeTitle);
        
        if (episodeCache && episodeTitle) {
          const titleMatch = findTmdbEpisodeByTitle(
            episodeCache,
            embySeason,
            episodeTitle,
            embyPart,
            embyEpisode,
            actualSeriesName
          );
          
          if (titleMatch && titleMatch.confidence >= 0.7) {
            if (titleMatch.number !== embyEpisode) {
              finalEpisode = titleMatch.number;
              matchMethod = titleMatch.method;
              console.log(`Episode corrected: "${episodeTitle}" S${embySeason}E${embyEpisode} → E${finalEpisode}`);
              
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(embySeason).padStart(2,'0')}E${String(embyEpisode).padStart(2,'0')}`,
                sourceTitle: episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: titleMatch.title,
                confidence: titleMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            }
          } else {
            // Try cross-season search
            const crossSeasonMatch = findEpisodeAcrossSeasons(
              episodeCache, episodeTitle, embySeason, embyPart, embyEpisode, actualSeriesName
            );
            
            if (crossSeasonMatch && crossSeasonMatch.confidence >= 0.7) {
              finalSeason = crossSeasonMatch.season;
              finalEpisode = crossSeasonMatch.number;
              matchMethod = crossSeasonMatch.method + "-cross-season";
              console.log(`Episode matched across seasons: "${episodeTitle}" → S${finalSeason}E${finalEpisode}`);
              
              episodeMismatches.push({
                series: actualSeriesName,
                sourceEpisode: `S${String(embySeason).padStart(2,'0')}E${String(embyEpisode).padStart(2,'0')}`,
                sourceTitle: episodeTitle,
                tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                tmdbTitle: crossSeasonMatch.title,
                confidence: crossSeasonMatch.confidence,
                method: matchMethod,
                autoMatched: true,
              });
            } else if (titleMatch && titleMatch.confidence < 0.7) {
              // Low confidence - prompt user
              const selection = await promptEpisodeSelection(
                qa, Notice, actualSeriesName, embySeason, embyEpisode,
                episodeTitle, episodeCache, progress
              );
              
              if (selection.action === "select") {
                finalSeason = selection.season;
                finalEpisode = selection.episode;
                matchMethod = "manual";
                
                episodeMismatches.push({
                  series: actualSeriesName,
                  sourceEpisode: `S${String(embySeason).padStart(2,'0')}E${String(embyEpisode).padStart(2,'0')}`,
                  sourceTitle: episodeTitle,
                  tmdbEpisode: `S${String(finalSeason).padStart(2,'0')}E${String(finalEpisode).padStart(2,'0')}`,
                  tmdbTitle: episodeCache?.[`S${finalSeason}`]?.find(e => e.number === finalEpisode)?.title || "Unknown",
                  confidence: 0,
                  method: "manual-selection",
                  autoMatched: false,
                });
                
                // Save mapping
                if (!progress.manualEpisodeMappings) progress.manualEpisodeMappings = {};
                if (!progress.manualEpisodeMappings[actualSeriesName]) {
                  progress.manualEpisodeMappings[actualSeriesName] = {};
                }
                progress.manualEpisodeMappings[actualSeriesName][`S${embySeason}E${embyEpisode}`] = {
                  season: finalSeason,
                  episode: finalEpisode
                };
                await saveProgress(app, progress);
                
              } else if (selection.action === "skip") {
                if (!progress.skippedEpisodes) progress.skippedEpisodes = {};
                if (!progress.skippedEpisodes[actualSeriesName]) {
                  progress.skippedEpisodes[actualSeriesName] = [];
                }
                if (!progress.skippedEpisodes[actualSeriesName].includes(`S${embySeason}E${embyEpisode}`)) {
                  progress.skippedEpisodes[actualSeriesName].push(`S${embySeason}E${embyEpisode}`);
                }
                await saveProgress(app, progress);
                
                skipped++;
                await markWatchProcessed(app, uniqueId);
                continue;
              } else {
                // User cancelled
                if (Notice) new Notice("Import cancelled.", 3000);
                return;
              }
            }
          }
        }
        
        // Create watch log entry
        const watchResult = await createWatchLogEntry(app, {
          type: "episode",
          date,
          showName: actualSeriesName,
          season: finalSeason,
          episode: finalEpisode,
          episodeTitle,
          source: sourceConfig.wikilink,
          embyId: embyItemId,
        });
        
        if (watchResult.created) {
          await updateEpisodeWatched(app, actualSeriesName, finalSeason, finalEpisode, date);
          imported++;
        } else {
          console.log(`Skipping duplicate watch: ${actualSeriesName} S${finalSeason}E${finalEpisode} on ${date}`);
        }
        await markWatchProcessed(app, uniqueId);
        
      } else {
        console.log(`Skipping unknown type "${itemType}": ${rawTitle}`);
        await markWatchProcessed(app, uniqueId);
      }
      
      // Progress notification
      if ((imported + skipped) % 25 === 0 && imported > 0 && Notice) {
        new Notice(`Processed ${imported + skipped}/${itemsToImport.length}...`);
      }
      
    } catch (e) {
      console.error(`Error processing: ${rawTitle}`, e);
      skipped++;
    }
  }
  
  // Write episode mismatch log
  if (episodeMismatches.length > 0) {
    await writeEpisodeMismatchLog(app, episodeMismatches, "Emby CSV");
  }
  
  // Summary
  console.log("=".repeat(50));
  console.log("EMBY CSV IMPORT SUMMARY");
  console.log("=".repeat(50));
  console.log(`Watch entries created: ${imported}`);
  console.log(`Series fetched from TMDB: ${seriesFetched}`);
  console.log(`Movies fetched from TMDB: ${moviesFetched}`);
  console.log(`Audio items skipped: ${skippedAudio}`);
  console.log(`Items with no Emby ID: ${skippedNoId}`);
  console.log(`Items not found in Emby: ${skippedNotFound}`);
  console.log(`Other skipped: ${skipped}`);
  console.log(`Episode mismatches logged: ${episodeMismatches.length}`);
  console.log("=".repeat(50));
  
  if (Notice) {
    let msg = `Emby CSV import complete!\n${imported} watch entries created.`;
    if (seriesFetched > 0) msg += `\n${seriesFetched} new series fetched.`;
    if (moviesFetched > 0) msg += `\n${moviesFetched} new movies fetched.`;
    if (skippedAudio > 0) msg += `\n${skippedAudio} audio items skipped.`;
    if (skippedNotFound > 0) msg += `\n${skippedNotFound} items not found in Emby.`;
    if (newSkipped > 0) msg += `\n${newSkipped} series added to skip list.`;
    if (episodeMismatches.length > 0) msg += `\n${episodeMismatches.length} episode translations logged.`;
    const remaining = toProcess.length - itemsToImport.length;
    if (remaining > 0) msg += `\n\n${remaining} more items remaining.`;
    new Notice(msg, 10000);
  }
}

// ============================================================================
// REVIEW SKIPPED SHOWS
// ============================================================================

async function handleReviewSkippedShows(params, apiKey) {
  const { app, qa, obsidian, Notice } = params;
  const progress = await loadProgress(app);
  const skippedList = Object.entries(progress.skippedSeries || {});
  
  if (skippedList.length === 0) {
    if (Notice) new Notice("No skipped shows to review.");
    return;
  }
  
  let reviewed = 0;
  let imported = 0;
  let removed = 0;
  
  for (const [seriesName, data] of skippedList) {
    const sourceInfo = data.source ? ` (from ${data.source})` : "";
    const dateInfo = data.skippedAt ? ` on ${data.skippedAt}` : "";
    
    const options = [
      `── ${seriesName} ──`,
      `Skipped${sourceInfo}${dateInfo}`,
      "➕ Import Now (search TMDB)",
      "⏭️ Keep Skipped",
      "🗑️ Remove from list (don't import)",
      "✅ Done Reviewing",
    ];
    const values = ["header", "info", "import", "keep", "remove", "done"];
    
    let action = await qa.suggester(options, values);
    while (action === "header" || action === "info") {
      action = await qa.suggester(options, values);
    }
    
    if (action === "done" || action === undefined) break;
    
    reviewed++;
    
    if (action === "import") {
      // Search TMDB and import this series
      if (Notice) new Notice(`Searching TMDB for: ${seriesName}...`);
      
      const normalizedName = normalizeSeriesName(seriesName);
      let results = await searchTVShow(obsidian, apiKey, seriesName);
      
      if ((!results || results.length === 0) && seriesName !== normalizedName) {
        results = await searchTVShow(obsidian, apiKey, normalizedName);
      }
      
      if (!results || results.length === 0) {
        if (Notice) new Notice(`"${seriesName}" not found in TMDB. Keeping in skip list.`);
        continue;
      }
      
      // Let user pick
      let tmdbData;
      if (results.length === 1) {
        tmdbData = results[0];
        if (Notice) new Notice(`Found: ${tmdbData.name}`);
      } else {
        const headerText = `── Select match for "${seriesName}" ──`;
        const tmdbOptions = [headerText, ...results.slice(0, SETTINGS.maxResults).map(r => `${r.name} (${r.first_air_date?.substring(0, 4) || "?"})`), "❌ Cancel"];
        const tmdbValues = ["header", ...results.slice(0, SETTINGS.maxResults), null];
        let selection = await qa.suggester(tmdbOptions, tmdbValues);
        while (selection === "header") {
          selection = await qa.suggester(tmdbOptions, tmdbValues);
        }
        tmdbData = selection;
        
        if (!tmdbData) {
          if (Notice) new Notice(`Skipped TMDB selection for "${seriesName}". Keeping in skip list.`);
          continue;
        }
      }
      
      // Create series note and fetch episodes
      const actualSeriesName = tmdbData.name || seriesName;
      const tmdbId = tmdbData.id;
      
      await createSeriesNote(app, obsidian, actualSeriesName, tmdbData);
      await fetchAndCreateAllEpisodes(app, obsidian, apiKey, actualSeriesName, tmdbId, Notice);
      
      // Save alias if name differs
      await addSeriesAlias(app, seriesName, actualSeriesName, tmdbId);
      
      await markSeriesFetched(app, actualSeriesName, tmdbId);
      await removeSeriesFromSkipped(app, seriesName);
      
      imported++;
      if (Notice) new Notice(`✅ Imported "${actualSeriesName}"`);
      
    } else if (action === "remove") {
      await removeSeriesFromSkipped(app, seriesName);
      removed++;
      if (Notice) new Notice(`Removed "${seriesName}" from skip list.`);
    }
    // "keep" - do nothing, stays in list
  }
  
  // Summary
  if (Notice && reviewed > 0) {
    let msg = `Review complete!\n`;
    if (imported > 0) msg += `${imported} series imported.\n`;
    if (removed > 0) msg += `${removed} removed from list.\n`;
    const remaining = skippedList.length - imported - removed;
    if (remaining > 0) msg += `${remaining} still skipped.`;
    new Notice(msg, 5000);
  }
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
  const enhancedParams = { app, qa, obsidian, Notice };

  // Load secrets
  const secrets = await loadSecrets(app);
  const apiKey = secrets.tmdbApiKey;

  if (!apiKey) {
    if (Notice) new Notice("TMDB API key not found.\n\nAdd 'tmdbApiKey' to .obsidian/quickadd-secrets.json", 5000);
    return;
  }

  // Ensure folders
  await ensureFolder(app, SETTINGS.folders.movies);
  await ensureFolder(app, SETTINGS.folders.series);
  await ensureFolder(app, SETTINGS.folders.watched);
  await ensureFolder(app, SETTINGS.folders.covers);
  await ensureFolder(app, `${SETTINGS.folders.covers}/movies`);
  await ensureFolder(app, `${SETTINGS.folders.covers}/series`);

  // AUTO-DETECT: If Prime queue file exists, process it directly (triggered by extension)
  const primeQueueFile = SOURCES.prime.queueFile;
  const primeQueueExists = await app.vault.adapter.exists(primeQueueFile);
  
  if (primeQueueExists) {
    console.log("Prime import queue detected, processing automatically...");
    if (Notice) new Notice("Prime Video queue detected, processing...", 2000);
    
    const beforeStats = await showPreImportStats(app, Notice);
    await handlePrimeExtension(enhancedParams, apiKey, SOURCES.prime);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  // AUTO-DETECT: If Netflix queue file exists, process it directly (triggered by extension)
  const netflixQueueFile = SOURCES.netflix.queueFile;
  const netflixQueueExists = await app.vault.adapter.exists(netflixQueueFile);
  
  if (netflixQueueExists) {
    console.log("Netflix import queue detected, processing automatically...");
    if (Notice) new Notice("Netflix queue detected, processing...", 2000);
    
    const beforeStats = await showPreImportStats(app, Notice);
    await handleNetflixExtension(enhancedParams, apiKey, SOURCES.netflix);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  // Show current stats before import
  const beforeStats = await showPreImportStats(app, Notice);
  
  // Check for skipped series
  const progress = await loadProgress(app);
  const skippedCount = Object.keys(progress.skippedSeries || {}).length;

  // Level 1: Main menu
  const menuOptions = [
    "🔍 Search existing shows",
    "Manual - Search TMDB",
    "CSV Import",
    "API Import",
  ];
  const menuValues = ["search", "manual", "csv", "api"];
  
  // Add review option if there are skipped series
  if (skippedCount > 0) {
    menuOptions.push(`📋 Review Skipped Shows (${skippedCount})`);
    menuValues.push("review");
  }
  
  const mode = await qa.suggester(menuOptions, menuValues);

  if (!mode) return;

  if (mode === "search") {
    await handleSearch(app, qa, Notice);
    return;
  }
  
  if (mode === "review") {
    await handleReviewSkippedShows(enhancedParams, apiKey);
    return;
  }

  if (mode === "manual") {
    await handleManual(enhancedParams, apiKey);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  if (mode === "csv") {
    await handleCSVImport(enhancedParams, apiKey);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  // Level 2: API Import sub-menu
  const availableSources = Object.entries(SOURCES)
    .filter(([_, config]) => !config.disabled)
    .map(([key, config]) => ({ key, ...config }));

  const sourceNames = availableSources.map(s => s.name);
  const sourceKeys = availableSources.map(s => s.key);

  const sourceKey = await qa.suggester(sourceNames, sourceKeys);
  if (!sourceKey) return;

  const sourceConfig = SOURCES[sourceKey];

  switch (sourceKey) {
    case "embyDirect":
      await handleEmbyDirect(enhancedParams, apiKey, sourceConfig);
      break;
    case "embyCsv":
      await handleEmbyCsv(enhancedParams, apiKey, sourceConfig);
      break;
    case "prime":
      await handlePrimeExtension(enhancedParams, apiKey, sourceConfig);
      break;
    case "netflix":
      await handleNetflixExtension(enhancedParams, apiKey, sourceConfig);
      break;
    default:
      if (Notice) new Notice(`Handler not implemented for: ${sourceConfig.name}`, 3000);
      return;
  }
  
  // Sync vault tracker after API imports
  const afterStats = await syncVaultTracker(app, Notice);
  showPostImportDiff(Notice, beforeStats, afterStats);
};

// ============================================================================
// VAULT TRACKER STATS
// ============================================================================
const TRACKER_FILE = ".obsidian/vault-tracker/shows.json";

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

function formatShowStats(stats) {
  if (!stats) return "No tracker data yet";
  const s = stats.stats;
  return `${s.movies} movies, ${s.series} series, ${s.watchLogs} watch logs`;
}

async function showPreImportStats(app, Notice) {
  // Sync tracker first to ensure stats are current
  const freshStats = await syncVaultTracker(app, null);
  const stats = freshStats || await readTrackerStats(app);
  if (stats && Notice) {
    new Notice(`🎬 Current: ${formatShowStats(stats)}`, 4000);
  }
  return stats;
}

function showPostImportDiff(Notice, beforeStats, afterStats) {
  if (!Notice || !beforeStats || !afterStats) return;
  
  const before = beforeStats.stats;
  const after = afterStats.stats;
  
  const moviesDiff = after.movies - before.movies;
  const seriesDiff = after.series - before.series;
  const watchLogsDiff = after.watchLogs - before.watchLogs;
  const episodesDiff = after.episodes - before.episodes;
  
  const parts = [];
  if (moviesDiff !== 0) parts.push(`🎬 Movies: ${before.movies} → ${after.movies} (${moviesDiff > 0 ? '+' : ''}${moviesDiff})`);
  if (seriesDiff !== 0) parts.push(`📺 Series: ${before.series} → ${after.series} (${seriesDiff > 0 ? '+' : ''}${seriesDiff})`);
  if (episodesDiff !== 0) parts.push(`📝 Episodes: ${before.episodes} → ${after.episodes} (${episodesDiff > 0 ? '+' : ''}${episodesDiff})`);
  if (watchLogsDiff !== 0) parts.push(`👁️ Watch Logs: ${before.watchLogs} → ${after.watchLogs} (${watchLogsDiff > 0 ? '+' : ''}${watchLogsDiff})`);
  
  if (parts.length > 0) {
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
  
  const words1 = a.split(/\s+/);
  const words2 = b.split(/\s+/);
  const matches = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
  return matches.length / Math.max(words1.length, words2.length);
}

function searchShows(trackerData, query) {
  if (!trackerData || !query) return [];
  
  const q = query.toLowerCase().trim();
  const results = [];
  
  // Search movies
  for (const movie of (trackerData.movies || [])) {
    const title = (movie.title || "").toLowerCase();
    if (title.includes(q)) {
      results.push({ ...movie, type: "movie", score: title === q ? 1 : 0.9 });
    } else {
      const similarity = stringSimilarity(title, q);
      if (similarity > 0.3) {
        results.push({ ...movie, type: "movie", score: similarity });
      }
    }
  }
  
  // Search series
  for (const series of (trackerData.series || [])) {
    const title = (series.title || "").toLowerCase();
    if (title.includes(q)) {
      results.push({ ...series, type: "series", score: title === q ? 1 : 0.9 });
    } else {
      const similarity = stringSimilarity(title, q);
      if (similarity > 0.3) {
        results.push({ ...series, type: "series", score: similarity });
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
  
  const query = await qa.inputPrompt("Search shows", "Enter movie or series title");
  if (!query?.trim()) return;
  
  const results = searchShows(trackerData, query.trim());
  
  if (results.length === 0) {
    if (Notice) new Notice(`No matches found for "${query}"`, 3000);
    return;
  }
  
  // Format results for suggester
  const displayOptions = results.map(item => {
    const icon = item.type === "movie" ? "🎬" : "📺";
    const watched = item.watched ? "✅" : "";
    const year = item.year ? ` (${item.year})` : "";
    const rating = item.rating ? ` ⭐${item.rating}` : "";
    const count = item.watchCount ? ` [${item.watchCount}x]` : "";
    return `${icon}${watched} ${item.title}${year}${rating}${count}`;
  });
  
  const selected = await qa.suggester(displayOptions, results);
  if (!selected) return;
  
  // Open the selected show
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
    const trackerPath = SETTINGS.syncTrackerPath;
    const trackerExists = await app.vault.adapter.exists(trackerPath);
    if (!trackerExists) {
      console.log("Vault tracker not found, skipping sync");
      return null;
    }
    
    const trackerCode = await app.vault.adapter.read(trackerPath);
    const trackerModule = {};
    const moduleFunc = new Function("module", "exports", "require", trackerCode);
    moduleFunc(trackerModule, {}, () => {});
    
    if (trackerModule.exports?.syncTracker) {
      const results = await trackerModule.exports.syncTracker(app, { domains: ["shows"], silent: true });
      console.log("Vault tracker synced (shows)");
      return results?.shows || null;
    }
  } catch (e) {
    console.error("Failed to sync vault tracker:", e);
  }
  return null;
}
