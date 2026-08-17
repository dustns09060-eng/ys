const $ = (id) => document.getElementById(id);

let roomList = [];
let roomAuditSource = [];
let matchRoomList = [];
let result = { all: [], mutual: [], onlyMe: [], fansOnly: [], neither: [] };
let currentTab = "all";
let currentGroup = 0;
let currentCopyBatch = 0;
let installPrompt = null;
let adminLoggedIn = false;
let adminPasswordValue = "";
let publicConfig = null;
let accessGranted = false;
let appLockGranted = false;
let matchGranted = false;
let followGranted = false;
let gateMode = "loading";
let securityVersion = "";
let noticeSignature = "";
const APP_VERSION = "V43";

let config = {
  version: "V43 ROSTER AUDIT",
  appName: "여우방 팔로우리스트+맞팔확인",
  apiUrl: "",
  sheetId: "",
  sheetName: "팔로우리스트",
  fallbackCsv: "room-list.csv",
};

const FOLLOW_PROGRESS_KEY = "yeowoobang:lastFollowPosition:v1";
const FOLLOW_DAILY_KEY = "yeowoobang:dailyFollowVisits:v1";
const FOLLOW_LIST_CACHE_KEY = "yeowoobang:followListCache:v1";
const FOLLOW_LIST_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
const ROSTER_BASELINE_KEY = "yeowoobang:adminRosterBaseline:v1";
let lastRosterAudit = null;
const JSZIP_CDN_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
let jsZipLoadPromise = null;

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStorageJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeStorageJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

function formatResumeTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const today = localDateKey();
  const target = localDateKey(date);
  const time = date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (target === today) return `오늘 ${time}`;

  return `${date.toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  })} ${time}`;
}

function getDailyVisitData() {
  const today = localDateKey();
  const saved = readStorageJson(FOLLOW_DAILY_KEY, null);

  if (!saved || saved.date !== today || !Array.isArray(saved.ids)) {
    return { date: today, ids: [] };
  }

  return saved;
}

function recordDailyVisit(id) {
  const daily = getDailyVisitData();
  if (!daily.ids.includes(id)) daily.ids.push(id);
  writeStorageJson(FOLLOW_DAILY_KEY, daily);
  renderResumeCard();
}

function saveLastFollowPosition(item) {
  const index = roomList.findIndex((person) => person.id === item.id);
  const group = index >= 0 ? Math.floor(index / 500) + 1 : Math.max(currentGroup, 1);

  const data = {
    group,
    no: String(item.no || ""),
    name: String(item.name || ""),
    id: String(item.id || ""),
    timestamp: Date.now(),
  };

  if (writeStorageJson(FOLLOW_PROGRESS_KEY, data)) {
    recordDailyVisit(data.id);
    renderResumeCard();
  }
}

function getLastFollowPosition() {
  const saved = readStorageJson(FOLLOW_PROGRESS_KEY, null);
  if (!saved || !validUsername(normalize(saved.id))) return null;
  return {
    ...saved,
    id: normalize(saved.id),
    group: Math.max(1, Number(saved.group) || 1),
  };
}

function renderResumeCard() {
  const card = $("resumeCard");
  if (!card) return;

  const last = getLastFollowPosition();
  const daily = getDailyVisitData();

  $("todayVisitCount").textContent = `오늘 ${daily.ids.length}명`;

  if (!last) {
    card.classList.add("hidden");
    return;
  }

  $("resumeLocation").textContent = `${last.group}조 · ${last.no}번`;
  $("resumeName").textContent = last.name || "닉네임 없음";
  $("resumeId").textContent = `@${last.id}`;
  $("resumeTime").textContent = formatResumeTime(last.timestamp);
  card.classList.remove("hidden");
}

function clearLastFollowPosition() {
  try {
    localStorage.removeItem(FOLLOW_PROGRESS_KEY);
  } catch (_) {}

  renderResumeCard();
  toast("이어보기 기록을 초기화했습니다.");
}

function highlightFollowItem(id) {
  const target = document.querySelector(
    `.follow-item[data-follow-id="${CSS.escape(id)}"]`
  );

  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("resume-highlight");

  setTimeout(() => {
    target.classList.remove("resume-highlight");
  }, 2600);

  return true;
}

function resumeLastFollowPosition() {
  const last = getLastFollowPosition();
  if (!last) {
    toast("저장된 이어보기 기록이 없습니다.");
    return;
  }

  $("followSearch").value = "";
  currentGroup = last.group;
  currentCopyBatch = 0;
  renderGroupTabs();
  renderCopyBatches();
  renderFollowList();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!highlightFollowItem(last.id)) {
        toast("명단에서 마지막 위치를 찾지 못했습니다.");
      }
    });
  });
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.style.display = "none"), 1900);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/^instagram\.com\//, "")
    .replace(/^_u\//, "")
    .replace(/^@+/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .trim();
}

function validUsername(value) {
  return /^[a-z0-9._]{1,30}$/.test(value) &&
    !["instagram", "accounts", "explore", "direct", "p", "reels", "stories", "www", "about", "privacy", "terms", "login", "_u"].includes(value);
}

function unique(values) {
  const set = new Set();
  for (const value of values || []) {
    const id = normalize(value);
    if (validUsername(id)) set.add(id);
  }
  return [...set];
}


function saveFollowListCache(list) {
  if (!Array.isArray(list) || !list.length) return;

  writeStorageJson(FOLLOW_LIST_CACHE_KEY, {
    savedAt: Date.now(),
    members: list.map((item) => ({
      no: item.no,
      name: item.name,
      id: item.id,
    })),
  });
}

function restoreFollowListCache() {
  const cached = readStorageJson(FOLLOW_LIST_CACHE_KEY, null);
  if (!cached || !Array.isArray(cached.members) || !cached.members.length) {
    return false;
  }

  const age = Date.now() - Number(cached.savedAt || 0);
  if (!Number.isFinite(age) || age > FOLLOW_LIST_CACHE_MAX_AGE) {
    return false;
  }

  const restored = cached.members
    .map((item, index) => ({
      no: item.no || index + 1,
      name: String(item.name || ""),
      id: normalize(item.id),
    }))
    .filter((item) => validUsername(item.id));

  if (!restored.length) return false;

  roomList = restored;
  updateFollowStats();
  renderGroupTabs();
  renderCopyBatches();
  renderFollowList();
  renderResumeCard();

  if ($("followState")) {
    $("followState").textContent =
      `저장된 명단 ${roomList.length}명을 먼저 표시했습니다. 최신 명단 확인 중...`;
  }

  return true;
}

function scheduleNoticeLoad(delay = 2000) {
  window.setTimeout(() => {
    if (accessGranted) {
      loadNotices(false).catch(() => {});
    }
  }, delay);
}

function loadJsZipLibrary() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jsZipLoadPromise) return jsZipLoadPromise;

  jsZipLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jszip-lazy="true"]');

    if (existing) {
      existing.addEventListener("load", () => resolve(window.JSZip), { once: true });
      existing.addEventListener("error", () => reject(new Error("ZIP 분석 라이브러리를 불러오지 못했습니다.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = JSZIP_CDN_URL;
    script.async = true;
    script.dataset.jszipLazy = "true";

    script.onload = () => {
      if (window.JSZip) {
        resolve(window.JSZip);
      } else {
        reject(new Error("ZIP 분석 라이브러리를 불러오지 못했습니다."));
      }
    };

    script.onerror = () => {
      jsZipLoadPromise = null;
      reject(new Error("ZIP 분석 라이브러리를 불러오지 못했습니다."));
    };

    document.head.appendChild(script);
  });

  return jsZipLoadPromise;
}

async function loadConfig() {
  try {
    const response = await fetch(`config.json?t=${Date.now()}`, { cache: "no-store" });
    if (response.ok) config = { ...config, ...(await response.json()) };
  } catch (_) {}
}

async function apiGet(action) {
  if (!config.apiUrl) throw new Error("Apps Script 주소가 설정되지 않았습니다.");
  const url = new URL(config.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("_t", Date.now().toString());

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "API 요청 실패");
  return data;
}

async function apiPost(action, payload = {}) {
  if (!config.apiUrl) throw new Error("Apps Script 주소가 설정되지 않았습니다.");

  const params = new URLSearchParams();
  params.set("action", action);
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  });

  const response = await fetch(config.apiUrl, {
    method: "POST",
    body: params,
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "API 요청 실패");
  return data;
}

function setGate(mode, message = "") {
  gateMode = mode;
  const title = $("gateTitle");
  const text = $("gateMessage");
  const roles = $("gateRoleSelect");
  const form = $("gateForm");
  const retryBtn = $("gateRetryBtn");
  const password = $("gatePassword");

  $("gateError").textContent = "";
  roles.classList.add("hidden");
  form.classList.add("hidden");
  retryBtn.classList.add("hidden");
  password.value = "";

  if (mode === "loading") {
    title.textContent = "접속 확인";
    text.textContent = message || "설정을 불러오는 중입니다.";
  } else if (mode === "role") {
    title.textContent = "여우방";
    text.textContent = "";
    roles.classList.remove("hidden");
  } else if (mode === "access") {
    title.textContent = "이용하기";
    text.textContent = "";
    password.placeholder = "접속 비밀번호";
    form.classList.remove("hidden");
  } else if (mode === "admin") {
    title.textContent = "운영진";
    text.textContent = "";
    password.placeholder = "운영진 비밀번호";
    form.classList.remove("hidden");
  } else if (mode === "blocked") {
    title.textContent = "앱 잠금 중";
    text.textContent = "현재 일반 접속이 잠겨 있습니다.";
    form.classList.remove("hidden");
    password.classList.add("hidden");
    $("gateSubmitBtn").classList.add("hidden");
  } else if (mode === "error") {
    title.textContent = "연결 확인 필요";
    text.textContent = message || "연결에 실패했습니다.";
    retryBtn.classList.remove("hidden");
  }

  if (mode !== "blocked") {
    password.classList.remove("hidden");
    $("gateSubmitBtn").classList.remove("hidden");
  }
}

