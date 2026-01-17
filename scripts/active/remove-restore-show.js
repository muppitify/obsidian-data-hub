// remove-restore-show.js — QuickAdd script for Obsidian
//
// Soft-delete a show (movie or TV series) with restore capability.
// Moves all references to trash instead of permanently deleting.
//
// Modes:
//   - Search & Delete: Find and soft-delete a show
//   - Restore from Trash: Restore a previously deleted show
//   - Purge Trash: Permanently delete trashed shows
//
// What gets removed:
//   - Series/movie notes and episode notes
//   - Cover images
//   - Watch log entries
//   - Progress tracking entries
//   - Any other JSON config references
//
// iOS compatible: uses app.vault.adapter
//
// ============================================================================

const SETTINGS = {
  // Folders to search
  folders: {
    movies: "shows/movies",
    series: "shows/series",
    watched: "shows/watched",
    covers: "shows/covers",
  },
  
  // Config files to clean (exclude workspace files - Obsidian manages those)
  configFiles: [
    ".obsidian/watch-import-progress.json",
    ".obsidian/watch-import-unfound.json",
    ".obsidian/watch-episode-mismatches.md",
    ".obsidian/vault-tracker/shows.json",
  ],
  
  // Files to skip during config scanning (Obsidian-managed, will auto-clear on restart)
  skipConfigFiles: [
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
  ],
  
  // Trash folder location
  trashFolder: ".obsidian/trash",
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

function formatTimestamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

function safeFilename(s, maxLength = 200) {
  if (!s) return "untitled";
  let safe = String(s)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (safe.length > maxLength) {
    safe = safe.substring(0, maxLength).trim();
  }
  return safe || "untitled";
}

/**
 * Ensure a folder exists, creating parent folders as needed
 */
async function ensureFolder(adapter, folderPath) {
  const parts = folderPath.split('/');
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      const exists = await adapter.exists(current);
      if (!exists) {
        await adapter.mkdir(current);
      }
    } catch (e) {}
  }
}

/**
 * Recursively list all files in a directory
 */
async function listFilesRecursive(adapter, dir) {
  const files = [];
  try {
    const items = await adapter.list(dir);
    files.push(...items.files);
    for (const folder of items.folders) {
      files.push(...await listFilesRecursive(adapter, folder));
    }
  } catch (e) {}
  return files;
}

/**
 * Check if a file is binary based on extension
 */
function isBinaryFile(filePath) {
  const binaryExtensions = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'tar', 'gz', 'rar', '7z',
    'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
  ];
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return binaryExtensions.includes(ext);
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Find all shows (movies and series) in the vault matching search term
 */
function findMatchingShows(app, searchTerm) {
  const term = searchTerm.toLowerCase().trim();
  const results = {
    movies: [],
    series: [],
  };
  
  const allFiles = app.vault.getFiles();
  
  // Find movies
  const movieFolder = SETTINGS.folders.movies;
  for (const file of allFiles) {
    if (file.path.startsWith(movieFolder) && file.extension === "md") {
      const name = file.basename;
      if (name.toLowerCase().includes(term)) {
        results.movies.push({
          name: name,
          path: file.path,
          type: "movie",
        });
      }
    }
  }
  
  // Find series (look for series.md or folder names)
  const seriesFolder = SETTINGS.folders.series;
  const seriesFolders = new Set();
  
  for (const file of allFiles) {
    if (file.path.startsWith(seriesFolder) && file.extension === "md") {
      // Extract series folder name
      const pathParts = file.path.replace(seriesFolder + "/", "").split("/");
      if (pathParts.length >= 1) {
        const seriesName = pathParts[0];
        if (seriesName.toLowerCase().includes(term)) {
          seriesFolders.add(seriesName);
        }
      }
    }
  }
  
  for (const seriesName of seriesFolders) {
    results.series.push({
      name: seriesName,
      path: `${seriesFolder}/${seriesName}`,
      type: "series",
    });
  }
  
  return results;
}

/**
 * Gather all references to a show throughout the vault
 */
