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

// ---------- 白天时段定义（浆板只在白天活动） ----------
export const DAYTIME = { start: 6, end: 18 };      // 整个白天 6-18 点
export const PERIOD_SPLIT = 12;                    // 上午/下午分界

// 找出「今天+dayOffset」当天、小时在 [startHour, endHour) 的时间轴下标
function dayHourIndices(times, dayOffset, startHour, endHour) {
  if (!times || !times.length) return [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + dayOffset);
  const y = base.getFullYear(), mo = base.getMonth(), da = base.getDate();
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const d = new Date(times[i]);
    if (d.getFullYear() === y && d.getMonth() === mo && d.getDate() === da) {
      const h = d.getHours();
      if (h >= startHour && h < endHour) out.push(i);
    }
  }
  return out;
}

// 单个小时的评估：返回该小时各指标值 + 综合等级
function evalHour(spotData, idx) {
  const { spot, marine, weather } = spotData;
  const wh = weather?.hourly;
  const wave = extractWaveConfidence(marine, idx);
  const waveVal = wave ? wave.value : null;
  const swellPeriod = marine?.hourly ? pickModelValue(marine.hourly, 'swell_wave_period', idx) : null;
  const windKn = wh?.wind_speed_10m?.[idx] ?? null;
  const windDir = wh?.wind_direction_10m?.[idx] ?? null;
  const gust = wh?.wind_gusts_10m?.[idx] ?? null;
  const temp = wh?.temperature_2m?.[idx] ?? null;
  const precip = wh?.precipitation?.[idx] ?? null;
  const code = wh?.weather_code?.[idx];
  const thunder = code != null && isThunderstorm(code);
  const offshore = isOffshore(windDir, spot.coastFacing);

  const levels = [];
  if (waveVal != null) levels.push(gradeByMax(waveVal, THRESHOLDS.waveHeight));
  if (swellPeriod != null) levels.push(gradeByMax(swellPeriod, THRESHOLDS.swellPeriod));
  if (windKn != null) levels.push(gradeByMax(windKn, THRESHOLDS.windSpeed));
  if (gust != null) levels.push(gradeByMax(gust, THRESHOLDS.gust));
  if (offshore && windKn != null) levels.push(gradeByMax(windKn, THRESHOLDS.offshoreWind));
  let level = worst(levels);
  if (thunder) level = LEVEL.RED;

  return { idx, level, wave, waveVal, swellPeriod, windKn, windDir, gust, temp, precip, thunder, offshore };
}

// 把一组（连续）下标格式化成小时段文字，如 "14-17点"、"15点"
function fmtHourRanges(times, idxList) {
  if (!idxList.length) return '';
  const sorted = [...idxList].sort((a, b) => a - b);
  const groups = [];
  let s = sorted[0], p = sorted[0];
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k] === p + 1) { p = sorted[k]; continue; }
    groups.push([s, p]); s = sorted[k]; p = sorted[k];
  }
  groups.push([s, p]);
  return groups.map(([a, b]) => {
    const ha = new Date(times[a]).getHours();
    const hb = new Date(times[b]).getHours();
    return ha === hb ? `${ha}点` : `${ha}-${hb + 1}点`;
  }).join('、');
}

