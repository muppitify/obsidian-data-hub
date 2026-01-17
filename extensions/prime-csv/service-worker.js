/**
 * Prime Video Watch History Exporter - Service Worker
 * 
 * Handles downloads, webhook posting, and settings storage.
 */

// Default settings
const DEFAULT_SETTINGS = {
  outputFormat: 'json',
  webhookUrl: '',
  webhookEnabled: false,
  formatDates: true,
};

/**
 * Get settings from storage
 */
async function getSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return result;
}

/**
 * Save settings to storage
 */
async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
}

/**
 * Generate filename with timestamp
 */
function generateFilename(format) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `prime-watch-history-${timestamp}.${format}`;
}

/**
 * Download data as a file
 */
async function downloadFile(data, format) {
  const filename = generateFilename(format);
  const mimeType = format === 'json' ? 'application/json' : 'text/csv';
  
  // Service workers can't use URL.createObjectURL, so use data URL instead
  const base64Data = btoa(unescape(encodeURIComponent(data)));
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true,
    });

    console.log(`[Prime Exporter] Download started: ${filename} (id: ${downloadId})`);
    return { success: true, filename, downloadId };
  } catch (error) {
    console.error('[Prime Exporter] Download failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Post data to webhook
 */
async function postToWebhook(webhookUrl, items, exportedAt) {
  const payload = {
    exportedAt,
    itemCount: items.length,
    items,
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.text();
    console.log(`[Prime Exporter] Webhook response: ${result}`);

    return { success: true, status: response.status };
  } catch (error) {
    console.error('[Prime Exporter] Webhook failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations
  (async () => {
    try {
      switch (message.action) {
        case 'getSettings': {
          const settings = await getSettings();
          sendResponse({ success: true, settings });
          break;
        }

        case 'saveSettings': {
          await saveSettings(message.settings);
          sendResponse({ success: true });
          break;
        }

        case 'download': {
          const { data, format } = message;
          const result = await downloadFile(data, format);
          sendResponse(result);
          break;
        }

        case 'webhook': {
          const { webhookUrl, items, exportedAt } = message;
          const result = await postToWebhook(webhookUrl, items, exportedAt);
          sendResponse(result);
          break;
        }

        case 'export': {
          // Full export flow: get data from content script, then download/webhook
          const settings = await getSettings();
          
          // Get the active tab
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          
          if (!tab?.id) {
            sendResponse({ success: false, error: 'No active tab found' });
            break;
          }

          // Check if we're on a Prime Video page
          if (!tab.url?.includes('primevideo.com') && !tab.url?.includes('amazon.com')) {
            sendResponse({ success: false, error: 'Not on a Prime Video page' });
            break;
          }

          // Request data from content script
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'collectHistory' });
            
            if (!response?.success) {
              sendResponse({ success: false, error: response?.error || 'Failed to collect history' });
              break;
            }

            const { items, csv, exportedAt } = response;
            const results = { items: items.length, download: null, webhook: null };

            // Download file
            const data = settings.outputFormat === 'json' 
              ? JSON.stringify(items, null, 2) 
              : csv;
            results.download = await downloadFile(data, settings.outputFormat);

            // Post to webhook if enabled
            if (settings.webhookEnabled && settings.webhookUrl) {
              results.webhook = await postToWebhook(settings.webhookUrl, items, exportedAt);
            }

            sendResponse({ success: true, results });
          } catch (error) {
            // Content script might not be loaded
            sendResponse({ 
              success: false, 
              error: 'Content script not loaded. Please refresh the page and try again.' 
            });
          }
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[Prime Exporter] Service worker error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  // Return true to indicate async response
  return true;
});

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Prime Exporter] Extension installed');
    // Initialize default settings
    saveSettings(DEFAULT_SETTINGS);
  } else if (details.reason === 'update') {
    console.log(`[Prime Exporter] Extension updated to ${chrome.runtime.getManifest().version}`);
  }
});

console.log('[Prime Exporter] Service worker started');
