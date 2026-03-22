// ===================== STATE =====================
let state = {
  accounts: [],
  recipients: [],
  scrapedEmails: [],
  history: [],
  settings: { defaultDelay: 3 },
  selectedAccounts: [],
  isBlasting: false,
  isHtmlMode: false,
  blastStats: { sent: 0, failed: 0, total: 0 },
  scrapeMode: 'website',
  isActivated: false
};

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Cek Status Aktivasi Terlebih Dahulu
  const status = await window.electronAPI.checkActivationStatus();
  state.isActivated = status.isActivated;

  if (!state.isActivated) {
    showActivationScreen();
  } else {
    document.getElementById('activation-screen').style.display = 'none';
    await loadData();
    setupListeners();
    updateDashboard();
  }
});

async function loadData() {
  state.accounts = await window.electronAPI.getAccounts();
  state.recipients = await window.electronAPI.getRecipients();
  state.history = await window.electronAPI.getHistory();
  state.settings = await window.electronAPI.getSettings();
  
  renderAccounts();
  renderRecipients();
  renderHistory();
  updateBlastAccountSelector();
  loadSettings();
}

// ===================== LISENSI & AKTIVASI =====================
async function showActivationScreen() {
  const screen = document.getElementById('activation-screen');
  screen.style.display = 'flex';
  
  // Ambil HWID untuk ditampilkan (agar user bisa lapor ke kamu)
  const hwid = await window.electronAPI.getHWID();
  document.getElementById('display-hwid').textContent = hwid;
}

async function handleActivation() {
  const licenseKey = document.getElementById('input-license-key').value.trim();
  if (!licenseKey) {
    showToast('Masukkan kode lisensi Anda', 'warning');
    return;
  }

  showToast('Memverifikasi lisensi...', 'info');
  const result = await window.electronAPI.verifyLicense(licenseKey);

  if (result.success) {
    showToast('Aktivasi Berhasil! Membuka aplikasi...', 'success');
    setTimeout(() => {
      location.reload(); // Refresh untuk memuat data aplikasi
    }, 1500);
  } else {
    showToast(result.message, 'error');
  }
}

function copyHWID() {
  const hwid = document.getElementById('display-hwid').textContent;
  navigator.clipboard.writeText(hwid);
  showToast('ID Komputer disalin ke clipboard', 'info');
}

// ===================== NAVIGATION =====================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  document.getElementById(`page-${page}`).classList.add('active');
  const navItem = document.querySelector(`[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');
  
  if (page === 'blast') {
    updateBlastAccountSelector();
    updateBlastRecipientCount();
  }
  if (page === 'dashboard') updateDashboard();
}

// ===================== DASHBOARD =====================
function updateDashboard() {
  const totalSent = state.history.reduce((sum, h) => sum + (h.sent || 0), 0);
  document.getElementById('stat-total-sent').textContent = totalSent.toLocaleString();
  document.getElementById('stat-total-recipients').textContent = state.recipients.length.toLocaleString();
  document.getElementById('stat-total-accounts').textContent = state.accounts.length;
  document.getElementById('stat-total-campaigns').textContent = state.history.length;
  
  const activityList = document.getElementById('recent-activity-list');
  if (!state.history || state.history.length === 0) {
    activityList.innerHTML = `<div class="empty-state-sm"><i class="fas fa-inbox"></i><p>Belum ada aktivitas</p></div>`;
  } else {
    activityList.innerHTML = state.history.slice(0, 5).map(h => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px;">
        <div>
          <div style="font-weight:600">${escHtml(h.subject || 'Campaign')}</div>
          <div style="color:var(--text-muted);font-size:11px">${formatDate(h.date)}</div>
        </div>
        <div style="color:var(--success); font-weight:700;">+${h.sent}</div>
      </div>
    `).join('');
  }
}

// ===================== EVENT LISTENERS =====================
function setupListeners() {
  window.electronAPI.onBlastProgress(handleBlastProgress);
  window.electronAPI.onBlastComplete(handleBlastComplete);
  window.electronAPI.onBlastStopped(handleBlastStopped);
  window.electronAPI.onScrapeProgress(handleScrapeProgress);
}