// 评估一个时段（上午/下午）：聚合该时段所有小时，找出最差等级 + 危险原因(含时段)
function evalPeriod(spotData, indices, times) {
  if (!indices.length) return null;
  const hours = indices.map((i) => evalHour(spotData, i));
  const level = worst(hours.map((h) => h.level));

  // 各危险因子命中的小时下标
  const thunderIdx = hours.filter((h) => h.thunder).map((h) => h.idx);
  const waveBadIdx = hours.filter((h) => h.waveVal != null && gradeByMax(h.waveVal, THRESHOLDS.waveHeight) !== LEVEL.GREEN).map((h) => h.idx);
  const windBadIdx = hours.filter((h) => h.windKn != null && gradeByMax(h.windKn, THRESHOLDS.windSpeed) !== LEVEL.GREEN).map((h) => h.idx);
  const gustBadIdx = hours.filter((h) => h.gust != null && gradeByMax(h.gust, THRESHOLDS.gust) !== LEVEL.GREEN).map((h) => h.idx);
  const swellBadIdx = hours.filter((h) => h.swellPeriod != null && gradeByMax(h.swellPeriod, THRESHOLDS.swellPeriod) !== LEVEL.GREEN).map((h) => h.idx);
  const offshoreIdx = hours.filter((h) => h.offshore && h.windKn != null && gradeByMax(h.windKn, THRESHOLDS.offshoreWind) !== LEVEL.GREEN).map((h) => h.idx);

  const reasons = [];
  if (thunderIdx.length) reasons.push(`⛈️ ${fmtHourRanges(times, thunderIdx)}有雷暴，禁止下水`);
  if (waveBadIdx.length) {
    const peak = Math.max(...hours.filter((h) => waveBadIdx.includes(h.idx)).map((h) => h.waveVal));
    reasons.push(`浪高 ${peak.toFixed(1)}m（${fmtHourRanges(times, waveBadIdx)}）`);
  }
  if (swellBadIdx.length) {
    const peak = Math.max(...hours.filter((h) => swellBadIdx.includes(h.idx)).map((h) => h.swellPeriod));
    reasons.push(`涌浪周期 ${peak.toFixed(0)}s 偏长（${fmtHourRanges(times, swellBadIdx)}）`);
  }
  if (windBadIdx.length) {
    const peak = Math.max(...hours.filter((h) => windBadIdx.includes(h.idx)).map((h) => h.windKn));
    reasons.push(`风偏大 ${knotsToMs(peak).toFixed(1)}m/s（${fmtHourRanges(times, windBadIdx)}）`);
  }
  if (gustBadIdx.length) {
    const peak = Math.max(...hours.filter((h) => gustBadIdx.includes(h.idx)).map((h) => h.gust));
    reasons.push(`阵风 ${knotsToMs(peak).toFixed(1)}m/s（${fmtHourRanges(times, gustBadIdx)}）`);
  }
  if (offshoreIdx.length) reasons.push(`⚠️ 离岸风（${fmtHourRanges(times, offshoreIdx)}）会把人吹向外海`);
  if (!reasons.length) reasons.push('各项条件良好');

  // 一句话短标签（取最严重因子）：雷暴 > 浪 > 涌浪 > 风 > 阵风 > 离岸
  let headline = '';
  if (thunderIdx.length) headline = `${fmtHourRanges(times, thunderIdx)}雷暴`;
  else if (waveBadIdx.length) headline = `${fmtHourRanges(times, waveBadIdx)}浪大`;
  else if (swellBadIdx.length) headline = `${fmtHourRanges(times, swellBadIdx)}涌浪长`;
  else if (windBadIdx.length) headline = `${fmtHourRanges(times, windBadIdx)}风大`;
  else if (gustBadIdx.length) headline = `${fmtHourRanges(times, gustBadIdx)}阵风大`;
  else if (offshoreIdx.length) headline = `${fmtHourRanges(times, offshoreIdx)}离岸风`;
  // 兜底：非绿时段必须有原因。若上面未命中(等级来源与因子集不一致)，取首条 reason
  if (!headline && level !== LEVEL.GREEN && reasons[0] && reasons[0] !== '各项条件良好') {
    headline = reasons[0].replace(/（[^）]*）/g, '').trim();
  }

  // 该时段代表值（用于卡片展示）：峰值浪、峰值风、中点气温/降雨
  const mid = hours[Math.floor(hours.length / 2)];
  const peakWave = Math.max(...hours.map((h) => (h.waveVal == null ? -Infinity : h.waveVal)));
  const peakWindKn = Math.max(...hours.map((h) => (h.windKn == null ? -Infinity : h.windKn)));
  const maxPrecip = Math.max(...hours.map((h) => (h.precip == null ? 0 : h.precip)));
  const waveConf = mid.wave ? mid.wave.confidence : 'single';

  return {
    level, reasons, headline,
    peakWave: isFinite(peakWave) ? peakWave : null,
    peakWindKn: isFinite(peakWindKn) ? peakWindKn : null,
    temp: mid.temp, maxPrecip, waveConf,
    windDir: mid.windDir, offshore: offshoreIdx.length > 0,
  };
}

