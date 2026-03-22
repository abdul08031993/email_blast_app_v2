const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios');
const { machineIdSync } = require('node-machine-id');

let mainWindow;
let isBlasting = false;
let stopBlast = false;

// ==================== CONFIGURATION ====================
// Paste Link Web App Google Script kamu di bawah ini
const LICENSE_API_URL = "https://script.google.com/macros/s/AKfycbwh2mStTL518wUg_NpWqPdM-hAauT1CxgS6nG62wmvsvarLIFFea1voacQWJ5WO1WKx/exec";

// ==================== DATA STORAGE ====================
const dataDir = path.join(app.getPath('userData'), 'email-blast-data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const accountsFile = path.join(dataDir, 'accounts.json');
const recipientsFile = path.join(dataDir, 'recipients.json');
const historyFile = path.join(dataDir, 'history.json');
const settingsFile = path.join(dataDir, 'settings.json');
const licenseFile = path.join(dataDir, 'license.json');

function readJSON(file, def = []) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return def;
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ==================== APP INIT ====================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    frame: false,
    backgroundColor: '#0f0f1a'
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ==================== LICENSE SYSTEM ====================
ipcMain.handle('verify-license', async (e, licenseKey) => {
  const hwid = machineIdSync();
  try {
    // Timeout 15 detik agar tidak hang jika internet lemot
    const response = await axios.post(LICENSE_API_URL, {
      action: 'activate',
      licenseKey: licenseKey,
      hwid: hwid
    }, { timeout: 15000 });

    if (response.data.success) {
      writeJSON(licenseFile, { licenseKey, hwid, active: true });
      return { success: true, message: response.data.message };
    } else {
      return { success: false, message: response.data.message };
    }
  } catch (error) {
    console.error("License Error:", error.message);
    return { success: false, message: "Server sibuk atau tidak ada internet. Coba lagi nanti." };
  }
});

ipcMain.handle('check-activation-status', () => {
  const saved = readJSON(licenseFile, null);
  const currentHwid = machineIdSync();
  
  // File lisensi harus ada, status aktif, dan HWID harus cocok dengan PC sekarang
  if (saved && saved.active && saved.hwid === currentHwid) {
    return { isActivated: true };
  }
  return { isActivated: false };
});

ipcMain.handle('get-hwid', () => machineIdSync());

// ==================== WINDOW CONTROLS ====================
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// ==================== ACCOUNTS ====================
ipcMain.handle('get-accounts', () => readJSON(accountsFile));
ipcMain.handle('save-account', (e, account) => {
  const accounts = readJSON(accountsFile);
  const idx = accounts.findIndex(a => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push({ ...account, id: Date.now().toString() });
  writeJSON(accountsFile, accounts);
  return accounts;
});
ipcMain.handle('delete-account', (e, id) => {
  const accounts = readJSON(accountsFile).filter(a => a.id !== id);
  writeJSON(accountsFile, accounts);
  return accounts;
});
ipcMain.handle('test-account', async (e, account) => {
  try {
    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: parseInt(account.smtpPort),
      secure: account.smtpPort == 465,
      auth: { user: account.email, pass: account.password },
      tls: { rejectUnauthorized: false }
    });
    await transporter.verify();
    return { success: true, message: 'Koneksi SMTP Berhasil!' };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ==================== RECIPIENTS ====================
ipcMain.handle('get-recipients', () => readJSON(recipientsFile));
ipcMain.handle('save-recipients', (e, list) => {
  writeJSON(recipientsFile, list);
  return list;
});
ipcMain.handle('import-recipients', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Text/CSV', extensions: ['txt', 'csv'] }]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const content = fs.readFileSync(result.filePaths[0], 'utf8');
    const emails = extractEmailsFromText(content);
    return emails;
  }
  return [];
});

function extractEmailsFromText(text) {
  if (!text) return [];
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return [...new Set(matches)];
}

// ==================== EMAIL SCRAPER (PUPPETEER) ====================
async function scrapeWebsiteWithPuppeteer(url) {
  let browser;
  try {
    if (!url.startsWith('http')) url = 'https://' + url;
    browser = await puppeteer.launch({ 
      headless: "new", 
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setDefaultNavigationTimeout(30000);
    await page.goto(url, { waitUntil: 'networkidle2' });
    const content = await page.content();
    await browser.close();
    return extractEmailsFromText(content);
  } catch (err) {
    if (browser) await browser.close();
    return [];
  }
}

ipcMain.handle('scrape-website', async (e, url) => {
  mainWindow.webContents.send('scrape-progress', { message: `Scraping ${url}...`, count: 0 });
  try {
    const emails = await scrapeWebsiteWithPuppeteer(url);
    return { success: true, emails, count: emails.length };
  } catch (err) {
    return { success: false, message: err.message, emails: [] };
  }
});

ipcMain.handle('scrape-google-maps', async (e, keyword) => {
  let browser;
  try {
    mainWindow.webContents.send('scrape-progress', { message: `Mencari "${keyword}"...`, count: 0 });
    browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2' });

    for(let i=0; i<3; i++) {
        await page.evaluate(() => {
            const sidePanel = document.querySelector('div[role="feed"]');
            if (sidePanel) sidePanel.scrollTop += 1000;
        });
        await new Promise(r => setTimeout(r, 1500));
    }

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href && !href.includes('google.com') && href.startsWith('http'));
    });

    const uniqueLinks = [...new Set(links)];
    let allEmails = [];
    for (const link of uniqueLinks) {
      mainWindow.webContents.send('scrape-progress', { message: `Mengecek email di: ${link}`, count: allEmails.length });
      const emails = await scrapeWebsiteWithPuppeteer(link);
      allEmails = [...allEmails, ...emails];
    }

    await browser.close();
    const finalEmails = [...new Set(allEmails)];
    return { success: true, emails: finalEmails, count: finalEmails.length };
  } catch (err) {
    if (browser) await browser.close();
    return { success: false, message: err.message, emails: [] };
  }
});

