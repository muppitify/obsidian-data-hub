// fitness.js — Unified QuickAdd script for Obsidian
//
// Imports workout data from various sources:
//   - Manual: Quick workout entry
//   - CSV Import: Workout export files
//   - Future: Garmin Connect, Strava, Apple Fitness+
//
// Creates workout notes and workout type notes.
//
// iOS compatible: uses app.vault.adapter
//
// ============================================================================
// Utilities copied from lib/quickadd-core.js:
//   - String: pad2, localISODate, safeFilename, sanitizeForWikilink, toWikilink
//   - YAML: quoteYamlString
//   - CSV: parseCSV, parseCSVLine
//   - Date: parseDate
//   - File: ensureFolder, ensureNote
//   - Progress: createProgressTracker pattern
//   - Entity: createEntityUpsert pattern
//   - Search: stringSimilarity, searchByTitle (as searchWorkouts)
// ============================================================================

// ============================================================================
// SETTINGS
// ============================================================================
const SETTINGS = {
  // Script paths
  syncTrackerPath: "scripts/active/sync-tracker.js",

  // CSV file path (relative to vault root)
  csvPath: "csv-imports/health/Workouts/workouts.csv",

  // Output folder for workout notes
  noteFolder: "health/workouts",

  // Category wikilink for workout notes
  categoryWikilink: "[[Workouts]]",

  // Progress tracking file
  progressFile: ".obsidian/workout-import-progress.json",

  // Skipped workouts log file
  skippedLogFile: ".obsidian/workout-import-skipped.md",

  // Workout types to skip (case-insensitive)
  skipWorkoutTypes: ["Other"],

  // Workout type name mappings (normalize different names to one)
  workoutTypeMap: {
    "Functional Strength Training": "Strength Training",
  },

  // Workout type upsert settings
  workoutTypeUpsert: {
    enabled: true,
    folder: "WorkoutTypes",
    categoryPath: "Categories/WorkoutTypes.md",
    baseName: "WorkoutTypes.base",
    tag: "WorkoutTypes",
  },
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

function safeFilename(s, maxLength = 200) {
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

function toWikilink(name) {
  const s = sanitizeForWikilink(name);
  if (!s) return "";
  if (s.startsWith("[[") && s.endsWith("]]")) return s;
  return `[[${s}]]`;
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
// DATE/TIME PARSING
// ============================================================================
function parseDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
}

function timeToFilename(timeStr) {
  const s = String(timeStr || "").trim();
  return s.replace(":", "");
}

// ============================================================================
// VALUE PARSING
// ============================================================================
function parseValueWithUnit(str) {
  const s = String(str || "").trim();
  if (!s) return { value: null, unit: "" };

  const match = s.match(/^([\d.]+)\s*(.*)$/);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2].trim();
    return { value: Number.isFinite(value) ? value : null, unit };
  }

  return { value: null, unit: "" };
}

