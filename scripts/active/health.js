// health.js — Unified QuickAdd script for Obsidian
//
// Imports health data from various sources:
//   - CSV Import: Health export files (metrics, sleep, weight, mindfulness)
//   - Future: Apple Health API, Google Fit API
//
// Creates daily health notes with combined metrics.
//
// iOS compatible: uses app.vault.adapter
//
// ============================================================================
// Utilities copied from lib/quickadd-core.js:
//   - String: pad2, localISODate
//   - YAML: quoteYamlString
//   - CSV: parseCSV, parseCSVLine
//   - Date: parseDate
//   - File: ensureFolder
//   - Progress: createProgressTracker pattern
//   - Search: searchByTitle (as searchHealthEntries)
//   - Incremental: readExistingFrontmatter (as readExistingHealthNote),
//                  detectDataSources (as getExistingSourcesFromFrontmatter),
//                  hasNewDataSources (as hasNewSources),
//                  mergeDataBySources (as mergeHealthData)
// ============================================================================

// ============================================================================
// SETTINGS
// ============================================================================
const SETTINGS = {
  // Script paths
  syncTrackerPath: "scripts/active/sync-tracker.js",

  // CSV file paths (relative to vault root)
  csvPaths: {
    metrics: "csv-imports/health/Health/metrics.csv",
    sleep: "csv-imports/health/Health/sleep.csv",
    weight: "csv-imports/health/Health/weight.csv",
    mindfulness: "csv-imports/health/Health/mindfulness.csv",
  },

  // Output folder for daily health notes
  noteFolder: "health/daily",

  // Category wikilink for daily health notes
  categoryWikilink: "[[Health]]",

  // Progress tracking file
  progressFile: ".obsidian/health-import-progress.json",
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
// DATE PARSING
// ============================================================================
function parseDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  // M/D/YYYY or MM/DD/YYYY (US format common in health exports)
  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // Already YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  return s;
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

  // Match "Xh:Ym" or "Xh:Ym:Zs"
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

// Define which metrics belong to each data source for completeness checking
const DATA_SOURCE_METRICS = {
  activity: ["activeEnergy", "steps", "restingHeartRate", "hrv", "vo2Max"],
  sleep: ["sleepStart", "sleepEnd", "timeAsleep", "timeInBed"],
  weight: ["weight"],
  mindfulness: ["mindfulnessTime", "mindfulnessDuration"],
};

async function loadProgress(app) {
  try {
    const exists = await app.vault.adapter.exists(SETTINGS.progressFile);
    if (!exists) return { processedDates: [], dateMetrics: {} };
    const raw = await app.vault.adapter.read(SETTINGS.progressFile);
    const data = JSON.parse(raw);
    // Ensure dateMetrics exists for backwards compatibility
    if (!data.dateMetrics) data.dateMetrics = {};
    return data;
  } catch {
    return { processedDates: [], dateMetrics: {} };
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

async function markDateProcessed(app, date, sources = []) {
  const progress = await loadProgress(app);
  if (!progress.processedDates.includes(date)) {
    progress.processedDates.push(date);
    await saveProgress(app, progress);
  }
}

async function resetProgress(app) {
  await saveProgress(app, { processedDates: [], dateMetrics: {} });
}

// ============================================================================
// INCREMENTAL UPDATE SUPPORT
// ============================================================================

/**
 * Read existing health note and return its frontmatter
 */
async function readExistingHealthNote(app, notePath) {
  try {
    const exists = await app.vault.adapter.exists(notePath);
    if (!exists) return null;
    
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file) return null;
    
    const cache = app.metadataCache.getFileCache(file);
    return cache?.frontmatter || null;
  } catch (e) {
    console.error(`Failed to read health note: ${notePath}`, e);
    return null;
  }
}

/**
 * Check which data sources have data in the CSV for a given date
 */
function getAvailableSourcesFromCSV(metricsGroup, sleepGroup, weightGroup, mindfulnessGroup) {
  const sources = [];
  if (metricsGroup && metricsGroup.length > 0) sources.push("activity");
  if (sleepGroup && sleepGroup.length > 0) sources.push("sleep");
  if (weightGroup && weightGroup.length > 0) sources.push("weight");
  if (mindfulnessGroup && mindfulnessGroup.length > 0) sources.push("mindfulness");
  return sources;
}

/**
 * Check which data sources are present in existing frontmatter
 */
function getExistingSourcesFromFrontmatter(fm) {
  if (!fm) return [];
  
  const sources = [];
  
  // Check activity metrics
  if (fm.activeEnergy != null || fm.steps != null || fm.restingHeartRate != null) {
    sources.push("activity");
  }
  
  // Check sleep metrics
  if (fm.sleepStart || fm.timeAsleep != null || fm.timeInBed != null) {
    sources.push("sleep");
  }
  
  // Check weight metrics
  if (fm.weight != null) {
    sources.push("weight");
  }
  
  // Check mindfulness metrics
  if (fm.mindfulnessTime || fm.mindfulnessDuration != null) {
    sources.push("mindfulness");
  }
  
  return sources;
}

/**
 * Merge existing frontmatter with new data (new data takes precedence for its source)
 */
function mergeHealthData(existingFm, newData, newSources) {
  if (!existingFm) return newData;
  
  // Start with existing data
  const merged = { ...existingFm };
  
  // Remove non-data fields
  delete merged.position;
  
  // Overlay new data for each new source
  for (const source of newSources) {
    const metricsForSource = DATA_SOURCE_METRICS[source] || [];
    
    // For each metric in this source, use new data if available
    for (const [key, value] of Object.entries(newData)) {
      // Always update date
      if (key === "date") {
        merged[key] = value;
        continue;
      }
      
      // Check if this key belongs to a new source
      const keyBelongsToNewSource = newSources.some(s => 
        DATA_SOURCE_METRICS[s]?.some(m => key.toLowerCase().includes(m.toLowerCase()))
      );
      
      if (keyBelongsToNewSource && value != null && value !== "") {
        merged[key] = value;
      }
    }
  }
  
  // Also add any new keys that don't exist yet
  for (const [key, value] of Object.entries(newData)) {
    if (merged[key] === undefined && value != null && value !== "") {
      merged[key] = value;
    }
  }
  
  return merged;
}

/**
 * Check if there are new data sources in CSV that aren't in the existing note
 */
function hasNewSources(existingSources, csvSources) {
  return csvSources.some(s => !existingSources.includes(s));
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================
async function ensureFolder(app, folder) {
  const f = String(folder || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!f) return;
  await app.vault.adapter.mkdir(f).catch(() => {});
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
// DATA TRANSFORMATION
// ============================================================================
function transformMetrics(row) {
  const activeEnergy = parseValueWithUnit(row["active energy"]);
  const restingEnergy = parseValueWithUnit(row["resting energy"]);
  const resting = parseValueWithUnit(row["resting"]);
  const vo2max = parseValueWithUnit(row["vo₂ max"] || row["vo2 max"]);

  return {
    activeEnergy: activeEnergy.value,
    activeEnergyUnit: activeEnergy.unit || "kcal",
    restingEnergy: restingEnergy.value,
    restingEnergyUnit: restingEnergy.unit || "kcal",
    restingHeartRate: resting.value,
    restingHeartRateUnit: resting.unit || "bpm",
    hrv: parseInt(row["hrv"], 10) || null,
    steps: parseInt(row["steps"], 10) || null,
    vo2Max: vo2max.value,
  };
}

function transformSleep(row) {
  const avgResp = parseValueWithUnit(row["avg. respiration rate"]);
  const avgSpO2 = parsePercentage(row["avg. spo2"]);
  const avgHrv = parseValueWithUnit(row["avg. hrv"]);

  return {
    sleepStart: row["start"] || null,
    sleepEnd: row["end"] || null,
    timeInBed: parseDuration(row["inbed"]),
    timeAsleep: parseDuration(row["asleep"]),
    timeAwake: parseDuration(row["awake"]),
    sleepRem: parseDuration(row["rem"]),
    sleepCore: parseDuration(row["core"]),
    sleepDeep: parseDuration(row["deep"]),
    wakeCount: parseInt(row["wake count"], 10) || null,
    sleepEfficiency: parsePercentage(row["efficiency"]),
    fallAsleepTime: parseDuration(row["fall asleep"]),
    avgRespirationRate: avgResp.value,
    respirationRateUnit: avgResp.unit || "breaths/min",
    avgSpO2: avgSpO2,
    sleepAvgHrv: avgHrv.value,
    sleepAvgHrvUnit: avgHrv.unit || "ms",
    sleepSource: row["data source"] || null,
  };
}

function transformWeight(row) {
  const weight = parseValueWithUnit(row["weight"]);
  const fat = parsePercentage(row["fat"]);
  const bmi = parseFloat(row["bmi"]) || null;

  return {
    weight: weight.value,
    weightUnit: weight.unit || "kg",
    bodyFat: fat,
    bmi: bmi,
    weightSource: row["data source"] || null,
  };
}

function transformMindfulness(row) {
  const sdnn = parseValueWithUnit(row["sdnn"]);
  const rmssd = parseValueWithUnit(row["rmssd"]);
  const avgHrv = parseValueWithUnit(row["avg. hrv"]);

  return {
    mindfulnessTime: row["time"] || null,
    mindfulnessDuration: parseDuration(row["duration"]),
    mindfulnessSdnn: sdnn.value,
    mindfulnessSdnnUnit: sdnn.unit || "ms",
    mindfulnessRmssd: rmssd.value,
    mindfulnessRmssdUnit: rmssd.unit || "ms",
    mindfulnessAvgHrv: avgHrv.value,
    mindfulnessAvgHrvUnit: avgHrv.unit || "bpm",
    mindfulnessSource: row["data source"] || null,
  };
}

// ============================================================================
// GROUP BY DATE
// ============================================================================
function groupByDate(rows, dateField = "date") {
  const groups = {};
  for (const row of rows) {
    const rawDate = row[dateField];
    const date = parseDate(rawDate);
    if (!date) continue;

    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(row);
  }
  return groups;
}

// ============================================================================
// BUILD DAILY DATA
// ============================================================================
function buildDailyData(date, metricsGroup, sleepGroup, weightGroup, mindfulnessGroup) {
  const data = { date };

  // Metrics (should only be one per day)
  if (metricsGroup && metricsGroup.length > 0) {
    Object.assign(data, transformMetrics(metricsGroup[0]));
  }

  // Sleep (use Main=TRUE only)
  if (sleepGroup && sleepGroup.length > 0) {
    const mainSleep = sleepGroup.find((r) => r["main"]?.toUpperCase() === "TRUE") || sleepGroup[0];
    Object.assign(data, transformSleep(mainSleep));
  }

  // Weight (use first measurement of the day)
  if (weightGroup && weightGroup.length > 0) {
    Object.assign(data, transformWeight(weightGroup[0]));
  }

  // Mindfulness (use first session of the day)
  if (mindfulnessGroup && mindfulnessGroup.length > 0) {
    Object.assign(data, transformMindfulness(mindfulnessGroup[0]));
  }

  return data;
}

// ============================================================================
// BUILD FRONTMATTER
// ============================================================================
function buildFrontMatter(data) {
  const lines = [];
  lines.push("---");
  lines.push(`categories:\n  - "${SETTINGS.categoryWikilink}"`);
  lines.push(`date: ${quoteYamlString(data.date)}`);
  lines.push(`created: ${quoteYamlString(localISODate())}`);

  // Metrics section
  if (data.activeEnergy != null) {
    lines.push(`activeEnergy: ${data.activeEnergy}`);
    lines.push(`activeEnergyUnit: ${quoteYamlString(data.activeEnergyUnit)}`);
  }
  if (data.restingEnergy != null) {
    lines.push(`restingEnergy: ${data.restingEnergy}`);
    lines.push(`restingEnergyUnit: ${quoteYamlString(data.restingEnergyUnit)}`);
  }
  if (data.restingHeartRate != null) {
    lines.push(`restingHeartRate: ${data.restingHeartRate}`);
    lines.push(`restingHeartRateUnit: ${quoteYamlString(data.restingHeartRateUnit)}`);
  }
  if (data.hrv != null) lines.push(`hrv: ${data.hrv}`);
  if (data.steps != null) lines.push(`steps: ${data.steps}`);
  if (data.vo2Max != null) lines.push(`vo2Max: ${data.vo2Max}`);

  // Sleep section
  if (data.sleepStart) lines.push(`sleepStart: ${quoteYamlString(data.sleepStart)}`);
  if (data.sleepEnd) lines.push(`sleepEnd: ${quoteYamlString(data.sleepEnd)}`);
  if (data.timeInBed != null) lines.push(`timeInBed: ${data.timeInBed}`);
  if (data.timeAsleep != null) lines.push(`timeAsleep: ${data.timeAsleep}`);
  if (data.timeAwake != null) lines.push(`timeAwake: ${data.timeAwake}`);
  if (data.sleepRem != null) lines.push(`sleepRem: ${data.sleepRem}`);
  if (data.sleepCore != null) lines.push(`sleepCore: ${data.sleepCore}`);
  if (data.sleepDeep != null) lines.push(`sleepDeep: ${data.sleepDeep}`);
  if (data.wakeCount != null) lines.push(`wakeCount: ${data.wakeCount}`);
  if (data.sleepEfficiency != null) lines.push(`sleepEfficiency: ${data.sleepEfficiency}`);
  if (data.fallAsleepTime != null) lines.push(`fallAsleepTime: ${data.fallAsleepTime}`);
  if (data.avgRespirationRate != null) {
    lines.push(`avgRespirationRate: ${data.avgRespirationRate}`);
    lines.push(`respirationRateUnit: ${quoteYamlString(data.respirationRateUnit)}`);
  }
  if (data.avgSpO2 != null) lines.push(`avgSpO2: ${data.avgSpO2}`);
  if (data.sleepAvgHrv != null) {
    lines.push(`sleepAvgHrv: ${data.sleepAvgHrv}`);
    lines.push(`sleepAvgHrvUnit: ${quoteYamlString(data.sleepAvgHrvUnit)}`);
  }
  if (data.sleepSource) lines.push(`sleepSource: ${quoteYamlString(data.sleepSource)}`);

  // Weight section
  if (data.weight != null) {
    lines.push(`weight: ${data.weight}`);
    lines.push(`weightUnit: ${quoteYamlString(data.weightUnit)}`);
  }
  if (data.bodyFat != null) lines.push(`bodyFat: ${data.bodyFat}`);
  if (data.bmi != null) lines.push(`bmi: ${data.bmi}`);
  if (data.weightSource) lines.push(`weightSource: ${quoteYamlString(data.weightSource)}`);

  // Mindfulness section
  if (data.mindfulnessTime) lines.push(`mindfulnessTime: ${quoteYamlString(data.mindfulnessTime)}`);
  if (data.mindfulnessDuration != null) lines.push(`mindfulnessDuration: ${data.mindfulnessDuration}`);
  if (data.mindfulnessSdnn != null) {
    lines.push(`mindfulnessSdnn: ${data.mindfulnessSdnn}`);
    lines.push(`mindfulnessSdnnUnit: ${quoteYamlString(data.mindfulnessSdnnUnit)}`);
  }
  if (data.mindfulnessRmssd != null) {
    lines.push(`mindfulnessRmssd: ${data.mindfulnessRmssd}`);
    lines.push(`mindfulnessRmssdUnit: ${quoteYamlString(data.mindfulnessRmssdUnit)}`);
  }
  if (data.mindfulnessAvgHrv != null) {
    lines.push(`mindfulnessAvgHrv: ${data.mindfulnessAvgHrv}`);
    lines.push(`mindfulnessAvgHrvUnit: ${quoteYamlString(data.mindfulnessAvgHrvUnit)}`);
  }
  if (data.mindfulnessSource) lines.push(`mindfulnessSource: ${quoteYamlString(data.mindfulnessSource)}`);

  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

// ============================================================================
// MODE HANDLERS
// ============================================================================
async function handleCSVImport(app, qa, Notice) {
  // Load all CSV data
  if (Notice) new Notice("Loading health data CSVs...");

  const [metricsData, sleepData, weightData, mindfulnessData] = await Promise.all([
    loadCSVData(app, SETTINGS.csvPaths.metrics),
    loadCSVData(app, SETTINGS.csvPaths.sleep),
    loadCSVData(app, SETTINGS.csvPaths.weight),
    loadCSVData(app, SETTINGS.csvPaths.mindfulness),
  ]);

  // Group all data by date
  const metricsByDate = groupByDate(metricsData.rows);
  const sleepByDate = groupByDate(sleepData.rows);
  const weightByDate = groupByDate(weightData.rows);
  const mindfulnessByDate = groupByDate(mindfulnessData.rows);

  // Collect all unique dates
  const allDates = new Set([
    ...Object.keys(metricsByDate),
    ...Object.keys(sleepByDate),
    ...Object.keys(weightByDate),
    ...Object.keys(mindfulnessByDate),
  ]);

  // Analyze each date for new or updated data
  const datesToCreate = [];
  const datesToUpdate = [];
  
  for (const date of allDates) {
    const notePath = `${SETTINGS.noteFolder}/${date}.md`;
    const existingFm = await readExistingHealthNote(app, notePath);
    
    const csvSources = getAvailableSourcesFromCSV(
      metricsByDate[date],
      sleepByDate[date],
      weightByDate[date],
      mindfulnessByDate[date]
    );
    
    if (!existingFm) {
      // Note doesn't exist - needs creation
      datesToCreate.push({ date, sources: csvSources });
    } else {
      // Note exists - check if CSV has new data sources
      const existingSources = getExistingSourcesFromFrontmatter(existingFm);
      if (hasNewSources(existingSources, csvSources)) {
        datesToUpdate.push({ 
          date, 
          existingSources, 
          newSources: csvSources.filter(s => !existingSources.includes(s)),
          allCsvSources: csvSources,
          existingFm 
        });
      }
    }
  }
  
  const totalWork = datesToCreate.length + datesToUpdate.length;
  
  if (totalWork === 0) {
    if (Notice) new Notice(`All ${allDates.size} dates are up to date. No new data to import.`, 4000);
    
    const forceUpdate = await qa.yesNoPrompt(
      "Force Update?",
      "All health notes are complete. Would you like to force re-import all data?\n\n(This will overwrite existing metrics with CSV data)"
    );
    
    if (forceUpdate) {
      // Reset and process all dates
      await resetProgress(app);
      for (const date of allDates) {
        datesToCreate.push({ date, sources: getAvailableSourcesFromCSV(
          metricsByDate[date], sleepByDate[date], weightByDate[date], mindfulnessByDate[date]
        )});
      }
    } else {
      return;
    }
  }

  // Show summary
  let summaryMsg = `Found ${allDates.size} total dates in CSV.\n\n`;
  if (datesToCreate.length > 0) summaryMsg += `• ${datesToCreate.length} new dates to create\n`;
  if (datesToUpdate.length > 0) summaryMsg += `• ${datesToUpdate.length} existing notes with new data to update\n`;
  summaryMsg += "\nContinue?";
  
  const proceed = await qa.yesNoPrompt("Health Data Import", summaryMsg);
  if (!proceed) return;

  // Ensure output folder exists
  await ensureFolder(app, SETTINGS.noteFolder);

  let created = 0;
  let updated = 0;

  // Process new dates (create notes)
  for (const { date, sources } of datesToCreate) {
    const notePath = `${SETTINGS.noteFolder}/${date}.md`;

    // Build data from CSV
    const dailyData = buildDailyData(
      date,
      metricsByDate[date],
      sleepByDate[date],
      weightByDate[date],
      mindfulnessByDate[date]
    );

    // Build frontmatter
    const content = buildFrontMatter(dailyData);

    // Create note
    try {
      // Delete if exists (for force update case)
      const exists = await app.vault.adapter.exists(notePath);
      if (exists) {
        await app.vault.adapter.remove(notePath);
      }
      await app.vault.create(notePath, content);
      created++;
      await markDateProcessed(app, date, sources);
    } catch (e) {
      console.error(`Failed to create note for ${date}:`, e);
    }

    // Progress notification every 50 notes
    if (created % 50 === 0 && Notice) {
      new Notice(`Created ${created} / ${datesToCreate.length} days...`);
    }
  }

  // Process existing dates that need updates (merge new data)
  for (const { date, newSources, allCsvSources, existingFm } of datesToUpdate) {
    const notePath = `${SETTINGS.noteFolder}/${date}.md`;

    // Build new data from CSV
    const csvData = buildDailyData(
      date,
      metricsByDate[date],
      sleepByDate[date],
      weightByDate[date],
      mindfulnessByDate[date]
    );

    // Merge existing with new
    const mergedData = mergeHealthData(existingFm, csvData, newSources);

    // Rebuild frontmatter with merged data
    const content = buildFrontMatter(mergedData);

    // Update note
    try {
      await app.vault.adapter.write(notePath, content);
      updated++;
      await markDateProcessed(app, date, allCsvSources);
      
      if (Notice && updated <= 5) {
        const sourcesAdded = newSources.join(", ");
        new Notice(`Updated ${date}: added ${sourcesAdded}`, 3000);
      }
    } catch (e) {
      console.error(`Failed to update note for ${date}:`, e);
    }
  }

  if (Notice) {
    let msg = "Health import complete!\n\n";
    if (created > 0) msg += `• ${created} notes created\n`;
    if (updated > 0) msg += `• ${updated} notes updated with new data`;
    new Notice(msg, 5000);
  }
}

async function handleAPIImport(app, qa, Notice) {
  if (Notice) {
    new Notice("API Import (Apple Health, Google Fit) coming soon!\n\nUse CSV Import for now.", 5000);
  }
}

// ============================================================================
// VAULT TRACKER STATS
// ============================================================================
const TRACKER_FILE = ".obsidian/vault-tracker/health.json";

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

function formatHealthStats(stats) {
  if (!stats) return "No tracker data yet";
  const s = stats.stats;
  const range = s.dateRange ? `${s.dateRange[0]} to ${s.dateRange[1]}` : "no data";
  return `${s.entries} daily entries (${range})`;
}

async function showPreImportStats(app, Notice) {
  // Sync tracker first to ensure stats are current
  const freshStats = await syncVaultTracker(app, null);
  const stats = freshStats || await readTrackerStats(app);
  if (stats && Notice) {
    new Notice(`❤️ Current: ${formatHealthStats(stats)}`, 4000);
  }
  return stats;
}

function showPostImportDiff(Notice, beforeStats, afterStats) {
  if (!Notice || !beforeStats || !afterStats) return;
  
  const before = beforeStats.stats;
  const after = afterStats.stats;
  
  const entriesDiff = after.entries - before.entries;
  const metricsDiff = after.metricsTracked - before.metricsTracked;
  
  const parts = [];
  if (entriesDiff !== 0) parts.push(`❤️ Entries: ${before.entries} → ${after.entries} (${entriesDiff > 0 ? '+' : ''}${entriesDiff})`);
  if (metricsDiff !== 0) parts.push(`📊 Metrics: ${before.metricsTracked} → ${after.metricsTracked} (${metricsDiff > 0 ? '+' : ''}${metricsDiff})`);
  
  if (parts.length > 0) {
    new Notice(`Import complete!\n\n${parts.join('\n')}`, 6000);
  }
}

// ============================================================================
// SEARCH EXISTING
// ============================================================================
function searchHealthEntries(trackerData, query) {
  if (!trackerData?.entries || !query) return [];
  
  const q = query.toLowerCase().trim();
  const results = [];
  
  for (const entry of trackerData.entries) {
    const date = (entry.date || "").toLowerCase();
    if (date.includes(q)) {
      results.push({ ...entry, score: date === q ? 1 : 0.9 });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 15);
}

function formatHealthMetrics(metrics) {
  const parts = [];
  if (metrics.steps) parts.push(`${metrics.steps} steps`);
  if (metrics.weight) parts.push(`${metrics.weight}kg`);
  if (metrics.timeAsleep) parts.push(`${metrics.timeAsleep}h sleep`);
  if (metrics.activeEnergy) parts.push(`${metrics.activeEnergy} kcal`);
  return parts.length > 0 ? parts.join(", ") : "no data";
}

async function handleSearch(app, qa, Notice) {
  const trackerData = await readTrackerStats(app);
  if (!trackerData) {
    if (Notice) new Notice("No tracker data found. Run a sync first.", 3000);
    return;
  }
  
  // Offer recent entries or date search
  const searchType = await qa.suggester(
    ["Browse recent entries", "Search by date"],
    ["recent", "date"]
  );
  
  if (!searchType) return;
  
  let results;
  if (searchType === "recent") {
    // Show most recent 20 entries
    results = (trackerData.entries || []).slice(0, 20);
  } else {
    const query = await qa.inputPrompt("Search health entries", "Enter date (YYYY-MM-DD or partial)");
    if (!query?.trim()) return;
    results = searchHealthEntries(trackerData, query.trim());
  }
  
  if (results.length === 0) {
    if (Notice) new Notice("No entries found", 3000);
    return;
  }
  
  // Format results for suggester
  const displayOptions = results.map(entry => {
    const summary = formatHealthMetrics(entry.metrics || {});
    return `📅 ${entry.date} - ${summary}`;
  });
  
  const selected = await qa.suggester(displayOptions, results);
  if (!selected) return;
  
  // Open the selected entry
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
      const results = await trackerModule.exports.syncTracker(app, { domains: ["health"], silent: true });
      console.log("Vault tracker synced (health)");
      return results?.health || null;
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
    ["🔍 Search existing entries", "CSV Import - Health export files", "API Import (Future)"],
    ["search", "csv", "api"]
  );

  if (!mode) return;

  if (mode === "search") {
    await handleSearch(app, qa, Notice);
    return;
  }

  if (mode === "csv") {
    await handleCSVImport(app, qa, Notice);
    const afterStats = await syncVaultTracker(app, Notice);
    showPostImportDiff(Notice, beforeStats, afterStats);
    return;
  }

  if (mode === "api") {
    await handleAPIImport(app, qa, Notice);
    return;
  }
};
