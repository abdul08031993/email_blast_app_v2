const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs');
const puppeteer = require('puppeteer');
const axios = require('axios');
const { machineIdSync } = require('node-machine-id');
const os = require('os');

function getChromePath() {
  const candidates = [];
  if (os.platform() === 'win32') {
    candidates.push(
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (os.platform() === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/microsoft-edge'
    );
  }
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });
  if (found) return found;
  // Fallback: gunakan Chromium yang di-bundle bersama puppeteer
  try { return puppeteer.executablePath(); } catch(_) { return undefined; }
}

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
  if (saved && saved.active && saved.hwid === currentHwid) {
    return { isActivated: true, licenseKey: saved.licenseKey || '' };
  }
  return { isActivated: false, licenseKey: '' };
});

ipcMain.handle('deactivate-license', () => {
  try {
    if (fs.existsSync(licenseFile)) fs.unlinkSync(licenseFile);
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
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

// ==================== EMAIL SCRAPER ====================
// Regex email — filter domain-domain sampah umum
const JUNK_DOMAINS = /noreply|no-reply|example\.com|sentry\.io|yourdomain|domain\.com|wixpress|@email\.com|@test\.|@mail\.ru|@spam|cloudflare|placeholder|localhost/i;

function extractEmailsFromText(text) {
  if (!text) return [];
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return [...new Set(matches)].filter(e => !JUNK_DOMAINS.test(e));
}

const STEALTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

async function launchBrowser(headless = true) {
  const execPath = getChromePath();
  const opts = {
    headless: headless ? 'new' : false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-extensions',
      '--window-size=1366,768',
    ],
    ignoreHTTPSErrors: true,
  };
  if (execPath) opts.executablePath = execPath;
  return puppeteer.launch(opts);
}

async function scrapeSinglePage(page, url, timeoutMs = 20000) {
  try {
    if (!url.startsWith('http')) url = 'https://' + url;
    await page.setUserAgent(STEALTH_UA);
    await page.setDefaultNavigationTimeout(timeoutMs);
    // Navigasi dengan fallback timeout
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch(_) {
      // Jika timeout, tetap ambil apa yang sudah ter-load
    }
    // Tunggu sebentar agar JS render
    await new Promise(r => setTimeout(r, 1500));
    // Ambil mailto: links
    const hrefEmails = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href^="mailto:"]'))
        .map(a => a.href.replace('mailto:', '').split('?')[0].trim())
        .filter(e => e.includes('@'));
    }).catch(() => []);
    const content = await page.content().catch(() => '');
    // Juga cek meta tags dan JSON-LD
    const metaContent = await page.evaluate(() => {
      const metas = Array.from(document.querySelectorAll('meta[content]')).map(m => m.content).join(' ');
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent).join(' ');
      return metas + ' ' + scripts;
    }).catch(() => '');
    const allEmails = [...new Set([...hrefEmails, ...extractEmailsFromText(content + ' ' + metaContent)])];
    return allEmails;
  } catch (err) {
    return [];
  }
}

