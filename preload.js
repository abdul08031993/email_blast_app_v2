const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // License & Activation
  verifyLicense: (licenseKey) => ipcRenderer.invoke('verify-license', licenseKey),
  checkActivationStatus: () => ipcRenderer.invoke('check-activation-status'),
  getHWID: () => ipcRenderer.invoke('get-hwid'),
  deactivateLicense: () => ipcRenderer.invoke('deactivate-license'),

  // Accounts
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  saveAccount: (account) => ipcRenderer.invoke('save-account', account),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  testAccount: (account) => ipcRenderer.invoke('test-account', account),

  // Recipients
  getRecipients: () => ipcRenderer.invoke('get-recipients'),
  saveRecipients: (list) => ipcRenderer.invoke('save-recipients', list),
  importRecipients: () => ipcRenderer.invoke('import-recipients'),
  exportEmails: (emails) => ipcRenderer.invoke('export-emails', emails),

  // Scraper
  scrapeGoogleMaps: (opts) => ipcRenderer.invoke('scrape-google-maps', opts),
  scrapeWebsite: (url) => ipcRenderer.invoke('scrape-website', url),
  socialOpenBrowser: (opts) => ipcRenderer.invoke('social-open-browser', opts),
  socialScrapeAfterLogin: (opts) => ipcRenderer.invoke('social-scrape-after-login', opts),
  socialStopScrape: () => ipcRenderer.invoke('social-stop-scrape'),
  socialCloseBrowser: () => ipcRenderer.invoke('social-close-browser'),

  // Blast
  startBlast: (config) => ipcRenderer.invoke('start-blast', config),
  stopBlast: () => ipcRenderer.invoke('stop-blast'),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Event listeners (Komunikasi dari Main ke Renderer)
  onBlastProgress: (cb) => ipcRenderer.on('blast-progress', (_, data) => cb(data)),
  onBlastComplete: (cb) => ipcRenderer.on('blast-complete', (_, data) => cb(data)),
  onBlastStopped:  (cb) => ipcRenderer.on('blast-stopped',  (_, data) => cb(data)),
  onScrapeProgress:(cb) => ipcRenderer.on('scrape-progress', (_, data) => cb(data)),
  onScrapeLead:    (cb) => ipcRenderer.on('scrape-lead',     (_, data) => cb(data)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});