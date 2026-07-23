// ============================================================
// 安全判断逻辑：多模式可信度、离岸风、红黄绿综合结论
// ============================================================
import { THRESHOLDS, WAVE_MODELS, MODEL_DIVERGENCE_THRESHOLD } from './config.js';

// 结论等级
export const LEVEL = { GREEN: 'green', YELLOW: 'yellow', RED: 'red' };

// 单指标分级：给定值与 {greenMax, yellowMax}，返回等级
function gradeByMax(value, { greenMax, yellowMax }) {
  if (value == null || isNaN(value)) return null;
  if (value <= greenMax) return LEVEL.GREEN;
  if (value <= yellowMax) return LEVEL.YELLOW;
  return LEVEL.RED;
}

// 取多个等级中最严重的
function worst(levels) {
  const order = { green: 0, yellow: 1, red: 2 };
  let w = null;
  for (const l of levels) {
    if (l == null) continue;
    if (w == null || order[l] > order[w]) w = l;
  }
  return w == null ? LEVEL.GREEN : w;
}

// ---------- 从多模式 marine 数据中提取"当前时刻"各模式浪高，算可信度 ----------
// Open-Meteo 多模式返回的字段形如 wave_height_ewam / wave_height_gwam ...
// 返回 { value, models:[{model,height}], confidence:'high'|'low'|'single', spread }
function extractWaveConfidence(marine, idx) {
  if (!marine || !marine.hourly) return null;
  const h = marine.hourly;
  const heights = [];
  for (const m of WAVE_MODELS) {
    const key = `wave_height_${m}`;
    if (h[key] && h[key][idx] != null) {
      heights.push({ model: m, height: h[key][idx] });
    }
  }
  // 兼容：若未按模式后缀返回（单模式），退回基础字段
  if (heights.length === 0 && h.wave_height && h.wave_height[idx] != null) {
    return {
      value: h.wave_height[idx],
      models: [{ model: 'default', height: h.wave_height[idx] }],
      confidence: 'single',
      spread: 0,
    };
  }
  if (heights.length === 0) return null;

  const vals = heights.map((x) => x.height);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = Math.max(...vals) - Math.min(...vals);
  let confidence;
  if (heights.length === 1) confidence = 'single';
  else confidence = spread <= MODEL_DIVERGENCE_THRESHOLD ? 'high' : 'low';

  return { value: avg, models: heights, confidence, spread };
}

// ---------- 离岸风判断 ----------
// 风向为"风的来向"(气象标准)，风吹向 = 来向+180。
// 离岸方向 = 海岸朝向的反方向(即从岸吹向海) = coastFacing 的反向。
// 若"风吹向"接近"离岸方向"，即为离岸风。
function isOffshore(windFromDir, coastFacing) {
  if (windFromDir == null) return false;
  const windToward = (windFromDir + 180) % 360;
  // 离岸方向：从陆地吹向海，即朝向 coastFacing 方向吹
  const offshoreDir = coastFacing;
  let diff = Math.abs(windToward - offshoreDir) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= THRESHOLDS.offshoreAngleTolerance;
}

// 判断天气代码是否为雷暴（WMO code 95/96/99）
function isThunderstorm(code) {
  return code === 95 || code === 96 || code === 99;
}

