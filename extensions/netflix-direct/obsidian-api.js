/**
 * Obsidian Local REST API Client for Netflix Importer
 * 
 * Handles communication with Obsidian via the Local REST API plugin.
 * Used for checking connection, querying existing watches, and triggering imports.
 */

const ObsidianAPI = {
  /**
   * Test connection to Obsidian Local REST API
   * @param {string} apiUrl - Base URL (e.g., "https://127.0.0.1:27124")
   * @param {string} apiKey - API key from Local REST API plugin
   * @returns {Promise<{ok: boolean, error?: string, vaultName?: string}>}
   */
  async checkConnection(apiUrl, apiKey) {
    try {
      const response = await fetch(`${apiUrl}/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { ok: false, error: 'Invalid API key' };
        }
        return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const data = await response.json();
      return { ok: true, vaultName: data.name || 'Unknown vault' };
    } catch (e) {
      console.error('[Obsidian API] Connection error:', e);
      
      if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
        return { 
          ok: false, 
          error: 'Cannot connect to Obsidian. Is it running with the Local REST API plugin enabled?' 
        };
      }
      if (e.message?.includes('SSL') || e.message?.includes('certificate')) {
        return { 
          ok: false, 
          error: 'SSL certificate error. You may need to accept the certificate in your browser.' 
        };
      }
      
      return { ok: false, error: e.message || 'Unknown connection error' };
    }
  },

  /**
   * Get existing Netflix watch entries from the vault
   * Queries shows/watched/ folder for entries with source: "[[Netflix]]"
   * @param {string} apiUrl - Base URL
   * @param {string} apiKey - API key
   * @returns {Promise<{ok: boolean, entries?: Set<string>, error?: string}>}
   */
  async getExistingEntries(apiUrl, apiKey) {
    try {
      // Use the search endpoint to find files with Netflix source
      const searchQuery = 'source: "[[Netflix]]"';
      
      const response = await fetch(`${apiUrl}/search/simple/?query=${encodeURIComponent(searchQuery)}&contextLength=0`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.log('[Obsidian API] Search failed, trying directory listing...');
        return await this.getExistingEntriesViaListing(apiUrl, apiKey);
      }

      const results = await response.json();
      const entries = new Set();

      for (const result of results) {
        const filename = result.filename || '';
        
        if (!filename.startsWith('shows/watched/')) continue;
        
        // Extract date and title from filename
        const match = filename.match(/(\d{4}-\d{2}-\d{2})-\d+-(.+?)(?:-S\d+E\d+)?\.md$/);
        if (match) {
          const date = match[1];
          const title = match[2]
            .replace(/-/g, ' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
          
          entries.add(`${date}|${title}`);
        }
      }

      console.log(`[Obsidian API] Found ${entries.size} existing Netflix entries`);
      return { ok: true, entries };
    } catch (e) {
      console.error('[Obsidian API] Error fetching existing entries:', e);
      return { ok: false, error: e.message || 'Failed to fetch existing entries' };
    }
  },

  /**
   * Fallback: Get existing entries by listing the watched folder
   * @param {string} apiUrl - Base URL
   * @param {string} apiKey - API key
   * @returns {Promise<{ok: boolean, entries?: Set<string>, error?: string}>}
   */
  async getExistingEntriesViaListing(apiUrl, apiKey) {
    try {
      const response = await fetch(`${apiUrl}/vault/shows/watched/`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { ok: true, entries: new Set() };
        }
        return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const files = await response.json();
      const entries = new Set();

      for (const file of files.files || []) {
        const filename = file;
        const match = filename.match(/(\d{4}-\d{2}-\d{2})-\d+-(.+?)(?:-S\d+E\d+)?\.md$/);
        if (match) {
          const date = match[1];
          const title = match[2]
            .replace(/-/g, ' ')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
          
          entries.add(`${date}|${title}`);
        }
      }

      console.log(`[Obsidian API] Found ${entries.size} watched entries via listing`);
      return { ok: true, entries };
    } catch (e) {
      console.error('[Obsidian API] Error listing watched folder:', e);
      return { ok: false, error: e.message || 'Failed to list watched folder' };
    }
  },

  /**
   * Send items to Obsidian for import via the commands endpoint
   * @param {string} apiUrl - Base URL
   * @param {string} apiKey - API key
   * @param {Array} items - Items to import
   * @param {string} quickAddChoiceName - Name of the QuickAdd choice to trigger
   * @returns {Promise<{ok: boolean, imported?: number, skipped?: number, error?: string}>}
   */
  async importItems(apiUrl, apiKey, items, quickAddChoiceName = 'Shows') {
    try {
      // Store items in a file that the QuickAdd script will read
      const importData = {
        source: 'Netflix',
        exportedAt: new Date().toISOString(),
        itemCount: items.length,
        items: items,
      };

      // Write the import data to a file in the vault
      const importPath = '.obsidian/netflix-import-queue.json';
      
      const writeResponse = await fetch(`${apiUrl}/vault/${importPath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(importData, null, 2),
      });

      if (!writeResponse.ok) {
        return { ok: false, error: `Failed to write import data: HTTP ${writeResponse.status}` };
      }

      // Trigger QuickAdd via Obsidian URI
      const quickAddUri = `obsidian://quickadd?choice=${encodeURIComponent(quickAddChoiceName)}`;
      
      console.log('[Obsidian API] Opening QuickAdd URI:', quickAddUri);
      
      window.open(quickAddUri, '_blank');

      return { 
        ok: true, 
        imported: items.length,
        message: `${items.length} items sent to Obsidian. QuickAdd should open automatically.`
      };
    } catch (e) {
      console.error('[Obsidian API] Import error:', e);
      return { ok: false, error: e.message || 'Failed to import items' };
    }
  },

  /**
   * Create an identifier for an item (for duplicate checking)
   * @param {object} item - Watch history item
   * @returns {string} Identifier string
   */
  createItemIdentifier(item) {
    const date = (item.dateWatched || '').substring(0, 10);
    const title = (item.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return `${date}|${title}`;
  },

  /**
   * Filter items to only include new ones (not in existing entries)
   * @param {Array} items - All scraped items
   * @param {Set} existingEntries - Set of existing entry identifiers
   * @returns {Array} Filtered items
   */
  filterNewItems(items, existingEntries) {
    return items.filter(item => {
      const identifier = this.createItemIdentifier(item);
      const isNew = !existingEntries.has(identifier);
      
      if (!isNew) {
        console.log(`[Obsidian API] Skipping existing: ${identifier}`);
      }
      
      return isNew;
    });
  },

  /**
   * Filter items by date range
   * @param {Array} items - Items to filter
   * @param {string} filterMode - 'all', 'from', or 'range'
   * @param {string} fromDate - Start date (ISO format)
   * @param {string} toDate - End date (ISO format)
   * @returns {Array} Filtered items
   */
  filterByDateRange(items, filterMode, fromDate, toDate) {
    if (filterMode === 'all' || !filterMode) {
      return items;
    }

    return items.filter(item => {
      const itemDate = (item.dateWatched || '').substring(0, 10);
      if (!itemDate) return true;

      if (filterMode === 'from') {
        return itemDate >= fromDate;
      }
      
      if (filterMode === 'range') {
        return itemDate >= fromDate && itemDate <= toDate;
      }

      return true;
    });
  }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ObsidianAPI;
}
