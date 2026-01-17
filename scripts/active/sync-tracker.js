// sync-tracker.js — Vault Tracker for Obsidian
//
// Scans vault folders and generates JSON summaries of:
//   - Books (books/books/)
//   - Shows (shows/movies/, shows/series/, shows/watched/)
//   - Health (health/daily/)
//   - Workouts (health/workouts/)
//
// Can be run standalone or called from other scripts after imports.
//
// iOS compatible: uses app.vault.adapter
//
// ============================================================================
// Utilities copied from lib/quickadd-core.js:
//   - String: pad2, localISODate, stripWikilink
//   - File: getFrontmatter
// ============================================================================

// ============================================================================
// SETTINGS
// ============================================================================
const SETTINGS = {
  // Output folder for tracker JSON files
  outputFolder: ".obsidian/vault-tracker",

  // Domain configurations
  books: {
    folder: "books/books",
    coverFolder: "books/covers",
  },
  shows: {
    moviesFolder: "shows/movies",
    seriesFolder: "shows/series",
    watchedFolder: "shows/watched",
    coverFolder: "shows/covers",
  },
  health: {
    folder: "health/daily",
  },
  workouts: {
    folder: "health/workouts",
  },
};

// ============================================================================
// UTILITIES
// ============================================================================
function pad2(n) {
  return String(n).padStart(2, "0");
}

