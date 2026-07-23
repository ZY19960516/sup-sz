// ============================================================
// 应用主入口：拉数据 -> 评估 -> 渲染，含缓存与离线降级
// ============================================================
import { SPOTS } from './config.js';
import { fetchSpotData } from './api.js';
import { evaluate } from './logic.js';
import { renderCards } from './ui.js';

const CACHE_KEY = 'sup-sz-cache-v1';

const cardsEl = document.getElementById('cards');
const bannerEl = document.getElementById('banner');
const refreshBtn = document.getElementById('refresh');
const headerSub = document.getElementById('header-sub');
const dateTabsEl = document.getElementById('date-tabs');

// 当前选中的日期偏移（0=今天，1=明天，2=后天）与最近一次拉到的点位原始数据
let currentDayOffset = 0;
let lastSpotDatas = null;

// 主流程
async function load(useCacheFirst = true) {
  // 先展示缓存（秒开体验），再后台刷新
  if (useCacheFirst) {
    const cached = readCache();
    if (cached && cached.spotDatas) {
      lastSpotDatas = cached.spotDatas;
      renderForDay();
      showBanner(`显示 ${fmtClock(cached.savedAt)} 缓存数据，正在刷新…`, 'offline');
    } else {
      cardsEl.innerHTML = '<div class="loading"><div class="spinner"></div><div style="margin-top:10px">正在获取深圳海况…</div></div>';
    }
  }

  try {
    // 并行拉 7 个点位
    const spotDatas = await Promise.all(SPOTS.map((s) => fetchSpotData(s)));
    lastSpotDatas = spotDatas;
    renderForDay();
    writeCache(spotDatas);
    hideBanner();
    headerSub.textContent = `更新于 ${fmtClock(new Date().toISOString())} · 数据为模式预报，非实测`;
  } catch (e) {
    const cached = readCache();
    if (cached && cached.spotDatas) {
      lastSpotDatas = cached.spotDatas;
      renderForDay();
      showBanner(`网络异常，显示 ${fmtClock(cached.savedAt)} 缓存数据`, 'offline');
    } else {
      cardsEl.innerHTML = '<div class="loading">网络异常，暂时无法获取数据。请检查网络后重试。</div>';
    }
  }
}

// 按当前选中的日期，对已拉到的原始数据重新评估并渲染（切日期无需重新联网）
function renderForDay() {
  if (!lastSpotDatas) return;
  const results = lastSpotDatas.map((sd) => ({
    spotData: sd,
    evalResult: evaluate(sd, currentDayOffset),
  }));
  renderCards(results, cardsEl, currentDayOffset);
}

// ---------- 缓存 ----------
function writeCache(spotDatas) {
  try {
    // 只存原始点位数据，evalResult 随所选日期动态计算
    const payload = {
      savedAt: new Date().toISOString(),
      spotDatas,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
    // localStorage 满或不可用时静默忽略
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ---------- 横幅 ----------
function showBanner(text, cls) {
  bannerEl.textContent = text;
  bannerEl.className = `banner show ${cls}`;
}
function hideBanner() {
  bannerEl.className = 'banner';
}

function fmtClock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- 事件 ----------
refreshBtn.addEventListener('click', () => load(false));

// 日期切换
dateTabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-day]');
  if (!btn) return;
  const day = +btn.dataset.day;
  if (day === currentDayOffset) return;
  currentDayOffset = day;
  // 更新按钮激活态
  dateTabsEl.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  // 重新评估并渲染
  renderForDay();
});

// 网络恢复自动刷新
window.addEventListener('online', () => load(false));
window.addEventListener('offline', () => showBanner('已离线，显示缓存数据', 'offline'));

// 注册 Service Worker（PWA 离线）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

// 启动
load(true);
