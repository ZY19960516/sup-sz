// ============================================================
// 数据层：Open-Meteo（浪/风/水温）+ 和风天气（预警）
// 全部浏览器直连；任何一层失败都不拖垮整体（降级）
// ============================================================
import { QWEATHER, WAVE_MODELS, TIMELINE } from './config.js';

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const WEATHER_BASE = 'https://api.open-meteo.com/v1/forecast';

// 通用 fetch，带超时与 JSON 解析
async function fetchJSON(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- Open-Meteo Marine：多模式浪高 + 涌浪 + 风浪 ----------
// 返回逐小时时间轴（含过去 pastDays + 未来 forecastDays）
export async function fetchMarine(spot) {
  const hourly = [
    'wave_height',
    'wave_direction',
    'wave_period',
    'swell_wave_height',
    'swell_wave_period',
    'swell_wave_direction',
    'wind_wave_height',
    'wind_wave_period',
    'sea_surface_temperature',
  ].join(',');

  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    hourly,
    models: WAVE_MODELS.join(','), // 多模式，用于交叉验证
    timezone: 'Asia/Shanghai',
    past_days: TIMELINE.pastDaysDefault,
    forecast_days: 4, // 覆盖 72h + 余量
    cell_selection: 'sea', // 强制取海面网格，避免落到陆地取不到浪
  });

  return fetchJSON(`${MARINE_BASE}?${params}`);
}

// 拉取更长历史（回溯，最多 3 个月）——按需调用
export async function fetchMarineHistory(spot, pastDays) {
  const hourly = ['wave_height', 'swell_wave_height', 'swell_wave_period'].join(',');
  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    hourly,
    timezone: 'Asia/Shanghai',
    past_days: Math.min(pastDays, TIMELINE.pastDaysMax),
    forecast_days: 0,
    cell_selection: 'sea',
  });
  return fetchJSON(`${MARINE_BASE}?${params}`);
}

// ---------- Open-Meteo Weather：风 / 阵风 / 降水 / 雷暴 ----------
export async function fetchWeather(spot) {
  const hourly = [
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'precipitation',
    'weather_code', // 用于识别雷暴（95/96/99）
  ].join(',');

  const params = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lon,
    hourly,
    wind_speed_unit: 'kn', // 直接用节，贴合浆板习惯
    timezone: 'Asia/Shanghai',
    past_days: TIMELINE.pastDaysDefault,
    forecast_days: 4,
  });

  return fetchJSON(`${WEATHER_BASE}?${params}`);
}

// ---------- 和风天气：官方气象预警（可选，降级）----------
// key 未配置或请求失败 -> 返回 null，上层隐藏预警区
export async function fetchWarning(spot) {
  if (!QWEATHER.key) return null; // 未配置 key，静默降级
  try {
    const url = `https://${QWEATHER.host}/v7/warning/now?location=${spot.lon},${spot.lat}&key=${QWEATHER.key}`;
    const data = await fetchJSON(url, 8000);
    if (data && data.code === '200') {
      return data.warning || []; // 空数组=无预警
    }
    return null;
  } catch (e) {
    return null; // 预警失败不影响主体验
  }
}

// ---------- 拉取单个点位的全部数据（并行 + 独立降级）----------
export async function fetchSpotData(spot) {
  const [marineRes, weatherRes, warningRes] = await Promise.allSettled([
    fetchMarine(spot),
    fetchWeather(spot),
    fetchWarning(spot),
  ]);

  return {
    spot,
    marine: marineRes.status === 'fulfilled' ? marineRes.value : null,
    weather: weatherRes.status === 'fulfilled' ? weatherRes.value : null,
    warning: warningRes.status === 'fulfilled' ? warningRes.value : null,
    // 标记核心数据（浪+风）是否成功；两者都失败则该卡片显示"暂时取不到"
    ok: marineRes.status === 'fulfilled' || weatherRes.status === 'fulfilled',
    fetchedAt: new Date().toISOString(),
  };
}