// 找到"当前时刻"在时间轴数组中的下标
export function findNowIndex(times) {
  if (!times || !times.length) return 0;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    const d = Math.abs(t - now);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

// ---------- 综合评估单个点位（当前时刻）----------
export function evaluate(spotData) {
  const { spot, marine, weather, warning } = spotData;
  if (!spotData.ok) {
    return { level: null, unavailable: true, reasons: ['数据暂时取不到'] };
  }

  const reasons = [];
  const levels = [];

  // 时间轴与当前下标（优先用 weather 的时间轴）
  const times = weather?.hourly?.time || marine?.hourly?.time || [];
  const idx = findNowIndex(times);

  // --- 浪 ---
  const wave = extractWaveConfidence(marine, idx);
  let swellPeriod = null;
  let swellHeight = null;
  let windWaveHeight = null;
  if (marine?.hourly) {
    const mh = marine.hourly;
    // 涌浪周期/高度可能带模式后缀，做兜底取值
    swellPeriod = pickModelValue(mh, 'swell_wave_period', idx);
    swellHeight = pickModelValue(mh, 'swell_wave_height', idx);
    windWaveHeight = pickModelValue(mh, 'wind_wave_height', idx);
  }

  if (wave) {
    const lv = gradeByMax(wave.value, THRESHOLDS.waveHeight);
    levels.push(lv);
    if (lv === LEVEL.RED) reasons.push(`浪高 ${wave.value.toFixed(1)}m 偏大`);
    else if (lv === LEVEL.YELLOW) reasons.push(`浪高 ${wave.value.toFixed(1)}m 需注意`);
    if (wave.confidence === 'low') reasons.push('多模式分歧大，浪高仅供参考');
  }
  if (swellPeriod != null) {
    const lv = gradeByMax(swellPeriod, THRESHOLDS.swellPeriod);
    levels.push(lv);
    if (lv === LEVEL.RED) reasons.push(`涌浪周期 ${swellPeriod.toFixed(0)}s 偏长`);
    else if (lv === LEVEL.YELLOW) reasons.push(`涌浪周期 ${swellPeriod.toFixed(0)}s 需注意`);
  }

  // --- 风 ---
  let windSpeed = null;
  let windDir = null;
  let gust = null;
  let offshore = false;
  if (weather?.hourly) {
    const wh = weather.hourly;
    windSpeed = wh.wind_speed_10m?.[idx];
    windDir = wh.wind_direction_10m?.[idx];
    gust = wh.wind_gusts_10m?.[idx];

    if (windSpeed != null) {
      const lv = gradeByMax(windSpeed, THRESHOLDS.windSpeed);
      levels.push(lv);
      if (lv === LEVEL.RED) reasons.push(`风速 ${windSpeed.toFixed(0)}节 偏大`);
      else if (lv === LEVEL.YELLOW) reasons.push(`风速 ${windSpeed.toFixed(0)}节 需注意`);
    }
    if (gust != null) {
      const lv = gradeByMax(gust, THRESHOLDS.gust);
      levels.push(lv);
      if (lv === LEVEL.RED) reasons.push(`阵风 ${gust.toFixed(0)}节 偏大`);
      else if (lv === LEVEL.YELLOW) reasons.push(`阵风 ${gust.toFixed(0)}节 需注意`);
    }
    // 离岸风
    offshore = isOffshore(windDir, spot.coastFacing);
    if (offshore && windSpeed != null) {
      const lv = gradeByMax(windSpeed, THRESHOLDS.offshoreWind);
      levels.push(lv);
      if (lv !== LEVEL.GREEN) reasons.push(`⚠️ 离岸风 ${windSpeed.toFixed(0)}节，会把人吹向外海`);
    }
  }

  // --- 雷暴强制红 ---
  let thunder = false;
  if (weather?.hourly?.weather_code) {
    thunder = isThunderstorm(weather.hourly.weather_code[idx]);
  }
  // 和风官方预警（雷暴/大风/台风）
  let officialWarnings = [];
  if (Array.isArray(warning) && warning.length) {
    officialWarnings = warning.map((w) => w.title || w.typeName || '预警');
    reasons.push(...officialWarnings.map((t) => `官方预警：${t}`));
  }

  let level = worst(levels);
  if (thunder) {
    level = LEVEL.RED;
    reasons.unshift('⛈️ 雷暴，禁止下水');
  }
  // 有台风/雷暴类官方预警也强制红
  if (officialWarnings.some((t) => /台风|雷|暴雨|大风/.test(t))) {
    level = LEVEL.RED;
  }

  if (reasons.length === 0) reasons.push('各项条件良好');

  return {
    level,
    unavailable: false,
    reasons,
    metrics: {
      wave,
      swellHeight,
      swellPeriod,
      windWaveHeight,
      windSpeed,
      windDir,
      gust,
      offshore,
      thunder,
      officialWarnings,
    },
    fetchedAt: spotData.fetchedAt,
    nowIndex: idx,
  };
}

// 从可能带模式后缀的 hourly 字段里取值（先试基础名，再试各模式）
function pickModelValue(hourly, base, idx) {
  if (hourly[base] && hourly[base][idx] != null) return hourly[base][idx];
  for (const m of WAVE_MODELS) {
    const k = `${base}_${m}`;
    if (hourly[k] && hourly[k][idx] != null) return hourly[k][idx];
  }
  return null;
}

// 风向角度 -> 中文方位
export function dirToText(deg) {
  if (deg == null) return '--';
  const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return dirs[Math.round(deg / 45) % 8];
}

// 节 -> 蒲福风级（近似）
export function knotsToBeaufort(kn) {
  if (kn == null) return 0;
  const table = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
  for (let i = 0; i < table.length; i++) if (kn < table[i]) return i;
  return 12;
}