function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localISODateTime(d = new Date()) {
  return `${localISODate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function stripWikilink(s) {
  const str = String(s || "");
  const match = str.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  return match ? match[1].split("/").pop() : str;
}

function extractWikilinks(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(stripWikilink).filter(Boolean);
  }
  return [stripWikilink(value)].filter(Boolean);
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================
function getFrontmatter(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  return cache?.frontmatter || {};
}

// ============================================================================
// FOLDER SCANNING
// ============================================================================
async function getMarkdownFilesInFolder(app, folderPath) {
  const files = [];
  const folder = app.vault.getAbstractFileByPath(folderPath);
  
  if (!folder) return files;
  
  const allFiles = app.vault.getMarkdownFiles();
  for (const file of allFiles) {
    if (file.path.startsWith(folderPath + "/")) {
      files.push(file);
    }
  }
  
  return files;
}

async function getMarkdownFilesRecursive(app, folderPath) {
  const files = [];
  const allFiles = app.vault.getMarkdownFiles();
  
  for (const file of allFiles) {
    if (file.path.startsWith(folderPath + "/")) {
      files.push(file);
    }
  }
  
  return files;
}

// ============================================================================
// BOOKS SCANNER
// ============================================================================
async function scanBooks(app) {
  const files = await getMarkdownFilesInFolder(app, SETTINGS.books.folder);
  
  const books = [];
  const authors = new Set();
  const genres = new Set();
  const stores = new Set();
  const formats = new Set();
  let withRating = 0;
  let withCover = 0;
  
  const statusCounts = {
    "not-started": 0,
    reading: 0,
    finished: 0,
    abandoned: 0,
    unknown: 0,
  };

  for (const file of files) {
    const fm = getFrontmatter(app, file);
    
    // Handle both "status" and "readingStatus" field names
    const rawStatus = fm.readingStatus || fm.status || "unknown";
    
    const book = {
      path: file.path,
      title: fm.title || file.basename,
      author: extractWikilinks(fm.author),
      rating: fm.rating ?? null,
      status: rawStatus,
      dateRead: fm.readingDone || fm.dateRead || fm.date_read || null,
      dateStarted: fm.readingStarted || null,
      dateAdded: fm.dateAdded || fm.created || null,
      publishDate: fm.publishDate || fm.publishedDate || null,
      purchasedDate: fm.purchasedDate || null,
      genre: extractWikilinks(fm.genre),
      format: stripWikilink(fm.format) || null,
      store: stripWikilink(fm.purchasedStore) || null,
      hasCover: !!(fm.localCoverImage || fm.coverImage),
      bookKey: fm.bookKey || null,
      source: fm.source || null,
    };
    
    books.push(book);
    
    // Aggregate stats
    book.author.forEach(a => authors.add(a));
    book.genre.forEach(g => genres.add(g));
    if (book.store) stores.add(book.store);
    if (book.format) formats.add(book.format);
    if (book.rating != null && book.rating !== "") withRating++;
    if (book.hasCover) withCover++;
    
    const status = book.status in statusCounts ? book.status : "unknown";
    statusCounts[status]++;
  }

  // Sort by dateRead (most recent first), then by title
  books.sort((a, b) => {
    if (a.dateRead && b.dateRead) return b.dateRead.localeCompare(a.dateRead);
    if (a.dateRead) return -1;
    if (b.dateRead) return 1;
    return (a.title || "").localeCompare(b.title || "");
  });

  return {
    generated: localISODateTime(),
    stats: {
      total: books.length,
      withRating,
      withCover,
      uniqueAuthors: authors.size,
      uniqueGenres: genres.size,
      uniqueStores: stores.size,
      uniqueFormats: formats.size,
      byStatus: statusCounts,
    },
    authors: [...authors].sort(),
    genres: [...genres].sort(),
    stores: [...stores].sort(),
    formats: [...formats].sort(),
    books,
  };
}

// ============================================================================
// SHOWS SCANNER
// ============================================================================
async function scanShows(app) {
  // Scan movies
  const movieFiles = await getMarkdownFilesInFolder(app, SETTINGS.shows.moviesFolder);
  const movies = [];
  const movieGenres = new Set();
  
  for (const file of movieFiles) {
    const fm = getFrontmatter(app, file);
    
    const movie = {
      path: file.path,
      title: fm.title || file.basename,
      year: fm.year || null,
      tmdbId: fm.tmdbId || null,
      rating: fm.rating ?? null,
      genre: extractWikilinks(fm.genre),
      watched: fm.watched ?? false,
      watchCount: fm.watchCount ?? 0,
      firstWatched: fm.firstWatched || null,
      lastWatched: fm.lastWatched || null,
      hasCover: !!(fm.localCoverImage),
    };
    
    movies.push(movie);
    movie.genre.forEach(g => movieGenres.add(g));
  }

  // Scan series (only series notes, not episodes)
  const seriesFiles = await getMarkdownFilesRecursive(app, SETTINGS.shows.seriesFolder);
  const series = [];
  const episodes = [];
  const seriesGenres = new Set();
  
  for (const file of seriesFiles) {
    const fm = getFrontmatter(app, file);
    const categories = extractWikilinks(fm.categories);
    
    if (categories.includes("Series")) {
      // This is a series note
      const s = {
        path: file.path,
        title: fm.title || file.basename,
        tmdbId: fm.tmdbId || null,
        status: fm.status || "unknown",
        rating: fm.rating ?? null,
        genre: extractWikilinks(fm.genre),
        totalSeasons: fm.totalSeasons || null,
        totalEpisodes: fm.totalEpisodes || null,
        firstWatched: fm.firstWatched || null,
        lastWatched: fm.lastWatched || null,
        hasCover: !!(fm.localCoverImage),
      };
      series.push(s);
      s.genre.forEach(g => seriesGenres.add(g));
      
    } else if (categories.includes("Episodes")) {
      // This is an episode note
      const ep = {
        path: file.path,
        series: stripWikilink(fm.series) || null,
        season: fm.season || null,
        episode: fm.episode || null,
        title: fm.title || file.basename,
        watched: fm.watched ?? false,
        watchCount: fm.watchCount ?? 0,
        firstWatched: fm.firstWatched || null,
        lastWatched: fm.lastWatched || null,
      };
      episodes.push(ep);
    }
  }

  // Scan watch logs
  const watchFiles = await getMarkdownFilesInFolder(app, SETTINGS.shows.watchedFolder);
  const watchLogs = [];
  const sources = new Set();
  
  for (const file of watchFiles) {
    const fm = getFrontmatter(app, file);
    
    const log = {
      path: file.path,
      date: fm.date || null,
      type: fm.type || "unknown",
      show: stripWikilink(fm.show || fm.movie) || null,
      season: fm.season || null,
      episode: fm.episode || null,
      source: stripWikilink(fm.source) || null,
      rating: fm.rating ?? null,
    };
    
    watchLogs.push(log);
    if (log.source) sources.add(log.source);
  }

  // Sort
  movies.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  series.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  watchLogs.sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return 0;
  });

  // Combine genres
  const allGenres = new Set([...movieGenres, ...seriesGenres]);

  // Date range from watch logs
  const watchDates = watchLogs.map(w => w.date).filter(Boolean).sort();
  const dateRange = watchDates.length > 0 
    ? [watchDates[0], watchDates[watchDates.length - 1]]
    : null;

  return {
    generated: localISODateTime(),
    stats: {
      movies: movies.length,
      series: series.length,
      episodes: episodes.length,
      watchLogs: watchLogs.length,
      moviesWatched: movies.filter(m => m.watched).length,
      moviesWithRating: movies.filter(m => m.rating != null && m.rating !== "").length,
      seriesWithRating: series.filter(s => s.rating != null && s.rating !== "").length,
      uniqueGenres: allGenres.size,
      uniqueSources: sources.size,
      watchDateRange: dateRange,
    },
    genres: [...allGenres].sort(),
    sources: [...sources].sort(),
    movies,
    series,
    episodes,
    watchLogs,
  };
}

// ============================================================================
// HEALTH SCANNER
// ============================================================================
async function scanHealth(app) {
  const files = await getMarkdownFilesInFolder(app, SETTINGS.health.folder);
  
  const entries = [];
  const metricsFound = new Set();
  
  for (const file of files) {
    const fm = getFrontmatter(app, file);
    
    // Track which metrics are present (matches health.js field names)
    const metrics = {};
    const metricKeys = [
      // Activity
      "steps", "activeEnergy", "restingEnergy", "hrv", "restingHeartRate", "vo2Max",
      // Sleep (from health.js)
      "sleepStart", "sleepEnd", "timeInBed", "timeAsleep", "timeAwake",
      "sleepRem", "sleepCore", "sleepDeep", "wakeCount", "sleepEfficiency",
      "fallAsleepTime", "avgRespirationRate", "avgSpO2", "sleepAvgHrv",
      // Weight
      "weight", "bodyFat", "bmi",
      // Mindfulness (from health.js)
      "mindfulnessTime", "mindfulnessDuration", "mindfulnessSdnn", 
      "mindfulnessRmssd", "mindfulnessAvgHrv",
    ];
    
    for (const key of metricKeys) {
      if (fm[key] != null && fm[key] !== "") {
        metrics[key] = fm[key];
        metricsFound.add(key);
      }
    }
    
    const entry = {
      path: file.path,
      date: fm.date || file.basename,
      metrics,
    };
    
    entries.push(entry);
  }

  // Sort by date (most recent first)
  entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // Date range
  const dates = entries.map(e => e.date).filter(Boolean).sort();
  const dateRange = dates.length > 0 
    ? [dates[0], dates[dates.length - 1]]
    : null;

  return {
    generated: localISODateTime(),
    stats: {
      entries: entries.length,
      dateRange,
      metricsTracked: metricsFound.size,
    },
    metricsTracked: [...metricsFound].sort(),
    entries,
  };
}

// ============================================================================
// WORKOUTS SCANNER
// ============================================================================
async function scanWorkouts(app) {
  const files = await getMarkdownFilesInFolder(app, SETTINGS.workouts.folder);
  
  const workouts = [];
  const workoutTypes = new Set();
  let totalMinutes = 0;
  let totalCalories = 0;
  
  for (const file of files) {
    const fm = getFrontmatter(app, file);
    
    // Duration: fitness.js uses totalTime (minutes), fallback to other field names
    const duration = fm.totalTime || fm.movingTime || fm.duration || fm.durationMinutes || null;
    // Calories: fitness.js uses activeCalories
    const calories = fm.activeCalories || fm.calories || null;
    
    const workout = {
      path: file.path,
      date: fm.date || null,
      time: fm.time || null,
      type: stripWikilink(fm.workoutType || fm.type) || null,
      duration,
      calories,
      distance: fm.distance || null,
      elevationGain: fm.elevationGain || null,
      avgHeartRate: fm.avgHeartRate || null,
      maxHeartRate: fm.maxHeartRate || null,
      source: fm.source || null,
    };
    
    workouts.push(workout);
    
    if (workout.type) workoutTypes.add(workout.type);
    if (typeof duration === "number") totalMinutes += duration;
    if (typeof calories === "number") totalCalories += calories;
  }

  // Sort by date (most recent first)
  workouts.sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    return 0;
  });

  // Date range
  const dates = workouts.map(w => w.date).filter(Boolean).sort();
  const dateRange = dates.length > 0 
    ? [dates[0], dates[dates.length - 1]]
    : null;

  // Count by type
  const byType = {};
  for (const type of workoutTypes) {
    byType[type] = workouts.filter(w => w.type === type).length;
  }

  return {
    generated: localISODateTime(),
    stats: {
      total: workouts.length,
      uniqueTypes: workoutTypes.size,
      totalMinutes: Math.round(totalMinutes),
      totalCalories: Math.round(totalCalories),
      dateRange,
      byType,
    },
    workoutTypes: [...workoutTypes].sort(),
    workouts,
  };
}

// ============================================================================
// SUMMARY GENERATOR
// ============================================================================
function generateSummary(books, shows, health, workouts) {
  return {
    generated: localISODateTime(),
    books: {
      total: books.stats.total,
      finished: books.stats.byStatus.finished,
      reading: books.stats.byStatus.reading,
      withRating: books.stats.withRating,
      uniqueAuthors: books.stats.uniqueAuthors,
    },
    shows: {
      movies: shows.stats.movies,
      series: shows.stats.series,
      episodes: shows.stats.episodes,
      watchLogs: shows.stats.watchLogs,
      moviesWatched: shows.stats.moviesWatched,
    },
    health: {
      entries: health.stats.entries,
      dateRange: health.stats.dateRange,
      metricsTracked: health.stats.metricsTracked,
    },
    workouts: {
      total: workouts.stats.total,
      types: workouts.stats.uniqueTypes,
      totalMinutes: workouts.stats.totalMinutes,
      totalCalories: workouts.stats.totalCalories,
    },
  };
}

// ============================================================================
// FILE WRITING
// ============================================================================
async function writeTrackerFile(app, filename, data) {
  const folderPath = SETTINGS.outputFolder;
  const filePath = `${folderPath}/${filename}`;
  
  // Ensure folder exists
  try {
    await app.vault.adapter.mkdir(folderPath);
  } catch (e) {
    // Folder may already exist
  }
  
  const content = JSON.stringify(data, null, 2);
  
  // Write file (overwrite if exists)
  const exists = await app.vault.adapter.exists(filePath);
  if (exists) {
    await app.vault.adapter.write(filePath, content);
  } else {
    await app.vault.create(filePath, content);
  }
  
  return filePath;
}

// ============================================================================
// MAIN SYNC FUNCTION (can be called from other scripts)
// ============================================================================
async function syncTracker(app, options = {}) {
  const { 
    domains = ["books", "shows", "health", "workouts"],
    silent = false,
  } = options;
  
  const results = {};
  
  // Scan requested domains
  if (domains.includes("books")) {
    results.books = await scanBooks(app);
    await writeTrackerFile(app, "books.json", results.books);
  }
  
  if (domains.includes("shows")) {
    results.shows = await scanShows(app);
    await writeTrackerFile(app, "shows.json", results.shows);
  }
  
  if (domains.includes("health")) {
    results.health = await scanHealth(app);
    await writeTrackerFile(app, "health.json", results.health);
  }
  
  if (domains.includes("workouts")) {
    results.workouts = await scanWorkouts(app);
    await writeTrackerFile(app, "workouts.json", results.workouts);
  }
  
  // Generate summary if all domains scanned
  if (domains.length === 4 && results.books && results.shows && results.health && results.workouts) {
    const summary = generateSummary(results.books, results.shows, results.health, results.workouts);
    await writeTrackerFile(app, "summary.json", summary);
    results.summary = summary;
  }
  
  return results;
}

// ============================================================================
// QUICKADD ENTRY POINT
// ============================================================================
module.exports = {
  entry: async (params) => {
    const { app, quickAddApi: qa } = params;
    const Notice = app?.workspace?.activeLeaf ? window.Notice : null;
    
    // Menu options
    const options = [
      "📊 Full Sync (all domains)",
      "📚 Books only",
      "🎬 Shows only",
      "❤️ Health only",
      "🏋️ Workouts only",
      "📈 View Summary",
    ];
    
    const choice = await qa.suggester(options, options);
    if (!choice) return;
    
    if (choice === "📈 View Summary") {
      // Just read and display summary
      const summaryPath = `${SETTINGS.outputFolder}/summary.json`;
      const exists = await app.vault.adapter.exists(summaryPath);
      
      if (!exists) {
        if (Notice) new Notice("No summary found. Run a full sync first.", 3000);
        return;
      }
      
      const content = await app.vault.adapter.read(summaryPath);
      const summary = JSON.parse(content);
      
      const msg = [
        `📊 Vault Summary (${summary.generated})`,
        "",
        `📚 Books: ${summary.books.total} (${summary.books.finished} finished, ${summary.books.reading} reading)`,
        `🎬 Movies: ${summary.shows.movies} (${summary.shows.moviesWatched} watched)`,
        `📺 Series: ${summary.shows.series} (${summary.shows.episodes} episodes)`,
        `📝 Watch Logs: ${summary.shows.watchLogs}`,
        `❤️ Health: ${summary.health.entries} daily entries`,
        `🏋️ Workouts: ${summary.workouts.total} (${summary.workouts.totalMinutes} mins)`,
      ].join("\n");
      
      if (Notice) new Notice(msg, 10000);
      return;
    }
    
    // Determine which domains to sync
    let domains;
    switch (choice) {
      case "📚 Books only":
        domains = ["books"];
        break;
      case "🎬 Shows only":
        domains = ["shows"];
        break;
      case "❤️ Health only":
        domains = ["health"];
        break;
      case "🏋️ Workouts only":
        domains = ["workouts"];
        break;
      default:
        domains = ["books", "shows", "health", "workouts"];
    }
    
    if (Notice) new Notice(`Syncing tracker: ${domains.join(", ")}...`, 2000);
    
    const results = await syncTracker(app, { domains });
    
    // Build result message
    const parts = [];
    if (results.books) parts.push(`📚 ${results.books.stats.total} books`);
    if (results.shows) parts.push(`🎬 ${results.shows.stats.movies} movies, ${results.shows.stats.series} series`);
    if (results.health) parts.push(`❤️ ${results.health.stats.entries} health entries`);
    if (results.workouts) parts.push(`🏋️ ${results.workouts.stats.total} workouts`);
    
    if (Notice) {
      new Notice(`Tracker synced!\n\n${parts.join("\n")}`, 5000);
    }
  },
  
  // Export syncTracker for use by other scripts
  syncTracker,
  
  // Export individual scanners for targeted updates
  scanBooks,
  scanShows,
  scanHealth,
  scanWorkouts,
};