function showGate() {
  $("appGate").classList.remove("hidden");
  document.body.classList.add("gate-open");
}

function hideGate() {
  $("appGate").classList.add("hidden");
  document.body.classList.remove("gate-open");
}

function setAdminNavigation(enabled) {
  $("adminNavBtn")?.classList.toggle("hidden", !enabled);
  $("noticeNavBtn")?.classList.toggle("hidden", enabled);
}

function finishBootScreen() {
  if (window.__yeowoobangBootTimer) {
    clearTimeout(window.__yeowoobangBootTimer);
    window.__yeowoobangBootTimer = null;
  }
  const boot = document.getElementById("bootScreen");
  if (boot) boot.remove();
}

async function bootstrapAuth() {
  showGate();
  setGate("loading");

  try {
    publicConfig = await apiGet("publicConfig");
    updateLockIndicators();
    setGate("role");
  } catch (error) {
    setGate("error", `설정을 불러오지 못했습니다. ${error.message}`);
  }
}

function chooseGeneralAccess() {
  if (publicConfig?.appLocked) {
    setGate("blocked");
    return;
  }
  setGate("access");
}

function chooseAdminAccess() {
  setGate("admin");
}

function backToRoleSelect() {
  setGate("role");
}

async function submitGatePassword() {
  const password = $("gatePassword").value.trim();
  if (!password) {
    $("gateError").textContent = "비밀번호를 입력해 주세요.";
    return;
  }

  try {
    $("gateSubmitBtn").disabled = true;

    if (gateMode === "access") {
      await apiPost("verifyAccessPassword", { password });
      accessGranted = true;
      adminLoggedIn = false;
      adminPasswordValue = "";
      setAdminNavigation(false);
      hideGate();
      showView("followView");
      await loadAfterAuth();
      return;
    }

    if (gateMode === "admin") {
      await apiPost("adminLogin", { password });
      adminLoggedIn = true;
      adminPasswordValue = password;
      accessGranted = true;
      matchGranted = true;
      followGranted = true;
      setAdminNavigation(true);
      hideGate();
      await loadAfterAuth();
      showView("adminView");
      showAdminPanel();
      loadAdminLogs();
      toast("운영진으로 접속했습니다.");
    }
  } catch (error) {
    $("gateError").textContent =
      gateMode === "admin"
        ? "운영진 비밀번호가 올바르지 않습니다."
        : "접속 비밀번호가 올바르지 않습니다.";
  } finally {
    $("gateSubmitBtn").disabled = false;
  }
}

async function loadAfterAuth() {
  restoreFollowListCache();

  const essentialTasks = [
    loadRoomList(false),
    refreshPublicConfig(false),
  ];

  scheduleNoticeLoad(2000);

  await Promise.allSettled(essentialTasks);
  securityVersion = publicConfig?.securityVersion || "";
  checkVersionUpdate();
}

async function refreshPublicConfig(recheck = true) {
  const previousSecurity = securityVersion || publicConfig?.securityVersion || "";
  publicConfig = await apiGet("publicConfig");
  updateLockIndicators();
  applyFollowLock();
  applyMatchLock();
  checkVersionUpdate();

  const nextSecurity = publicConfig?.securityVersion || "";
  if (recheck && previousSecurity && nextSecurity && previousSecurity !== nextSecurity && !adminLoggedIn) {
    securityVersion = nextSecurity;
    accessGranted = false;
    appLockGranted = false;
    matchGranted = false;
    followGranted = false;
    toast("보안 설정이 변경되어 다시 로그인합니다.");
    setAdminNavigation(false);
    await bootstrapAuth();
    return;
  }
  securityVersion = nextSecurity;
}

function checkVersionUpdate() {
  if (!publicConfig?.forceUpdate) return;
  const serverVersion = String(publicConfig.version || "").trim().toUpperCase();
  if (!serverVersion || serverVersion === APP_VERSION) return;
  $("updateMessage").textContent = `현재 ${APP_VERSION} · 최신 ${serverVersion}`;
  $("updateOverlay").classList.remove("hidden");
}

function updateLockIndicators() {
  const appLocked = Boolean(publicConfig?.appLocked);
  const matchLocked = Boolean(publicConfig?.matchLocked);
  const followLocked = Boolean(publicConfig?.followLocked);

  if ($("appLockState")) {
    $("appLockState").textContent = appLocked ? "잠금 중" : "사용 가능";
    $("appLockState").className = `lock-state ${appLocked ? "locked" : "unlocked"}`;
  }

  if ($("matchLockState")) {
    $("matchLockState").textContent = matchLocked ? "잠금 중" : "사용 가능";
    $("matchLockState").className = `lock-state ${matchLocked ? "locked" : "unlocked"}`;
  }

  if ($("followLockState")) {
    $("followLockState").textContent = followLocked ? "잠금 중" : "사용 가능";
    $("followLockState").className = `lock-state ${followLocked ? "locked" : "unlocked"}`;
  }
}

function applyFollowLock() {
  const locked = Boolean(publicConfig?.followLocked) && !followGranted && !adminLoggedIn;
  $("followLockCard")?.classList.toggle("hidden", !locked);
  $("followContent")?.classList.toggle("hidden", locked);
}

async function unlockFollow() {
  const password = $("followPassword").value.trim();
  if (!password) {
    $("followUnlockMsg").textContent = "비밀번호를 입력해 주세요.";
    return;
  }

  try {
    await apiPost("verifyFollowPassword", { password });
    followGranted = true;
    $("followUnlockMsg").textContent = "";
    $("followPassword").value = "";
    applyFollowLock();
    toast("팔로우리스트 잠금이 해제되었습니다.");
  } catch (_) {
    $("followUnlockMsg").textContent = "팔로우리스트 비밀번호가 올바르지 않습니다.";
  }
}

function applyMatchLock() {
  const locked = Boolean(publicConfig?.matchLocked) && !matchGranted && !adminLoggedIn;
  $("matchLockCard").classList.toggle("hidden", !locked);
  $("matchContent").classList.toggle("hidden", locked);
}

async function unlockMatch() {
  const password = $("matchPassword").value.trim();
  if (!password) {
    $("matchUnlockMsg").textContent = "비밀번호를 입력해 주세요.";
    return;
  }

  try {
    await apiPost("verifyMatchPassword", { password });
    matchGranted = true;
    $("matchUnlockMsg").textContent = "";
    $("matchPassword").value = "";
    applyMatchLock();
    await loadMatchRoomList(false).catch(() => {});
    toast("맞팔확인 잠금이 해제되었습니다.");
  } catch (_) {
    $("matchUnlockMsg").textContent = "맞팔확인 비밀번호가 올바르지 않습니다.";
  }
}

function sheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (cell || row.length) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
      if (char === "\r" && next === "\n") i++;
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function rowsToAuditSource(rows) {
  const list = [];
  rows.forEach((row, index) => {
    const joined = row.join(" ");
    if (index === 0 && (joined.includes("번호") || joined.includes("닉네임") || joined.includes("아이디"))) return;
    if (!row.some((cell) => String(cell || "").trim())) return;

    list.push({
      no: String(row[0] || "").trim(),
      name: String(row[1] || "").trim(),
      idRaw: String(row[2] || "").trim(),
      id: normalize(row[2] || ""),
    });
  });
  return list;
}

function rowsToRoom(rows) {
  const list = [];
  rows.forEach((row, index) => {
    const joined = row.join(" ");
    if (index === 0 && (joined.includes("번호") || joined.includes("닉네임") || joined.includes("아이디"))) return;

    const id = normalize(row[2] || row[1] || row[0]);
    if (validUsername(id)) {
      list.push({
        no: row[0] || list.length + 1,
        name: row[1] || "",
        id,
      });
    }
  });

  const seen = new Set();
  return list.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

async function loadRoomList(show = false) {
  setSheetState("불러오는 중");
  let lastError = "";

  try {
    const data = await apiGet("followList");
    roomAuditSource = (data.members || []).map((item) => ({
      no: String(item.no || "").trim(),
      name: String(item.name || "").trim(),
      idRaw: String(item.id || "").trim(),
      id: normalize(item.id),
    }));
    roomList = (data.members || []).map((item, index) => ({
      no: item.no || index + 1,
      name: item.name || "",
      id: normalize(item.id),
    })).filter((item) => validUsername(item.id));

    if (!roomList.length) throw new Error("API 명단 0명");

    setSheetState("정상");
    updateFollowStats();
    renderGroupTabs();
    renderCopyBatches();
    renderFollowList();
    renderResumeCard();
    saveFollowListCache(roomList);
    if (adminLoggedIn) renderRosterAudit();
    if (show) toast("명단 새로고침 완료");
    return;
  } catch (error) {
    lastError = error.message;
  }

  const urls = [];
  if (config.sheetId) {
    const sheet = encodeURIComponent(config.sheetName || "Sheet1");
    urls.push(`https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:csv&sheet=${sheet}&t=${Date.now()}`);
    urls.push(`https://docs.google.com/spreadsheets/d/${config.sheetId}/export?format=csv&sheet=${sheet}&t=${Date.now()}`);
  }
  urls.push(`${config.fallbackCsv || "room-list.csv"}?t=${Date.now()}`);

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsedRows = parseCsv(await response.text());
      const list = rowsToRoom(parsedRows);
      if (!list.length) throw new Error("0명");
      roomAuditSource = rowsToAuditSource(parsedRows);
      roomList = list;
      setSheetState("백업");
      updateFollowStats();
      renderGroupTabs();
      renderCopyBatches();
      renderFollowList();
      renderResumeCard();
      saveFollowListCache(roomList);
      if (adminLoggedIn) renderRosterAudit();
      if (show) toast("백업 명단으로 불러왔습니다.");
      return;
    } catch (error) {
      lastError = error.message;
    }
  }

  setSheetState("오류");
  $("followState").textContent = `명단을 불러오지 못했습니다. (${lastError})`;
  if (show) toast("명단 불러오기 실패");
}


