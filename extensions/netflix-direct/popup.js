/**
 * Netflix Obsidian Importer - Popup Script
 * 
 * Handles UI interactions and communicates with Obsidian Local REST API
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM elements
  const apiUrlInput = document.getElementById('api-url');
  const apiKeyInput = document.getElementById('api-key');
  const quickAddChoiceInput = document.getElementById('quickadd-choice');
  const testConnectionBtn = document.getElementById('test-connection-btn');
  const connectionStatus = document.getElementById('connection-status');
  const dateFilterRadios = document.querySelectorAll('input[name="date-filter"]');
  const fromDateInput = document.getElementById('from-date');
  const rangeFromInput = document.getElementById('range-from');
  const rangeToInput = document.getElementById('range-to');
  const scanBtn = document.getElementById('scan-btn');
  const scanText = scanBtn?.querySelector('.scan-text');
  const scanSpinner = scanBtn?.querySelector('.scan-spinner');
  const importBtn = document.getElementById('import-btn');
  const btnText = importBtn.querySelector('.btn-text');
  const btnSpinner = importBtn.querySelector('.btn-spinner');
  const statusSection = document.getElementById('status-section');
  const statusMessage = document.getElementById('status-message');
  const pageCheck = document.getElementById('page-check');
  const previewSection = document.getElementById('preview-section');
  const previewContent = document.getElementById('preview-content');
  const resultsSection = document.getElementById('results-section');
  const resultsContent = document.getElementById('results-content');
  
  // State for scanned items
  let scannedItems = null;

  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  fromDateInput.value = oneYearAgo;
  rangeFromInput.value = oneYearAgo;
  rangeToInput.value = today;

  /**
   * Show status message
   */
  function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusSection.className = `status ${type}`;
    statusSection.classList.remove('hidden');
  }

  /**
   * Hide status
   */
  function hideStatus() {
    statusSection.classList.add('hidden');
  }

  /**
   * Set loading state for import
   */
  function setLoading(loading) {
    importBtn.disabled = loading;
    btnText.textContent = loading ? 'Importing...' : 'Import to Obsidian';
    btnSpinner.classList.toggle('hidden', !loading);
    testConnectionBtn.disabled = loading;
    if (scanBtn) scanBtn.disabled = loading;
  }

  /**
   * Set scanning state
   */
  function setScanning(scanning) {
    if (scanBtn) scanBtn.disabled = scanning;
    if (scanText) scanText.textContent = scanning ? 'Scanning...' : 'Scan Page';
    if (scanSpinner) scanSpinner.classList.toggle('hidden', !scanning);
    importBtn.disabled = scanning;
    testConnectionBtn.disabled = scanning;
  }

  /**
   * Show preview of scanned items
   */
  function showPreview(counts) {
    previewSection.classList.remove('hidden');
    
    let html = `<strong>${counts.total}</strong> items found on page`;
    if (counts.filtered !== counts.total) {
      html += `<br><strong>${counts.filtered}</strong> after date filter`;
    }
    if (counts.new !== undefined && counts.new !== counts.filtered) {
      html += `<br><strong>${counts.new}</strong> new (not in vault)`;
    }
    
    previewContent.innerHTML = html;
    
    // Enable import button if there are items to import
    if (counts.filtered > 0 || counts.new > 0) {
      importBtn.disabled = false;
    }
  }

  /**
   * Show results
   */
  function showResults(results) {
    resultsSection.classList.remove('hidden');
    
    let html = '';
    
    if (results.scraped !== undefined) {
      html += `<p><strong>${results.scraped}</strong> items scraped from Netflix</p>`;
    }
    
    if (results.filtered !== undefined) {
      html += `<p><strong>${results.filtered}</strong> items after date filtering</p>`;
    }
    
    if (results.new !== undefined) {
      html += `<p><strong>${results.new}</strong> new items (not in vault)</p>`;
    }
    
    if (results.imported !== undefined) {
      html += `<p class="success-text">✓ ${results.imported} items queued for import</p>`;
    }
    
    if (results.message) {
      html += `<p class="info-text">${results.message}</p>`;
    }
    
    if (results.error) {
      html += `<p class="error-text">✗ ${results.error}</p>`;
    }
    
    resultsContent.innerHTML = html;
  }

  /**
   * Check if current tab is a Netflix viewing activity page
   */
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || '';
      
      console.log('[Popup] Current URL:', url);
      
      // Check for Netflix viewing activity page
      const isNetflixPage = 
        url.includes('netflix.com') && url.includes('settings/viewed');
      
      console.log('[Popup] Is Netflix viewing activity page:', isNetflixPage);
      
      if (!isNetflixPage) {
        pageCheck.classList.remove('hidden');
        importBtn.disabled = true;
        if (scanBtn) scanBtn.disabled = true;
        return false;
      }
      
      pageCheck.classList.add('hidden');
      if (scanBtn) {
        scanBtn.disabled = false;
        console.log('[Popup] On Netflix page - scan button enabled');
      }
      return true;
    } catch (error) {
      console.error('Error checking tab:', error);
      if (scanBtn) scanBtn.disabled = true;
      return false;
    }
  }

  /**
   * Load saved settings
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get({
        obsidianApiUrl: 'https://127.0.0.1:27124',
        obsidianApiKey: '',
        quickAddChoiceName: 'Shows',
        dateFilterMode: 'all',
        dateFrom: oneYearAgo,
        dateTo: today,
      });
      
      apiUrlInput.value = result.obsidianApiUrl;
      apiKeyInput.value = result.obsidianApiKey;
      quickAddChoiceInput.value = result.quickAddChoiceName;
      
      // Set date filter radio
      const filterRadio = document.querySelector(`input[name="date-filter"][value="${result.dateFilterMode}"]`);
      if (filterRadio) {
        filterRadio.checked = true;
        updateDateInputStates();
      }
      
      fromDateInput.value = result.dateFrom || oneYearAgo;
      rangeFromInput.value = result.dateFrom || oneYearAgo;
      rangeToInput.value = result.dateTo || today;
      
      // Enable import button if we have an API key
      if (result.obsidianApiKey) {
        importBtn.disabled = false;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /**
   * Save settings
   */
  async function saveSettings() {
    const filterMode = document.querySelector('input[name="date-filter"]:checked')?.value || 'all';
    
    const settings = {
      obsidianApiUrl: apiUrlInput.value.trim(),
      obsidianApiKey: apiKeyInput.value.trim(),
      quickAddChoiceName: quickAddChoiceInput.value.trim() || 'Shows',
      dateFilterMode: filterMode,
      dateFrom: filterMode === 'from' ? fromDateInput.value : rangeFromInput.value,
      dateTo: rangeToInput.value,
    };
    
    try {
      await chrome.storage.sync.set(settings);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  /**
   * Update date input enabled states based on selected filter
   */
  function updateDateInputStates() {
    const filterMode = document.querySelector('input[name="date-filter"]:checked')?.value || 'all';
    
    fromDateInput.disabled = filterMode !== 'from';
    rangeFromInput.disabled = filterMode !== 'range';
    rangeToInput.disabled = filterMode !== 'range';
  }

  /**
   * Test connection to Obsidian
   */
  async function testConnection() {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiUrl) {
      connectionStatus.textContent = '✗ API URL required';
      connectionStatus.className = 'connection-status error';
      return false;
    }
    
    if (!apiKey) {
      connectionStatus.textContent = '✗ API key required';
      connectionStatus.className = 'connection-status error';
      return false;
    }
    
    connectionStatus.textContent = 'Testing...';
    connectionStatus.className = 'connection-status';
    
    const result = await ObsidianAPI.checkConnection(apiUrl, apiKey);
    
    if (result.ok) {
      connectionStatus.textContent = `✓ Connected to ${result.vaultName}`;
      connectionStatus.className = 'connection-status success';
      importBtn.disabled = false;
      await saveSettings();
      return true;
    } else {
      connectionStatus.textContent = `✗ ${result.error}`;
      connectionStatus.className = 'connection-status error';
      importBtn.disabled = true;
      return false;
    }
  }

  /**
   * Handle scan button click - preview items without importing
   */
  async function handleScan() {
    console.log('[Popup] Scan button clicked!');
    hideStatus();
    resultsSection.classList.add('hidden');
    previewSection.classList.add('hidden');
    setScanning(true);
    scannedItems = null;
    
    try {
      showStatus('Scanning page for viewing history...', 'loading');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      // Ping content script
      let contentScriptReady = false;
      try {
        const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        contentScriptReady = pingResponse?.ready === true;
      } catch {
        console.log('[Popup] Content script not loaded, will inject');
      }
      
      // Inject content script if needed
      if (!contentScriptReady) {
        showStatus('Preparing page...', 'loading');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js'],
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error('[Popup] Injection error:', error);
          throw new Error('Failed to prepare page. Please refresh and try again.');
        }
      }
      
      // Determine start date for scrolling optimization
      const filterMode = document.querySelector('input[name="date-filter"]:checked')?.value || 'all';
      let scrollStartDate = null;
      
      if (filterMode === 'from') {
        scrollStartDate = fromDateInput.value || null;
      } else if (filterMode === 'range') {
        scrollStartDate = rangeFromInput.value || null;
      }
      
      const statusMsg = scrollStartDate 
        ? `Clicking "Show more" to load items from ${scrollStartDate}...` 
        : 'Clicking "Show more" to load all items... This may take a minute.';
      showStatus(statusMsg, 'loading');
      
      // Collect history from content script with date filter
      let historyResponse;
      try {
        historyResponse = await chrome.tabs.sendMessage(tab.id, { 
          action: 'collectHistory',
          startDate: scrollStartDate
        });
      } catch (msgError) {
        console.error('[Popup] Message error:', msgError);
        throw new Error('Communication error. Please refresh the page and try again.');
      }
      
      if (!historyResponse?.success) {
        throw new Error(historyResponse?.error || 'Failed to collect history');
      }
      
      const allItems = historyResponse.items;
      console.log(`[Popup] Scanned ${allItems.length} items from Netflix`);
      
      // Apply date filter
      const fromDate = filterMode === 'from' ? fromDateInput.value : rangeFromInput.value;
      const toDate = rangeToInput.value;
      
      const filteredItems = ObsidianAPI.filterByDateRange(allItems, filterMode, fromDate, toDate);
      console.log(`[Popup] After date filter: ${filteredItems.length} items`);
      
      // Store for import
      scannedItems = filteredItems;
      
      // Check for existing entries if connected
      const apiUrl = apiUrlInput.value.trim();
      const apiKey = apiKeyInput.value.trim();
      
      let newCount = filteredItems.length;
      if (apiUrl && apiKey) {
        showStatus('Checking for existing entries...', 'loading');
        const existingResult = await ObsidianAPI.getExistingEntries(apiUrl, apiKey);
        if (existingResult.ok && existingResult.entries) {
          const newItems = ObsidianAPI.filterNewItems(filteredItems, existingResult.entries);
          newCount = newItems.length;
          scannedItems = newItems;
        }
      }
      
      hideStatus();
      showPreview({
        total: allItems.length,
        filtered: filteredItems.length,
        new: newCount,
      });
      
    } catch (error) {
      console.error('Scan error:', error);
      showStatus(error.message || 'An error occurred', 'error');
    } finally {
      setScanning(false);
    }
  }

  /**
   * Handle import button click
   */
  async function handleImport() {
    hideStatus();
    resultsSection.classList.add('hidden');
    setLoading(true);
    
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiUrl || !apiKey) {
      showStatus('Please configure Obsidian API settings first.', 'error');
      setLoading(false);
      return;
    }
    
    await saveSettings();
    
    try {
      // Step 1: Check Obsidian connection
      showStatus('Connecting to Obsidian...', 'loading');
      const connectionResult = await ObsidianAPI.checkConnection(apiUrl, apiKey);
      
      if (!connectionResult.ok) {
        showStatus(`Cannot connect to Obsidian: ${connectionResult.error}`, 'error');
        setLoading(false);
        return;
      }
      
      let newItems;
      const results = {};
      
      // Use already scanned items if available
      if (scannedItems && scannedItems.length > 0) {
        console.log(`[Popup] Using ${scannedItems.length} already scanned items`);
        newItems = scannedItems;
        results.new = scannedItems.length;
      } else {
        // Step 2: Get the active tab and collect history
        showStatus('Collecting viewing history from Netflix...', 'loading');
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab?.id) {
          throw new Error('No active tab found');
        }
        
        // Ping content script
        let contentScriptReady = false;
        try {
          const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
          contentScriptReady = pingResponse?.ready === true;
        } catch {
          console.log('[Popup] Content script not loaded, will inject');
        }
        
        // Inject content script if needed
        if (!contentScriptReady) {
          showStatus('Preparing page... Please wait.', 'loading');
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content-script.js'],
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error('[Popup] Injection error:', error);
            throw new Error('Failed to prepare page. Please refresh and try again.');
          }
        }
        
        // Determine start date for scrolling optimization
        const filterMode = document.querySelector('input[name="date-filter"]:checked')?.value || 'all';
        let scrollStartDate = null;
        
        if (filterMode === 'from') {
          scrollStartDate = fromDateInput.value || null;
        } else if (filterMode === 'range') {
          scrollStartDate = rangeFromInput.value || null;
        }
        
        const statusMsg = scrollStartDate 
          ? `Loading items from ${scrollStartDate}...` 
          : 'Loading all history items... This may take a minute.';
        showStatus(statusMsg, 'loading');
        
        // Collect history from content script
        let historyResponse;
        try {
          historyResponse = await chrome.tabs.sendMessage(tab.id, { 
            action: 'collectHistory',
            startDate: scrollStartDate
          });
        } catch (msgError) {
          console.error('[Popup] Message error:', msgError);
          throw new Error('Communication error. Please refresh the page and try again.');
        }
        
        if (!historyResponse?.success) {
          throw new Error(historyResponse?.error || 'Failed to collect history');
        }
        
        const allItems = historyResponse.items;
        results.scraped = allItems.length;
        
        console.log(`[Popup] Scraped ${allItems.length} items from Netflix`);
        
        // Step 3: Apply date filter
        showStatus('Applying date filter...', 'loading');
        const fromDate = filterMode === 'from' ? fromDateInput.value : rangeFromInput.value;
        const toDate = rangeToInput.value;
        
        const filteredItems = ObsidianAPI.filterByDateRange(allItems, filterMode, fromDate, toDate);
        results.filtered = filteredItems.length;
        
        console.log(`[Popup] After date filter: ${filteredItems.length} items`);
        
        // Step 4: Check for existing entries in vault
        showStatus('Checking for existing entries in vault...', 'loading');
        const existingResult = await ObsidianAPI.getExistingEntries(apiUrl, apiKey);
        
        newItems = filteredItems;
        if (existingResult.ok && existingResult.entries) {
          newItems = ObsidianAPI.filterNewItems(filteredItems, existingResult.entries);
          console.log(`[Popup] After duplicate filter: ${newItems.length} new items`);
        } else {
          console.log('[Popup] Could not check existing entries, proceeding with all items');
        }
        results.new = newItems.length;
      }
      
      // Step 5: Import to Obsidian
      if (newItems.length === 0) {
        showStatus('No new items to import!', 'success');
        showResults({
          ...results,
          message: 'All items are already in your vault or filtered out.',
        });
        setLoading(false);
        return;
      }
      
      showStatus(`Sending ${newItems.length} items to Obsidian...`, 'loading');
      const quickAddChoice = quickAddChoiceInput.value.trim() || 'Shows';
      const importResult = await ObsidianAPI.importItems(apiUrl, apiKey, newItems, quickAddChoice);
      
      if (!importResult.ok) {
        throw new Error(importResult.error);
      }
      
      results.imported = importResult.imported;
      results.message = importResult.message;
      
      showStatus('Import queued successfully!', 'success');
      showResults(results);
      
    } catch (error) {
      console.error('Import error:', error);
      showStatus(error.message || 'An error occurred', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Event listeners
  console.log('[Popup] Setting up event listeners...');
  testConnectionBtn.addEventListener('click', testConnection);
  if (scanBtn) {
    console.log('[Popup] scanBtn found, attaching listener');
    scanBtn.addEventListener('click', handleScan);
  } else {
    console.log('[Popup] scanBtn NOT found');
  }
  importBtn.addEventListener('click', handleImport);
  console.log('[Popup] Event listeners attached');
  
  apiUrlInput.addEventListener('blur', saveSettings);
  apiKeyInput.addEventListener('blur', () => {
    saveSettings();
    if (apiKeyInput.value.trim()) {
      importBtn.disabled = false;
    }
  });
  quickAddChoiceInput.addEventListener('blur', saveSettings);
  
  dateFilterRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      updateDateInputStates();
      saveSettings();
      scannedItems = null;
      previewSection.classList.add('hidden');
    });
  });
  
  fromDateInput.addEventListener('change', () => {
    saveSettings();
    scannedItems = null;
    previewSection.classList.add('hidden');
  });
  rangeFromInput.addEventListener('change', () => {
    saveSettings();
    scannedItems = null;
    previewSection.classList.add('hidden');
  });
  rangeToInput.addEventListener('change', () => {
    saveSettings();
    scannedItems = null;
    previewSection.classList.add('hidden');
  });

  // Initialize
  console.log('[Popup] Starting initialization...');
  await loadSettings();
  const isOnNetflixPage = await checkCurrentTab();
  console.log('[Popup] Is on Netflix page:', isOnNetflixPage);
  console.log('[Popup] Scan button disabled state:', scanBtn?.disabled);
  
  // Double-check scan button is enabled if on Netflix page
  if (isOnNetflixPage && scanBtn) {
    scanBtn.disabled = false;
    console.log('[Popup] Force-enabled scan button');
  }
  
  // Auto-test connection if we have credentials
  if (apiKeyInput.value.trim() && isOnNetflixPage) {
    testConnection();
  }
  
  console.log('[Popup] Initialization complete');
});