async function scrapeWebsiteWithPuppeteer(url) {
  let browser;
  try {
    browser = await launchBrowser(true);
    const page = await browser.newPage();
    const emails = await scrapeSinglePage(page, url);
    await browser.close();
    return emails;
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

// ==================== GOOGLE MAPS SCRAPER (DIOPTIMASI) ====================
ipcMain.handle('scrape-google-maps', async (e, { keyword, maxResults = 30 }) => {
  let browser;
  let allEmails = [];
  let allLeads  = []; // {name, website, phone, email}
  let stopped   = false;

  const sendProgress = (msg, count) =>
    mainWindow.webContents.send('scrape-progress', { message: msg, count });

  try {
    browser = await launchBrowser(true);
    const page = await browser.newPage();
    await page.setUserAgent(STEALTH_UA);
    // Inject stealth headers agar tidak diblok
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });
    // Sembunyikan tanda-tanda automation
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
    await page.setDefaultNavigationTimeout(60000);

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    sendProgress(`Membuka Google Maps: ${keyword}`, 0);
    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch(_) {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await new Promise(r => setTimeout(r, 3000));

    // Scroll side panel untuk muat lebih banyak bisnis
    sendProgress('Memuat daftar bisnis...', 0);
    const scrollRounds = Math.ceil(maxResults / 7);
    for (let i = 0; i < scrollRounds; i++) {
      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollTop += 2000;
      });
      await new Promise(r => setTimeout(r, 1800));
    }

    // Ambil semua link bisnis dari panel kiri (bukan link google.com biasa)
    const bizLinks = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      const seen = new Set();
      const result = [];
      for (const a of anchors) {
        const href = a.href.split('?')[0];
        if (!seen.has(href)) { seen.add(href); result.push(href); }
      }
      return result;
    });

    const links = bizLinks.slice(0, maxResults);

    // FALLBACK: jika tidak ada link bisnis (DOM Maps berubah), kunjungi link non-Google langsung
    if (links.length === 0) {
      sendProgress('Tidak ada profil bisnis, mencoba strategi alternatif...', 0);
      const fallbackLinks = await page.evaluate(() =>
        [...new Set(Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => h.startsWith('http') && !h.includes('google.com') && !h.includes('goo.gl'))
        )].slice(0, 20)
      ).catch(() => []);

      for (const url of fallbackLinks) {
        sendProgress(`Scraping: ${url.substring(0, 60)}`, allEmails.length);
        const pg = await browser.newPage();
        const emails = await scrapeSinglePage(pg, url, 15000);
        await pg.close().catch(() => {});
        if (emails.length > 0) {
          allEmails.push(...emails);
          allEmails = [...new Set(allEmails)];
          mainWindow.webContents.send('scrape-lead', { name: url, emails });
          sendProgress(`✓ ${url.substring(0,40)} → ${emails.length} email`, allEmails.length);
        }
      }
    } else {
      sendProgress(`Ditemukan ${links.length} bisnis, mulai ekstrak data...`, 0);

      for (let i = 0; i < links.length; i++) {
        if (stopped) break;
        const bizUrl = links[i];
        sendProgress(`[${i+1}/${links.length}] Membuka profil bisnis...`, allEmails.length);

        try {
          const bizPage = await browser.newPage();
          await bizPage.setUserAgent(STEALTH_UA);
          await bizPage.setDefaultNavigationTimeout(30000);
          try {
            await bizPage.goto(bizUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          } catch(_) { /* tetap lanjut dengan apa yang sudah ter-load */ }
          await new Promise(r => setTimeout(r, 2000));

          // Ekstrak data bisnis — support beberapa versi DOM Maps
          const bizData = await bizPage.evaluate(() => {
            const name = (document.querySelector('h1') || {}).textContent?.trim() || '';
            let website = '';
            const wCandidates = [
              ...document.querySelectorAll('a[data-item-id*="authority"]'),
              ...document.querySelectorAll('a[aria-label*="ebsite"]'),
              ...document.querySelectorAll('a[href^="http"]:not([href*="google"])'),
            ];
            for (const el of wCandidates) {
              if (el.href && !el.href.includes('google.com') && !el.href.includes('maps.google')) {
                website = el.href; break;
              }
            }
            const allText = document.body.innerText || '';
            const phoneMatch = allText.match(/(?:\+62|0)[0-9][\s\-]?[0-9]{2,4}[\s\-]?[0-9]{3,4}[\s\-]?[0-9]{3,4}/);
            const phone = phoneMatch ? phoneMatch[0].trim() : '';
            const directEmails = (allText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []);
            return { name, website, phone, directEmails };
          }).catch(() => ({ name: '', website: '', phone: '', directEmails: [] }));

          const lead = { name: bizData.name, website: bizData.website, phone: bizData.phone, emails: [] };
          lead.emails.push(...extractEmailsFromText(bizData.directEmails.join(' ')));

          if (bizData.website) {
            sendProgress(`[${i+1}/${links.length}] Website: ${bizData.website.substring(0, 50)}...`, allEmails.length);
            const webPage = await browser.newPage();
            const webEmails = await scrapeSinglePage(webPage, bizData.website, 18000);
            await webPage.close().catch(() => {});
            lead.emails.push(...webEmails);
          }

          lead.emails = [...new Set(lead.emails)];

          if (lead.emails.length > 0 || lead.phone) {
            allLeads.push(lead);
            allEmails.push(...lead.emails);
            allEmails = [...new Set(allEmails)];
            mainWindow.webContents.send('scrape-lead', lead);
            sendProgress(`✓ ${lead.name || 'Bisnis'} → ${lead.emails.length} email | total: ${allEmails.length}`, allEmails.length);
          } else {
            sendProgress(`[${i+1}/${links.length}] Tidak ada email pada bisnis ini`, allEmails.length);
          }

          await bizPage.close().catch(() => {});
        } catch (bizErr) {
          sendProgress(`[${i+1}] Error: ${bizErr.message.substring(0, 50)}`, allEmails.length);
        }
      }
    }

    await browser.close().catch(() => {});
    return { success: true, emails: [...new Set(allEmails)], leads: allLeads, count: allEmails.length };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { success: false, message: err.message, emails: [], leads: [] };
  }
});

// ==================== SOCIAL MEDIA SCRAPER (DENGAN LOGIN) ====================
let socialBrowser = null;
let socialScrapeStop = false;