async function loadMatchRoomList(show = false, force = false) {
  if (!force && matchRoomList.length) {
    if ($("roomState")) {
      $("roomState").textContent = `${matchRoomList.length}명 준비 완료`;
    }
    return matchRoomList;
  }

  if ($("roomState")) {
    $("roomState").textContent = "불러오는 중";
  }

  try {
    const data = await apiGet("matchList");

    matchRoomList = (data.members || [])
      .map((item, index) => ({
        no: item.no || index + 1,
        name: item.name || "",
        id: normalize(item.id),
      }))
      .filter((item) => validUsername(item.id));

    if (!matchRoomList.length) {
      throw new Error("맞팔확인용 명단이 비어 있습니다.");
    }

    if ($("roomState")) {
      $("roomState").textContent = `${matchRoomList.length}명 준비 완료`;
    }

    if (show) {
      toast(`맞팔확인용 명단 ${matchRoomList.length}명 새로고침 완료`);
    }

    return matchRoomList;
  } catch (error) {
    matchRoomList = [];

    if ($("roomState")) {
      $("roomState").textContent = "불러오기 오류";
    }

    if ($("status")) {
      $("status").textContent = `맞팔확인용 명단을 불러오지 못했습니다. (${error.message})`;
    }

    if (show) {
      toast("맞팔확인용 명단 불러오기 실패");
    }

    throw error;
  }
}

function setSheetState(state) {
  if ($("adminApiState")) {
    $("adminApiState").textContent = state;
  }
}

function updateFollowStats() {
  const groups = Math.ceil(roomList.length / 500);
  $("followTotal").textContent = `${roomList.length}명`;
  $("groupTotal").textContent = `${groups}조`;
  $("lastRefresh").textContent = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  $("adminTotal").textContent = `${roomList.length}명`;
  $("adminGroups").textContent = `${groups}조`;
  $("followState").textContent = `전체 ${roomList.length}명 · 500명씩 ${groups}개 조`;
}


const FOLLOW_COPY_BATCH_SIZE = 40;

function currentFollowGroupItems() {
  if (currentGroup > 0) {
    return roomList.slice((currentGroup - 1) * 500, currentGroup * 500);
  }
  return roomList;
}

function renderCopyBatches() {
  const card = $("copyBatchCard");
  const container = $("copyBatchButtons");
  if (!card || !container) return;

  const items = currentFollowGroupItems();
  const totalBatches = Math.ceil(items.length / FOLLOW_COPY_BATCH_SIZE);

  $("copyBatchGroup").textContent = currentGroup > 0 ? `${currentGroup}조` : "전체";

  if (!items.length || !totalBatches) {
    card.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  if (currentCopyBatch >= totalBatches) currentCopyBatch = 0;

  container.innerHTML = Array.from({ length: totalBatches }, (_, batchIndex) => {
    const startIndex = batchIndex * FOLLOW_COPY_BATCH_SIZE;
    const endIndex = Math.min(startIndex + FOLLOW_COPY_BATCH_SIZE, items.length);
    const first = items[startIndex];
    const last = items[endIndex - 1];

    const startLabel = first?.no || startIndex + 1;
    const endLabel = last?.no || endIndex;
    const isNext = batchIndex === currentCopyBatch;

    return `
      <button
        class="copy-batch-btn ${isNext ? "next" : ""}"
        type="button"
        data-copy-batch="${batchIndex}"
        aria-label="${escapeHtml(startLabel)}번부터 ${escapeHtml(endLabel)}번까지 복사"
      >
        <span>${escapeHtml(startLabel)}~${escapeHtml(endLabel)}</span>
        <small>${endIndex - startIndex}명</small>
      </button>
    `;
  }).join("");

  $("copyBatchGuide").textContent =
    currentGroup > 0
      ? `${currentGroup}조 명단을 40명 단위로 복사합니다.`
      : "전체 명단을 40명 단위로 복사합니다.";

  card.classList.remove("hidden");

  requestAnimationFrame(() => {
    container.querySelector(".copy-batch-btn.next")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  });
}

async function copyFollowBatch(batchIndex) {
  const items = currentFollowGroupItems();
  const start = batchIndex * FOLLOW_COPY_BATCH_SIZE;
  const batch = items.slice(start, start + FOLLOW_COPY_BATCH_SIZE);

  if (!batch.length) {
    toast("복사할 명단이 없습니다.");
    return;
  }

  try {
    await writeClipboardText(
      batch
        .map((item, index) => {
          const no = String(item.no || start + index + 1).trim();
          const name = String(item.name || "").trim();
          const id = String(item.id || "").trim();
          return `${no}. ${name} @${id}`;
        })
        .join("\n")
    );

    const totalBatches = Math.ceil(items.length / FOLLOW_COPY_BATCH_SIZE);
    currentCopyBatch = batchIndex + 1 < totalBatches ? batchIndex + 1 : 0;

    const firstNo = batch[0]?.no || start + 1;
    const lastNo = batch[batch.length - 1]?.no || start + batch.length;

    renderCopyBatches();
    toast(`${firstNo}~${lastNo} · ${batch.length}명 복사 완료`);
  } catch (error) {
    toast(error.message || "40명 복사 실패");
  }
}

function renderGroupTabs() {
  const total = Math.max(1, Math.ceil(roomList.length / 500));
  $("groupTabs").innerHTML = ["전체", ...Array.from({ length: total }, (_, i) => `${i + 1}조`)]
    .map((text, index) => `<button class="group-tab ${index === currentGroup ? "active" : ""}" data-group="${index}">${text}</button>`)
    .join("");

  document.querySelectorAll(".group-tab").forEach((button) => {
    button.onclick = () => {
      currentGroup = Number(button.dataset.group);
      currentCopyBatch = 0;
      renderGroupTabs();
      renderCopyBatches();
      renderFollowList();
    };
  });
}

function followFiltered() {
  const query = String($("followSearch").value || "").trim().toLowerCase();
  let items = roomList;
  if (currentGroup > 0) items = items.slice((currentGroup - 1) * 500, currentGroup * 500);

  return query
    ? items.filter((item) =>
        String(item.no).includes(query) ||
        item.id.includes(normalize(query)) ||
        String(item.name).toLowerCase().includes(query))
    : items;
}

function renderFollowList() {
  const items = followFiltered();
  $("followList").innerHTML = items.length
    ? items.map((item) => `
      <div class="follow-item" data-follow-id="${escapeHtml(item.id)}">
        <span class="follow-no">${escapeHtml(item.no)}</span>
        <span class="follow-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <a class="follow-id" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" title="@${escapeHtml(item.id)}">@${escapeHtml(item.id)}</a>
        <a class="insta-btn" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" data-save-follow="${escapeHtml(item.id)}" aria-label="인스타그램 열기">↗ 열기</a>
      </div>`).join("")
    : '<div class="empty-state">검색 결과가 없습니다.</div>';
}

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === id));

  if (id === "followView") {
    applyFollowLock();
  }

  if (id === "matchView") {
    applyMatchLock();
    const locked = Boolean(publicConfig?.matchLocked) && !matchGranted && !adminLoggedIn;
    if (!locked && !matchRoomList.length) {
      loadMatchRoomList(false).catch(() => {});
    }
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function findFiles(zip) {
  const files = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  return {
    followers: files.filter((path) => /followers_\d+\.(html|json)$/i.test(path.replace(/\\/g, "/").split("/").pop())),
    following: files.find((path) => /^following\.(html|json)$/i.test(path.replace(/\\/g, "/").split("/").pop())),
  };
}

function extractHtml(text) {
  const ids = [];
  let match;
  let regex = /href=["']https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)\/?[^"']*["']/gi;
  while ((match = regex.exec(text))) ids.push(match[1]);

  if (!ids.length) {
    regex = /https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/gi;
    while ((match = regex.exec(text))) ids.push(match[1]);
  }
  return unique(ids);
}

function walkJson(value, output) {
  if (value == null) return;
  if (typeof value === "string") {
    const id = normalize(value);
    if (validUsername(id)) output.push(id);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, output));
    return;
  }
  if (typeof value === "object") Object.values(value).forEach((item) => walkJson(item, output));
}

function extractJson(text) {
  const output = [];
  try { walkJson(JSON.parse(text), output); } catch (_) {}
  return unique(output);
}

async function parseInstagramZip(file) {
  if (!file) throw new Error("ZIP 파일을 선택해 주세요.");

  const JSZipLibrary = await loadJsZipLibrary();
  const zip = await JSZipLibrary.loadAsync(file);
  const paths = findFiles(zip);

  if (!paths.followers.length) throw new Error("followers_1 파일을 찾지 못했습니다.");
  if (!paths.following) throw new Error("following 파일을 찾지 못했습니다.");

  let followers = [];
  for (const path of paths.followers) {
    const text = await zip.files[path].async("string");
    followers.push(...(path.endsWith(".json") ? extractJson(text) : extractHtml(text)));
  }

  const followingText = await zip.files[paths.following].async("string");
  const following = paths.following.endsWith(".json") ? extractJson(followingText) : extractHtml(followingText);

  return { followers: unique(followers), following };
}

function classify(followers, following, baseList = matchRoomList) {
  const followerSet = new Set(followers);
  const followingSet = new Set(following);

  const all = baseList.map((person) => ({
    ...person,
    status:
      followerSet.has(person.id) && followingSet.has(person.id) ? "mutual" :
      !followerSet.has(person.id) && followingSet.has(person.id) ? "onlyMe" :
      followerSet.has(person.id) && !followingSet.has(person.id) ? "fansOnly" :
      "neither",
  }));

  result = {
    all,
    mutual: all.filter((item) => item.status === "mutual"),
    onlyMe: all.filter((item) => item.status === "onlyMe"),
    fansOnly: all.filter((item) => item.status === "fansOnly"),
    neither: all.filter((item) => item.status === "neither"),
  };
}