// ===================== ACCOUNTS =====================
function renderAccounts() {
  const container = document.getElementById('accounts-list');
  if (state.accounts.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-envelope"></i><h3>Belum ada akun</h3><p>Tambahkan akun SMTP untuk memulai blast</p></div>`;
    return;
  }
  
  container.innerHTML = state.accounts.map(acc => `
    <div class="account-card" id="acc-${acc.id}">
      <div class="account-card-header">
        <div class="account-avatar">${(acc.name || acc.email || '?')[0].toUpperCase()}</div>
        <div class="account-info">
          <div class="account-name">${escHtml(acc.name || acc.email)}</div>
          <div class="account-email">${escHtml(acc.email)}</div>
        </div>
      </div>
      <div class="account-meta">
        <span><i class="fas fa-server"></i> ${escHtml(acc.smtpHost)}:${acc.smtpPort}</span>
      </div>
      <div class="account-actions">
        <button class="btn-test" onclick="testAccount('${acc.id}')"><i class="fas fa-plug"></i> Test</button>
        <button class="btn-edit" onclick="editAccount('${acc.id}')"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn-del" onclick="deleteAccount('${acc.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `).join('');
}

function showAccountModal(account = null) {
  document.getElementById('account-id').value = account?.id || '';
  document.getElementById('account-name').value = account?.name || '';
  document.getElementById('account-email').value = account?.email || '';
  document.getElementById('account-password').value = account?.password || '';
  document.getElementById('account-smtp-host').value = account?.smtpHost || '';
  document.getElementById('account-smtp-port').value = account?.smtpPort || '587';
  document.getElementById('modal-title').textContent = account ? 'Edit Akun Email' : 'Tambah Akun Email';
  document.getElementById('account-modal').style.display = 'flex';
}

function closeAccountModal() {
  document.getElementById('account-modal').style.display = 'none';
}

function editAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (acc) showAccountModal(acc);
}

async function deleteAccount(id) {
  if (!confirm('Hapus akun ini?')) return;
  state.accounts = await window.electronAPI.deleteAccount(id);
  renderAccounts();
  updateBlastAccountSelector();
  showToast('Akun dihapus', 'success');
}

async function testAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  showToast('Menguji koneksi...', 'info');
  const result = await window.electronAPI.testAccount(acc);
  if (result.success) showToast('✓ ' + result.message, 'success');
  else showToast('✗ ' + result.message, 'error');
}

async function testCurrentAccount() {
  const acc = getCurrentAccountFromModal();
  if (!acc.email || !acc.smtpHost) { showToast('Isi email dan SMTP terlebih dahulu', 'warning'); return; }
  showToast('Menguji koneksi...', 'info');
  const result = await window.electronAPI.testAccount(acc);
  if (result.success) showToast('✓ ' + result.message, 'success');
  else showToast('✗ ' + result.message, 'error');
}

async function saveAccount() {
  const acc = getCurrentAccountFromModal();
  if (!acc.email || !acc.password || !acc.smtpHost) {
    showToast('Lengkapi semua field yang wajib diisi', 'warning');
    return;
  }
  
  state.accounts = await window.electronAPI.saveAccount(acc);
  renderAccounts();
  updateBlastAccountSelector();
  closeAccountModal();
  showToast('Akun berhasil disimpan', 'success');
  updateDashboard();
}

function getCurrentAccountFromModal() {
  return {
    id: document.getElementById('account-id').value,
    name: document.getElementById('account-name').value,
    email: document.getElementById('account-email').value,
    password: document.getElementById('account-password').value,
    smtpHost: document.getElementById('account-smtp-host').value,
    smtpPort: document.getElementById('account-smtp-port').value || '587'
  };
}

function fillPreset(type) {
  const presets = {
    gmail: { host: 'smtp.gmail.com', port: '587' },
    yahoo: { host: 'smtp.mail.yahoo.com', port: '587' },
    outlook: { host: 'smtp-mail.outlook.com', port: '587' },
    zoho: { host: 'smtp.zoho.com', port: '587' },
    custom: { host: '', port: '587' }
  };
  const preset = presets[type];
  if (preset) {
    showAccountModal();
    document.getElementById('account-smtp-host').value = preset.host;
    document.getElementById('account-smtp-port').value = preset.port;
  }
}