// 生成一句话结论：两段一致 → "全天…"；不一致 → 分上午/下午
function buildSummary(morning, afternoon, officialWarnings) {
  const vt = { green: '适宜', yellow: '谨慎', red: '不宜' };
  const em = { green: '🟢', yellow: '🟡', red: '🔴' };
  if (officialWarnings.some((t) => /台风/.test(t))) return '🔴 台风预警，禁止下水';
  if (!morning && !afternoon) return '暂无白天时段数据';
  if (!morning) return `${em[afternoon.level]} 下午${vt[afternoon.level]}${afternoon.headline ? '：' + afternoon.headline : ''}`;
  if (!afternoon) return `${em[morning.level]} 上午${vt[morning.level]}${morning.headline ? '：' + morning.headline : ''}`;

  // 两段等级一致 → 全天
  if (morning.level === afternoon.level) {
    const lv = morning.level;
    if (lv === 'green') return '🟢 全天适宜，放心下水';
    const hl = morning.headline || afternoon.headline || '';
    return `${em[lv]} 全天${vt[lv]}${hl ? '：' + hl : ''}`;
  }
  // 不一致 → 分述
  const mp = `上午${em[morning.level]}${vt[morning.level]}${morning.level !== 'green' && morning.headline ? '(' + morning.headline + ')' : ''}`;
  const ap = `下午${em[afternoon.level]}${vt[afternoon.level]}${afternoon.level !== 'green' && afternoon.headline ? '(' + afternoon.headline + ')' : ''}`;
  return `${mp}，${ap}`;
}

// ---------- 综合评估单个点位（指定某天，分上午/下午时段） ----------
export function evaluate(spotData, dayOffset = 0) {
  const { marine, weather, warning } = spotData;
  if (!spotData.ok) {
    return { level: null, unavailable: true, summary: '数据暂时取不到', reasons: ['数据暂时取不到'] };
  }

  const times = weather?.hourly?.time || marine?.hourly?.time || [];
  const morning = evalPeriod(spotData, dayHourIndices(times, dayOffset, DAYTIME.start, PERIOD_SPLIT), times);
  const afternoon = evalPeriod(spotData, dayHourIndices(times, dayOffset, PERIOD_SPLIT, DAYTIME.end), times);

  // 和风官方预警（雷暴/大风/台风），日级别
  let officialWarnings = [];
  if (Array.isArray(warning) && warning.length) {
    officialWarnings = warning.map((w) => w.title || w.typeName || '预警');
  }

  let level = worst([morning?.level, afternoon?.level].filter(Boolean));
  if (officialWarnings.some((t) => /台风|雷|暴雨|大风/.test(t))) level = LEVEL.RED;
  if (!morning && !afternoon) {
    return { level: null, unavailable: true, summary: '该日暂无数据', reasons: ['该日暂无白天时段数据'] };
  }

  const summary = buildSummary(morning, afternoon, officialWarnings);

  // 卡片头部展示的代表指标：全天白天峰值浪/峰值风 + 上午气温 + 全天最大降雨
  const dayPeakWave = Math.max(morning?.peakWave ?? -Infinity, afternoon?.peakWave ?? -Infinity);
  const dayPeakWindKn = Math.max(morning?.peakWindKn ?? -Infinity, afternoon?.peakWindKn ?? -Infinity);
  const dayMaxPrecip = Math.max(morning?.maxPrecip ?? 0, afternoon?.maxPrecip ?? 0);
  const repTemp = (morning || afternoon).temp;
  const repWaveConf = (morning || afternoon).waveConf;
  const repWindDir = (morning || afternoon).windDir;

  return {
    level,
    unavailable: false,
    summary,
    dayOffset,
    periods: { morning, afternoon },
    officialWarnings,
    metrics: {
      peakWave: isFinite(dayPeakWave) ? dayPeakWave : null,
      peakWindKn: isFinite(dayPeakWindKn) ? dayPeakWindKn : null,
      maxPrecip: dayMaxPrecip,
      temp: repTemp,
      waveConf: repWaveConf,
      windDir: repWindDir,
      offshore: (morning?.offshore || afternoon?.offshore) || false,
    },
    fetchedAt: spotData.fetchedAt,
    nowIndex: findNowIndex(times),
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

// 节 -> 米/秒（1 节 = 0.5144 m/s）
export function knotsToMs(kn) {
  if (kn == null) return null;
  return kn * 0.5144;
}

// 风速统一展示文案：「N级 X.Xm/s」（数据源取的是节，此处换算显示）
export function fmtWind(kn) {
  if (kn == null) return '--';
  return `${knotsToBeaufort(kn)}级 ${knotsToMs(kn).toFixed(1)}m/s`;
}