async function analyze() {
  if (publicConfig?.matchLocked && !matchGranted && !adminLoggedIn) {
    applyMatchLock();
    toast("맞팔확인 비밀번호를 먼저 입력해 주세요.");
    return;
  }

  const button = $("analyzeBtn");
  try {
    button.disabled = true;
    button.textContent = window.JSZip ? "분석 중..." : "분석 준비 중...";
    if (!matchRoomList.length) await loadMatchRoomList(false);
    button.textContent = "분석 중...";
    const parsed = await parseInstagramZip($("zipFile").files[0]);
    classify(parsed.followers, parsed.following, matchRoomList);
    updateSummary();
    showTab("all");
    $("summarySection").classList.remove("hidden");
    $("resultsSection").classList.remove("hidden");
    $("status").textContent = `분석 완료 · 맞팔확인용 명단 ${matchRoomList.length}명 기준`;
    toast("분석 완료");
  } catch (error) {
    $("status").textContent = `오류: ${error.message}`;
    toast("분석 실패");
  } finally {
    button.disabled = false;
    button.innerHTML = '맞팔 분석 시작 <span>→</span>';
  }
}

function percent(value, total) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

function updateSummary() {
  const total = result.all.length;
  for (const key of ["mutual", "onlyMe", "fansOnly", "neither"]) {
    $(`${key}Count`).textContent = `${result[key].length}명`;
    $(`${key}Rate`).textContent = percent(result[key].length, total);
    $(`tab${key[0].toUpperCase() + key.slice(1)}`).textContent = result[key].length;
  }
  $("tabAll").textContent = total;
  $("rateText").innerHTML = `단톡방 맞팔률 <strong>${percent(result.mutual.length, total)}</strong> · ${result.mutual.length}/${total}명`;
}

function statusLabel(status) {
  return {
    mutual: "맞팔 완료",
    onlyMe: "나만 팔로우 함",
    fansOnly: "상대가 팔로우만 함",
    neither: "서로 팔로우 안 함",
  }[status];
}

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  renderMatchList();
}

function matchFiltered() {
  const query = String($("searchInput").value || "").trim().toLowerCase();
  const items = result[currentTab] || [];
  return query
    ? items.filter((item) => item.id.includes(normalize(query)) || String(item.name).toLowerCase().includes(query))
    : items;
}

function renderMatchList() {
  const items = matchFiltered();
  $("list").innerHTML = items.length
    ? items.map((item, index) => `
      <div class="item">
        <span class="item-no">${index + 1}</span>
        <div class="item-person">
          <strong class="item-name">${escapeHtml(item.name)}</strong>
          <a class="id" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener">@${escapeHtml(item.id)}</a>
        </div>
        <span class="badge ${item.status}">${statusLabel(item.status)}</span>
        <a class="insta" href="https://www.instagram.com/${encodeURIComponent(item.id)}/" target="_blank" rel="noopener" aria-label="인스타그램 열기">↗ 열기</a>
      </div>`).join("")
    : '<div class="empty-state">결과가 없습니다.</div>';
}

async function writeClipboardText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("클립보드 복사에 실패했습니다.");
  }
}

function copyTargetItems() {
  return currentTab === "all"
    ? [...result.onlyMe, ...result.neither]
    : matchFiltered();
}

async function copyCurrent() {
  const items = copyTargetItems();
  if (!items.length) return toast("복사할 명단이 없습니다.");

  try {
    const text = items
      .map((item, index) => `${index + 1}. ${item.name} @${item.id} - ${statusLabel(item.status)}`)
      .join("\n");

    await writeClipboardText(text);
    toast(`${items.length}명 명단 복사 완료`);
  } catch (error) {
    toast(error.message || "복사 실패");
  }
}

async function copyMentions() {
  const items = copyTargetItems();
  if (!items.length) return toast("복사할 멘션이 없습니다.");

  try {
    const text = items
      .map((item) => `@${item.id}`)
      .join("\n");

    await writeClipboardText(text);
    toast(`${items.length}명 멘션 복사 완료`);
  } catch (error) {
    toast(error.message || "멘션 복사 실패");
  }
}

function resetAnalysis() {
  $("zipFile").value = "";
  $("fileName").textContent = "인스타그램 ZIP 파일 선택";
  $("summarySection").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
}

async function loadNotices(notify = true) {
  try {
    const data = await apiGet("notices");
    const notices = data.notices || [];
    const nextSignature = JSON.stringify(notices.map(item => [item.noticeId, item.createdAt, item.content]));
    if (notify && noticeSignature && nextSignature !== noticeSignature && notices.length) {
      $("noticeCard").classList.remove("hidden");
      toast("새 공지가 등록되었습니다.");
    }
    noticeSignature = nextSignature;
    renderNotices(notices);
  } catch (_) {
    renderNotices([]);
  }
}

function renderNotices(notices) {
  $("adminNotices").textContent = `${notices.length}개`;
  $("noticeCard").classList.toggle("hidden", !notices.length);

  $("noticeList").innerHTML = notices
    .map((notice) => `<div class="notice-item"><p>${escapeHtml(notice.content)}</p></div>`)
    .join("");

  $("noticePageList").innerHTML = notices.length
    ? notices.map((notice) => `
      <article class="notice-page-item">
        <div class="notice-page-time">${escapeHtml(notice.createdAt || "")}</div>
        <p>${escapeHtml(notice.content)}</p>
      </article>`).join("")
    : '<p class="state-text">등록된 공지가 없습니다.</p>';

  $("adminNoticeList").innerHTML = notices.length
    ? notices.map((notice) => `
      <div class="notice-row">
        <div>
          <strong>${escapeHtml(notice.createdAt)}</strong>
          <div class="subtext">${escapeHtml(notice.content)}</div>
        </div>
        <button data-notice-id="${escapeHtml(notice.noticeId)}" type="button">삭제</button>
      </div>`).join("")
    : '<p class="state-text">등록된 공지가 없습니다.</p>';

  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.onclick = () => deleteNotice(button.dataset.noticeId);
  });
}

