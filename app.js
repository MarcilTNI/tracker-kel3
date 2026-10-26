const categories = [
  { id: "food", name: "Makanan", icon: "restaurant" },
  { id: "internet", name: "Internet & Pulsa", icon: "wifi" },
  { id: "transport", name: "Transportasi", icon: "directions_bus" },
  { id: "entertainment", name: "Hiburan", icon: "headphones" },
  { id: "housing", name: "Tempat tinggal", icon: "home" },
  { id: "college", name: "Kuliah", icon: "school" },
  { id: "shopping", name: "Belanja", icon: "shopping_bag" },
  { id: "health", name: "Kesehatan", icon: "medical_services" },
  { id: "other", name: "Lainnya", icon: "more_horiz" },
];

const LEGACY_STORAGE_KEY = "rapi-expense-tracker-v1";
const THEME_KEY = "rapi-theme";
const PROFILE_KEY = "rapi-profile";
const money = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const state = { month: "", budget: 0, transactions: [], history: [], archive: null };
let toastTimeout;
let profileStorageKey = PROFILE_KEY;
let authMode = "login";

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  const button = document.getElementById("theme-toggle");
  button.innerHTML = `<span class="material-symbols-rounded" aria-hidden="true">${isDark ? "light_mode" : "dark_mode"}</span>`;
  button.setAttribute("aria-label", isDark ? "Aktifkan tema terang" : "Aktifkan tema gelap");
  button.title = isDark ? "Aktifkan tema terang" : "Aktifkan tema gelap";
}

function initializeTheme() {
  try {
    applyTheme(localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light");
  } catch (error) {
    console.error("Gagal membaca preferensi tema.", error);
    applyTheme("light");
  }
}

function profileInitials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("id-ID");
}

function renderProfile(profile) {
  document.getElementById("profile-name").textContent = profile.name;
  document.getElementById("profile-subtitle").textContent = profile.subtitle || " ";
  document.querySelector(".avatar").textContent = profileInitials(profile.name);
}

function initializeProfile(username) {
  profileStorageKey = `${PROFILE_KEY}:${username.toLocaleLowerCase("id-ID")}`;
  let profile = { name: username, subtitle: "Akun pribadi" };
  try {
    const saved = JSON.parse(localStorage.getItem(profileStorageKey) || "null");
    if (saved && typeof saved.name === "string" && typeof saved.subtitle === "string") {
      profile = {
        name: saved.name.trim().slice(0, 30) || username,
        subtitle: saved.subtitle.trim().slice(0, 40),
      };
    }
  } catch (error) {
    console.error("Gagal membaca pengaturan profil.", error);
    showToast("Pengaturan profil tidak dapat dibaca.");
  }
  renderProfile(profile);
}

function todayString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value) {
  return money.format(value).replace(/\u00a0/g, " ");
}