// ==================== EMAIL BLAST ====================
ipcMain.handle('start-blast', async (e, config) => {
  if (isBlasting) return { success: false, message: 'Blast sedang berjalan' };
  stopBlast = false;
  isBlasting = true;
  
  const { accounts, recipients, subject, body, isHtml, delay, rotateAccounts, senderName } = config;
  let sent = 0, failed = 0;
  let accountIndex = 0;

  const transporters = accounts.map(acc => ({
    account: acc,
    transporter: nodemailer.createTransport({
      host: acc.smtpHost, port: parseInt(acc.smtpPort),
      secure: acc.smtpPort == 465,
      auth: { user: acc.email, pass: acc.password },
      tls: { rejectUnauthorized: false }
    })
  }));

  const history = readJSON(historyFile);
  const session = { id: Date.now().toString(), date: new Date().toISOString(), subject, total: recipients.length, sent: 0, failed: 0, logs: [] };

  for (let i = 0; i < recipients.length; i++) {
    if (stopBlast) break;
    const recipient = recipients[i];
    const { transporter, account } = transporters[accountIndex % transporters.length];

    try {
      await transporter.sendMail({
        from: `"${senderName || account.name || account.email}" <${account.email}>`,
        to: recipient, subject: subject, [isHtml ? 'html' : 'text']: body
      });
      sent++;
      mainWindow.webContents.send('blast-progress', { current: i + 1, total: recipients.length, sent, failed, lastEmail: recipient, status: 'success', account: account.email, percent: Math.round(((i + 1) / recipients.length) * 100)});
    } catch (err) {
      failed++;
      mainWindow.webContents.send('blast-progress', { current: i + 1, total: recipients.length, sent, failed, lastEmail: recipient, status: 'failed', error: err.message, account: account.email, percent: Math.round(((i + 1) / recipients.length) * 100)});
    }

    if (rotateAccounts) accountIndex++;
    if (i < recipients.length - 1 && !stopBlast) {
      await new Promise(r => setTimeout(r, (parseInt(delay) || 1) * 1000));
    }
  }

  session.sent = sent; session.failed = failed;
  history.unshift(session);
  writeJSON(historyFile, history.slice(0, 100));
  isBlasting = false;
  mainWindow.webContents.send('blast-complete', { sent, failed, total: recipients.length });
  return { success: true, sent, failed };
});

ipcMain.handle('stop-blast', () => { stopBlast = true; return { success: true }; });

// ==================== OTHER HANDLERS ====================
ipcMain.handle('get-history', () => readJSON(historyFile));
ipcMain.handle('clear-history', () => { writeJSON(historyFile, []); return []; });
ipcMain.handle('get-settings', () => readJSON(settingsFile, { theme: 'dark', defaultDelay: 3 }));
ipcMain.handle('save-settings', (e, settings) => { writeJSON(settingsFile, settings); return settings; });
ipcMain.handle('export-emails', async (e, emails) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: 'emails.txt' });
  if (!result.canceled) { fs.writeFileSync(result.filePath, emails.join('\n')); return { success: true, path: result.filePath }; }
  return { success: false };
});