function togglePassword(id) {
  const input = document.getElementById(id);
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ===================== RECIPIENTS =====================
function renderRecipients(filter = '') {
  const container = document.getElementById('recipients-list');
  const filtered = filter 
    ? state.recipients.filter(e => e.toLowerCase().includes(filter.toLowerCase()))
    : state.recipients;
  
  document.getElementById('recipient-badge').textContent = `${state.recipients.length} email`;
  
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><h3>Tidak ada penerima</h3><p>${filter ? 'Tidak ditemukan hasil pencarian' : 'Tambahkan email penerima atau import dari file'}</p></div>`;
    return;
  }
  
  container.innerHTML = `
    <table class="recipients-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Email Address</th>
          <th style="width:60px">Hapus</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((email, idx) => `
          <tr>
            <td style="color:var(--text-muted)">${idx + 1}</td>
            <td>${escHtml(email)}</td>
            <td><button class="delete-row-btn" onclick="removeRecipient('${escHtml(email)}')"><i class="fas fa-times"></i></button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function filterRecipients() {
  const q = document.getElementById('recipient-search').value;
  renderRecipients(q);
}

async function addRecipient() {
  const input = document.getElementById('new-recipient-input');
  const email = input.value.trim();
  if (!email) return;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) { showToast('Format email tidak valid', 'error'); return; }
  if (state.recipients.includes(email)) { showToast('Email sudah ada dalam daftar', 'warning'); return; }
  
  state.recipients.push(email);
  await window.electronAPI.saveRecipients(state.recipients);
  input.value = '';
  renderRecipients();
  updateBlastRecipientCount();
}

async function removeRecipient(email) {
  state.recipients = state.recipients.filter(e => e !== email);
  await window.electronAPI.saveRecipients(state.recipients);
  renderRecipients();
  updateBlastRecipientCount();
}

async function importRecipients() {
  const emails = await window.electronAPI.importRecipients();
  if (emails.length === 0) { showToast('Tidak ada email yang ditemukan dalam file', 'warning'); return; }
  
  const newEmails = emails.filter(e => !state.recipients.includes(e));
  state.recipients = [...state.recipients, ...newEmails];
  await window.electronAPI.saveRecipients(state.recipients);
  renderRecipients();
  updateBlastRecipientCount();
  showToast(`Berhasil: ${newEmails.length} email baru ditambahkan`, 'success');
}

async function exportRecipients() {
  if (state.recipients.length === 0) { showToast('Tidak ada email untuk diexport', 'warning'); return; }
  const result = await window.electronAPI.exportEmails(state.recipients);
  if (result.success) showToast('Export berhasil disimpan', 'success');
}

async function clearRecipients() {
  if (!confirm(`Hapus semua penerima?`)) return;
  state.recipients = [];
  await window.electronAPI.saveRecipients([]);
  renderRecipients();
  updateBlastRecipientCount();
  showToast('Semua penerima dihapus', 'success');
}

function addBulkRecipients() {
  const area = document.getElementById('bulk-paste-area');
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

async function processBulkPaste() {
  const text = document.getElementById('bulk-paste-input').value;
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const emails = [...new Set(text.match(emailRegex) || [])];
  
  if (emails.length === 0) { showToast('Tidak ada email yang valid', 'warning'); return; }
  
  const newEmails = emails.filter(e => !state.recipients.includes(e));
  state.recipients = [...state.recipients, ...newEmails];
  await window.electronAPI.saveRecipients(state.recipients);
  document.getElementById('bulk-paste-input').value = '';
  document.getElementById('bulk-paste-area').style.display = 'none';
  renderRecipients();
  updateBlastRecipientCount();
  showToast(`${newEmails.length} email ditambahkan`, 'success');
}

// ===================== EMAIL SCRAPER =====================
function setScrapeMode(mode) {
  state.scrapeMode = mode;
  document.querySelectorAll('.scraper-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${mode}`).classList.add('active');
  document.querySelectorAll('.scrape-mode').forEach(m => m.style.display = 'none');
  document.getElementById(`scrape-${mode}-mode`).style.display = 'flex';
}

function handleScrapeProgress(data) {
  addScrapeLog(data.message);
}

async function scrapeWebsite() {
  const url = document.getElementById('scrape-url').value.trim();
  if (!url) { showToast('Masukkan URL website', 'warning'); return; }
  
  addScrapeLog(`Memulai scraping: ${url}...`);
  const result = await window.electronAPI.scrapeWebsite(url);
  
  if (result.success) {
    addScrapeResults(result.emails);
    showToast(`Ditemukan ${result.emails.length} email`, 'success');
  } else {
    showToast('Gagal scraping: ' + result.message, 'error');
  }
}

async function scrapeMaps() {
  const keyword = document.getElementById('scrape-maps-keyword').value.trim();
  if (!keyword) { showToast('Masukkan kata kunci', 'warning'); return; }
  
  addScrapeLog(`Mencari "${keyword}" di Google Maps...`);
  const result = await window.electronAPI.scrapeGoogleMaps(keyword);
  
  if (result.success) {
    addScrapeResults(result.emails);
    showToast(`Ditemukan ${result.emails.length} email`, 'success');
  } else {
    showToast('Gagal: ' + result.message, 'error');
  }
}

function addScrapeLog(message) {
  const log = document.getElementById('scrape-log');
  if (log.querySelector('.log-placeholder')) log.innerHTML = '';
  log.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${escHtml(message)}</div>`;
  log.scrollTop = log.scrollHeight;
}

function addScrapeResults(emails) {
  const newEmails = emails.filter(e => !state.scrapedEmails.includes(e));
  state.scrapedEmails = [...state.scrapedEmails, ...newEmails];
  renderScrapedEmails();
}

function renderScrapedEmails() {
  const container = document.getElementById('scrape-results-list');
  document.getElementById('scrape-result-count').textContent = `${state.scrapedEmails.length} email`;
  
  if (state.scrapedEmails.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-bug"></i><h3>Belum ada hasil</h3></div>`;
    return;
  }
  
  container.innerHTML = state.scrapedEmails.map((email, i) => `
    <div class="email-result-item">
      <span>${i + 1}. ${escHtml(email)}</span>
      <button class="delete-row-btn" onclick="removeScrapedEmail('${escHtml(email)}')"><i class="fas fa-times"></i></button>
    </div>
  `).join('');
}