function getCategory(id) {
  return categories.find((category) => category.id === id) || categories[categories.length - 1];
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatMonth(monthString) {
  const date = new Date(`${monthString}-01T00:00:00`);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function materialIcon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status}).`);
  return data;
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  state.month = data.month;
  state.budget = data.budget;
  state.transactions = data.transactions;
  state.history = data.history;
}

async function migrateLegacyData() {
  let saved;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    saved = JSON.parse(raw);
  } catch (error) {
    console.error("Data transaksi lama di browser tidak dapat dibaca.", error);
    showToast("Data lama di browser tidak dapat dibaca.");
    return;
  }

  if (!saved || !Number.isFinite(Number(saved.budget)) || !Array.isArray(saved.transactions)) return;
  try {
    const result = await api("/api/migrate", {
      method: "POST",
      body: JSON.stringify({ budget: Number(saved.budget), transactions: saved.transactions }),
    });
    if (result.imported) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      await loadDashboard();
      showToast("Data pengeluaran lama berhasil dipindahkan ke database.");
    }
  } catch (error) {
    if (!error.message.includes("database_not_empty")) {
      console.error("Gagal memindahkan data lama ke database.", error);
      showToast(`Data lama belum berhasil dipindahkan: ${error.message}`);
    }
  }
}

function render() {
  const transactions = state.transactions;
  const spent = transactions.reduce((total, transaction) => total + Number(transaction.amount), 0);
  const remaining = state.budget - spent;
  const percent = state.budget > 0 ? (spent / state.budget) * 100 : 0;
  const cappedPercent = Math.min(percent, 100);
  const status = percent >= 100 ? "danger" : percent >= 75 ? "warning" : "safe";

  document.getElementById("current-month").textContent = formatMonth(state.month);
  document.getElementById("budget-total").textContent = formatMoney(state.budget);
  document.getElementById("spent-total").textContent = formatMoney(spent);
  document.getElementById("spent-percent").textContent = `${Math.round(percent)}%`;
  document.getElementById("remaining-total").textContent = formatMoney(Math.max(remaining, 0));
  document.getElementById("progress-spent").textContent = formatMoney(spent);
  document.getElementById("progress-budget").textContent = formatMoney(state.budget);
  document.getElementById("progress-percent").textContent = `${Math.round(percent)}%`;
  document.getElementById("legend-spent").textContent = formatMoney(spent);
  document.getElementById("legend-remaining").textContent = formatMoney(Math.max(remaining, 0));
  const progress = document.querySelector('[role="progressbar"]');
  progress.setAttribute("aria-valuenow", String(Math.round(cappedPercent)));
  document.getElementById("progress-fill").style.width = `${cappedPercent}%`;
  document.getElementById("progress-fill").className = `progress-fill ${status === "safe" ? "" : status}`;
  document.getElementById("status-label").textContent = status === "danger" ? "Melebihi batas" : status === "warning" ? "Hati-hati" : "Aman";
  document.querySelector(".remaining-card").className = `summary-card remaining-card ${status === "safe" ? "" : `is-${status}`}`;
  document.getElementById("remaining-caption").textContent = remaining < 0
    ? `Melebihi batas ${formatMoney(Math.abs(remaining))}`
    : status === "warning" ? "Pengeluaran mulai mendekati batas" : "Kamu masih punya ruang untuk bulan ini";
  const note = document.getElementById("spending-note");
  note.className = `spending-note ${status === "safe" ? "" : status}`;
  document.getElementById("spending-note-text").textContent = status === "danger"
    ? "Batas bulanan terlewati. Coba tahan pengeluaran yang tidak mendesak, ya."
    : status === "warning" ? "Pengeluaranmu mulai mendekati batas. Yuk, lebih cermat sampai akhir bulan."
    : "Kamu masih berada di jalur yang aman. Pertahankan, ya!";
  document.getElementById("category-overview").innerHTML = renderCategoryOverview(transactions);
  document.getElementById("category-grid").innerHTML = renderCategoryCards(transactions);
  renderTransactionRows(transactions, "transaction-rows");
  renderAllTransactions(transactions);
  renderBudgetView(spent, remaining, cappedPercent, status);
  renderHistoryList();
  document.getElementById("empty-transactions").classList.toggle("hidden", transactions.length > 0);
  document.querySelector("#recent-transactions .table-wrap table").classList.toggle("hidden", transactions.length === 0);
  syncBudgetInputs();
}

function categoryTotals(transactions) {
  return categories.map((category) => ({
    ...category,
    total: transactions.reduce((sum, transaction) =>
      transaction.category === category.id ? sum + Number(transaction.amount) : sum, 0),
    count: transactions.filter((transaction) => transaction.category === category.id).length,
  }));
}

function renderCategoryOverview(transactions) {
  const totals = categoryTotals(transactions).filter((category) => category.total > 0)
    .sort((a, b) => b.total - a.total).slice(0, 4);
  if (!totals.length) return '<p class="category-empty">Belum ada pengeluaran bulan ini.</p>';
  const max = totals[0].total;
  return totals.map((category) => `
    <div class="category-row">
      <span class="category-icon">${materialIcon(category.icon)}</span>
      <span class="category-meta"><span class="category-name">${escapeHtml(category.name)}</span><span class="category-count">${category.count} transaksi</span></span>
      <span class="mini-track"><span class="mini-fill" style="display:block;width:${Math.max(category.total / max * 100, 4)}%"></span></span>
      <span class="category-amount">${formatMoney(category.total)}</span>
    </div>`).join("");
}

function renderCategoryCards(transactions) {
  return categoryTotals(transactions).map((category) => `
    <article class="category-card">
      <span class="category-icon">${materialIcon(category.icon)}</span>
      <span class="category-card-copy"><strong>${escapeHtml(category.name)}</strong><span>${formatMoney(category.total)} · ${category.count} transaksi</span></span>
    </article>`).join("");
}

function transactionRow(transaction) {
  const category = getCategory(transaction.category);
  return `<tr>
    <td><span class="transaction-name"><span class="transaction-symbol">${materialIcon(category.icon)}</span>${escapeHtml(transaction.name)}</span></td>
    <td><span class="table-category"><span class="category-icon">${materialIcon(category.icon)}</span>${escapeHtml(category.name)}</span></td>
    <td>${formatDate(transaction.date)}</td>
    <td class="amount-cell">${formatMoney(Number(transaction.amount))}</td>
  </tr>`;
}

function renderTransactionRows(transactions, targetId) {
  document.getElementById(targetId).innerHTML = transactions.slice(0, 5).map(transactionRow).join("");
}

function renderAllTransactions(transactions) {
  const filter = document.getElementById("transaction-filter").value;
  const filtered = filter === "all" ? transactions : transactions.filter((transaction) => transaction.category === filter);
  document.getElementById("all-transaction-rows").innerHTML = filtered.map(transactionRow).join("");
  document.getElementById("empty-all-transactions").classList.toggle("hidden", filtered.length > 0);
  document.querySelector("#transactions-view .table-wrap table").classList.toggle("hidden", filtered.length === 0);
}

function renderBudgetView(spent, remaining, percent, status) {
  document.getElementById("budget-view-total").textContent = formatMoney(state.budget);
  document.getElementById("budget-view-spent").textContent = formatMoney(spent);
  document.getElementById("budget-view-remaining").textContent = formatMoney(Math.max(remaining, 0));
  document.getElementById("budget-view-fill").style.width = `${percent}%`;
  document.getElementById("budget-view-fill").className = `progress-fill ${status === "safe" ? "" : status}`;
  document.getElementById("budget-view-percent").textContent = `${Math.round(spent / state.budget * 100)}% terpakai`;
}

function renderHistoryList() {
  const select = document.getElementById("history-month");
  const selectedMonth = select.value;
  select.innerHTML = state.history.map((summary) =>
    `<option value="${summary.month}">${escapeHtml(formatMonth(summary.month))}</option>`).join("");
  if (state.history.some((summary) => summary.month === selectedMonth)) {
    select.value = selectedMonth;
  }
  document.getElementById("history-empty").classList.toggle("hidden", state.history.length > 0);
  document.getElementById("history-content").classList.toggle("hidden", state.history.length === 0);
  select.classList.toggle("hidden", state.history.length === 0);
  document.getElementById("history-print").classList.toggle("hidden", state.history.length === 0);
  if (state.history.length && select.value) loadHistoryDetail(select.value);
}

async function loadHistoryDetail(month) {
  if (!month) return;
  try {
    const archive = await api(`/api/history/${encodeURIComponent(month)}`);
    if (document.getElementById("history-month").value !== month) return;
    state.archive = archive;
    const remaining = archive.budget - archive.spent;
    document.getElementById("history-title").textContent = formatMonth(archive.month);
    document.getElementById("history-budget").textContent = formatMoney(archive.budget);
    document.getElementById("history-spent").textContent = formatMoney(archive.spent);
    document.getElementById("history-budget-status-label").textContent =
      remaining < 0 ? "Melebihi anggaran" : "Sisa anggaran";
    document.getElementById("history-remaining").textContent = formatMoney(Math.abs(remaining));
    document.getElementById("history-transaction-count").textContent =
      `${archive.transaction_count} transaksi`;
    document.getElementById("history-category-list").innerHTML = archive.categories.map((item) => {
      const category = getCategory(item.category);
      return `<div class="history-category-row"><span class="category-icon">${materialIcon(category.icon)}</span><span>${escapeHtml(category.name)}</span><strong>${formatMoney(item.amount)}</strong></div>`;
    }).join("");
    document.getElementById("history-rows").innerHTML = archive.transactions.map(transactionRow).join("");
  } catch (error) {
    console.error("Gagal memuat riwayat bulanan.", error);
    showToast(`Riwayat tidak dapat dimuat: ${error.message}`);
  }
}

function setupCategoryInputs() {
  const categoryOptions = categories.map((category) =>
    `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  document.getElementById("expense-category").innerHTML = categoryOptions;
  document.getElementById("transaction-filter").insertAdjacentHTML("beforeend", categories.map((category) =>
    `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join(""));
}

function syncBudgetInputs() {
  document.getElementById("budget-amount").value = String(state.budget);
}

const viewDetails = {
  dashboard: { title: "Ringkasan keuangan", breadcrumb: "Ringkasan", subtitle: "Pantau pengeluaranmu, tetap aman sampai akhir bulan." },
  transactions: { title: "Riwayat transaksi", breadcrumb: "Transaksi", subtitle: "Semua catatan pengeluaranmu, tersusun rapi." },
  budget: { title: "Anggaran bulanan", breadcrumb: "Anggaran", subtitle: "Rencanakan pengeluaran agar tetap sesuai kemampuan." },
  categories: { title: "Kategori pengeluaran", breadcrumb: "Kategori", subtitle: "Lihat rincian pengeluaran berdasarkan kebutuhanmu." },
  history: { title: "Riwayat bulanan", breadcrumb: "Riwayat", subtitle: "Lihat dan cetak laporan pengeluaran bulan-bulan sebelumnya." },
};

function showView(viewName) {
  const view = viewDetails[viewName] || viewDetails.dashboard;
  document.querySelectorAll(".nav-item").forEach((item) =>
    item.classList.toggle("active", item.dataset.view === viewName));
  document.getElementById("page-title").textContent = view.title;
  document.getElementById("page-breadcrumb").textContent = view.breadcrumb;
  document.getElementById("page-subtitle").textContent = view.subtitle;
  document.querySelector(".summary-grid").classList.toggle("hidden", viewName !== "dashboard");
  document.querySelector(".content-grid").classList.toggle("hidden", viewName !== "dashboard");
  document.getElementById("recent-transactions").classList.toggle("hidden", viewName !== "dashboard");
  ["transactions", "budget", "categories", "history"].forEach((name) =>
    document.getElementById(`${name}-view`).classList.toggle("hidden", name !== viewName));
  document.querySelector(".eyebrow").classList.toggle("hidden", viewName !== "dashboard");
  if (viewName === "history") renderHistoryList();
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialogs() {
  document.querySelectorAll("dialog[open]").forEach((dialog) => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 3500);
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegistering = mode === "register";
  document.getElementById("auth-title").textContent =
    isRegistering ? "Buat akun baru" : "Masuk ke akunmu";
  document.getElementById("auth-description").textContent = isRegistering
    ? "Buat akun dengan username dan password untuk menyimpan data pribadimu."
    : "Masuk untuk melihat transaksi dan anggaran pribadimu.";
  document.getElementById("auth-submit").textContent = isRegistering ? "Daftar" : "Masuk";
  document.getElementById("auth-switch").textContent = isRegistering
    ? "Sudah punya akun? Masuk"
    : "Belum punya akun? Daftar";
  document.getElementById("auth-hint").classList.toggle("hidden", !isRegistering);
  const password = document.getElementById("auth-password");
  password.autocomplete = isRegistering ? "new-password" : "current-password";
  if (isRegistering) password.minLength = 8;
  else password.removeAttribute("minlength");
}

function showAuth() {
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-page").classList.remove("hidden");
}

function showApp(username) {
  document.getElementById("auth-page").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("account-username").textContent = username;
  initializeProfile(username);
}

async function loadAuthenticatedData() {
  await loadDashboard();
  await migrateLegacyData();
  render();
}

document.getElementById("auth-switch").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
  document.getElementById("auth-error").classList.add("hidden");
});

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    username: String(form.get("username")).trim(),
    password: String(form.get("password")),
  };
  const error = document.getElementById("auth-error");
  error.classList.add("hidden");
  try {
    const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const user = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showApp(user.username);
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove("hidden");
    return;
  }
  try {
    await loadAuthenticatedData();
  } catch (requestError) {
    console.error("Gagal memuat data akun.", requestError);
    showToast(`Data akun tidak dapat dimuat: ${requestError.message}`);
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    document.getElementById("auth-form").reset();
    setAuthMode("login");
    showAuth();
  } catch (error) {
    console.error("Gagal keluar dari akun.", error);
    showToast(`Tidak dapat keluar: ${error.message}`);
  }
});

document.querySelectorAll("[data-open-transaction]").forEach((button) =>
  button.addEventListener("click", () => {
    document.getElementById("transaction-form").reset();
    const today = todayString();
    document.getElementById("expense-date").value =
      today.slice(0, 7) === state.month ? today : `${state.month}-01`;
    document.getElementById("transaction-error").classList.add("hidden");
    openDialog(document.getElementById("transaction-modal"));
    document.getElementById("expense-name").focus();
  }));

document.querySelectorAll("[data-edit-budget]").forEach((button) =>
  button.addEventListener("click", () => {
    syncBudgetInputs();
    document.getElementById("budget-error").classList.add("hidden");
    openDialog(document.getElementById("budget-modal"));
    document.getElementById("budget-amount").focus();
  }));

document.querySelectorAll("[data-close-modal]").forEach((button) =>
  button.addEventListener("click", closeDialogs));

document.querySelectorAll("[data-view]").forEach((button) =>
  button.addEventListener("click", () => showView(button.dataset.view)));

document.querySelectorAll("[data-view-link]").forEach((button) =>
  button.addEventListener("click", () => {
    showView(button.dataset.viewLink);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));

document.getElementById("transaction-filter").addEventListener("change", render);
document.getElementById("history-month").addEventListener("change", (event) => loadHistoryDetail(event.target.value));
document.getElementById("history-print").addEventListener("click", () => {
  if (state.archive) window.print();
});

document.getElementById("theme-toggle").addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  try {
    localStorage.setItem(THEME_KEY, nextTheme);
  } catch (error) {
    console.error("Gagal menyimpan preferensi tema.", error);
    showToast("Pilihan tema tidak dapat disimpan.");
  }
});

document.getElementById("profile-open").addEventListener("click", () => {
  document.getElementById("profile-name-input").value = document.getElementById("profile-name").textContent;
  document.getElementById("profile-subtitle-input").value = document.getElementById("profile-subtitle").textContent.trim();
  openDialog(document.getElementById("profile-modal"));
  document.getElementById("profile-name-input").focus();
});

document.getElementById("profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const profile = {
    name: String(form.get("name")).trim(),
    subtitle: String(form.get("subtitle") || "").trim(),
  };
  if (!profile.name) {
    document.getElementById("profile-name-input").reportValidity();
    return;
  }
  try {
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  } catch (error) {
    console.error("Gagal menyimpan pengaturan profil.", error);
    showToast("Profil tidak dapat disimpan di browser ini.");
    return;
  }
  renderProfile(profile);
  closeDialogs();
  showToast("Profil berhasil diperbarui.");
});

document.getElementById("transaction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const transaction = {
    name: String(form.get("name")).trim(),
    amount: Number(form.get("amount")),
    date: String(form.get("date")),
    category: String(form.get("category")),
  };
  const error = document.getElementById("transaction-error");
  if (!transaction.name || !Number.isSafeInteger(transaction.amount) || transaction.amount < 1 ||
      !categories.some((item) => item.id === transaction.category) || !transaction.date) {
    error.textContent = "Lengkapi semua data dengan benar. Nominal harus berupa rupiah bulat.";
    error.classList.remove("hidden");
    return;
  }
  if (transaction.date.slice(0, 7) !== state.month) {
    error.textContent = `Tanggal transaksi harus berada di bulan berjalan (${formatMonth(state.month)}).`;
    error.classList.remove("hidden");
    return;
  }
  try {
    await api("/api/transactions", { method: "POST", body: JSON.stringify(transaction) });
    closeDialogs();
    await loadDashboard();
    render();
    showToast("Pengeluaran berhasil dicatat.");
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove("hidden");
  }
});

document.getElementById("budget-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Number(document.getElementById("budget-amount").value);
  const error = document.getElementById("budget-error");
  if (!Number.isSafeInteger(amount) || amount < 1) {
    error.textContent = "Masukkan batas anggaran berupa rupiah bulat lebih besar dari nol.";
    error.classList.remove("hidden");
    return;
  }
  try {
    await api("/api/budget", { method: "PUT", body: JSON.stringify({ amount }) });
    closeDialogs();
    await loadDashboard();
    render();
    showToast("Batas anggaran berhasil diperbarui.");
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove("hidden");
  }
});

document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialogs();
  }));

async function initialize() {
  setupCategoryInputs();
  initializeTheme();
  setAuthMode("login");
  try {
    const auth = await api("/api/auth/session");
    if (auth.authenticated) {
      showApp(auth.username);
    } else {
      showAuth();
      return;
    }
  } catch (error) {
    console.error("Gagal menghubungi backend Acumalaka Tracker.", error);
    showAuth();
    const authError = document.getElementById("auth-error");
    authError.textContent = `Backend belum tersedia: ${error.message}. Jalankan python app.py.`;
    authError.classList.remove("hidden");
    return;
  }
  try {
    await loadAuthenticatedData();
  } catch (error) {
    console.error("Gagal memuat data akun.", error);
    showToast(`Data akun tidak dapat dimuat: ${error.message}`);
  }
}

initialize();
