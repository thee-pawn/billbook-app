/**
 * Initialization UI Logic with Full Progress Tracking
 */

// DOM elements
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const statusMessage = document.getElementById('statusMessage');
const timeEstimate = document.getElementById('timeEstimate');
const logsToggle = document.getElementById('logsToggle');
const logsContent = document.getElementById('logsContent');
const logsScroll = document.getElementById('logsScroll');
const logsHeader = document.getElementById('logsHeader');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const retryButton = document.getElementById('retryButton');

// State
let startTime = Date.now();
let currentStage = '';
let logsExpanded = false;

/**
 * Update progress
 */
function updateProgress(progress) {
  const { stage, message, percent } = progress;
  
  console.log('Progress:', progress);
  
  // Update progress bar
  progressFill.style.width = `${percent}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  
  // Update status message
  statusMessage.textContent = message;
  
  // Update stage indicator
  if (stage !== currentStage) {
    // Remove active from all stages
    document.querySelectorAll('.stage').forEach(s => {
      s.classList.remove('active');
    });
    
    // Mark completed stages
    const stages = ['dependencies', 'repositories', 'services'];
    const currentIndex = stages.indexOf(stage);
    
    stages.forEach((s, i) => {
      const stageEl = document.querySelector(`[data-stage="${s}"]`);
      if (stageEl) {
        if (i < currentIndex) {
          stageEl.classList.add('completed');
          stageEl.classList.remove('active');
        } else if (i === currentIndex) {
          stageEl.classList.add('active');
          stageEl.classList.remove('completed');
        }
      }
    });
    
    currentStage = stage;
  }
  
  // Update time estimate
  const elapsed = (Date.now() - startTime) / 1000; // seconds
  if (percent > 5) {
    const estimatedTotal = (elapsed / percent) * 100;
    const remaining = Math.max(0, estimatedTotal - elapsed);
    
    if (remaining > 60) {
      const minutes = Math.floor(remaining / 60);
      timeEstimate.textContent = `Estimated time remaining: ~${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      timeEstimate.textContent = `Estimated time remaining: ~${Math.round(remaining)} seconds`;
    }
  }
  
  // Add to logs
  addLogEntry(message);
}

/**
 * Add log entry
 */
function addLogEntry(message) {
  if (!logsScroll) {
    console.error('logsScroll element not found');
    return;
  }
  
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  logEntry.textContent = `[${timestamp}] ${message}`;
  logsScroll.appendChild(logEntry);
  
  // Auto-expand logs after first few entries to show activity
  const logCount = logsScroll.children.length;
  if (logCount > 3 && !logsExpanded) {
    toggleLogs(); // Auto-expand after a few logs
  }
  
  // Auto-scroll to bottom
  logsScroll.scrollTop = logsScroll.scrollHeight;
  
  // Debug
  console.log('Added log:', message);
}

/**
 * Show error
 */
function showError(error) {
  errorSection.style.display = 'block';
  errorMessage.textContent = error;
  addLogEntry(`ERROR: ${error}`);
  console.error('ERROR:', error);
  
  // Show restart button if error suggests restart is needed
  const restartButton = document.getElementById('restartButton');
  if (error.toLowerCase().includes('restart')) {
    restartButton.style.display = 'inline-block';
  } else {
    restartButton.style.display = 'none';
  }
}

/**
 * Hide error
 */
function hideError() {
  errorSection.style.display = 'none';
}

/**
 * Toggle logs
 */
function toggleLogs() {
  logsExpanded = !logsExpanded;
  
  if (logsExpanded) {
    logsContent.classList.add('expanded');
    logsToggle.textContent = 'Hide ▲';
  } else {
    logsContent.classList.remove('expanded');
    logsToggle.textContent = 'Show ▼';
  }
}

/**
 * Retry initialization
 */
async function retryInitialization() {
  hideError();
  startTime = Date.now();
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  statusMessage.textContent = 'Retrying initialization...';
  timeEstimate.textContent = 'Estimated time: Calculating...';
  
  addLogEntry('Retrying initialization...');
  
  try {
    const result = await window.electronAPI.initializeApp();
    if (!result.success) {
      showError(result.error || 'Initialization failed');
    }
  } catch (error) {
    showError(error.message || 'Failed to start initialization');
  }
}

/**
 * Restart application
 */
async function restartApplication() {
  addLogEntry('Restarting application...');
  statusMessage.textContent = 'Restarting application...';
  
  try {
    await window.electronAPI.restartApp();
  } catch (error) {
    console.error('Failed to restart:', error);
    showError('Failed to restart application: ' + (error.message || 'Unknown error'));
  }
}

/**
 * Initialize
 */
async function initialize() {
  // Setup event listeners
  logsToggle.addEventListener('click', toggleLogs);
  logsHeader.addEventListener('click', toggleLogs);
  retryButton.addEventListener('click', retryInitialization);
  
  const restartButton = document.getElementById('restartButton');
  if (restartButton) {
    restartButton.addEventListener('click', restartApplication);
  }
  
  // Listen for progress updates
  window.electronAPI.onInitProgress((progress) => {
    updateProgress(progress);
  });
  
  // Listen for errors
  window.electronAPI.onInitError((error) => {
    showError(error);
  });
  
  // Listen for completion
  window.electronAPI.onInitComplete(() => {
    addLogEntry('Initialization complete! Opening application...');
    
    // Mark all stages as completed
    document.querySelectorAll('.stage').forEach(s => {
      s.classList.remove('active');
      s.classList.add('completed');
    });
    
    statusMessage.textContent = 'Opening application...';
    timeEstimate.textContent = '';
    
    console.log('Initialization complete!');
  });
  
  // Log startup
  addLogEntry('BillBook+ initialization started');
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