ipcMain.handle('social-open-browser', async (e, { platform }) => {
  try {
    // Tutup browser lama jika ada
    if (socialBrowser) { await socialBrowser.close().catch(() => {}); socialBrowser = null; }

    socialBrowser = await launchBrowser(false); // visible browser
    const page = await socialBrowser.newPage();

    const urls = {
      linkedin:  'https://www.linkedin.com/login',
      facebook:  'https://www.facebook.com/login',
      instagram: 'https://www.instagram.com/accounts/login',
      twitter:   'https://twitter.com/i/flow/login',
    };

    await page.goto(urls[platform] || urls.linkedin, { waitUntil: 'domcontentloaded' });
    return { success: true, message: `Browser ${platform} dibuka. Silakan login di jendela browser.` };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('social-scrape-after-login', async (e, { platform, keyword, maxPages }) => {
  if (!socialBrowser) return { success: false, message: 'Browser belum dibuka. Klik Buka Browser terlebih dahulu.' };
  socialScrapeStop = false;
  let allEmails = [];

  const sendProgress = (msg, count) =>
    mainWindow.webContents.send('scrape-progress', { message: msg, count });

  try {
    const pages = await socialBrowser.pages();
    let page = pages[pages.length - 1];

    if (platform === 'linkedin') {
      // Search LinkedIn untuk orang/bisnis dengan keyword
      sendProgress('Membuka LinkedIn Search...', 0);
      await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`, { waitUntil: 'networkidle2', timeout: 30000 });

      for (let p = 0; p < (maxPages || 5); p++) {
        if (socialScrapeStop) break;
        sendProgress(`LinkedIn halaman ${p+1}: ekstrak email...`, allEmails.length);
        const content = await page.content();
        const emails = extractEmailsFromText(content);
        allEmails.push(...emails);

        // Kunjungi profil individual untuk dapat email
        const profileLinks = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href*="/in/"]'))
            .map(a => a.href.split('?')[0])
            .filter((v,i,arr) => arr.indexOf(v) === i)
            .slice(0, 5)
        );

        for (const profileUrl of profileLinks) {
          if (socialScrapeStop) break;
          try {
            const profilePage = await socialBrowser.newPage();
            sendProgress(`Membuka profil: ${profileUrl.substring(0, 50)}...`, allEmails.length);
            await profilePage.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
            // Klik "Contact info" jika ada
            try {
              await profilePage.click('a[id*="contact-info"], a[data-control-name="contact_see_more"]');
              await new Promise(r => setTimeout(r, 1500));
            } catch(_) {}
            const html = await profilePage.content();
            const profEmails = extractEmailsFromText(html);
            allEmails.push(...profEmails);
            if (profEmails.length > 0) {
              mainWindow.webContents.send('scrape-lead', { name: profileUrl, emails: profEmails });
            }
            await profilePage.close();
          } catch(_) {}
        }

        allEmails = [...new Set(allEmails)];
        sendProgress(`Halaman ${p+1} selesai – ${allEmails.length} email`, allEmails.length);

        // Next page
        try {
          const nextBtn = await page.$('button[aria-label="Next"]');
          if (!nextBtn) break;
          await nextBtn.click();
          await new Promise(r => setTimeout(r, 3000));
        } catch(_) { break; }
      }

    } else if (platform === 'facebook') {
      sendProgress('Membuka Facebook Search...', 0);
      await page.goto(`https://www.facebook.com/search/people?q=${encodeURIComponent(keyword)}`, { waitUntil: 'networkidle2', timeout: 30000 });

      for (let p = 0; p < (maxPages || 3); p++) {
        if (socialScrapeStop) break;
        // Scroll untuk load lebih banyak
        for (let s = 0; s < 5; s++) {
          await page.evaluate(() => window.scrollBy(0, 1500));
          await new Promise(r => setTimeout(r, 1000));
        }
        const html = await page.content();
        const emails = extractEmailsFromText(html);
        allEmails.push(...emails);
        allEmails = [...new Set(allEmails)];
        sendProgress(`Facebook scroll ${p+1} – ${allEmails.length} email`, allEmails.length);
      }

    } else if (platform === 'instagram') {
      sendProgress('Membuka Instagram Search...', 0);
      await page.goto(`https://www.instagram.com/explore/`, { waitUntil: 'networkidle2', timeout: 30000 });

      // Cari & buka profil berdasar keyword
      try {
        const searchInput = await page.$('input[placeholder*="Search"], input[aria-label*="Search"]');
        if (searchInput) {
          await searchInput.click();
          await searchInput.type(keyword, { delay: 100 });
          await new Promise(r => setTimeout(r, 2500));
          const firstResult = await page.$('a[href*="/"][role="link"]:not([href="/"])');
          if (firstResult) await firstResult.click();
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch(_) {}
      const html = await page.content();
      const emails = extractEmailsFromText(html);
      allEmails.push(...emails);
      sendProgress(`Instagram – ${allEmails.length} email`, allEmails.length);
    }

    allEmails = [...new Set(allEmails)];
    return { success: true, emails: allEmails, count: allEmails.length };
  } catch (err) {
    return { success: false, message: err.message, emails: [] };
  }
});

ipcMain.handle('social-stop-scrape', () => { socialScrapeStop = true; return { success: true }; });
ipcMain.handle('social-close-browser', async () => {
  if (socialBrowser) { await socialBrowser.close().catch(() => {}); socialBrowser = null; }
  return { success: true };
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