function removeScrapedEmail(email) {
  state.scrapedEmails = state.scrapedEmails.filter(e => e !== email);
  renderScrapedEmails();
}

async function addScrapedToRecipients() {
  if (state.scrapedEmails.length === 0) return;
  const newEmails = state.scrapedEmails.filter(e => !state.recipients.includes(e));
  state.recipients = [...state.recipients, ...newEmails];
  await window.electronAPI.saveRecipients(state.recipients);
  renderRecipients();
  updateBlastRecipientCount();
  showToast(`${newEmails.length} email baru ditambahkan`, 'success');
}

// ===================== BLAST =====================
function updateBlastAccountSelector() {
  const container = document.getElementById('blast-account-selector');
  if (state.accounts.length === 0) {
    container.innerHTML = `<p>Belum ada akun. <a onclick="navigateTo('accounts')">Tambah akun</a></p>`;
    return;
  }
  
  container.innerHTML = state.accounts.map(acc => `
    <div class="account-chip ${state.selectedAccounts.includes(acc.id) ? 'selected' : ''}" 
         onclick="toggleAccountSelect('${acc.id}')">
      <span>${escHtml(acc.name || acc.email)}</span>
    </div>
  `).join('');
}

function toggleAccountSelect(id) {
  const idx = state.selectedAccounts.indexOf(id);
  if (idx >= 0) state.selectedAccounts.splice(idx, 1);
  else state.selectedAccounts.push(id);
  updateBlastAccountSelector();
}

function updateBlastRecipientCount() {
  const el = document.getElementById('blast-recipient-count');
  if (el) el.textContent = `${state.recipients.length} penerima dipilih`;
  const statEl = document.getElementById('stat-total');
  if (statEl) statEl.textContent = state.recipients.length;
}