async function loadAdminLogs() {
  if (!adminLoggedIn || !adminPasswordValue) return;
  try {
    const data = await apiPost("getAdminLogs", { adminPassword: adminPasswordValue });
    const logs = data.logs || [];
    $("adminLogList").innerHTML = logs.length
      ? logs.map(log => `<div class="log-row"><strong>${escapeHtml(log.createdAt)}</strong><span>${escapeHtml(log.action)}</span><small>${escapeHtml(log.detail)}</small></div>`).join("")
      : '<p class="state-text">저장된 로그가 없습니다.</p>';
  } catch (error) {
    $("adminLogList").innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

function rosterAuditMembers() {
  const source = roomAuditSource.length
    ? roomAuditSource
    : roomList.map((item) => ({ no: String(item.no || "").trim(), name: item.name || "", idRaw: item.id || "", id: normalize(item.id) }));

  return source.map((item) => ({
    no: String(item.no || "").trim(),
    name: String(item.name || "").trim(),
    idRaw: String(item.idRaw ?? item.id ?? "").trim(),
    id: normalize(item.idRaw ?? item.id ?? ""),
  }));
}

function rosterSnapshot(members = rosterAuditMembers()) {
  return {
    savedAt: Date.now(),
    members: members.map((item) => ({ no: item.no, name: item.name, id: item.id })),
  };
}

function readRosterBaseline() {
  const data = readStorageJson(ROSTER_BASELINE_KEY, null);
  if (!data || !Array.isArray(data.members)) return null;
  return data;
}

function duplicateGroups(items, keyFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({ key, members }));
}

function calculateRosterAudit() {
  const current = rosterAuditMembers();
  const baseline = readRosterBaseline();

  const duplicateIds = duplicateGroups(current.filter((x) => validUsername(x.id)), (x) => x.id);
  const duplicateNos = duplicateGroups(current, (x) => x.no);
  const duplicateNames = duplicateGroups(current, (x) => x.name.trim().toLowerCase())
    .filter((group) => new Set(group.members.map((x) => x.id)).size > 1);
  const missingIds = current.filter((x) => !x.idRaw.trim());
  const invalidIds = current.filter((x) => x.idRaw.trim() && !validUsername(x.id));
  const missingNos = current.filter((x) => !x.no);
  const missingNames = current.filter((x) => !x.name);

  const newMembers = [];
  const removedMembers = [];
  const changedIds = [];

  if (baseline) {
    const currentNoGroups = duplicateGroups(current, (x) => x.no);
    const baselineNormalized = (baseline.members || []).map((x) => ({
      no: String(x.no || "").trim(),
      name: String(x.name || "").trim(),
      id: normalize(x.id),
    }));
    const baselineNoGroups = duplicateGroups(baselineNormalized, (x) => x.no);
    const badCurrentNos = new Set(currentNoGroups.map((g) => g.key));
    const badBaselineNos = new Set(baselineNoGroups.map((g) => g.key));

    const currentByNo = new Map(current.filter((x) => x.no && !badCurrentNos.has(x.no)).map((x) => [x.no, x]));
    const baseByNo = new Map(baselineNormalized.filter((x) => x.no && !badBaselineNos.has(x.no)).map((x) => [x.no, x]));

    currentByNo.forEach((item, no) => {
      const old = baseByNo.get(no);
      if (!old) newMembers.push(item);
      else if (old.id && item.id && old.id !== item.id) changedIds.push({ no, name: item.name || old.name, before: old.id, after: item.id });
    });
    baseByNo.forEach((item, no) => { if (!currentByNo.has(no)) removedMembers.push(item); });
  }

  const issueCount = duplicateIds.length + duplicateNos.length + duplicateNames.length + missingIds.length + invalidIds.length + missingNos.length + missingNames.length;
  return { current, baseline, newMembers, removedMembers, changedIds, duplicateIds, duplicateNos, duplicateNames, missingIds, invalidIds, missingNos, missingNames, issueCount };
}

function auditMemberText(item) {
  const no = item.no ? `${item.no}. ` : "";
  const name = item.name || "(닉네임 없음)";
  const id = item.id ? ` @${item.id}` : " (아이디 없음)";
  return `${no}${name}${id}`;
}

function auditSectionHtml(title, items, formatter = auditMemberText) {
  if (!items.length) return "";
  return `<section class="audit-detail-section"><h4>${escapeHtml(title)} <span>${items.length}</span></h4>${items.map((item) => `<div class="audit-detail-row">${escapeHtml(formatter(item))}</div>`).join("")}</section>`;
}

function renderRosterAudit() {
  if (!$("rosterAuditDetails")) return;
  const audit = calculateRosterAudit();
  lastRosterAudit = audit;

  $("auditNewCount").textContent = `${audit.newMembers.length}명`;
  $("auditRemovedCount").textContent = `${audit.removedMembers.length}명`;
  $("auditChangedCount").textContent = `${audit.changedIds.length}명`;
  $("auditIssueCount").textContent = `${audit.issueCount}건`;

  if (!audit.baseline) {
    $("rosterBaselineState").textContent = "기준 명단이 없습니다. 현재 명단을 기준으로 저장하면 이후 변경사항을 감지합니다.";
  } else {
    const date = new Date(audit.baseline.savedAt || 0);
    $("rosterBaselineState").textContent = `기준 저장: ${date.toLocaleString("ko-KR")} · ${audit.baseline.members.length}명`;
  }

  const sections = [
    auditSectionHtml("🆕 신규 회원", audit.newMembers),
    auditSectionHtml("🔴 삭제된 회원", audit.removedMembers),
    auditSectionHtml("🟠 아이디 변경 의심", audit.changedIds, (x) => `${x.no}. ${x.name}  @${x.before} → @${x.after}`),
    auditSectionHtml("⚠️ 동일 아이디 중복", audit.duplicateIds, (g) => `@${g.key} · ${g.members.map((x) => `${x.no || "?"}.${x.name || "?"}`).join(" / ")}`),
    auditSectionHtml("⚠️ 회원번호 중복", audit.duplicateNos, (g) => `${g.key}번 · ${g.members.map((x) => `${x.name || "?"} @${x.id || "?"}`).join(" / ")}`),
    auditSectionHtml("⚠️ 닉네임 중복(아이디 다름)", audit.duplicateNames, (g) => `${g.members[0]?.name || g.key} · ${g.members.map((x) => `@${x.id || "?"}`).join(" / ")}`),
    auditSectionHtml("⚠️ 아이디 누락", audit.missingIds),
    auditSectionHtml("⚠️ 아이디 형식 오류", audit.invalidIds, (x) => `${x.no || "?"}. ${x.name || "?"} · ${x.idRaw}`),
    auditSectionHtml("⚠️ 회원번호 누락", audit.missingNos),
    auditSectionHtml("⚠️ 닉네임 누락", audit.missingNames),
  ].filter(Boolean).join("");

  $("rosterAuditDetails").innerHTML = sections || `<div class="audit-ok">✅ 명단 이상 없음</div>`;
}

function saveRosterBaseline() {
  if (!adminLoggedIn) return toast("운영진 로그인이 필요합니다.");
  const snapshot = rosterSnapshot();
  writeStorageJson(ROSTER_BASELINE_KEY, snapshot);
  renderRosterAudit();
  toast(`현재 명단 ${snapshot.members.length}명을 기준으로 저장했습니다.`);
}

async function copyRosterAudit() {
  const audit = lastRosterAudit || calculateRosterAudit();
  const lines = ["[여우방 명단 자동 점검]", `신규 ${audit.newMembers.length}명 / 삭제 ${audit.removedMembers.length}명 / 아이디 변경 의심 ${audit.changedIds.length}명 / 중복·오류 ${audit.issueCount}건`];
  if (audit.newMembers.length) lines.push("", "[신규 회원]", ...audit.newMembers.map(auditMemberText));
  if (audit.removedMembers.length) lines.push("", "[삭제된 회원]", ...audit.removedMembers.map(auditMemberText));
  if (audit.changedIds.length) lines.push("", "[아이디 변경 의심]", ...audit.changedIds.map((x) => `${x.no}. ${x.name} @${x.before} → @${x.after}`));
  if (audit.duplicateIds.length) lines.push("", "[동일 아이디 중복]", ...audit.duplicateIds.map((g) => `@${g.key} : ${g.members.map((x) => `${x.no || "?"}.${x.name || "?"}`).join(" / ")}`));
  if (audit.duplicateNos.length) lines.push("", "[회원번호 중복]", ...audit.duplicateNos.map((g) => `${g.key}번 : ${g.members.map((x) => `${x.name || "?"} @${x.id || "?"}`).join(" / ")}`));
  if (audit.duplicateNames.length) lines.push("", "[닉네임 중복]", ...audit.duplicateNames.map((g) => `${g.members[0]?.name || g.key} : ${g.members.map((x) => `@${x.id || "?"}`).join(" / ")}`));
  if (audit.missingIds.length) lines.push("", "[아이디 누락]", ...audit.missingIds.map(auditMemberText));
  if (audit.invalidIds.length) lines.push("", "[아이디 형식 오류]", ...audit.invalidIds.map((x) => `${x.no || "?"}. ${x.name || "?"} ${x.idRaw}`));
  if (audit.missingNos.length) lines.push("", "[회원번호 누락]", ...audit.missingNos.map(auditMemberText));
  if (audit.missingNames.length) lines.push("", "[닉네임 누락]", ...audit.missingNames.map(auditMemberText));
  if (lines.length === 2) lines.push("", "✅ 명단 이상 없음");
  try { await writeClipboardText(lines.join("\n")); toast("명단 점검 결과를 복사했습니다."); }
  catch (error) { toast(error.message || "점검 결과 복사 실패"); }
}

async function adminLogin() {
  const password = $("adminPassword").value.trim();
  if (!password) return;

  try {
    await apiPost("adminLogin", { password });
    adminLoggedIn = true;
    adminPasswordValue = password;
    $("adminLoginMsg").textContent = "";
    showAdminPanel();
    renderRosterAudit();
    loadAdminLogs();
    matchGranted = true;
    followGranted = true;
    applyFollowLock();
    applyMatchLock();
    toast("운영진 로그인 완료");
  } catch (_) {
    $("adminLoginMsg").textContent = "운영진 비밀번호가 올바르지 않습니다.";
  }
}

function showAdminPanel() {
  $("adminPanel").classList.remove("hidden");
  $("adminLoginCard").classList.add("hidden");
  updateLockIndicators();
}

function adminLogout() {
  adminLoggedIn = false;
  adminPasswordValue = "";
  accessGranted = false;
  matchGranted = false;
  followGranted = false;
  $("adminPanel").classList.add("hidden");
  $("adminLoginCard").classList.remove("hidden");
  $("adminPassword").value = "";
  setAdminNavigation(false);
  applyFollowLock();
  applyMatchLock();
  bootstrapAuth();
}

async function runAdminAction(action, payload, successMessage) {
  if (!adminLoggedIn || !adminPasswordValue) {
    toast("운영진 로그인이 필요합니다.");
    return null;
  }

  try {
    const data = await apiPost(action, { adminPassword: adminPasswordValue, ...payload });
    toast(successMessage);
    await Promise.allSettled([refreshPublicConfig(false), loadNotices(false), loadAdminLogs()]);
    return data;
  } catch (error) {
    toast(error.message || "변경 실패");
    return null;
  }
}

async function saveNotice() {
  const content = $("noticeBody").value.trim();
  if (!content) return toast("공지 내용을 입력해 주세요.");

  const data = await runAdminAction("addNotice", { content }, "공지 저장 완료");
  if (data) {
    $("noticeBody").value = "";
    renderNotices(data.notices || []);
  }
}

async function deleteNotice(noticeId) {
  const data = await runAdminAction("deleteNotice", { noticeId }, "공지 삭제 완료");
  if (data) renderNotices(data.notices || []);
}

async function changePassword(action, inputId, message) {
  const value = $(inputId).value.trim();
  if (!value) return toast("새 비밀번호를 입력해 주세요.");

  const data = await runAdminAction(action, { newPassword: value }, message);
  if (data) $(inputId).value = "";
}



// ===== V44 품앗이 확인 1차 개발본 =====
let pumasiLastResult = null;
let pumasiSelectedVideo = null;
let pumasiSelectedImages = [];
let pumasiVideoRecognized = [];
let pumasiVideoReview = [];
let pumasiVideoAutoCorrected = [];
const PUMASI_SELF_ID_KEY = "yeowoobang:pumasiSelfId:v1";

function pumasiNormalizeId(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function parsePumasiParticipants(text) {
  const lines = String(text || "").split(/\r?\n/);
  const seen = new Set();
  const items = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Instagram 게시물 URL 줄은 참여자로 세지 않음
    if (/https?:\/\/(?:www\.)?instagram\.com\//i.test(line)) continue;

    let id = "";
    let name = "";

    // 1) @아이디 형식: "꼬꼬 @h._.ggoggo"
    const atMatches = [...line.matchAll(/@([A-Za-z0-9._]{1,30})/g)];
    if (atMatches.length) {
      id = atMatches[atMatches.length - 1][1];
      name = line
        .replace(/^\s*\d+\s*[.)-]?\s*/, "")
        .replace(new RegExp("@?" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i"), "")
        .trim();
    }

    // 2) 품앗이 명단에서 실제로 쓰는 "번호. 닉네임/인스타아이디" 형식
    // 예: "19. 연주니/kite_jun_"
    if (!id) {
      const slashMatch = line.match(/^\s*(?:\d+\s*[.)-]?\s*)?(.+?)\s*\/\s*@?([A-Za-z0-9._]{1,30})\s*$/);
      if (slashMatch) {
        name = slashMatch[1].trim();
        id = slashMatch[2];
      }
    }

    // 3) "번호 닉네임 아이디" 또는 아이디만 있는 단순 형식
    if (!id) {
      const cleaned = line.replace(/^\s*\d+\s*[.)-]?\s*/, "").trim();
      const tokens = cleaned.split(/\s+/);
      const candidate = tokens[tokens.length - 1] || "";
      if (/^[A-Za-z0-9._]{1,30}$/.test(candidate)) {
        id = candidate;
        name = tokens.slice(0, -1).join(" ").trim();
      }
    }

    id = pumasiNormalizeId(id);
    if (!id || seen.has(id)) continue;

    seen.add(id);
    items.push({ name: name || id, id });
  }

  return items;
}

function getPumasiCommentIds(text, participants) {
  const lower = String(text || "").toLowerCase();
  const found = new Set();

  participants.forEach((person) => {
    const id = pumasiNormalizeId(person.id);
    if (!id) return;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("(^|[^a-z0-9._])@?" + escaped + "(?=$|[^a-z0-9._])", "i");
    if (pattern.test(lower)) found.add(id);
  });

  return found;
}

function refreshPumasiParticipantCount() {
  const participants = parsePumasiParticipants($("pumasiParticipants")?.value || "");
  if ($("pumasiParticipantCount")) $("pumasiParticipantCount").textContent = participants.length + "명";
}

function getPumasiSelfId(participants = []) {
  let saved = "";
  try { saved = pumasiNormalizeId(localStorage.getItem(PUMASI_SELF_ID_KEY) || ""); } catch (_) {}
  if (saved && participants.some(p => p.id === saved)) return saved;

  // Instagram OAuth 연결이 붙으면 이 저장값을 로그인한 사용자명으로 덮어쓰면 됩니다.
  // 현재 여우방 운영 계정은 명단에 있을 때 자동 제외합니다.
  const owner = "tlso_94";
  if (participants.some(p => p.id === owner)) return owner;
  return "";
}

function getPumasiCheckTargets(participants) {
  const selfId = getPumasiSelfId(participants);
  return {
    selfId,
    targets: selfId ? participants.filter(p => p.id !== selfId) : [...participants]
  };
}

function renderPumasiResult(participants, completed, sourceLabel, pending = new Set(), selfId = "") {
  const completedSet = new Set([...completed].map(pumasiNormalizeId));
  const pendingSet = new Set([...pending].map(pumasiNormalizeId).filter(id => !completedSet.has(id)));
  const missing = participants.filter((p) => !completedSet.has(p.id) && !pendingSet.has(p.id));
  const done = participants.filter((p) => completedSet.has(p.id));
  const review = participants.filter((p) => pendingSet.has(p.id));
  pumasiLastResult = { participants, completed: completedSet, pending: pendingSet, missing, selfId };

  $("pumasiResultCard").classList.remove("hidden");
  $("pumasiTotalCount").textContent = participants.length + "명";
  $("pumasiDoneCount").textContent = done.length + "명";
  $("pumasiMissingCount").textContent = missing.length + "명";

  const date = $("pumasiDate").value || "날짜 미지정";
  const selfText = selfId ? ` · 내 계정 @${selfId} 제외` : "";
  const reviewText = review.length ? ` · 확인 필요 ${review.length}명` : "";
  $("pumasiResultMeta").textContent = `${date} · ${sourceLabel}${selfText}${reviewText}`;

  $("pumasiResultList").innerHTML = participants.map((person, index) => {
    const isDone = completedSet.has(person.id);
    const isPending = pendingSet.has(person.id);
    const statusText = isDone ? "✓ 댓글 완료" : (isPending ? "? 확인 필요" : "✕ 댓글 미작성");
    const statusClass = isDone ? "ok" : "no";
    const pendingStyle = isPending ? ' style="background:#fff7df;color:#9a6800"' : "";
    return `
      <div class="pumasi-result-item">
        <span class="pumasi-no">${index + 1}</span>
        <span class="pumasi-person"><strong>${escapeHtml(person.name)}</strong><small>@${escapeHtml(person.id)}</small></span>
        <span class="pumasi-status ${statusClass}"${pendingStyle}>${statusText}</span>
        <a class="insta-btn" href="https://www.instagram.com/${encodeURIComponent(person.id)}/" target="_blank" rel="noopener">열기</a>
      </div>`;
  }).join("");

  $("pumasiResultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyPumasiMissing(mentionOnly) {
  if (!pumasiLastResult) return toast("먼저 댓글 확인을 해주세요.");
  const missing = pumasiLastResult.missing || [];
  if (!missing.length) return toast("댓글 누락자가 없습니다.");

  const text = mentionOnly
    ? missing.map((p) => "@" + p.id).join(" ")
    : missing.map((p) => `${p.name} @${p.id}`).join("\n");

  await copyText(text);
  toast(mentionOnly ? "@멘션을 복사했습니다." : "누락자 명단을 복사했습니다.");
}

function runPumasiPasteCheck() {
  const participants = parsePumasiParticipants($("pumasiParticipants").value);
  if (!participants.length) return toast("참여자 명단을 먼저 붙여넣어 주세요.");

  const comments = $("pumasiCommentsText").value.trim();
  if (!comments) return toast("댓글 내용을 먼저 붙여넣어 주세요.");

  const completed = getPumasiCommentIds(comments, participants);
  renderPumasiResult(participants, completed, "댓글 텍스트 확인");
}

function resetPumasiResult() {
  pumasiLastResult = null;
  pumasiVideoRecognized = [];
  pumasiVideoReview = [];
  pumasiVideoAutoCorrected = [];
  $("pumasiResultCard").classList.add("hidden");
}


function pumasiLevenshtein(a, b) {
  a = String(a || ""); b = String(b || "");
  const m = a.length, n = b.length;
  const dp = Array.from({length:n+1}, (_,j)=>j);
  for (let i=1;i<=m;i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j=1;j<=n;j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j]+1, dp[j-1]+1, prev + (a[i-1]===b[j-1]?0:1));
      prev = tmp;
    }
  }
  return dp[n];
}

