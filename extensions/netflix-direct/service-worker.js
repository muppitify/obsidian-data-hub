/**
 * Netflix Obsidian Importer - Service Worker
 * 
 * Minimal service worker for the Obsidian integration extension.
 * Most functionality is handled directly by the popup via the Obsidian API.
 */

// Default settings
const DEFAULT_SETTINGS = {
  obsidianApiUrl: 'https://127.0.0.1:27124',
  obsidianApiKey: '',
  quickAddChoiceName: 'Shows',
  dateFilterMode: 'all',
  dateFrom: '',
  dateTo: '',
};

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Netflix Obsidian] Extension installed');
    // Initialize default settings
    chrome.storage.sync.set(DEFAULT_SETTINGS);
  } else if (details.reason === 'update') {
    console.log(`[Netflix Obsidian] Extension updated to ${chrome.runtime.getManifest().version}`);
  }
});

console.log('[Netflix Obsidian] Service worker started');