function parsePercentage(str) {
  const s = String(str || "").trim();
  if (!s) return null;

  const match = s.match(/^(\d+)%?$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

function parseDuration(str) {
  const s = String(str || "").trim();
  if (!s) return null;

  const match = s.match(/^(\d+)h:(\d+)m(?::(\d+)s)?$/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;
    return hours * 60 + minutes + Math.round(seconds / 60);
  }

  return null;
}

// ============================================================================
// PROGRESS TRACKING
// ============================================================================
async function loadProgress(app) {
  try {
    const exists = await app.vault.adapter.exists(SETTINGS.progressFile);
    if (!exists) return { processedWorkouts: [] };
    const raw = await app.vault.adapter.read(SETTINGS.progressFile);
    return JSON.parse(raw);
  } catch {
    return { processedWorkouts: [] };
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

async function markWorkoutProcessed(app, workoutId) {
  const progress = await loadProgress(app);
  if (!progress.processedWorkouts.includes(workoutId)) {
    progress.processedWorkouts.push(workoutId);
    await saveProgress(app, progress);
  }
}

async function resetProgress(app) {
  await saveProgress(app, { processedWorkouts: [] });
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

function findExistingNoteByTitle(app, activeFile, title) {
  return app.metadataCache.getFirstLinkpathDest(title, activeFile?.path || "") || null;
}

// ============================================================================
// WORKOUT TYPE UPSERT
// ============================================================================
async function createWorkoutTypeNote(app, obsidian, typeName) {
  const cfg = SETTINGS.workoutTypeUpsert;
  const categoryLink = `[[${cfg.categoryPath.replace(/\.md$/, "")}]]`;

  const safeName = safeFilename(sanitizeForWikilink(typeName));
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

## Workouts

![[${cfg.baseName}]]
`;

  return await app.vault.create(filePath, content);
}

async function upsertAndLinkWorkoutType({ app, obsidian, workoutFile, typeName }) {
  const cfg = SETTINGS.workoutTypeUpsert;
  if (!cfg.enabled) return "";

  const name = String(typeName || "").trim();
  if (!name) return "";

  // Ensure category exists
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
  const existing = findExistingNoteByTitle(app, workoutFile, name);
  if (existing) {
    link = `[[${existing.basename}]]`;
  } else {
    const created = await createWorkoutTypeNote(app, obsidian, name);
    if (!created) return "";
    link = `[[${created.basename}]]`;
  }

  // Update frontmatter with link
  await app.fileManager.processFrontMatter(workoutFile, (frontmatter) => {
    frontmatter.workoutType = link;
  });

  return link;
}

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================
function normalizeWorkoutType(type) {
  const t = String(type || "").trim();
  if (SETTINGS.workoutTypeMap && SETTINGS.workoutTypeMap[t]) {
    return SETTINGS.workoutTypeMap[t];
  }
  return t || "Other";
}

function generateWorkoutId(row) {
  const date = parseDate(row["date"]);
  const time = row["time"] || "";
  const type = normalizeWorkoutType(row["type"]);
  return `${date}-${time}-${type}`.replace(/[^a-zA-Z0-9-]/g, "");
}

function transformWorkout(row) {
  const date = parseDate(row["date"]);
  const time = row["time"] || "";
  const type = normalizeWorkoutType(row["type"]);

  const distance = parseValueWithUnit(row["distance"]);
  const elevationGain = parseValueWithUnit(row["elevation gain"]);
  const activeCalories = parseValueWithUnit(row["active calories"]);
  const temperature = parseValueWithUnit(row["temperature"]);
  const humidity = parsePercentage(row["humidity"]);

  const minHR = parseValueWithUnit(row["min. heart rate"]);
  const avgHR = parseValueWithUnit(row["avg. heart rate"]);
  const maxHR = parseValueWithUnit(row["max. heart rate"]);

  // Extract source name (remove ID in parentheses)
  const sourceRaw = row["source"] || "";
  const source = sourceRaw.replace(/\s*\([^)]+\)$/, "").trim();

  return {
    date,
    time,
    workoutType: type,
    totalTime: parseDuration(row["total time"]),
    movingTime: parseDuration(row["moving time"]),
    distance: distance.value,
    distanceUnit: distance.unit || "km",
    elevationGain: elevationGain.value,
    elevationGainUnit: elevationGain.unit || "m",
    activeCalories: activeCalories.value,
    activeCaloriesUnit: activeCalories.unit || "kcal",
    temperature: temperature.value,
    temperatureUnit: temperature.unit || "C",
    humidity: humidity,
    minHeartRate: minHR.value,
    avgHeartRate: avgHR.value,
    maxHeartRate: maxHR.value,
    heartRateUnit: minHR.unit || avgHR.unit || maxHR.unit || "bpm",
    trimp: parseInt(row["trimp"], 10) || null,
    mets: parseFloat(row["mets"]) || null,
    hrZone0: parseDuration(row["hrz0"]),
    hrZone1: parseDuration(row["hrz1"]),
    hrZone2: parseDuration(row["hrz2"]),
    hrZone3: parseDuration(row["hrz3"]),
    hrZone4: parseDuration(row["hrz4"]),
    hrZone5: parseDuration(row["hrz5"]),
    source,
  };
}

// ============================================================================
// BUILD FRONTMATTER
// ============================================================================
function buildFrontMatter(data) {
  const lines = [];
  lines.push("---");
  lines.push(`categories:\n  - "${SETTINGS.categoryWikilink}"`);
  lines.push(`date: ${quoteYamlString(data.date)}`);
  if (data.time) lines.push(`time: ${quoteYamlString(data.time)}`);
  lines.push(`created: ${quoteYamlString(localISODate())}`);

  // Workout type as text initially (will be updated to wikilink)
  lines.push(`workoutType: ${quoteYamlString(data.workoutType)}`);

  // Duration
  if (data.totalTime != null) lines.push(`totalTime: ${data.totalTime}`);
  if (data.movingTime != null) lines.push(`movingTime: ${data.movingTime}`);

  // Distance & elevation
  if (data.distance != null) {
    lines.push(`distance: ${data.distance}`);
    lines.push(`distanceUnit: ${quoteYamlString(data.distanceUnit)}`);
  }
  if (data.elevationGain != null) {
    lines.push(`elevationGain: ${data.elevationGain}`);
    lines.push(`elevationGainUnit: ${quoteYamlString(data.elevationGainUnit)}`);
  }

  // Calories
  if (data.activeCalories != null) {
    lines.push(`activeCalories: ${data.activeCalories}`);
    lines.push(`activeCaloriesUnit: ${quoteYamlString(data.activeCaloriesUnit)}`);
  }

  // Environment
  if (data.temperature != null) {
    lines.push(`temperature: ${data.temperature}`);
    lines.push(`temperatureUnit: ${quoteYamlString(data.temperatureUnit)}`);
  }
  if (data.humidity != null) lines.push(`humidity: ${data.humidity}`);

  // Heart rate
  if (data.minHeartRate != null) lines.push(`minHeartRate: ${data.minHeartRate}`);
  if (data.avgHeartRate != null) lines.push(`avgHeartRate: ${data.avgHeartRate}`);
  if (data.maxHeartRate != null) lines.push(`maxHeartRate: ${data.maxHeartRate}`);
  if (data.minHeartRate != null || data.avgHeartRate != null || data.maxHeartRate != null) {
    lines.push(`heartRateUnit: ${quoteYamlString(data.heartRateUnit)}`);
  }

  // Training metrics
  if (data.trimp != null) lines.push(`trimp: ${data.trimp}`);
  if (data.mets != null) lines.push(`mets: ${data.mets}`);

  // HR zones
  if (data.hrZone0 != null) lines.push(`hrZone0: ${data.hrZone0}`);
  if (data.hrZone1 != null) lines.push(`hrZone1: ${data.hrZone1}`);
  if (data.hrZone2 != null) lines.push(`hrZone2: ${data.hrZone2}`);
  if (data.hrZone3 != null) lines.push(`hrZone3: ${data.hrZone3}`);
  if (data.hrZone4 != null) lines.push(`hrZone4: ${data.hrZone4}`);
  if (data.hrZone5 != null) lines.push(`hrZone5: ${data.hrZone5}`);

  // Source
  if (data.source) lines.push(`source: ${quoteYamlString(data.source)}`);

  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

// ============================================================================
// CSV DATA LOADING
// ============================================================================
async function loadCSVData(app, path) {
  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) {
      console.log(`CSV not found: ${path}`);
      return { headers: [], rows: [] };
    }
    const text = await app.vault.adapter.read(path);
    return parseCSV(text);
  } catch (e) {
    console.error(`Error loading CSV ${path}:`, e);
    return { headers: [], rows: [] };
  }
}

// ============================================================================
// MODE HANDLERS
// ============================================================================
async function handleManualEntry(app, qa, obsidian, Notice) {
  // Quick workout entry
  const workoutTypes = [
    "Running", "Walking", "Cycling", "Swimming", "Strength Training",
    "HIIT", "Yoga", "Pilates", "CrossFit", "Rowing", "Elliptical", "Other"
  ];

  const workoutType = await qa.suggester(workoutTypes, workoutTypes);
  if (!workoutType) return;

  const date = localISODate();
  const time = (await qa.inputPrompt("Time", "HH:MM (e.g., 14:30)"))?.trim() || "";
  const durationRaw = (await qa.inputPrompt("Duration", "minutes"))?.trim();
  const totalTime = durationRaw ? parseInt(durationRaw, 10) : null;

  const data = {
    date,
    time,
    workoutType: normalizeWorkoutType(workoutType),
    totalTime,
  };

  // Generate filename
  const timeStr = timeToFilename(time);
  const typeSafe = safeFilename(data.workoutType);
  const filename = `${data.date}-${timeStr}-${typeSafe}.md`;
  const notePath = `${SETTINGS.noteFolder}/${filename}`;

  await ensureFolder(app, SETTINGS.noteFolder);

  const exists = await app.vault.adapter.exists(notePath);
  if (exists) {
    if (Notice) new Notice(`Workout already exists: ${filename}`);
    return;
  }

  const content = buildFrontMatter(data);

  try {
    const workoutFile = await app.vault.create(notePath, content);

    await upsertAndLinkWorkoutType({
      app,
      obsidian,
      workoutFile,
      typeName: data.workoutType,
    });

    await app.workspace.getLeaf(true).openFile(workoutFile);
    if (Notice) new Notice(`Created workout: ${filename}`);
  } catch (e) {
    console.error(`Failed to create workout:`, e);
    if (Notice) new Notice(`Failed to create workout: ${e.message}`);
  }
}

async function handleCSVImport(app, qa, obsidian, Notice) {
  // Load CSV data
  if (Notice) new Notice("Loading workout CSV...");

  const workoutData = await loadCSVData(app, SETTINGS.csvPath);

  if (workoutData.rows.length === 0) {
    if (Notice) new Notice("No workouts found in CSV.");
    return;
  }

  // Load progress
  const progress = await loadProgress(app);
  const processedSet = new Set(progress.processedWorkouts || []);

  // Build skip types set (case-insensitive)
  const skipTypesLower = new Set(
    (SETTINGS.skipWorkoutTypes || []).map((t) => t.toLowerCase().trim())
  );

  // Track IDs seen in this run to handle CSV duplicates
  const seenInRun = new Set();

  // Track skipped workouts with reasons
  const skippedWorkouts = [];

  // Filter to unprocessed workouts (excluding skipped types and duplicates)
  const workoutsToProcess = workoutData.rows.filter((row) => {
    const id = generateWorkoutId(row);
    const date = parseDate(row["date"]);
    const time = row["time"] || "";
    const rawType = row["type"] || "";
    const type = normalizeWorkoutType(rawType);

    // Skip if already processed in previous runs
    if (processedSet.has(id)) return false;

    // Skip if duplicate row in this CSV
    if (seenInRun.has(id)) {
      skippedWorkouts.push({ date, time, type, reason: `Duplicate in CSV (was: ${rawType})` });
      return false;
    }
    seenInRun.add(id);

    // Check if type should be skipped
    const typeLower = type.toLowerCase().trim();
    const rawTypeLower = rawType.toLowerCase().trim();
    if (skipTypesLower.has(typeLower) || skipTypesLower.has(rawTypeLower)) {
      skippedWorkouts.push({ date, time, type, reason: `Type filtered: ${rawType}` });
      return false;
    }

    return true;
  });

  if (workoutsToProcess.length === 0) {
    const reset = await qa.yesNoPrompt(
      "All workouts processed",
      `All ${workoutData.rows.length} workouts have been imported. Reset progress to re-import?`
    );
    if (reset) {
      await resetProgress(app);
      if (Notice) new Notice("Progress reset. Run again to re-import.");
    }
    return;
  }

  // Build summary message
  let summaryMsg = `Found ${workoutData.rows.length} total workouts.\n${workoutsToProcess.length} new workouts to import.`;
  if (SETTINGS.skipWorkoutTypes.length > 0) {
    summaryMsg += `\n\nSkipping types: ${SETTINGS.skipWorkoutTypes.join(", ")}`;
  }
  summaryMsg += "\n\nContinue?";

  const proceed = await qa.yesNoPrompt("Workout Import", summaryMsg);
  if (!proceed) return;

  // Ensure output folder exists
  await ensureFolder(app, SETTINGS.noteFolder);

  // Process each workout
  let imported = 0;
  let skipped = 0;

  for (const row of workoutsToProcess) {
    const workoutId = generateWorkoutId(row);
    const data = transformWorkout(row);

    // Generate filename: YYYY-MM-DD-HHMM-Type.md
    const timeStr = timeToFilename(data.time);
    const typeSafe = safeFilename(data.workoutType);
    const filename = `${data.date}-${timeStr}-${typeSafe}.md`;
    const notePath = `${SETTINGS.noteFolder}/${filename}`;

    // Check if note already exists
    const exists = await app.vault.adapter.exists(notePath);
    if (exists) {
      skipped++;
      skippedWorkouts.push({ date: data.date, time: data.time, type: data.workoutType, reason: "File already exists" });
      await markWorkoutProcessed(app, workoutId);
      continue;
    }

    // Build frontmatter
    const content = buildFrontMatter(data);

    // Create note
    try {
      const workoutFile = await app.vault.create(notePath, content);

      // Upsert workout type and link
      await upsertAndLinkWorkoutType({
        app,
        obsidian,
        workoutFile,
        typeName: data.workoutType,
      });

      imported++;
      await markWorkoutProcessed(app, workoutId);
    } catch (e) {
      console.error(`Failed to create workout note ${filename}:`, e);
    }

    // Progress notification every 25 workouts
    if (imported % 25 === 0 && Notice) {
      new Notice(`Imported ${imported} / ${workoutsToProcess.length} workouts...`);
    }
  }

  // Write skipped log if any
  if (skippedWorkouts.length > 0) {
    const logLines = [
      `# Skipped Workouts`,
      ``,
      `Import run: ${localISODate()}`,
      ``,
      `| Date | Time | Type | Reason |`,
      `|------|------|------|--------|`,
    ];
    for (const s of skippedWorkouts) {
      logLines.push(`| ${s.date} | ${s.time} | ${s.type} | ${s.reason} |`);
    }
    logLines.push(``);

    try {
      await app.vault.adapter.write(SETTINGS.skippedLogFile, logLines.join("\n"));
    } catch (e) {
      console.error("Failed to write skipped log:", e);
    }
  }

  if (Notice) {
    let msg = `Workout import complete! ${imported} notes created, ${skipped} skipped.`;
    if (skippedWorkouts.length > 0) {
      msg += `\nSee ${SETTINGS.skippedLogFile} for details.`;
    }
    new Notice(msg);
  }
}

async function handleAPIImport(app, qa, Notice) {
  if (Notice) {
    new Notice("API Import (Garmin, Strava, Apple Fitness+) coming soon!\n\nUse CSV Import for now.", 5000);
  }
}

// ============================================================================
// VAULT TRACKER STATS
// ============================================================================
const TRACKER_FILE = ".obsidian/vault-tracker/workouts.json";

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

function formatWorkoutStats(stats) {
  if (!stats) return "No tracker data yet";
  const s = stats.stats;
  const hours = Math.floor(s.totalMinutes / 60);
  const mins = s.totalMinutes % 60;
  return `${s.total} workouts (${hours}h ${mins}m, ${s.uniqueTypes} types)`;
}

async function showPreImportStats(app, Notice) {
  // Sync tracker first to ensure stats are current
  const freshStats = await syncVaultTracker(app, null);
  const stats = freshStats || await readTrackerStats(app);
  if (stats && Notice) {
    new Notice(`🏋️ Current: ${formatWorkoutStats(stats)}`, 4000);
  }
  return stats;
}

function showPostImportDiff(Notice, beforeStats, afterStats) {
  if (!Notice || !beforeStats || !afterStats) return;
  
  const before = beforeStats.stats;
  const after = afterStats.stats;
  
  const workoutsDiff = after.total - before.total;
  const minutesDiff = after.totalMinutes - before.totalMinutes;
  const typesDiff = after.uniqueTypes - before.uniqueTypes;
  const caloriesDiff = after.totalCalories - before.totalCalories;
  
  const parts = [];
  if (workoutsDiff !== 0) parts.push(`🏋️ Workouts: ${before.total} → ${after.total} (${workoutsDiff > 0 ? '+' : ''}${workoutsDiff})`);
  if (minutesDiff !== 0) parts.push(`⏱️ Minutes: ${before.totalMinutes} → ${after.totalMinutes} (${minutesDiff > 0 ? '+' : ''}${minutesDiff})`);
  if (caloriesDiff !== 0) parts.push(`🔥 Calories: ${before.totalCalories} → ${after.totalCalories} (${caloriesDiff > 0 ? '+' : ''}${caloriesDiff})`);
  if (typesDiff !== 0) parts.push(`📋 Types: ${before.uniqueTypes} → ${after.uniqueTypes} (${typesDiff > 0 ? '+' : ''}${typesDiff})`);
  
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

function searchWorkouts(trackerData, query, searchType) {
  if (!trackerData?.workouts || !query) return [];
  
  const q = query.toLowerCase().trim();
  const results = [];
  
  for (const workout of trackerData.workouts) {
    if (searchType === "type") {
      const type = (workout.type || "").toLowerCase();
      if (type.includes(q) || stringSimilarity(type, q) > 0.3) {
        results.push({ ...workout, score: type === q ? 1 : 0.8 });
      }
    } else {
      // Search by date
      const date = (workout.date || "").toLowerCase();
      if (date.includes(q)) {
        results.push({ ...workout, score: date === q ? 1 : 0.9 });
      }
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 20);
}

async function handleSearch(app, qa, Notice) {
  const trackerData = await readTrackerStats(app);
  if (!trackerData) {
    if (Notice) new Notice("No tracker data found. Run a sync first.", 3000);
    return;
  }
  
  // Offer search options
  const searchType = await qa.suggester(
    ["Browse recent workouts", "Search by workout type", "Search by date"],
    ["recent", "type", "date"]
  );
  
  if (!searchType) return;
  
  let results;
  if (searchType === "recent") {
    // Show most recent 20 workouts
    results = (trackerData.workouts || []).slice(0, 20);
  } else if (searchType === "type") {
    // Show workout types first
    const types = trackerData.workoutTypes || [];
    if (types.length === 0) {
      if (Notice) new Notice("No workout types found", 3000);
      return;
    }
    const selectedType = await qa.suggester(types, types);
    if (!selectedType) return;
    results = searchWorkouts(trackerData, selectedType, "type");
  } else {
    const query = await qa.inputPrompt("Search workouts by date", "Enter date (YYYY-MM-DD or partial)");
    if (!query?.trim()) return;
    results = searchWorkouts(trackerData, query.trim(), "date");
  }
  
  if (results.length === 0) {
    if (Notice) new Notice("No workouts found", 3000);
    return;
  }
  
  // Format results for suggester
  const displayOptions = results.map(workout => {
    const duration = workout.duration ? `${workout.duration}m` : "";
    const calories = workout.calories ? `${workout.calories} kcal` : "";
    const details = [duration, calories].filter(Boolean).join(", ");
    return `🏋️ ${workout.date} - ${workout.type || "Unknown"}${details ? ` (${details})` : ""}`;
  });
  
  const selected = await qa.suggester(displayOptions, results);
  if (!selected) return;
  
  // Open the selected workout
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
      const results = await trackerModule.exports.syncTracker(app, { domains: ["workouts"], silent: true });
      console.log("Vault tracker synced (workouts)");
      return results?.workouts || null;
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

  // Show current stats before import
  const beforeStats = await showPreImportStats(app, Notice);

  // Mode selection
  const mode = await qa.suggester(
    ["🔍 Search existing workouts", "Manual - Quick workout entry", "CSV Import - Workout export file", "API Import (Future)"],
    ["search", "manual", "csv", "api"]
  );

  if (!mode) return;

  if (mode === "search") {
    await handleSearch(app, qa, Notice);
    return;
  }

  if (mode === "manual") {
    await handleManualEntry(app, qa, obsidian, Notice);
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
    await handleAPIImport(app, qa, Notice);
    return;
  }
};
