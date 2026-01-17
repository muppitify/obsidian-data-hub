/**
 * Prime Video Obsidian Importer - Service Worker
 * 
 * Minimal service worker for the Obsidian integration extension.
 * Most functionality is handled directly by the popup via the Obsidian API.
 */

// Default settings
const DEFAULT_SETTINGS = {
  obsidianApiUrl: 'https://127.0.0.1:27124',
  obsidianApiKey: '',
  dateFilterMode: 'all',
  dateFrom: '',
  dateTo: '',
};

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Prime Obsidian] Extension installed');
    // Initialize default settings
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  } else if (details.reason === 'update') {
    console.log(`[Prime Obsidian] Extension updated to ${chrome.runtime.getManifest().version}`);
  }
});

console.log('[Prime Obsidian] Service worker started');