async function gatherShowReferences(app, showName, showType) {
  const adapter = app.vault.adapter;
  const term = showName.toLowerCase();
  
  const references = {
    showName: showName,
    showType: showType,
    folders: [],
    files: [],
    watchedNotes: [],
    configMatches: [],
    totalItems: 0,
  };
  
  const allFiles = app.vault.getFiles();
  
  // 1. Main show folder
  if (showType === "series") {
    const seriesPath = `${SETTINGS.folders.series}/${showName}`;
    const seriesFiles = allFiles.filter(f => f.path.startsWith(seriesPath + "/") || f.path === seriesPath);
    if (seriesFiles.length > 0) {
      references.folders.push(seriesPath);
      references.files.push(...seriesFiles.map(f => f.path));
    }
  } else {
    const moviePath = `${SETTINGS.folders.movies}/${showName}.md`;
    const movieFile = allFiles.find(f => f.path === moviePath);
    if (movieFile) {
      references.files.push(movieFile.path);
    }
  }
  
  // 2. Covers folder
  const coversPath = showType === "series" 
    ? `${SETTINGS.folders.covers}/series/${showName}`
    : `${SETTINGS.folders.covers}/movies/${showName}.jpg`;
  
  if (showType === "series") {
    const coverFiles = allFiles.filter(f => f.path.startsWith(coversPath + "/") || f.path === coversPath);
    if (coverFiles.length > 0) {
      references.folders.push(coversPath);
      references.files.push(...coverFiles.map(f => f.path));
    }
  } else {
    const coverFile = allFiles.find(f => f.path === coversPath);
    if (coverFile) {
      references.files.push(coverFile.path);
    }
  }
  
  // 3. Watched notes
  const watchedFolder = SETTINGS.folders.watched;
  for (const file of allFiles) {
    if (file.path.startsWith(watchedFolder) && file.path.toLowerCase().includes(term)) {
      references.watchedNotes.push(file.path);
    }
  }
  
  // 4. Config files
  for (const configPath of SETTINGS.configFiles) {
    try {
      const exists = await adapter.exists(configPath);
      if (exists) {
        const content = await adapter.read(configPath);
        const matches = (content.toLowerCase().match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        if (matches > 0) {
          references.configMatches.push({ path: configPath, count: matches });
        }
      }
    } catch (e) {}
  }
  
  // 5. Scan ALL .obsidian JSON files for references (excluding trash)
  const obsidianFiles = await listFilesRecursive(adapter, '.obsidian');
  for (const filePath of obsidianFiles) {
    // Skip already checked files, trash folder, and Obsidian-managed files
    if (SETTINGS.configFiles.includes(filePath)) continue;
    if (SETTINGS.skipConfigFiles.includes(filePath)) continue;
    if (filePath.startsWith(SETTINGS.trashFolder)) continue;
    
    try {
      const content = await adapter.read(filePath);
      const matches = (content.toLowerCase().match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
      if (matches > 0) {
        references.configMatches.push({ path: filePath, count: matches });
      }
    } catch (e) {}
  }
  
  references.totalItems = 
    references.folders.length + 
    references.files.length + 
    references.watchedNotes.length +
    references.configMatches.reduce((sum, c) => sum + c.count, 0);
  
  return references;
}

// ============================================================================
// SOFT DELETE FUNCTIONS
// ============================================================================

/**
 * Extract config entries that match the show name for backup
 */
async function extractConfigEntries(adapter, configMatches, term) {
  const extracted = [];
  
  for (const config of configMatches) {
    try {
      const content = await adapter.read(config.path);
      
      if (config.path.endsWith('.json')) {
        const data = JSON.parse(content);
        const entries = extractFromJsonObject(data, term);
        if (entries.length > 0) {
          extracted.push({
            path: config.path,
            type: 'json',
            entries: entries,
          });
        }
      } else if (config.path.endsWith('.md')) {
        const lines = content.split('\n');
        const matchingLines = lines.filter(line => line.toLowerCase().includes(term));
        if (matchingLines.length > 0) {
          extracted.push({
            path: config.path,
            type: 'markdown',
            entries: matchingLines,
          });
        }
      }
    } catch (e) {}
  }
  
  return extracted;
}

/**
 * Extract entries from JSON object that match term
 */
function extractFromJsonObject(obj, term, path = '', results = []) {
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (typeof item === 'string' && item.toLowerCase().includes(term)) {
        results.push({ path: `${path}[${index}]`, value: item, type: 'array-item' });
      } else if (typeof item === 'object' && item !== null) {
        extractFromJsonObject(item, term, `${path}[${index}]`, results);
      }
    });
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      if (key.toLowerCase().includes(term)) {
        results.push({ path: newPath, key, value: obj[key], type: 'key-match' });
      } else if (typeof obj[key] === 'string' && obj[key].toLowerCase().includes(term)) {
        results.push({ path: newPath, key, value: obj[key], type: 'value-match' });
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        extractFromJsonObject(obj[key], term, newPath, results);
      }
    }
  }
  return results;
}