function pumasiExtractPossibleIds(text) {
  const clean = String(text || "")
    .replace(/\s*([._])\s*/g, "$1")
    .toLowerCase();
  const tokens = clean.match(/@?[a-z0-9._]{4,30}/g) || [];
  return [...new Set(tokens.map(x => pumasiNormalizeId(x)))]
    .filter(x => x && !/^(www|instagram|reply|like|likes|hours?|minutes?|view|more|follow)$/.test(x));
}

function pumasiMatchOcrText(text, participants) {
  const exact = new Set();
  const auto = new Map();
  const review = new Map();
  const rawText = String(text || "").toLowerCase();
  const tokens = pumasiExtractPossibleIds(rawText);
  const ids = participants.map(p => pumasiNormalizeId(p.id)).filter(Boolean);

  // 1) 정확 일치
  for (const id of ids) {
    const escId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("(^|[^a-z0-9._])@?" + escId + "(?=$|[^a-z0-9._])", "i");
    if (pattern.test(rawText)) exact.add(id);
  }

  // 2) OCR 토큰을 '참여자 명단'에 역매칭합니다.
  // 같은 토큰이 여러 참여자와 비슷하면 자동 확정하지 않습니다.
  for (const token of tokens) {
    const candidates = ids
      .filter(id => !exact.has(id))
      .map(id => ({ id, distance: pumasiLevenshtein(token, id) }))
      .filter(x => Math.abs(token.length - x.id.length) <= 2)
      .sort((a,b) => a.distance - b.distance || b.id.length - a.id.length);

    if (!candidates.length) continue;
    const best = candidates[0];
    const second = candidates[1];
    const uniqueBest = !second || second.distance >= best.distance + 1;
    const boundaryExtra = token.length === best.id.length + 1 &&
      (token.endsWith(best.id) || token.startsWith(best.id));
    const underscorePrefixFix = token.length === best.id.length + 1 &&
      best.id.startsWith("_") && token.slice(1) === best.id;

    // distance 1의 유일 후보는 길이가 충분하면 자동 보정합니다.
    // 예: a_happppppy_ -> _happppppy_
    if (uniqueBest && best.id.length >= 5 &&
        (best.distance === 1 || boundaryExtra || underscorePrefixFix)) {
      const prev = auto.get(best.id);
      if (!prev || best.distance < prev.distance) {
        auto.set(best.id, { id: best.id, seenAs: token, distance: best.distance });
      }
      continue;
    }

    const maxReviewDist = best.id.length >= 8 ? 2 : 1;
    if (uniqueBest && best.distance <= maxReviewDist) {
      const prev = review.get(best.id);
      if (!prev || best.distance < prev.distance) {
        review.set(best.id, { id: best.id, seenAs: token, distance: best.distance });
      }
    }
  }

  exact.forEach(id => { auto.delete(id); review.delete(id); });
  auto.forEach((_, id) => review.delete(id));
  return { exact, auto, review };
}

function pumasiSetProgress(kind, status, pct) {
  const wrap = $(kind === "video" ? "pumasiVideoProgress" : "pumasiImageProgress");
  const statusEl = $(kind === "video" ? "pumasiVideoStatus" : "pumasiImageStatus");
  const pctEl = $(kind === "video" ? "pumasiVideoPercent" : "pumasiImagePercent");
  const bar = $(kind === "video" ? "pumasiVideoBar" : "pumasiImageBar");
  wrap?.classList.remove("hidden");
  if (statusEl) statusEl.textContent = status;
  if (pctEl) pctEl.textContent = Math.max(0, Math.min(100, Math.round(pct))) + "%";
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function pumasiWaitEvent(el, eventName) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error("파일을 읽지 못했습니다.")); };
    const cleanup = () => {
      el.removeEventListener(eventName, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(eventName, ok, {once:true});
    el.addEventListener("error", bad, {once:true});
  });
}

