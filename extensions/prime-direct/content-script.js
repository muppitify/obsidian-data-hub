/**
 * Prime Video Watch History Exporter - Content Script
 * 
 * Runs on Prime Video watch history pages to extract viewing data.
 * Communicates with popup for Obsidian import.
 */

(() => {
  'use strict';

  // Prevent multiple injections
  if (window.__primeHistoryExporterLoaded) {
    return;
  }
  window.__primeHistoryExporterLoaded = true;

  /** Locale-specific strings */
  const MSG = {
    column: {
      dateWatched: 'Date Watched',
      type: 'Type',
      title: 'Title',
      episodeTitle: 'Episode Title',
      gti: 'Global Title Identifier',
      path: 'Path',
      imageUrl: 'Image URL',
    },
    value: {
      movie: 'Movie',
      series: 'Series',
    },
  };

  /**
   * Decode HTML entities in a string (e.g., "&#34;", "&quot;")
   */
  const decodeHtmlEntities = (() => {
    const domParser = new DOMParser();
    return (str) => {
      if (!str) return '';
      try {
        return domParser.parseFromString(str, 'text/html').documentElement.textContent || '';
      } catch {
        return str;
      }
    };
  })();

  /**
   * Format epoch milliseconds as "yyyy-mm-dd hh:mm:ss.sss"
   */
  const toDateTimeString = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toISOString().slice(0, -1).split('T').join(' ');
    } catch {
      return String(ts);
    }
  };

  /**
   * Process watch history items from a date section
   */
  const processWatchHistoryItems = (dateSections) => {
    const items = [];

    for (const dateSection of dateSections) {
      if (!dateSection?.titles) continue;

      for (const item of dateSection.titles) {
        const title = decodeHtmlEntities(item?.title?.text);
        const id = item?.gti || '';
        const path = item?.title?.href || '';
        const imageUrl = item?.imageSrc || '';

        // Check if this is a series with episodes
        if (Array.isArray(item.children) && item.children.length > 0) {
          const type = MSG.value.series;

          for (const episode of item.children) {
            const episodeTitle = decodeHtmlEntities(episode?.title?.text);

            items.push({
              dateWatched: toDateTimeString(episode?.time),
              type,
              title,
              episodeTitle,
              id,
              episodeId: episode?.gti || '',
              path,
              episodePath: episode?.title?.href || '',
              imageUrl,
            });
          }
        } else {
          // It's a movie
          items.push({
            dateWatched: toDateTimeString(item?.time),
            type: MSG.value.movie,
            title,
            episodeTitle: '',
            id,
            episodeId: '',
            path,
            episodePath: '',
            imageUrl,
          });
        }
      }
    }

    return items;
  };

  /**
   * Extract watch history from a potential response object
   */
  const extractFromResponse = (obj) => {
    const widgets = obj?.widgets;
    if (!Array.isArray(widgets)) return [];

    let allItems = [];

    for (const widget of widgets) {
      if (widget?.widgetType !== 'watch-history') continue;

      const dateSections = widget?.content?.content?.titles;
      if (Array.isArray(dateSections)) {
        allItems = allItems.concat(processWatchHistoryItems(dateSections));
      }
    }

    return allItems;
  };

  /**
   * Find inline watch history data from script tags
   */
  const findInlineWatchHistory = () => {
    console.log('[Prime Exporter] Searching for inline watch history data...');

    const scripts = Array.from(document.body.querySelectorAll('script[type="text/template"]'));
    let allItems = [];

    for (const script of scripts) {
      try {
        const obj = JSON.parse(script.textContent.trim());
        const items = extractFromResponse(obj?.props);

        if (items.length > 0) {
          allItems = allItems.concat(items);
          console.log(`[Prime Exporter] Found ${items.length} items in inline data`);
        }
      } catch (e) {
        // Not valid JSON or wrong format, skip
      }
    }

    return allItems;
  };

  /**
   * Search ALL script tags for any JSON containing watch history data
   * This runs after scrolling to find any newly loaded data
   */
  const searchAllScriptsForData = () => {
    console.log('[Prime Exporter] Searching all scripts for watch history data...');
    let allItems = [];
    
    // Check all script tags
    const allScripts = document.querySelectorAll('script');
    let scriptsChecked = 0;
    let dataFound = 0;
    
    for (const script of allScripts) {
      const content = script.textContent || '';
      if (!content || content.length < 100) continue;
      
      scriptsChecked++;
      
      // Try to parse as JSON directly
      try {
        const obj = JSON.parse(content.trim());
        const items = extractFromResponse(obj?.props || obj);
        if (items.length > 0) {
          allItems = allItems.concat(items);
          dataFound += items.length;
        }
      } catch {
        // Not direct JSON, try to find JSON objects in the content
      }
      
      // Look for embedded JSON patterns like: {"widgets":[ or "watch-history"
      if (content.includes('watch-history') || content.includes('widgetType')) {
        // Try to extract JSON from the script
        const jsonMatches = content.match(/\{[\s\S]*"widgets"[\s\S]*\}/g);
        if (jsonMatches) {
          for (const match of jsonMatches) {
            try {
              const obj = JSON.parse(match);
              const items = extractFromResponse(obj);
              if (items.length > 0) {
                allItems = allItems.concat(items);
                dataFound += items.length;
                console.log(`[Prime Exporter] Found ${items.length} items in embedded JSON`);
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
    }
    
    // Also check for __NEXT_DATA__, __NUXT__, or window state
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
      try {
        const obj = JSON.parse(nextData.textContent);
        console.log('[Prime Exporter] Found __NEXT_DATA__, searching for watch history...');
        const items = searchObjectForWatchHistory(obj);
        if (items.length > 0) {
          allItems = allItems.concat(items);
          dataFound += items.length;
        }
      } catch (e) {
        console.log('[Prime Exporter] Could not parse __NEXT_DATA__');
      }
    }
    
    console.log(`[Prime Exporter] Searched ${scriptsChecked} scripts, found ${dataFound} additional items`);
    return allItems;
  };

  /**
   * Recursively search an object for watch history data
   */
  const searchObjectForWatchHistory = (obj, depth = 0) => {
    if (depth > 10 || !obj || typeof obj !== 'object') return [];
    
    let items = [];
    
    // Check if this object has watch history structure
    if (obj.widgetType === 'watch-history' && obj.content?.content?.titles) {
      const found = processWatchHistoryItems(obj.content.content.titles);
      if (found.length > 0) {
        console.log(`[Prime Exporter] Found ${found.length} items in nested object`);
        return found;
      }
    }
    
    // Check for titles array directly
    if (Array.isArray(obj.titles) && obj.titles[0]?.title) {
      const found = processWatchHistoryItems([{ titles: obj.titles }]);
      if (found.length > 0) return found;
    }
    
    // Recursively search arrays and objects
    if (Array.isArray(obj)) {
      for (const item of obj) {
        items = items.concat(searchObjectForWatchHistory(item, depth + 1));
      }
    } else {
      for (const key of Object.keys(obj)) {
        items = items.concat(searchObjectForWatchHistory(obj[key], depth + 1));
      }
    }
    
    return items;
  };

  /**
   * Collected items from intercepted fetch responses (stored in window for page script access)
   */
  window.__primeExporterFetchedItems = window.__primeExporterFetchedItems || [];

  /**
   * Inject a script into the page context to intercept fetch and XHR calls
   * Content scripts can't intercept page's network calls, so we inject into the actual page
   */
  const injectFetchInterceptor = () => {
    if (document.getElementById('prime-exporter-fetch-interceptor')) {
      console.log('[Prime Exporter] Network interceptor already injected');
      return;
    }

    const script = document.createElement('script');
    script.id = 'prime-exporter-fetch-interceptor';
    script.textContent = `
      (function() {
        if (window.__primeExporterFetchPatched) return;
        window.__primeExporterFetchPatched = true;
        window.__primeExporterFetchedItems = window.__primeExporterFetchedItems || [];
        
        // Helper to extract watch history from response data
        function extractWatchHistory(data) {
          try {
            const obj = typeof data === 'string' ? JSON.parse(data) : data;
            const widgets = obj?.widgets;
            
            if (Array.isArray(widgets)) {
              for (const widget of widgets) {
                if (widget?.widgetType === 'watch-history') {
                  const dateSections = widget?.content?.content?.titles;
                  if (Array.isArray(dateSections)) {
                    console.log('[Prime Exporter Page] Found ' + dateSections.length + ' date sections in response');
                    window.__primeExporterFetchedItems.push(...dateSections);
                    return true;
                  }
                }
              }
            }
            
            // Also check for direct titles array
            if (obj?.content?.content?.titles) {
              const dateSections = obj.content.content.titles;
              if (Array.isArray(dateSections)) {
                console.log('[Prime Exporter Page] Found ' + dateSections.length + ' date sections (direct)');
                window.__primeExporterFetchedItems.push(...dateSections);
                return true;
              }
            }
          } catch (e) {
            // Not valid JSON
          }
          return false;
        }
        
        // Intercept fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
          const response = await originalFetch.apply(this, args);
          
          try {
            const clonedResponse = response.clone();
            const contentType = clonedResponse.headers?.get?.('content-type') || '';
            
            // Log API calls for debugging
            if (url.includes('api') || url.includes('graphql') || url.includes('widget')) {
              console.log('[Prime Exporter Page] Fetch intercepted:', url.substring(0, 100), 'Type:', contentType);
            }
            
            if (contentType.includes('application/json') || contentType.includes('text/plain')) {
              const body = await clonedResponse.text();
              if (extractWatchHistory(body)) {
                console.log('[Prime Exporter Page] Extracted watch history from fetch:', url.substring(0, 80));
              }
            }
          } catch (e) {
            // Ignore errors
          }
          
          return response;
        };
        
        // Intercept XMLHttpRequest
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this._primeExporterUrl = url;
          return originalXHROpen.apply(this, [method, url, ...rest]);
        };
        
        XMLHttpRequest.prototype.send = function(...args) {
          this.addEventListener('load', function() {
            try {
              const url = this._primeExporterUrl || '';
              const contentType = this.getResponseHeader('content-type') || '';
              
              // Log API calls for debugging
              if (url.includes('api') || url.includes('graphql') || url.includes('widget')) {
                console.log('[Prime Exporter Page] XHR intercepted:', url.substring(0, 100), 'Type:', contentType);
              }
              
              if (contentType.includes('application/json') || contentType.includes('text/plain')) {
                if (extractWatchHistory(this.responseText)) {
                  console.log('[Prime Exporter Page] Captured data from XHR: ' + url.substring(0, 80));
                }
              }
            } catch (e) {
              // Ignore errors
            }
          });
          return originalXHRSend.apply(this, args);
        };
        
        console.log('[Prime Exporter Page] Fetch + XHR interceptors installed in page context');
      })();
    `;
    
    (document.head || document.documentElement).appendChild(script);
    console.log('[Prime Exporter] Network interceptor injected into page');
  };

  /**
   * Get fetched items from the page context
   */
  const getFetchedItems = () => {
    const dateSections = window.__primeExporterFetchedItems || [];
    if (dateSections.length === 0) return [];
    
    console.log(`[Prime Exporter] Processing ${dateSections.length} fetched date sections`);
    return processWatchHistoryItems(dateSections);
  };

  /**
   * Fallback: Parse items directly from the visible DOM
   * This works even if fetch interception fails
   */
  const parseItemsFromDOM = () => {
    console.log('[Prime Exporter] Attempting to parse items from DOM...');
    const items = [];
    
    // Find all date sections in the watch history
    const dateSections = document.querySelectorAll('[data-automation-id^="wh-date"]');
    console.log(`[Prime Exporter] Found ${dateSections.length} date sections in DOM`);
    
    // Log the first section structure to help debug
    if (dateSections.length > 0) {
      console.log('[Prime Exporter] First date section HTML sample:', dateSections[0].outerHTML.substring(0, 500));
    }
    
    for (const section of dateSections) {
      // Try to get the date from the section - it's in the automation-id like "wh-date-January 11, 2026"
      const sectionId = section.getAttribute('data-automation-id') || '';
      let dateText = '';
      
      // Extract date from automation-id (format: "wh-date-January 11, 2026")
      const dateMatch = sectionId.match(/wh-date-(.+)/);
      if (dateMatch) {
        dateText = dateMatch[1]; // e.g., "January 11, 2026"
      }
      
      // Also try to find a visible date header
      const dateHeader = section.querySelector('h3, h2, [class*="date"], [class*="Date"]');
      if (dateHeader && dateHeader.textContent) {
        dateText = dateHeader.textContent.trim() || dateText;
      }
      
      // Convert text date to ISO-ish format if possible
      if (dateText && !dateText.match(/^\d{4}-\d{2}-\d{2}/)) {
        try {
          const parsed = new Date(dateText);
          if (!isNaN(parsed.getTime())) {
            dateText = parsed.toISOString().split('T')[0]; // YYYY-MM-DD
          }
        } catch (e) {
          // Keep original date text
        }
      }
      
      // Find items - try multiple possible selectors
      const itemSelectors = [
        '[data-automation-id*="title"]',
        '[data-automation-id*="item"]',
        'article',
        '[class*="item"]',
        'a[href*="/detail/"]',
        'li',
      ];
      
      let itemElements = [];
      for (const selector of itemSelectors) {
        const found = section.querySelectorAll(selector);
        if (found.length > 0) {
          itemElements = found;
          console.log(`[Prime Exporter] Found ${found.length} items using selector: ${selector}`);
          break;
        }
      }
      
      // If no items found via selectors, look for links directly
      if (itemElements.length === 0) {
        itemElements = section.querySelectorAll('a[href*="/detail/"]');
      }
      
      for (const itemEl of itemElements) {
        try {
          // Get title - could be the link text or a child element
          let title = '';
          let path = '';
          let imageUrl = '';
          let episodeTitle = '';
          
          // If the element is a link itself
          if (itemEl.tagName === 'A') {
            title = itemEl.textContent?.trim() || '';
            path = itemEl.getAttribute('href') || '';
          } else {
            // Find the link inside
            const titleLink = itemEl.querySelector('a[href*="/detail/"]');
            if (titleLink) {
              title = titleLink.textContent?.trim() || '';
              path = titleLink.getAttribute('href') || '';
            }
          }
          
          // Try to find image
          const imageEl = itemEl.querySelector('img') || itemEl.closest('article')?.querySelector('img');
          if (imageEl) {
            imageUrl = imageEl.src || imageEl.getAttribute('data-src') || '';
          }
          
          // Skip if no title or it's a "Delete" link
          if (!title || title.includes('Delete') || title.includes('delete')) {
            continue;
          }
          
          // Check if this might be an episode (has episode-like text)
          const hasEpisode = /episode|ep\.|s\d+e\d+/i.test(title);
          
          items.push({
            dateWatched: dateText,
            type: hasEpisode ? MSG.value.series : MSG.value.movie,
            title: decodeHtmlEntities(title),
            episodeTitle: episodeTitle,
            id: path.split('/detail/')[1]?.split('/')[0] || '',
            episodeId: '',
            path,
            episodePath: '',
            imageUrl,
          });
        } catch (e) {
          console.warn('[Prime Exporter] Error parsing DOM item:', e);
        }
      }
    }
    
    // Also try finding items outside of date sections (some pages structure differently)
    if (items.length === 0) {
      console.log('[Prime Exporter] No items in date sections, trying alternative approach...');
      
      // The date sections are just headers - items follow them as siblings
      // Try to associate items with their preceding date header
      let currentDate = '';
      const historyContainer = document.querySelector('[data-automation-id="activity-history-items"]') || document.body;
      
      // Walk through all elements looking for date headers and items
      const allDateHeaders = historyContainer.querySelectorAll('[data-automation-id^="wh-date"]');
      console.log(`[Prime Exporter] Found ${allDateHeaders.length} date headers`);
      
      for (const dateHeader of allDateHeaders) {
        // Extract date from this header
        const sectionId = dateHeader.getAttribute('data-automation-id') || '';
        const dateMatch = sectionId.match(/wh-date-(.+)/);
        let dateText = dateMatch ? dateMatch[1] : '';
        
        // Convert to ISO format
        if (dateText && !dateText.match(/^\d{4}-\d{2}-\d{2}/)) {
          try {
            const parsed = new Date(dateText);
            if (!isNaN(parsed.getTime())) {
              dateText = parsed.toISOString().split('T')[0];
            }
          } catch (e) {}
        }
        
        // Find items that follow this date header (look at siblings and their children)
        let sibling = dateHeader.nextElementSibling;
        let itemsInSection = 0;
        
        // Collect all content between this date header and the next
        let sectionContent = [];
        while (sibling && !sibling.matches('[data-automation-id^="wh-date"]')) {
          sectionContent.push(sibling);
          sibling = sibling.nextElementSibling;
        }
        
        // Get full text of section to find all episodes
        const sectionText = sectionContent.map(el => el.innerText || '').join('\n');
        
        // Find all episode entries in this section
        const allEpisodeMatches = sectionText.match(/Episode\s+\d+:?\s*[^\n]+/gi) || [];
        const episodeTextsInSection = allEpisodeMatches
          .map(m => m.trim())
          .filter(m => m && !m.includes('Delete') && m.length > 5);
        
        // Find all show/movie links in this section
        const processedShows = new Set();
        
        for (const el of sectionContent) {
          const links = el.querySelectorAll('a[href*="/detail/"]');
          
          for (const link of links) {
            const title = link.textContent?.trim();
            const path = link.getAttribute('href');
            
            // Skip navigation/delete links
            if (!title || title.includes('Delete') || title.length < 2) continue;
            
            // Skip if we already processed this show (to avoid duplicates within same date)
            const showKey = title + '|' + path;
            if (processedShows.has(showKey)) continue;
            processedShows.add(showKey);
            
            // Find the item's container - go up to find the card/row for this item
            let itemContainer = link.closest('[class*="card"]') || 
                               link.closest('[class*="item"]') || 
                               link.closest('article') ||
                               link.closest('[data-automation-id]');
            
            // If no container found, try to find a reasonable parent
            if (!itemContainer) {
              let parent = link.parentElement;
              for (let i = 0; i < 8 && parent; i++) {
                // Stop if we hit the date section boundary
                if (parent.matches && parent.matches('[data-automation-id^="wh-date"]')) break;
                // Look for a container that has both the image and the title
                if (parent.querySelector('img') && parent.querySelector('a[href*="/detail/"]')) {
                  itemContainer = parent;
                  break;
                }
                parent = parent.parentElement;
              }
            }
            
            // Default to the direct parent if nothing found
            if (!itemContainer) itemContainer = link.parentElement?.parentElement || link.parentElement;
            
            // Try to find image within the container
            let imageUrl = '';
            const img = itemContainer?.querySelector('img');
            if (img) {
              imageUrl = img.src || img.getAttribute('data-src') || '';
            }
            
            // Detect type by looking at the "Delete" link text within this container
            const containerText = itemContainer?.innerText || '';
            const isMovie = containerText.includes('Delete movie') || 
                           containerText.includes('delete movie');
            const hasEpisodesWatched = containerText.includes('Episodes watched');
            
            // Find episodes ONLY within this item's container
            const showEpisodes = [];
            if (hasEpisodesWatched && itemContainer) {
              // Look for episode text only within this container
              const episodeMatches = containerText.match(/Episode\s+\d+:?\s*[^\n]+/gi) || [];
              for (const epMatch of episodeMatches) {
                const epText = epMatch.trim();
                if (epText && !epText.includes('Delete') && epText.length > 5) {
                  showEpisodes.push(epText);
                }
              }
            }
            
            // Determine type: Movie if "Delete movie" found, Series if has episodes or title suggests it
            let type = MSG.value.movie;
            if (isMovie) {
              type = MSG.value.movie;
            } else if (hasEpisodesWatched || showEpisodes.length > 0 || /season|s\d+|series/i.test(title)) {
              type = MSG.value.series;
            }
            
            // If we found individual episodes, add each one separately
            if (showEpisodes.length > 0) {
              for (const epTitle of showEpisodes) {
                items.push({
                  dateWatched: dateText,
                  type: MSG.value.series,
                  title: decodeHtmlEntities(title),
                  episodeTitle: decodeHtmlEntities(epTitle),
                  id: path?.split('/detail/')[1]?.split('/')[0] || '',
                  episodeId: '',
                  path: path || '',
                  episodePath: '',
                  imageUrl,
                });
                itemsInSection++;
              }
            } else {
              // No episodes found, add the item as-is
              items.push({
                dateWatched: dateText,
                type,
                title: decodeHtmlEntities(title),
                episodeTitle: '',
                id: path?.split('/detail/')[1]?.split('/')[0] || '',
                episodeId: '',
                path: path || '',
                episodePath: '',
                imageUrl,
              });
              itemsInSection++;
            }
          }
        }
      }
      
      console.log(`[Prime Exporter] Found ${items.length} items associated with date headers`);
      
      // If still no items, fall back to finding all links
      if (items.length === 0) {
        console.log('[Prime Exporter] Falling back to all detail links...');
        const allLinks = document.querySelectorAll('a[href*="/detail/"]');
        console.log(`[Prime Exporter] Found ${allLinks.length} detail links on page`);
        
        for (const link of allLinks) {
          const title = link.textContent?.trim();
          const path = link.getAttribute('href');
          
          // Skip navigation/delete links
          if (!title || title.includes('Delete') || title.length < 2) continue;
          
          // Try to find image
          let imageUrl = '';
          let searchEl = link;
          for (let i = 0; i < 5 && searchEl && !imageUrl; i++) {
            const img = searchEl.querySelector('img');
            if (img) {
              imageUrl = img.src || img.getAttribute('data-src') || '';
            }
            searchEl = searchEl.parentElement;
          }
          
          // Find the container for this item to check for episodes
          const itemContainer = link.closest('[class*="item"]') || link.closest('article') || link.closest('div');
          
          // Look for episode entries
          const episodeTexts = [];
          if (itemContainer) {
            const allText = itemContainer.innerText || '';
            const episodeMatches = allText.match(/Episode\s+\d+[^]*?(?=Episode\s+\d+|$)/gi);
            
            if (episodeMatches && episodeMatches.length > 0) {
              for (const epMatch of episodeMatches) {
                const epText = epMatch.trim();
                if (epText && !epText.includes('Delete') && epText.length > 5) {
                  episodeTexts.push(epText.split('\n')[0].trim());
                }
              }
            }
          }
          
          // Detect type based on title patterns
          const isSeries = /season|s\d+|series|episode/i.test(title) || episodeTexts.length > 0;
          const type = isSeries ? MSG.value.series : MSG.value.movie;
          
          // If we found individual episodes, add each one separately
          if (episodeTexts.length > 0) {
            for (const epTitle of episodeTexts) {
              items.push({
                dateWatched: '',
                type: MSG.value.series,
                title: decodeHtmlEntities(title),
                episodeTitle: decodeHtmlEntities(epTitle),
                id: path?.split('/detail/')[1]?.split('/')[0] || '',
                episodeId: '',
                path: path || '',
                episodePath: '',
                imageUrl,
              });
            }
          } else {
            items.push({
              dateWatched: '',
              type,
              title: decodeHtmlEntities(title),
              episodeTitle: '',
              id: path?.split('/detail/')[1]?.split('/')[0] || '',
              episodeId: '',
              path: path || '',
              episodePath: '',
              imageUrl,
            });
          }
        }
      }
    }
    
    console.log(`[Prime Exporter] Parsed ${items.length} items from DOM`);
    return items;
  };

  /**
   * Expand all "Episodes watched" dropdowns to reveal episode details
   * Only expands collapsed sections - won't close already-expanded ones
   */
  const expandAllEpisodes = async () => {
    console.log('[Prime Exporter] Expanding collapsed episode dropdowns...');
    
    let expanded = 0;
    
    // Find elements with "Episodes watched" text
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      
      // Match "Episodes watched" but not if it already shows episode content
      if (text === 'Episodes watched' || text.match(/^Episodes watched\s*$/)) {
        // Find the clickable parent
        const clickable = el.closest('button') || el.closest('[role="button"]') || el.closest('[class*="expand"]') || el;
        
        // Check if already expanded
        const isExpanded = clickable.getAttribute('aria-expanded') === 'true';
        const hasExpandedClass = clickable.className?.includes('expanded');
        
        // Only click if collapsed
        if (!isExpanded && !hasExpandedClass && !clickable.dataset.primeExporterExpanded) {
          try {
            clickable.click();
            clickable.dataset.primeExporterExpanded = 'true';
            expanded++;
          } catch (e) {
            // Ignore click errors
          }
        }
      }
    }
    
    // Also look for aria-expanded="false" elements (only expand, never collapse)
    const collapsedButtons = document.querySelectorAll('[aria-expanded="false"]');
    for (const btn of collapsedButtons) {
      // Only process if it looks like an episode toggle
      const text = btn.textContent?.toLowerCase() || '';
      const isEpisodeToggle = text.includes('episode') || text.includes('watched') || 
                               btn.closest('[class*="episode"]') || btn.closest('[data-automation-id*="episode"]');
      
      if (isEpisodeToggle && !btn.dataset.primeExporterExpanded) {
        try {
          btn.click();
          btn.dataset.primeExporterExpanded = 'true';
          expanded++;
        } catch (e) {
          // Ignore
        }
      }
    }
    
    if (expanded > 0) {
      console.log(`[Prime Exporter] Expanded ${expanded} episode sections`);
      // Wait for content to render
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      console.log('[Prime Exporter] No collapsed episode sections found (may already be expanded)');
    }
    
    return expanded;
  };

  /**
   * Parse a date string from date section (e.g., "January 11, 2026") to YYYY-MM-DD
   */
  const parseDateSectionToISO = (dateText) => {
    if (!dateText) return '';
    try {
      const parsed = new Date(dateText);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    } catch (e) {}
    return '';
  };

  /**
   * Get all date section dates currently visible on the page
   * Returns sorted array of dates (oldest to newest for comparison)
   */
  const getVisibleDateSections = () => {
    const dates = [];
    const dateSections = document.querySelectorAll('[data-automation-id^="wh-date"]');
    
    for (const section of dateSections) {
      const sectionId = section.getAttribute('data-automation-id') || '';
      const dateMatch = sectionId.match(/wh-date-(.+)/);
      if (dateMatch) {
        const isoDate = parseDateSectionToISO(dateMatch[1]);
        if (isoDate) {
          dates.push(isoDate);
        }
      }
    }
    
    return dates;
  };

  /**
   * Check if we've scrolled past the start date (found items older than our range)
   */
  const hasReachedStartDate = (startDate) => {
    if (!startDate) return false; // No start date = load all
    
    const visibleDates = getVisibleDateSections();
    if (visibleDates.length === 0) return false;
    
    // Find the oldest date currently visible
    const oldestVisible = visibleDates.sort()[0]; // Sort ascending, get first
    
    // If oldest visible date is before our start date, we've gone far enough
    if (oldestVisible < startDate) {
      console.log(`[Prime Exporter] Reached start date boundary: oldest visible ${oldestVisible} < start ${startDate}`);
      return true;
    }
    
    return false;
  };

  /**
   * Force load watch history by scrolling - stops when reaching start date
   * @param {string|null} startDate - Start date in YYYY-MM-DD format, or null for all
   */
  const forceLoadWatchHistory = (startDate = null) => {
    return new Promise((resolve) => {
      const mode = startDate ? `until ${startDate}` : 'all items';
      console.log(`[Prime Exporter] Scrolling to load ${mode}...`);

      let lastScrollHeight = 0;
      let noChangeCount = 0;
      const maxNoChange = 15; // Stop after 15 iterations with no change
      const maxScrollTime = 120000; // Maximum 2 minutes of scrolling
      const startTime = Date.now();
      let scrollCount = 0;

      const scrollInterval = setInterval(() => {
        scrollCount++;
        const currentHeight = document.body.scrollHeight;
        const elapsed = Date.now() - startTime;

        // Check for timeout
        if (elapsed > maxScrollTime) {
          clearInterval(scrollInterval);
          console.log(`[Prime Exporter] Timeout after ${Math.round(elapsed / 1000)}s, proceeding with collected data`);
          setTimeout(resolve, 1000);
          return;
        }

        // Check if we've reached the start date boundary
        if (startDate && hasReachedStartDate(startDate)) {
          clearInterval(scrollInterval);
          console.log(`[Prime Exporter] Reached start date ${startDate} after ${scrollCount} scrolls`);
          setTimeout(resolve, 2000);
          return;
        }

        // Check if there's a loading indicator - try multiple selectors
        const loadingIndicators = [
          'div[data-automation-id=activity-history-items] > div > noscript',
          '[data-automation-id="loading-spinner"]',
          '.loading-spinner',
          'noscript',
        ];
        
        let hasMoreToLoad = false;
        for (const selector of loadingIndicators) {
          const el = document.body.querySelector(selector);
          if (el && el.closest('[data-automation-id*="history"]')) {
            hasMoreToLoad = true;
            break;
          }
        }

        // Also check if we're still getting new content
        if (currentHeight === lastScrollHeight) {
          noChangeCount++;
        } else {
          noChangeCount = 0;
          lastScrollHeight = currentHeight;
        }

        // Log progress every 10 scrolls
        if (scrollCount % 10 === 0) {
          const visibleDates = getVisibleDateSections();
          const oldestVisible = visibleDates.sort()[0] || 'unknown';
          console.log(`[Prime Exporter] Scrolling... (${scrollCount} scrolls, ${Math.round(elapsed / 1000)}s elapsed, oldest: ${oldestVisible})`);
        }

        // Stop if no more content loading OR page height hasn't changed for a while
        if (noChangeCount >= maxNoChange) {
          clearInterval(scrollInterval);
          console.log(`[Prime Exporter] Finished loading after ${scrollCount} scrolls`);
          // Give time for final fetch responses to be processed
          setTimeout(resolve, 2000);
          return;
        }

        window.scrollTo(0, document.body.scrollHeight);
      }, 300); // Allow more time for content to load and fetch to complete
    });
  };

  /**
   * Deduplicate items - only remove TRUE duplicates (same title AND same episode AND same date)
   */
  const deduplicateItems = (items) => {
    const seen = new Map();
    const showsWithEpisodes = new Set(); // Track which shows have episode entries

    // Helper to calculate quality score - prefer items with more complete data
    const getScore = (item) => {
      let score = 0;
      // Strong preference for full timestamps (contains time, not just date)
      if (item.dateWatched?.includes(':')) score += 100;
      // Prefer proper Amazon GTI IDs
      if (item.id?.startsWith('amzn1.dv.gti')) score += 50;
      if (item.episodeId?.startsWith('amzn1.dv.gti')) score += 50;
      // Prefer items with episode details
      if (item.episodeTitle) score += 20;
      if (item.episodePath) score += 10;
      if (item.imageUrl) score += 5;
      return score;
    };

    // First pass: identify which shows have specific episode entries
    for (const item of items) {
      if (item.type === 'Series' && item.episodeTitle) {
        showsWithEpisodes.add((item.title || '').toLowerCase().trim());
      }
    }

    for (const item of items) {
      // Key based on title + episode title only (NOT date or ID)
      // This allows merging the same episode from different sources
      const key = [
        (item.title || '').toLowerCase().trim(),
        (item.episodeTitle || '').toLowerCase().trim(),
      ].join('|');

      // Skip series entries with no episode if we have episode entries for this show
      const titleLower = (item.title || '').toLowerCase().trim();
      if (item.type === 'Series' && !item.episodeTitle && showsWithEpisodes.has(titleLower)) {
        console.log(`[Prime Exporter] Skipping generic series entry for "${item.title}" (have specific episodes)`);
        continue;
      }

      if (!seen.has(key)) {
        seen.set(key, item);
      } else {
        // If we have a duplicate, prefer the one with better data
        const existing = seen.get(key);
        const existingScore = getScore(existing);
        const newScore = getScore(item);
        
        if (newScore > existingScore) {
          seen.set(key, item);
        }
      }
    }

    return Array.from(seen.values());
  };

  /**
   * Sort items by date (newest first)
   */
  const sortByDate = (items) => {
    return items.sort((a, b) => {
      const dateA = a.dateWatched || '';
      const dateB = b.dateWatched || '';
      return dateB.localeCompare(dateA);
    });
  };

  /**
   * Extract just the date portion (YYYY-MM-DD) from a date string
   */
  const toDateOnly = (dateStr) => {
    if (!dateStr) return '';
    // Handle "YYYY-MM-DD HH:MM:SS.sss" or "YYYY-MM-DD" formats
    return dateStr.substring(0, 10);
  };

  /**
   * Main export function - called by popup via message
   * @param {Object} options - Collection options
   * @param {string|null} options.startDate - Start date (YYYY-MM-DD) to stop scrolling at, or null for all
   */
  const collectWatchHistory = async (options = {}) => {
    const { startDate = null } = options;
    console.log('[Prime Exporter] Starting collection...', startDate ? `(from ${startDate})` : '(all history)');

    try {
      // Reset fetched items in page context
      window.__primeExporterFetchedItems = [];

      // Inject fetch interceptor into page context (must be done BEFORE scrolling)
      injectFetchInterceptor();
      
      // Small delay to ensure interceptor is ready
      await new Promise(resolve => setTimeout(resolve, 200));

      // Get inline data first
      console.log('[Prime Exporter] Looking for inline data...');
      const inlineItems = findInlineWatchHistory();
      console.log(`[Prime Exporter] Found ${inlineItems.length} inline items`);

      // Scroll to load items (stops at startDate if provided)
      console.log('[Prime Exporter] Starting scroll to load items...');
      await forceLoadWatchHistory(startDate);
      
      // Expand all episode dropdowns to reveal episode details
      await expandAllEpisodes();
      // Do it twice in case new content was loaded
      await expandAllEpisodes();
      
      // Get items captured by the fetch interceptor
      const fetchedItems = getFetchedItems();
      console.log(`[Prime Exporter] Scroll complete, fetched ${fetchedItems.length} additional items from ${window.__primeExporterFetchedItems?.length || 0} date sections`);

      // Search ALL scripts again for any newly loaded data
      const scriptItems = searchAllScriptsForData();
      console.log(`[Prime Exporter] Found ${scriptItems.length} items from script search`);

      // Combine all sources
      let allItems = [...inlineItems, ...fetchedItems, ...scriptItems];
      console.log(`[Prime Exporter] Total items from inline + fetch + scripts: ${allItems.length}`);
      
      // Fallback: If we didn't get many items from fetch, try parsing the DOM directly
      if (fetchedItems.length === 0) {
        console.log('[Prime Exporter] Fetch interception got 0 items, trying DOM fallback...');
        const domItems = parseItemsFromDOM();
        if (domItems.length > 0) {
          allItems = [...allItems, ...domItems];
          console.log(`[Prime Exporter] Added ${domItems.length} items from DOM fallback`);
        }
      }
      
      console.log(`[Prime Exporter] Total items before dedup: ${allItems.length}`);

      // Deduplicate and sort
      const uniqueItems = deduplicateItems(allItems);
      const sortedItems = sortByDate(uniqueItems);
      
      console.log(`[Prime Exporter] Deduplication removed ${allItems.length - uniqueItems.length} duplicates`);

      console.log(`[Prime Exporter] Collection complete: ${sortedItems.length} unique items`);

      if (sortedItems.length === 0) {
        console.warn('[Prime Exporter] No items found! Check if you are on the correct page and logged in.');
      }

      return sortedItems;
    } catch (error) {
      console.error('[Prime Exporter] Error in collectWatchHistory:', error);
      throw error;
    }
  };

  /**
   * Listen for messages from popup/service worker
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'collectHistory') {
      const startDate = message.startDate || null;
      console.log('[Prime Exporter] Received collectHistory request', startDate ? `(startDate: ${startDate})` : '(all)');
      
      // Wrap in try-catch for safety
      (async () => {
        try {
          const items = await collectWatchHistory({ startDate });
          console.log(`[Prime Exporter] Sending ${items.length} items back`);
          sendResponse({
            success: true,
            items,
            exportedAt: new Date().toISOString(),
          });
        } catch (error) {
          console.error('[Prime Exporter] Error during collection:', error);
          sendResponse({
            success: false,
            error: error.message || 'Unknown error during collection',
          });
        }
      })();

      // Return true to indicate async response
      return true;
    }

    if (message.action === 'ping') {
      console.log('[Prime Exporter] Ping received, responding ready');
      sendResponse({ ready: true });
      return false;
    }
  });

  console.log('[Prime Exporter] Content script loaded and ready');
})();
