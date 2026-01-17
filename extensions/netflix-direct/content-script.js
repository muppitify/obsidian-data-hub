/**
 * Netflix Viewing Activity Exporter - Content Script
 * 
 * Runs on Netflix viewing activity pages to extract watch history data.
 * Communicates with popup for Obsidian import.
 */

(() => {
  'use strict';

  // Prevent multiple injections
  if (window.__netflixHistoryExporterLoaded) {
    return;
  }
  window.__netflixHistoryExporterLoaded = true;

  console.log('[Netflix Exporter] Content script loaded');

  /**
   * DOM Selectors for Netflix viewing activity page
   */
  const SELECTORS = {
    // Each row in the activity list
    row: 'li.retableRow[data-uia="activity-row"]',
    // Date column
    date: 'div.col.date',
    // Title column with link
    titleLink: 'div.col.title a',
    // Show more button
    showMore: 'button.btn.btn-blue.btn-small',
    // Alternative show more selector
    showMoreAlt: 'button[data-uia="viewing-activity-footer-button"]',
  };

  /**
   * Parse Netflix combined title into structured data
   * 
   * Patterns:
   * - "Series: Season X: \"Episode Title\""
   * - "Series: Volume X: \"Episode Title\""
   * - "Series: Arc Name: \"Episode Title\""
   * - "Movie Title"
   */
  function parseNetflixTitle(fullTitle) {
    if (!fullTitle) return { type: 'Movie', title: 'Unknown' };

    // Clean up the title
    const cleaned = fullTitle.trim();

    // Pattern 1: Series with Season number - "Title: Season X: \"Episode\""
    const seasonMatch = cleaned.match(/^(.+?):\s*Season\s*(\d+):\s*"(.+)"$/i);
    if (seasonMatch) {
      return {
        type: 'Series',
        title: seasonMatch[1].trim(),
        season: parseInt(seasonMatch[2], 10),
        episodeTitle: seasonMatch[3].trim().replace(/"$/, ''),
      };
    }

    // Pattern 2: Series with Volume - "Title: Volume X: \"Episode\""
    const volumeMatch = cleaned.match(/^(.+?):\s*Volume\s*(\d+):\s*"(.+)"$/i);
    if (volumeMatch) {
      return {
        type: 'Series',
        title: volumeMatch[1].trim(),
        season: parseInt(volumeMatch[2], 10), // Treat volume as season
        episodeTitle: volumeMatch[3].trim().replace(/"$/, ''),
      };
    }

    // Pattern 3: Series with Part - "Title: Part X: \"Episode\""
    const partMatch = cleaned.match(/^(.+?):\s*Part\s*(\d+):\s*"(.+)"$/i);
    if (partMatch) {
      return {
        type: 'Series',
        title: partMatch[1].trim(),
        season: parseInt(partMatch[2], 10), // Treat part as season
        episodeTitle: partMatch[3].trim().replace(/"$/, ''),
      };
    }

    // Pattern 4: Limited Series - "Title: Limited Series: \"Episode\""
    const limitedMatch = cleaned.match(/^(.+?):\s*Limited Series:\s*"(.+)"$/i);
    if (limitedMatch) {
      return {
        type: 'Series',
        title: limitedMatch[1].trim(),
        season: 1,
        episodeTitle: limitedMatch[2].trim().replace(/"$/, ''),
      };
    }

    // Pattern 5: Anime/Series with Arc - "Title: Arc Name: \"Episode\""
    // This catches patterns like "One Piece: Punk Hazard: \"Episode Title\""
    const arcMatch = cleaned.match(/^(.+?):\s*(.+?):\s*"(.+)"$/);
    if (arcMatch) {
      // Check if the middle part looks like an arc name (not Season/Volume/Part)
      const middlePart = arcMatch[2].trim();
      if (!/^(Season|Volume|Part|Limited Series)\s*\d*$/i.test(middlePart)) {
        return {
          type: 'Series',
          title: arcMatch[1].trim(),
          episodeTitle: `${middlePart}: ${arcMatch[3].trim().replace(/"$/, '')}`,
        };
      }
    }

    // Pattern 6: Simple series - "Title: \"Episode\"" (no season info)
    const simpleMatch = cleaned.match(/^(.+?):\s*"(.+)"$/);
    if (simpleMatch) {
      return {
        type: 'Series',
        title: simpleMatch[1].trim(),
        episodeTitle: simpleMatch[2].trim().replace(/"$/, ''),
      };
    }

    // No episode pattern found - it's a movie
    return {
      type: 'Movie',
      title: cleaned,
    };
  }

  /**
   * Parse date from Netflix format (DD/MM/YY or other locale formats)
   * Returns ISO date string (YYYY-MM-DD)
   */
  function parseNetflixDate(dateStr) {
    if (!dateStr) return new Date().toISOString().split('T')[0];

    const cleaned = dateStr.trim();

    // Try DD/MM/YY format (common in AU/UK)
    const dmy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, '0');
      const month = dmy[2].padStart(2, '0');
      let year = dmy[3];
      if (year.length === 2) {
        year = parseInt(year, 10) + 2000;
      }
      return `${year}-${month}-${day}`;
    }

    // Try MM/DD/YY format (US)
    const mdy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdy) {
      // Ambiguous - assume DD/MM/YY based on user's locale showing AU
      const day = mdy[1].padStart(2, '0');
      const month = mdy[2].padStart(2, '0');
      let year = mdy[3];
      if (year.length === 2) {
        year = parseInt(year, 10) + 2000;
      }
      return `${year}-${month}-${day}`;
    }

    // Try to parse with Date constructor as fallback
    try {
      const parsed = new Date(cleaned);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    } catch (e) {
      console.warn('[Netflix Exporter] Could not parse date:', cleaned);
    }

    // Return today's date as fallback
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Extract Netflix title ID from href
   */
  function extractNetflixId(href) {
    if (!href) return '';
    const match = href.match(/\/title\/(\d+)/);
    return match ? match[1] : '';
  }

  /**
   * Collect all visible watch history items from the page
   */
  function collectVisibleItems() {
    const items = [];
    const rows = document.querySelectorAll(SELECTORS.row);

    console.log(`[Netflix Exporter] Found ${rows.length} rows on page`);

    for (const row of rows) {
      try {
        // Get date
        const dateEl = row.querySelector(SELECTORS.date);
        const dateStr = dateEl?.textContent?.trim() || '';
        const dateWatched = parseNetflixDate(dateStr);

        // Get title and link
        const titleLink = row.querySelector(SELECTORS.titleLink);
        const fullTitle = titleLink?.textContent?.trim() || '';
        const href = titleLink?.getAttribute('href') || '';
        const netflixId = extractNetflixId(href);

        if (!fullTitle) continue;

        // Parse the title
        const parsed = parseNetflixTitle(fullTitle);

        items.push({
          dateWatched,
          type: parsed.type,
          title: parsed.title,
          episodeTitle: parsed.episodeTitle || '',
          season: parsed.season,
          netflixId,
          rawTitle: fullTitle,
        });
      } catch (e) {
        console.error('[Netflix Exporter] Error processing row:', e);
      }
    }

    return items;
  }

  /**
   * Find the "Show more" button
   */
  function findShowMoreButton() {
    // Try primary selector
    let btn = document.querySelector(SELECTORS.showMore);
    if (btn && btn.textContent?.toLowerCase().includes('show more')) {
      return btn;
    }

    // Try alternative selector
    btn = document.querySelector(SELECTORS.showMoreAlt);
    if (btn) return btn;

    // Search by text content
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
      if (button.textContent?.toLowerCase().includes('show more')) {
        return button;
      }
    }

    return null;
  }

  /**
   * Check if we've reached items older than the start date
   */
  function hasReachedStartDate(startDate) {
    if (!startDate) return false;

    const rows = document.querySelectorAll(SELECTORS.row);
    if (rows.length === 0) return false;

    // Check the last row's date
    const lastRow = rows[rows.length - 1];
    const dateEl = lastRow.querySelector(SELECTORS.date);
    const dateStr = dateEl?.textContent?.trim();

    if (!dateStr) return false;

    const itemDate = parseNetflixDate(dateStr);
    return itemDate < startDate;
  }

  /**
   * Load all watch history by clicking "Show more" repeatedly
   */
  async function loadAllHistory(startDate = null) {
    const maxClicks = 100; // Safety limit
    const delayBetweenClicks = 1500; // ms
    let clicks = 0;
    let lastRowCount = 0;
    let noChangeCount = 0;

    console.log('[Netflix Exporter] Starting to load full history...');
    if (startDate) {
      console.log(`[Netflix Exporter] Will stop at date: ${startDate}`);
    }

    while (clicks < maxClicks) {
      // Check if we've reached the start date
      if (startDate && hasReachedStartDate(startDate)) {
        console.log('[Netflix Exporter] Reached start date, stopping');
        break;
      }

      const showMoreBtn = findShowMoreButton();
      if (!showMoreBtn) {
        console.log('[Netflix Exporter] No more "Show more" button found');
        break;
      }

      // Check if button is visible and enabled
      const rect = showMoreBtn.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.log('[Netflix Exporter] Show more button not visible');
        break;
      }

      // Click the button
      showMoreBtn.click();
      clicks++;
      console.log(`[Netflix Exporter] Clicked "Show more" (${clicks})`);

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, delayBetweenClicks));

      // Check if new content was loaded
      const currentRowCount = document.querySelectorAll(SELECTORS.row).length;
      if (currentRowCount === lastRowCount) {
        noChangeCount++;
        if (noChangeCount >= 3) {
          console.log('[Netflix Exporter] No new content after 3 clicks, stopping');
          break;
        }
      } else {
        noChangeCount = 0;
        lastRowCount = currentRowCount;
      }
    }

    console.log(`[Netflix Exporter] Finished loading. Total clicks: ${clicks}`);
    return collectVisibleItems();
  }

  /**
   * Main collection function called from popup
   */
  async function collectWatchHistory(options = {}) {
    const { startDate } = options;

    console.log('[Netflix Exporter] collectWatchHistory called with options:', options);

    try {
      // Load all history (with optional date limit)
      const items = await loadAllHistory(startDate);

      console.log(`[Netflix Exporter] Collected ${items.length} items`);

      return {
        success: true,
        items,
        count: items.length,
      };
    } catch (error) {
      console.error('[Netflix Exporter] Collection error:', error);
      return {
        success: false,
        error: error.message || 'Failed to collect watch history',
        items: [],
      };
    }
  }

  /**
   * Quick scan - just collect what's visible without loading more
   */
  function quickScan() {
    const items = collectVisibleItems();
    return {
      success: true,
      items,
      count: items.length,
      isPartial: true,
    };
  }

  /**
   * Message listener for popup communication
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Netflix Exporter] Received message:', message);

    if (message.action === 'ping') {
      sendResponse({ ready: true, url: window.location.href });
      return true;
    }

    if (message.action === 'collectHistory') {
      // Handle async collection
      collectWatchHistory({
        startDate: message.startDate,
      }).then(result => {
        sendResponse(result);
      }).catch(error => {
        sendResponse({
          success: false,
          error: error.message || 'Collection failed',
          items: [],
        });
      });
      return true; // Keep channel open for async response
    }

    if (message.action === 'quickScan') {
      const result = quickScan();
      sendResponse(result);
      return true;
    }

    if (message.action === 'getPageInfo') {
      sendResponse({
        url: window.location.href,
        title: document.title,
        rowCount: document.querySelectorAll(SELECTORS.row).length,
      });
      return true;
    }

    return false;
  });

  // Notify that script is ready
  console.log('[Netflix Exporter] Content script ready');
})();
