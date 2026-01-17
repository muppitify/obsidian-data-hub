/**
 * Prime Video Watch History Exporter - Popup Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM elements
  const formatSelect = document.getElementById('format-select');
  const webhookEnabled = document.getElementById('webhook-enabled');
  const webhookOptions = document.getElementById('webhook-options');
  const webhookUrl = document.getElementById('webhook-url');
  const exportBtn = document.getElementById('export-btn');
  const btnText = exportBtn.querySelector('.btn-text');
  const btnSpinner = exportBtn.querySelector('.btn-spinner');
  const statusSection = document.getElementById('status-section');
  const statusMessage = document.getElementById('status-message');
  const pageCheck = document.getElementById('page-check');
  const resultsSection = document.getElementById('results-section');
  const resultsContent = document.getElementById('results-content');

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
   * Set loading state
   */
  function setLoading(loading) {
    exportBtn.disabled = loading;
    btnText.textContent = loading ? 'Exporting...' : 'Export Watch History';
    btnSpinner.classList.toggle('hidden', !loading);
  }

  /**
   * Show results
   */
  function showResults(results) {
    resultsSection.classList.remove('hidden');
    
    let html = '';
    
    if (results.items !== undefined) {
      html += `<p><strong>${results.items}</strong> items exported</p>`;
    }
    
    if (results.download) {
      if (results.download.success) {
        html += `<p class="success-text">✓ File downloaded: ${results.download.filename}</p>`;
      } else {
        html += `<p class="error-text">✗ Download failed: ${results.download.error}</p>`;
      }
    }
    
    if (results.webhook) {
      if (results.webhook.success) {
        html += `<p class="success-text">✓ Webhook sent successfully</p>`;
      } else {
        html += `<p class="error-text">✗ Webhook failed: ${results.webhook.error}</p>`;
      }
    }
    
    resultsContent.innerHTML = html;
  }

  /**
   * Check if current tab is a Prime Video page
   */
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || '';
      
      const isPrimePage = url.includes('primevideo.com/settings/watch-history') || 
                          (url.includes('amazon.com') && url.includes('watch-history'));
      
      if (!isPrimePage) {
        pageCheck.classList.remove('hidden');
        exportBtn.disabled = true;
        return false;
      }
      
      pageCheck.classList.add('hidden');
      return true;
    } catch (error) {
      console.error('Error checking tab:', error);
      return false;
    }
  }

  /**
   * Load saved settings
   */
  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      
      if (response?.success && response.settings) {
        const settings = response.settings;
        formatSelect.value = settings.outputFormat || 'json';
        webhookEnabled.checked = settings.webhookEnabled || false;
        webhookUrl.value = settings.webhookUrl || '';
        
        // Toggle webhook options visibility
        webhookOptions.classList.toggle('hidden', !settings.webhookEnabled);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /**
   * Save settings
   */
  async function saveSettings() {
    const settings = {
      outputFormat: formatSelect.value,
      webhookEnabled: webhookEnabled.checked,
      webhookUrl: webhookUrl.value.trim(),
    };
    
    try {
      await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  /**
   * Handle export button click
   */
  async function handleExport() {
    hideStatus();
    resultsSection.classList.add('hidden');
    setLoading(true);
    
    // Save current settings
    await saveSettings();
    
    showStatus('Collecting watch history... This may take a moment.', 'loading');
    
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab?.id) {
        throw new Error('No active tab found');
      }
      
      // Try to ping the content script
      let contentScriptReady = false;
      try {
        const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        contentScriptReady = pingResponse?.ready === true;
        console.log('[Prime Exporter Popup] Content script ready:', contentScriptReady);
      } catch {
        console.log('[Prime Exporter Popup] Content script not loaded, will inject');
      }
      
      // If content script not ready, inject it
      if (!contentScriptReady) {
        showStatus('Injecting script... Please wait.', 'loading');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js'],
          });
          // Wait a moment for script to initialize
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log('[Prime Exporter Popup] Content script injected');
        } catch (error) {
          console.error('[Prime Exporter Popup] Injection error:', error);
          throw new Error('Failed to inject content script. Please refresh the page and try again.');
        }
      }
      
      showStatus('Scrolling to load all history items... This may take 1-2 minutes.', 'loading');
      
      // Communicate DIRECTLY with content script (not via service worker)
      // This avoids message timeout issues
      console.log('[Prime Exporter Popup] Sending collectHistory request directly to content script');
      let historyResponse;
      try {
        historyResponse = await chrome.tabs.sendMessage(tab.id, { action: 'collectHistory' });
        console.log('[Prime Exporter Popup] Received history response:', historyResponse?.success, historyResponse?.items?.length);
      } catch (msgError) {
        console.error('[Prime Exporter Popup] Message error:', msgError);
        throw new Error('Communication error. Please refresh the page and try again.');
      }
      
      if (!historyResponse) {
        throw new Error('No response from content script. Please refresh the page and try again.');
      }
      
      if (!historyResponse.success) {
        throw new Error(historyResponse.error || 'Failed to collect history');
      }
      
      const { items, csv, exportedAt } = historyResponse;
      const results = { items: items.length, download: null, webhook: null };
      
      showStatus('Saving file...', 'loading');
      
      // Get settings for format
      const settingsResponse = await chrome.runtime.sendMessage({ action: 'getSettings' });
      const settings = settingsResponse?.settings || { outputFormat: 'json' };
      
      // Download file via service worker
      const data = settings.outputFormat === 'json' 
        ? JSON.stringify(items, null, 2) 
        : csv;
      
      const downloadResponse = await chrome.runtime.sendMessage({ 
        action: 'download', 
        data, 
        format: settings.outputFormat 
      });
      results.download = downloadResponse;
      
      // Post to webhook if enabled
      if (settings.webhookEnabled && settings.webhookUrl) {
        showStatus('Sending to webhook...', 'loading');
        const webhookResponse = await chrome.runtime.sendMessage({
          action: 'webhook',
          webhookUrl: settings.webhookUrl,
          items,
          exportedAt,
        });
        results.webhook = webhookResponse;
      }
      
      showStatus('Export completed!', 'success');
      showResults(results);
      
    } catch (error) {
      console.error('Export error:', error);
      showStatus(error.message || 'An error occurred', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Event listeners
  formatSelect.addEventListener('change', saveSettings);
  
  webhookEnabled.addEventListener('change', () => {
    webhookOptions.classList.toggle('hidden', !webhookEnabled.checked);
    saveSettings();
  });
  
  webhookUrl.addEventListener('blur', saveSettings);
  
  exportBtn.addEventListener('click', handleExport);

  // Initialize
  await loadSettings();
  await checkCurrentTab();
});