/**
 * Soft delete: Move show to trash with manifest for restore
 */
async function softDeleteShow(app, references, Notice) {
  const adapter = app.vault.adapter;
  const term = references.showName.toLowerCase();
  const timestamp = formatTimestamp();
  const trashPath = `${SETTINGS.trashFolder}/${safeFilename(references.showName)}-${timestamp}`;
  
  const results = {
    trashPath: trashPath,
    filesMoved: 0,
    configEntriesRemoved: 0,
    errors: [],
  };
  
  // Create trash folder
  await ensureFolder(adapter, trashPath);
  await ensureFolder(adapter, `${trashPath}/files`);
  
  // Build manifest
  const manifest = {
    showName: references.showName,
    showType: references.showType,
    deletedAt: new Date().toISOString(),
    files: [],
    configEntries: [],
  };
  
  // 1. Move files to trash (preserving structure)
  const allFilesToMove = [
    ...references.files,
    ...references.watchedNotes,
  ];
  
  // Deduplicate
  const uniqueFiles = [...new Set(allFilesToMove)];
  
  for (const filePath of uniqueFiles) {
    try {
      const exists = await adapter.exists(filePath);
      if (!exists) continue;
      
      // Create destination path in trash
      const destPath = `${trashPath}/files/${filePath}`;
      const destFolder = destPath.substring(0, destPath.lastIndexOf('/'));
      await ensureFolder(adapter, destFolder);
      
      // Read and write file (handle binary vs text)
      const isBinary = isBinaryFile(filePath);
      if (isBinary) {
        const content = await adapter.readBinary(filePath);
        await adapter.writeBinary(destPath, content);
      } else {
        const content = await adapter.read(filePath);
        await adapter.write(destPath, content);
      }
      
      // Record in manifest
      manifest.files.push({
        originalPath: filePath,
        trashPath: destPath,
        isBinary: isBinary,
      });
      
      // Delete original
      const file = app.vault.getAbstractFileByPath(filePath);
      if (file) {
        await app.vault.delete(file);
      }
      
      results.filesMoved++;
    } catch (e) {
      results.errors.push(`Failed to move ${filePath}: ${e.message}`);
    }
  }
  
  // 2. Clean up empty folders
  for (const folderPath of references.folders) {
    try {
      const exists = await adapter.exists(folderPath);
      if (exists) {
        await adapter.rmdir(folderPath, true);
      }
    } catch (e) {
      // Folder may already be empty/deleted
    }
  }
  
  // 3. Extract and save config entries before cleaning
  manifest.configEntries = await extractConfigEntries(adapter, references.configMatches, term);
  
  // 4. Clean config files
  for (const config of references.configMatches) {
    try {
      const content = await adapter.read(config.path);
      
      if (config.path.endsWith('.json')) {
        const data = JSON.parse(content);
        const cleaned = cleanJsonObject(data, term);
        const newContent = JSON.stringify(cleaned.data, null, 2);
        
        if (cleaned.removed > 0) {
          await adapter.write(config.path, newContent);
          results.configEntriesRemoved += cleaned.removed;
        }
      } else if (config.path.endsWith('.md')) {
        const lines = content.split('\n');
        const newLines = lines.filter(line => !line.toLowerCase().includes(term));
        const removed = lines.length - newLines.length;
        
        if (removed > 0) {
          await adapter.write(config.path, newLines.join('\n'));
          results.configEntriesRemoved += removed;
        }
      }
    } catch (e) {
      results.errors.push(`Failed to clean config ${config.path}: ${e.message}`);
    }
  }
  
  // 5. Save manifest
  await adapter.write(`${trashPath}/manifest.json`, JSON.stringify(manifest, null, 2));
  
  return results;
}

/**
 * Recursively clean JSON object of entries matching term
 */