async function pumasiSeekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.04) return;
  const p = pumasiWaitEvent(video, "seeked");
  video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
  await p;
}

function pumasiDrawFrame(video) {
  // 모바일 화면녹화의 작은 사용자명을 OCR이 읽기 쉽도록 확대합니다.
  const targetWidth = 1800;
  const scale = Math.min(2.4, Math.max(1, targetWidth / Math.max(1, video.videoWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext("2d", {willReadFrequently:true});
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0,0,canvas.width,canvas.height);
  const d = img.data;
  for(let i=0;i<d.length;i+=4){
    let gray = Math.round(d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
    gray = gray < 150 ? Math.max(0,gray-25) : Math.min(255,gray+15);
    d[i]=d[i+1]=d[i+2]=gray;
  }
  ctx.putImageData(img,0,0);
  return canvas;
}

function pumasiRenderRecognized(participants) {
  const wrap = $("pumasiVideoRecognizedWrap");
  const list = $("pumasiVideoRecognizedList");
  const count = $("pumasiVideoRecognizedCount");
  if (!wrap || !list || !count) return;

  count.textContent = pumasiVideoRecognized.length + "명";

  const byId = new Map(participants.map(p => [p.id, p]));
  const autoMap = new Map(pumasiVideoAutoCorrected.map(x => [x.id, x]));
  const exactHtml = pumasiVideoRecognized.length
    ? pumasiVideoRecognized.map(id => {
        const corrected = autoMap.get(id);
        const title = corrected ? ` title="OCR 자동 보정: ${escapeHtml(corrected.seenAs)} → @${escapeHtml(id)}"` : "";
        return `<span${title}>@${escapeHtml(byId.get(id)?.id || id)}${corrected ? " ✓" : ""}</span>`;
      }).join("")
    : '<small>정확히 인식된 아이디가 없습니다.</small>';

  const reviewHtml = pumasiVideoReview.length
    ? `<div class="pumasi-review-head"><strong>확인 필요 ${pumasiVideoReview.length}명</strong><small>OCR이 비슷하게 읽은 후보 · 자동 누락 처리하지 않음</small></div>
       <div class="pumasi-review-list">
         ${pumasiVideoReview.map(x => `
           <label>
             <input type="checkbox" class="pumasi-review-check" data-id="${escapeHtml(x.id)}">
             <span><b>@${escapeHtml(x.id)}</b><small>영상 인식: ${escapeHtml(x.seenAs)}</small></span>
           </label>`).join("")}
       </div>`
    : "";

  list.innerHTML = exactHtml + reviewHtml;
  wrap.classList.remove("hidden");
}

async function analyzePumasiVideo() {
  const allParticipants = parsePumasiParticipants($("pumasiParticipants").value);
  if (!allParticipants.length) return toast("참여자 명단을 먼저 입력해 주세요.");
  const { selfId, targets: participants } = getPumasiCheckTargets(allParticipants);
  if (!participants.length) return toast("확인할 참여자가 없습니다.");
  if (selfId) toast(`내 계정 @${selfId} 제외 · ${participants.length}명 확인`);
  if (!pumasiSelectedVideo) return toast("댓글 화면 녹화 영상을 먼저 선택해 주세요.");
  if (!window.Tesseract) return toast("OCR 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");

  const btn = $("pumasiVideoAnalyzeBtn");
  btn.disabled = true;
  btn.textContent = "영상 분석 중...";
  $("pumasiVideoRecognizedWrap")?.classList.add("hidden");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const url = URL.createObjectURL(pumasiSelectedVideo);
  video.src = url;
  let worker = null;

  try {
    pumasiSetProgress("video", "영상 정보 읽는 중...", 1);
    await pumasiWaitEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("영상 길이를 확인할 수 없습니다.");

    // UI 선택값보다 너무 듬성듬성 읽지 않도록 최대 0.9초 간격으로 보강
    const selectedInterval = Math.max(0.55, Number($("pumasiVideoInterval").value) || 1.25);
    const interval = Math.min(0.9, selectedInterval);
    let times = [];
    for (let t=0.2; t<video.duration; t+=interval) times.push(t);
    if (times.length > 180) {
      const step = times.length / 180;
      times = Array.from({length:180}, (_,i)=>times[Math.floor(i*step)]);
      $("pumasiVideoHint").textContent = "영상이 길어서 최대 180개 화면으로 나누어 분석합니다.";
    }

    pumasiSetProgress("video", "OCR 엔진 준비 중...", 3);
    worker = await Tesseract.createWorker("eng");
    try {
      await worker.setParameters({ preserve_interword_spaces:"1", tessedit_pageseg_mode:"11" });
    } catch (_) {}

    const exact = new Set();
    const auto = new Map();
    const review = new Map();

    for (let i=0;i<times.length;i++) {
      pumasiSetProgress("video", `${i+1}/${times.length} 화면에서 아이디 찾는 중`, 5 + (i/times.length)*90);
      await pumasiSeekVideo(video, times[i]);
      const canvas = pumasiDrawFrame(video);
      const result = await worker.recognize(canvas);
      const m = pumasiMatchOcrText(result?.data?.text || "", participants);
      m.exact.forEach(id => { exact.add(id); auto.delete(id); review.delete(id); });
      m.auto.forEach((v,id) => {
        if (exact.has(id)) return;
        const prev = auto.get(id);
        if (!prev || v.distance < prev.distance) auto.set(id, v);
        review.delete(id);
      });
      m.review.forEach((v,id) => {
        if (exact.has(id) || auto.has(id)) return;
        const prev = review.get(id);
        if (!prev || v.distance < prev.distance) review.set(id, v);
      });
      if (exact.size + auto.size >= participants.length) break;
    }

    pumasiVideoAutoCorrected = [...auto.values()]
      .filter(x => !exact.has(x.id))
      .sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id));
    pumasiVideoRecognized = [...new Set([...exact, ...auto.keys()])].sort();
    pumasiVideoReview = [...review.values()].filter(x => !exact.has(x.id) && !auto.has(x.id))
      .sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id));

    pumasiRenderRecognized(participants);
    pumasiSetProgress("video", pumasiVideoRecognized.length ? `완료 · ${pumasiVideoRecognized.length}명 인식` : "아이디 인식 실패 · 자동 판정 보류", 100);
    $("pumasiVideoHint").textContent = pumasiVideoRecognized.length
      ? "인식된 아이디와 확인 필요 후보를 검토한 뒤 누락자 비교를 눌러주세요."
      : "전원을 누락자로 처리하지 않았습니다. 스크롤 속도를 늦춰 다시 녹화하거나 캡처로 확인해주세요.";
  } catch (e) {
    pumasiSetProgress("video", "영상 분석 실패", 100);
    $("pumasiVideoHint").textContent = "오류: " + String(e.message || e);
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    URL.revokeObjectURL(url);
    btn.disabled = false;
    btn.textContent = "화면 녹화 분석 시작";
  }
}

function comparePumasiVideo() {
  const allParticipants = parsePumasiParticipants($("pumasiParticipants").value);
  const { selfId, targets: participants } = getPumasiCheckTargets(allParticipants);
  const checked = [...document.querySelectorAll(".pumasi-review-check:checked")]
    .map(el => pumasiNormalizeId(el.dataset.id)).filter(Boolean);
  const checkedSet = new Set(checked);
  const completed = new Set([...pumasiVideoRecognized, ...checked]);
  const pending = new Set(pumasiVideoReview.map(x => x.id).filter(id => !checkedSet.has(id)));
  if (!completed.size && !pending.size) return toast("확정된 댓글 작성자가 없습니다. 자동 누락 판정은 하지 않습니다.");
  renderPumasiResult(participants, completed, "댓글 화면 녹화 확인", pending, selfId);
}

async function analyzePumasiImages() {
  const allParticipants = parsePumasiParticipants($("pumasiParticipants").value);
  if (!allParticipants.length) return toast("참여자 명단을 먼저 입력해 주세요.");
  const { targets: participants } = getPumasiCheckTargets(allParticipants);
  if (!participants.length) return toast("확인할 참여자가 없습니다.");
  if (!pumasiSelectedImages.length) return toast("댓글 캡처를 먼저 선택해 주세요.");
  if (!window.Tesseract) return toast("OCR 모듈을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");

  const btn = $("pumasiImageAnalyzeBtn");
  btn.disabled = true;
  btn.textContent = "캡처 분석 중...";
  let worker = null;

  try {
    pumasiSetProgress("image", "OCR 엔진 준비 중...", 2);
    worker = await Tesseract.createWorker("eng");
    const exact = new Set();
    const auto = new Map();
    const review = new Map();

    for (let i=0;i<pumasiSelectedImages.length;i++) {
      pumasiSetProgress("image", `${i+1}/${pumasiSelectedImages.length} 캡처에서 아이디 찾는 중`, 5 + (i/pumasiSelectedImages.length)*90);
      const result = await worker.recognize(pumasiSelectedImages[i]);
      const m = pumasiMatchOcrText(result?.data?.text || "", participants);
      m.exact.forEach(id => { exact.add(id); auto.delete(id); review.delete(id); });
      m.auto.forEach((v,id) => {
        if (exact.has(id)) return;
        const prev = auto.get(id);
        if (!prev || v.distance < prev.distance) auto.set(id, v);
        review.delete(id);
      });
      m.review.forEach((v,id) => {
        if (exact.has(id) || auto.has(id)) return;
        const prev = review.get(id);
        if (!prev || v.distance < prev.distance) review.set(id,v);
      });
    }

    pumasiVideoAutoCorrected = [...auto.values()].filter(x => !exact.has(x.id));
    pumasiVideoRecognized = [...new Set([...exact, ...auto.keys()])].sort();
    pumasiVideoReview = [...review.values()].filter(x => !exact.has(x.id) && !auto.has(x.id));
    pumasiRenderRecognized(participants);
    pumasiSetProgress("image", pumasiVideoRecognized.length ? `완료 · ${pumasiVideoRecognized.length}명 인식` : "아이디 인식 실패 · 자동 판정 보류", 100);
    $("pumasiVideoRecognizedWrap")?.scrollIntoView({behavior:"smooth",block:"center"});
  } catch (e) {
    pumasiSetProgress("image", "캡처 분석 실패", 100);
    toast("캡처 분석 오류: " + String(e.message || e));
  } finally {
    if (worker) { try { await worker.terminate(); } catch (_) {} }
    btn.disabled = false;
    btn.textContent = "캡처 분석 시작";
  }
}