function setFormat(format) {
  state.isHtmlMode = format === 'html';
  document.getElementById('btn-text').classList.toggle('active', !state.isHtmlMode);
  document.getElementById('btn-html').classList.toggle('active', state.isHtmlMode);
  document.getElementById('html-toolbar').style.display = state.isHtmlMode ? 'flex' : 'none';
}

async function startBlast() {
  if (state.isBlasting) return;
  if (state.selectedAccounts.length === 0) { showToast('Pilih akun pengirim', 'warning'); return; }
  if (state.recipients.length === 0) { showToast('Penerima kosong', 'warning'); return; }
  
  const subject = document.getElementById('blast-subject').value.trim();
  const body = document.getElementById('blast-body').value.trim();
  if (!subject || !body) { showToast('Subjek dan Pesan harus diisi', 'warning'); return; }
  
  state.isBlasting = true;
  document.getElementById('btn-start-blast').style.display = 'none';
  document.getElementById('btn-stop-blast').style.display = 'flex';
  document.getElementById('blast-progress-container').style.display = 'block';
  document.getElementById('blast-log').innerHTML = '';
  
  const accounts = state.accounts.filter(a => state.selectedAccounts.includes(a.id));
  
  await window.electronAPI.startBlast({
    accounts,
    recipients: state.recipients,
    subject, body,
    isHtml: state.isHtmlMode,
    delay: parseInt(document.getElementById('blast-delay').value),
    senderName: document.getElementById('blast-sender-name').value,
    rotateAccounts: document.getElementById('blast-rotate-accounts').checked
  });
}

function handleBlastProgress(data) {
  document.getElementById('stat-sent').textContent = data.sent;
  document.getElementById('stat-failed').textContent = data.failed;
  document.getElementById('blast-progress-bar').style.width = `${data.percent}%`;
  document.getElementById('blast-progress-text').textContent = `${data.current} / ${data.total}`;
  
  const log = document.getElementById('blast-log');
  const status = data.status === 'success' ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)">✗</span>';
  log.innerHTML += `<div>${status} ${data.lastEmail} ${data.error ? '('+data.error+')' : ''}</div>`;
  log.scrollTop = log.scrollHeight;
}

async function stopBlast() {
  await window.electronAPI.stopBlast();
}

function handleBlastComplete(data) {
  state.isBlasting = false;
  document.getElementById('btn-start-blast').style.display = 'flex';
  document.getElementById('btn-stop-blast').style.display = 'none';
  showToast(`Selesai! ${data.sent} terkirim`, 'success');
  loadData();
}

function handleBlastStopped() {
  state.isBlasting = false;
  document.getElementById('btn-start-blast').style.display = 'flex';
  document.getElementById('btn-stop-blast').style.display = 'none';
  showToast('Blast dihentikan', 'warning');
}

// ===================== HISTORY =====================
function renderHistory() {
  const container = document.getElementById('history-list');
  if (!state.history || state.history.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>Belum ada riwayat</h3></div>`;
    return;
  }
  
  container.innerHTML = state.history.map(h => `
    <div class="history-card">
      <div style="font-weight:700">${escHtml(h.subject)}</div>
      <div style="font-size:11px; color:var(--text-muted)">${formatDate(h.date)}</div>
      <div style="margin-top:8px; display:flex; gap:15px; font-size:12px;">
        <span>Total: ${h.total}</span>
        <span style="color:var(--success)">Sent: ${h.sent}</span>
        <span style="color:var(--danger)">Failed: ${h.failed}</span>
      </div>
    </div>
  `).join('');
}

async function clearHistory() {
  if (confirm('Hapus semua riwayat?')) {
    await window.electronAPI.clearHistory();
    loadData();
  }
}

// ===================== SETTINGS =====================
function loadSettings() {
  document.getElementById('setting-delay').value = state.settings.defaultDelay;
}

async function saveSettings() {
  const settings = {
    defaultDelay: parseInt(document.getElementById('setting-delay').value),
    theme: document.getElementById('setting-theme').value
  };
  await window.electronAPI.saveSettings(settings);
  showToast('Pengaturan disimpan', 'success');
}

// ===================== UTILS =====================
function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escHtml(str) {
  const p = document.createElement('p');
  p.textContent = str;
  return p.innerHTML;
}

function formatDate(d) {
  return new Date(d).toLocaleString();
}