function cleanJsonObject(obj, term, removed = { count: 0 }) {
  if (Array.isArray(obj)) {
    const filtered = obj.filter(item => {
      if (typeof item === 'string' && item.toLowerCase().includes(term)) {
        removed.count++;
        return false;
      }
      return true;
    });
    return {
      data: filtered.map(item => {
        if (typeof item === 'object' && item !== null) {
          return cleanJsonObject(item, term, removed).data;
        }
        return item;
      }),
      removed: removed.count,
    };
  } else if (obj && typeof obj === 'object') {
    const newObj = {};
    for (const key of Object.keys(obj)) {
      if (key.toLowerCase().includes(term)) {
        removed.count++;
        continue;
      }
      if (typeof obj[key] === 'string' && obj[key].toLowerCase().includes(term)) {
        removed.count++;
        continue;
      }
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        newObj[key] = cleanJsonObject(obj[key], term, removed).data;
      } else {
        newObj[key] = obj[key];
      }
    }
    return { data: newObj, removed: removed.count };
  }
  return { data: obj, removed: removed.count };
}

// ============================================================================
// RESTORE FUNCTIONS
// ============================================================================

/**
 * List all trashed shows
 */
async function listTrashedShows(adapter) {
  const trashed = [];
  
  try {
    const exists = await adapter.exists(SETTINGS.trashFolder);
    if (!exists) return trashed;
    
    const items = await adapter.list(SETTINGS.trashFolder);
    
    for (const folder of items.folders) {
      try {
        const manifestPath = `${folder}/manifest.json`;
        const manifestExists = await adapter.exists(manifestPath);
        if (manifestExists) {
          const content = await adapter.read(manifestPath);
          const manifest = JSON.parse(content);
          trashed.push({
            path: folder,
            showName: manifest.showName,
            showType: manifest.showType,
            deletedAt: manifest.deletedAt,
            fileCount: manifest.files.length,
          });
        }
      } catch (e) {}
    }
  } catch (e) {}
  
  // Sort by deletion date, newest first
  trashed.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  
  return trashed;
}

/**
 * Restore a show from trash
 */
async function restoreShow(app, trashPath, Notice) {
  const adapter = app.vault.adapter;
  
  const results = {
    filesRestored: 0,
    configEntriesRestored: 0,
    errors: [],
  };
  
  // Load manifest
  const manifestPath = `${trashPath}/manifest.json`;
  let manifest;
  try {
    const content = await adapter.read(manifestPath);
    manifest = JSON.parse(content);
  } catch (e) {
    results.errors.push(`Failed to read manifest: ${e.message}`);
    return results;
  }
  
  // 1. Restore files
  for (const file of manifest.files) {
    try {
      const exists = await adapter.exists(file.trashPath);
      if (!exists) {
        results.errors.push(`Trash file not found: ${file.trashPath}`);
        continue;
      }
      
      // Ensure destination folder exists
      const destFolder = file.originalPath.substring(0, file.originalPath.lastIndexOf('/'));
      if (destFolder) {
        await ensureFolder(adapter, destFolder);
      }
      
      // Read and write file (handle binary vs text)
      // Check manifest flag first, fall back to extension check for older manifests
      const isBinary = file.isBinary !== undefined ? file.isBinary : isBinaryFile(file.originalPath);
      if (isBinary) {
        const content = await adapter.readBinary(file.trashPath);
        await adapter.writeBinary(file.originalPath, content);
      } else {
        const content = await adapter.read(file.trashPath);
        await adapter.write(file.originalPath, content);
      }
      
      results.filesRestored++;
    } catch (e) {
      results.errors.push(`Failed to restore ${file.originalPath}: ${e.message}`);
    }
  }
  
  // 2. Restore config entries (skip if already exists)
  for (const config of manifest.configEntries) {
    try {
      if (config.type === 'json') {
        const exists = await adapter.exists(config.path);
        if (!exists) continue;
        
        const content = await adapter.read(config.path);
        const data = JSON.parse(content);
        const contentLower = content.toLowerCase();
        
        // Re-add entries only if they don't already exist
        for (const entry of config.entries) {
          // Check if entry value already exists in the file
          const valueStr = typeof entry.value === 'string' 
            ? entry.value.toLowerCase() 
            : JSON.stringify(entry.value).toLowerCase();
          
          if (!contentLower.includes(valueStr)) {
            restoreJsonEntry(data, entry);
            results.configEntriesRestored++;
          }
        }
        
        await adapter.write(config.path, JSON.stringify(data, null, 2));
      } else if (config.type === 'markdown') {
        const exists = await adapter.exists(config.path);
        let content = '';
        if (exists) {
          content = await adapter.read(config.path);
        }
        const contentLower = content.toLowerCase();
        
        // Only add lines that don't already exist
        const newLines = config.entries.filter(line => 
          !contentLower.includes(line.toLowerCase())
        );
        
        if (newLines.length > 0) {
          const newContent = content + (content.endsWith('\n') ? '' : '\n') + newLines.join('\n') + '\n';
          await adapter.write(config.path, newContent);
          results.configEntriesRestored += newLines.length;
        }
      }
    } catch (e) {
      results.errors.push(`Failed to restore config ${config.path}: ${e.message}`);
    }
  }
  
  // 3. Delete trash folder
  try {
    await adapter.rmdir(trashPath, true);
  } catch (e) {
    results.errors.push(`Failed to clean up trash: ${e.message}`);
  }
  
  return results;
}