function initPumasiStage1() {
  const dateInput = $("pumasiDate");
  if (dateInput && !dateInput.value) {
    const now = new Date();
    dateInput.value = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
  }

  $("pumasiParticipants")?.addEventListener("input", refreshPumasiParticipantCount);
  $("pumasiPasteCheckBtn")?.addEventListener("click", runPumasiPasteCheck);
  $("pumasiResetBtn")?.addEventListener("click", resetPumasiResult);
  $("pumasiCopyMissingBtn")?.addEventListener("click", () => copyPumasiMissing(false));
  $("pumasiCopyMentionBtn")?.addEventListener("click", () => copyPumasiMissing(true));

  $("pumasiConnectBtn")?.addEventListener("click", () => {
    toast("Instagram 로그인 연결은 다음 개발 단계에서 붙입니다.");
  });

  $("pumasiApiBtn")?.addEventListener("click", () => {
    const participants = parsePumasiParticipants($("pumasiParticipants").value);
    if (!participants.length) return toast("참여자 명단을 먼저 입력해 주세요.");
    if (!$("pumasiPostUrl").value.trim()) return toast("확인할 Instagram 게시물 링크를 입력해 주세요.");
    $("pumasiApiStatus").textContent =
      "Instagram 자동 연결은 다음 단계에서 붙입니다. 지금은 아래 화면 녹화로 바로 확인할 수 있어요.";
    toast("아래 화면 녹화 확인을 사용해 주세요.");
  });

  $("pumasiCommentVideo")?.addEventListener("change", (e) => {
    pumasiSelectedVideo = e.target.files?.[0] || null;
    pumasiVideoRecognized = [];
    pumasiVideoReview = [];
    pumasiVideoAutoCorrected = [];
    $("pumasiVideoRecognizedWrap")?.classList.add("hidden");
    const info = $("pumasiVideoFileInfo");
    if (!info) return;
    if (!pumasiSelectedVideo) {
      info.className = "pumasi-file-info empty";
      info.textContent = "선택된 영상이 없습니다.";
    } else {
      info.className = "pumasi-file-info";
      const mb = (pumasiSelectedVideo.size / 1024 / 1024).toFixed(1);
      info.innerHTML = `<strong>${escapeHtml(pumasiSelectedVideo.name)}</strong><span>${mb} MB</span>`;
    }
  });

  $("pumasiVideoAnalyzeBtn")?.addEventListener("click", analyzePumasiVideo);
  $("pumasiVideoCompareBtn")?.addEventListener("click", comparePumasiVideo);

  $("pumasiCommentImages")?.addEventListener("change", (e) => {
    pumasiSelectedImages = [...(e.target.files || [])];
    const info = $("pumasiImageFileInfo");
    if (!info) return;
    if (!pumasiSelectedImages.length) {
      info.className = "pumasi-file-info empty";
      info.textContent = "선택된 캡처가 없습니다.";
    } else {
      info.className = "pumasi-file-info";
      info.innerHTML = `<strong>${pumasiSelectedImages.length}장 선택됨</strong><span>캡처 OCR</span>`;
    }
  });

  $("pumasiImageAnalyzeBtn")?.addEventListener("click", analyzePumasiImages);
}


document.querySelectorAll(".nav-btn").forEach((button) => {
  button.onclick = () => showView(button.dataset.view);
});

$("generalAccessBtn").onclick = chooseGeneralAccess;
$("adminAccessBtn").onclick = chooseAdminAccess;
$("gateBackBtn").onclick = backToRoleSelect;
$("gateSubmitBtn").onclick = submitGatePassword;
$("gatePassword").onkeydown = (event) => { if (event.key === "Enter") submitGatePassword(); };
$("gateRetryBtn").onclick = bootstrapAuth;

$("followSearch").oninput = renderFollowList;
$("refreshFollowBtn").onclick = () => loadRoomList(true);
$("reloadRoomBtn").onclick = () => loadMatchRoomList(true, true);

$("resumeBtn").onclick = resumeLastFollowPosition;
$("resumeResetBtn").onclick = clearLastFollowPosition;

$("followList").addEventListener("click", (event) => {
  const link = event.target.closest("[data-save-follow]");
  if (!link) return;

  const id = normalize(link.dataset.saveFollow);
  const item = roomList.find((person) => person.id === id);
  if (item) saveLastFollowPosition(item);
});

$("copyBatchButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy-batch]");
  if (!button) return;

  const batchIndex = Number(button.dataset.copyBatch);
  if (Number.isInteger(batchIndex) && batchIndex >= 0) {
    copyFollowBatch(batchIndex);
  }
});

$("followUnlockBtn").onclick = unlockFollow;
$("followPassword").onkeydown = (event) => { if (event.key === "Enter") unlockFollow(); };

$("matchUnlockBtn").onclick = unlockMatch;
$("matchPassword").onkeydown = (event) => { if (event.key === "Enter") unlockMatch(); };

$("zipFile").onchange = () => {
  $("fileName").textContent = $("zipFile").files[0]?.name || "인스타그램 ZIP 파일 선택";
};
$("analyzeBtn").onclick = analyze;
$("resetBtn").onclick = resetAnalysis;
$("searchInput").oninput = renderMatchList;
$("copyBtn").onclick = copyCurrent;
$("mentionBtn").onclick = copyMentions;
initPumasiStage1();

document.querySelectorAll(".tab").forEach((button) => {
  button.onclick = () => showTab(button.dataset.tab);
});

$("adminLoginBtn").onclick = adminLogin;
$("adminPassword").onkeydown = (event) => { if (event.key === "Enter") adminLogin(); };
$("adminLogoutBtn").onclick = adminLogout;
$("openSheetBtn").onclick = () => window.open(sheetUrl(), "_blank");
$("adminRefreshBtn").onclick = async () => {
  await Promise.allSettled([refreshPublicConfig(false), loadRoomList(true), loadMatchRoomList(true, true), loadNotices(false), loadAdminLogs()]);
  renderRosterAudit();
  toast("전체 새로고침 완료");
};

$("lockAppBtn").onclick = () => runAdminAction("setAppLock", { locked: true }, "앱을 잠갔습니다.");
$("unlockAppBtn").onclick = () => runAdminAction("setAppLock", { locked: false }, "앱 잠금을 해제했습니다.");
$("lockFollowBtn").onclick = () => runAdminAction("setFollowLock", { locked: true }, "팔로우리스트를 잠갔습니다.");
$("unlockFollowBtn").onclick = () => runAdminAction("setFollowLock", { locked: false }, "팔로우리스트 잠금을 해제했습니다.");
$("lockMatchBtn").onclick = () => runAdminAction("setMatchLock", { locked: true }, "맞팔확인을 잠갔습니다.");
$("unlockMatchBtn").onclick = () => runAdminAction("setMatchLock", { locked: false }, "맞팔확인 잠금을 해제했습니다.");

$("changeAccessPasswordBtn").onclick = () => changePassword("changeAccessPassword", "newAccessPassword", "접속 비밀번호를 변경했습니다.");
$("changeFollowPasswordBtn").onclick = () => changePassword("changeFollowPassword", "newFollowPassword", "팔로우리스트 비밀번호를 변경했습니다.");
$("changeMatchPasswordBtn").onclick = () => changePassword("changeMatchPassword", "newMatchPassword", "맞팔확인 비밀번호를 변경했습니다.");

$("saveNoticeBtn").onclick = saveNotice;
$("closeNoticeBtn").onclick = () => $("noticeCard").classList.add("hidden");
$("refreshNoticeBtn").onclick = loadNotices;
$("refreshLogsBtn").onclick = loadAdminLogs;
$("refreshRosterAuditBtn")?.addEventListener("click", () => { renderRosterAudit(); toast("명단 점검을 다시 실행했습니다."); });
$("saveRosterBaselineBtn")?.addEventListener("click", saveRosterBaseline);
$("copyRosterAuditBtn")?.addEventListener("click", copyRosterAudit);
$("updateNowBtn").onclick = async () => {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(reg => reg.update().catch(() => {})));
  }
  const url = new URL(location.href);
  url.searchParams.set("v", Date.now().toString());
  location.replace(url.toString());
};

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
});

$("installBtn").onclick = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
  } else {
    toast("브라우저 메뉴에서 홈 화면에 추가를 눌러주세요.");
  }
};

window.addEventListener("DOMContentLoaded", async () => {
  showGate();
  setGate("loading", "여우방을 불러오는 중입니다.");
  renderResumeCard();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js?v=430").catch(() => {});
  }

  try {
    await loadConfig();
    await bootstrapAuth();
  } catch (error) {
    setGate("error", `앱을 불러오지 못했습니다. ${error?.message || "다시 시도해 주세요."}`);
  } finally {
    finishBootScreen();
  }

  setInterval(async () => {
    if (!document.hidden && accessGranted) {
      try { await refreshPublicConfig(true); } catch (_) {}
    }
  }, 30000);

  setInterval(async () => {
    if (!document.hidden && accessGranted) {
      await loadNotices(true).catch(() => {});
    }
  }, 120000);
});