/**
 * Restore a JSON entry based on its type
 */
function restoreJsonEntry(data, entry) {
  const pathParts = entry.path.split(/[\.\[\]]/).filter(p => p !== '');
  
  if (entry.type === 'array-item') {
    // Find parent array and push the value
    let current = data;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (current[part] === undefined) {
        // Create path if needed
        current[part] = isNaN(parseInt(pathParts[i + 1])) ? {} : [];
      }
      current = current[part];
    }
    if (Array.isArray(current)) {
      current.push(entry.value);
    }
  } else if (entry.type === 'key-match' || entry.type === 'value-match') {
    // Restore key-value pair
    let current = data;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (current[part] === undefined) {
        current[part] = {};
      }
      current = current[part];
    }
    current[entry.key] = entry.value;
  }
}

// ============================================================================
// PURGE FUNCTIONS
// ============================================================================

/**
 * Permanently delete a trashed show
 */
async function purgeTrash(adapter, trashPath) {
  try {
    await adapter.rmdir(trashPath, true);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Purge all trash
 */
async function purgeAllTrash(adapter) {
  const results = { purged: 0, errors: [] };
  
  try {
    const exists = await adapter.exists(SETTINGS.trashFolder);
    if (exists) {
      await adapter.rmdir(SETTINGS.trashFolder, true);
      results.purged = 1;
    }
  } catch (e) {
    results.errors.push(e.message);
  }
  
  return results;
}

// ============================================================================
// VERIFICATION
// ============================================================================

/**
 * Verify all references have been removed
 */
async function verifyCleanup(app, showName) {
  const adapter = app.vault.adapter;
  const term = showName.toLowerCase();
  const remaining = [];
  
  // Check vault files
  const allFiles = app.vault.getFiles();
  for (const file of allFiles) {
    if (file.path.toLowerCase().includes(term)) {
      remaining.push({ type: 'file', path: file.path });
    }
  }
  
  // Check .obsidian files (excluding trash and Obsidian-managed files)
  const obsidianFiles = await listFilesRecursive(adapter, '.obsidian');
  for (const filePath of obsidianFiles) {
    if (filePath.startsWith(SETTINGS.trashFolder)) continue;
    if (SETTINGS.skipConfigFiles.includes(filePath)) continue;
    
    try {
      const content = await adapter.read(filePath);
      if (content.toLowerCase().includes(term)) {
        const matches = (content.toLowerCase().match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        remaining.push({ type: 'config', path: filePath, matches });
      }
    } catch (e) {}
  }
  
  return remaining;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

module.exports = async function removeRestoreShow(params) {
  const { app, quickAddApi: qa } = params;
  const Notice = params.obsidian?.Notice || app.Notice || function(msg) { console.log(msg); };
  const adapter = app.vault.adapter;
  
  // Get trash count for menu display
  const trashedShows = await listTrashedShows(adapter);
  const trashCount = trashedShows.length;
  const trashLabel = trashCount > 0 ? ` (${trashCount})` : " (empty)";
  
  // Main menu
  const modeOptions = [
    "🔍 Search & Delete Show",
    `♻️ Restore from Trash${trashLabel}`,
    `🗑️ Purge Trash${trashLabel}`,
    "❌ Cancel",
  ];
  const modeValues = ["delete", "restore", "purge", "cancel"];
  
  const mode = await qa.suggester(modeOptions, modeValues);
  
  if (!mode || mode === "cancel") {
    new Notice("Cancelled.");
    return;
  }
  
  // ========== DELETE MODE ==========
  if (mode === "delete") {
    // Step 1: Prompt for search term
    const searchTerm = await qa.inputPrompt(
      "Search for show to remove",
      "Enter show name (partial, case-insensitive)",
      ""
    );
    
    if (!searchTerm || !searchTerm.trim()) {
      new Notice("Cancelled - no search term entered.");
      return;
    }
    
    // Step 2: Find matching shows
    new Notice(`Searching for "${searchTerm}"...`);
    const matches = findMatchingShows(app, searchTerm.trim());
    
    const allMatches = [
      ...matches.movies.map(m => ({ ...m, display: `🎬 ${m.name}` })),
      ...matches.series.map(s => ({ ...s, display: `📺 ${s.name}` })),
    ];
    
    if (allMatches.length === 0) {
      new Notice(`No shows found matching "${searchTerm}".`);
      return;
    }
    
    // Step 3: Let user select a show
    const options = [
      "❌ Cancel",
      ...allMatches.map(m => m.display),
    ];
    const values = [
      null,
      ...allMatches,
    ];
    
    const selected = await qa.suggester(options, values);
    
    if (!selected) {
      new Notice("Cancelled.");
      return;
    }
    
    // Step 4: Gather references and show summary
    new Notice(`Analyzing "${selected.name}"...`);
    const references = await gatherShowReferences(app, selected.name, selected.type);
    
    // Build summary
    const summaryLines = [
      `── ${selected.type === 'series' ? '📺 Series' : '🎬 Movie'}: ${selected.name} ──`,
      "",
      `📁 Folders to delete: ${references.folders.length}`,
      `📄 Files to delete: ${references.files.length}`,
      `📝 Watch log entries: ${references.watchedNotes.length}`,
      `⚙️ Config entries: ${references.configMatches.reduce((sum, c) => sum + c.count, 0)}`,
      "",
      `Total items: ${references.totalItems}`,
      "",
      `⚠️ Close any open tabs for this show first!`,
      `(Workspace refs may persist until Obsidian restart)`,
    ];
    
    // Show summary and confirm
    const confirmOptions = [
      summaryLines.join('\n'),
      `🗑️ DELETE "${selected.name}" (move to trash)`,
      "❌ Cancel - do not delete",
    ];
    const confirmValues = ["header", "delete", "cancel"];
    
    let confirmation = await qa.suggester(confirmOptions, confirmValues);
    
    while (confirmation === "header") {
      confirmation = await qa.suggester(confirmOptions, confirmValues);
    }
    
    if (confirmation !== "delete") {
      new Notice("Cancelled - nothing was deleted.");
      return;
    }
    
    // Step 5: Soft delete
    new Notice(`Moving "${selected.name}" to trash...`);
    const deleteResults = await softDeleteShow(app, references, Notice);
    
    // Step 6: Verify cleanup
    new Notice("Verifying cleanup...");
    const remaining = await verifyCleanup(app, selected.name);
    
    // Step 7: Report results
    if (remaining.length === 0 && deleteResults.errors.length === 0) {
      const successMsg = [
        `✅ Successfully removed "${selected.name}"`,
        "",
        `Files moved to trash: ${deleteResults.filesMoved}`,
        `Config entries removed: ${deleteResults.configEntriesRemoved}`,
        "",
        `Restore from: ${deleteResults.trashPath}`,
      ].join('\n');
      
      new Notice(successMsg, 8000);
      console.log(successMsg);
    } else {
      const warningMsg = [
        `⚠️ Cleanup completed with issues for "${selected.name}"`,
        "",
        `Files moved: ${deleteResults.filesMoved}`,
        `Remaining references: ${remaining.length}`,
        `Errors: ${deleteResults.errors.length}`,
      ].join('\n');
      
      new Notice(warningMsg, 10000);
      console.log(warningMsg);
      console.log("Remaining:", remaining);
      console.log("Errors:", deleteResults.errors);
    }
  }
  
  // ========== RESTORE MODE ==========
  else if (mode === "restore") {
    if (trashedShows.length === 0) {
      new Notice("No shows in trash.");
      return;
    }
    
    // Build options
    const restoreOptions = [
      "❌ Cancel",
      ...trashedShows.map(t => {
        const date = new Date(t.deletedAt).toLocaleString();
        const icon = t.showType === 'series' ? '📺' : '🎬';
        return `${icon} ${t.showName} (${t.fileCount} files, deleted ${date})`;
      }),
    ];
    const restoreValues = [null, ...trashedShows];
    
    const selectedTrash = await qa.suggester(restoreOptions, restoreValues);
    
    if (!selectedTrash) {
      new Notice("Cancelled.");
      return;
    }
    
    // Confirm restore
    const restoreConfirmOptions = [
      `♻️ Restore "${selectedTrash.showName}"`,
      "❌ Cancel",
    ];
    const restoreConfirmValues = ["restore", "cancel"];
    
    const restoreConfirm = await qa.suggester(restoreConfirmOptions, restoreConfirmValues);
    
    if (restoreConfirm !== "restore") {
      new Notice("Cancelled.");
      return;
    }
    
    // Restore
    new Notice(`Restoring "${selectedTrash.showName}"...`);
    const restoreResults = await restoreShow(app, selectedTrash.path, Notice);
    
    if (restoreResults.errors.length === 0) {
      const successMsg = [
        `✅ Successfully restored "${selectedTrash.showName}"`,
        "",
        `Files restored: ${restoreResults.filesRestored}`,
        `Config entries restored: ${restoreResults.configEntriesRestored}`,
      ].join('\n');
      
      new Notice(successMsg, 8000);
      console.log(successMsg);
    } else {
      const warningMsg = [
        `⚠️ Restore completed with issues`,
        "",
        `Files restored: ${restoreResults.filesRestored}`,
        `Errors: ${restoreResults.errors.length}`,
      ].join('\n');
      
      new Notice(warningMsg, 10000);
      console.log(warningMsg);
      console.log("Errors:", restoreResults.errors);
    }
  }
  
  // ========== PURGE MODE ==========
  else if (mode === "purge") {
    if (trashedShows.length === 0) {
      new Notice("Trash is empty.");
      return;
    }
    
    // Build options
    const purgeOptions = [
      "❌ Cancel",
      `🗑️ PURGE ALL (${trashedShows.length} shows)`,
      ...trashedShows.map(t => {
        const date = new Date(t.deletedAt).toLocaleString();
        const icon = t.showType === 'series' ? '📺' : '🎬';
        return `🗑️ ${t.showName} (deleted ${date})`;
      }),
    ];
    const purgeValues = [null, "all", ...trashedShows];
    
    const selectedPurge = await qa.suggester(purgeOptions, purgeValues);
    
    if (!selectedPurge) {
      new Notice("Cancelled.");
      return;
    }
    
    // Confirm purge
    const purgeTarget = selectedPurge === "all" ? "ALL trashed shows" : `"${selectedPurge.showName}"`;
    const purgeConfirmOptions = [
      `⚠️ PERMANENTLY DELETE ${purgeTarget}? This cannot be undone!`,
      "❌ Cancel",
    ];
    const purgeConfirmValues = ["purge", "cancel"];
    
    const purgeConfirm = await qa.suggester(purgeConfirmOptions, purgeConfirmValues);
    
    if (purgeConfirm !== "purge") {
      new Notice("Cancelled.");
      return;
    }
    
    // Purge
    if (selectedPurge === "all") {
      new Notice("Purging all trash...");
      const purgeResults = await purgeAllTrash(adapter);
      new Notice(`✅ Trash purged. ${trashedShows.length} shows permanently deleted.`, 5000);
    } else {
      new Notice(`Purging "${selectedPurge.showName}"...`);
      const purgeResult = await purgeTrash(adapter, selectedPurge.path);
      if (purgeResult.success) {
        new Notice(`✅ "${selectedPurge.showName}" permanently deleted.`, 5000);
      } else {
        new Notice(`⚠️ Failed to purge: ${purgeResult.error}`, 5000);
      }
    }
  }
};
