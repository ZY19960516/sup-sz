// ============================================================
// 界面渲染：7 张卡片 + 点击展开详情 + 时间轴曲线图
// 依赖 uPlot（通过 CDN 在 index.html 引入，全局 uPlot）
// ============================================================
import { OFFICIAL_FORECAST_URL, TIMELINE, WAVE_MODELS } from './config.js';
import { LEVEL, dirToText, knotsToBeaufort, findNowIndex } from './logic.js';

const verdictText = {
  green: '适宜',
  yellow: '谨慎',
  red: '不宜',
};

// 渲染全部卡片
export function renderCards(results, container) {
  container.innerHTML = '';
  for (const r of results) {
    container.appendChild(renderCard(r));
  }
}

function renderCard({ spotData, evalResult }) {
  const spot = spotData.spot;
  const ev = evalResult;
  const card = document.createElement('div');
  const lvClass = ev.unavailable ? 'unavailable' : ev.level;
  card.className = `card ${lvClass}`;

  if (ev.unavailable) {
    card.innerHTML = `
      <div class="card-head">
        <span class="card-name">${spot.name}</span>
        <span class="card-verdict unavailable">暂无数据</span>
      </div>
      <div class="card-body"><div class="reasons">数据暂时取不到，下拉刷新重试</div></div>`;
    return card;
  }

  const m = ev.metrics;
  const waveVal = m.wave ? m.wave.value.toFixed(1) : '--';
  const confCls = m.wave ? m.wave.confidence : 'single';
  const confLabel = { high: '✓高可信', low: '⚠分歧大', single: '单模式' }[confCls];

  const swellTxt = m.swellHeight != null
    ? `涌浪 ${m.swellHeight.toFixed(1)}m / ${m.swellPeriod != null ? m.swellPeriod.toFixed(0) : '--'}s`
    : '';
  const windWaveTxt = m.windWaveHeight != null ? `风浪 ${m.windWaveHeight.toFixed(1)}m` : '';

  const windTxt = m.windSpeed != null
    ? `${knotsToBeaufort(m.windSpeed)}级 ${m.windSpeed.toFixed(0)}节 ${dirToText(m.windDir)}`
    : '--';
  const gustCls = m.gust != null && m.gust > 15 ? 'warn' : '';
  const offshoreTag = m.offshore ? '<span class="metric warn">离岸风⚠️</span>' : '';

  const reasonsHtml = ev.reasons.map((rs) => {
    const danger = /雷暴|离岸|预警|偏大|偏长/.test(rs);
    return `<div class="${danger ? 'danger' : ''}">${rs}</div>`;
  }).join('');

  const times = spotData.weather?.hourly?.time || spotData.marine?.hourly?.time || [];
  const updatedTxt = fmtTime(spotData.fetchedAt);

  card.innerHTML = `
    <div class="card-head" data-action="toggle">
      <span class="card-name">${spot.name}</span>
      <span class="card-verdict ${ev.level}">${verdictBadge(ev.level)} ${verdictText[ev.level]}</span>
    </div>
    <div class="card-body" data-action="toggle">
      <div class="wave-block">
        <span class="wave-main">🌊 ${waveVal}<span class="wave-unit">m</span></span>
        <span class="confidence ${confCls}">${confLabel}</span>
      </div>
      <div class="wave-detail">
        ${swellTxt ? `<span>${swellTxt}</span>` : ''}
        ${windWaveTxt ? `<span>${windWaveTxt}</span>` : ''}
      </div>
      <div class="metrics-row">
        <span class="metric">💨 ${windTxt}</span>
        <span class="metric ${gustCls}">🌀 阵风 ${m.gust != null ? m.gust.toFixed(0) + '节' : '--'}</span>
        ${offshoreTag}
      </div>
      <div class="reasons">${reasonsHtml}</div>
      <div class="card-foot">
        <span>更新于 ${updatedTxt}</span>
        <span class="expand-hint">点击查看 72h 曲线 ▾</span>
      </div>
    </div>
    <div class="detail" id="detail-${spot.id}">
      <div class="detail-controls">
        <div class="seg" data-seg="forecast">
          ${TIMELINE.forecastOptions.map((h, i) =>
            `<button data-hours="${h}" class="${i === TIMELINE.forecastOptions.length - 1 ? 'active' : ''}">未来${h}h</button>`
          ).join('')}
        </div>
        <div class="seg" data-seg="metric">
          <button data-metric="wave" class="active">浪高</button>
          <button data-metric="swell">涌浪</button>
          <button data-metric="wind">风速</button>
        </div>
      </div>
      <div class="chart-wrap" id="chart-${spot.id}"></div>
      <div class="legend">
        <span class="dot" style="background:#0ea5e9"></span>数值
        <span class="dot" style="background:#94a3b8"></span>过去 · 竖线=现在
      </div>
      <a class="official-link" href="${OFFICIAL_FORECAST_URL}" target="_blank" rel="noopener">
        📄 查看深圳官方海洋预报 →
      </a>
    </div>
  `;

  // 交互：展开/收起 + 图表
  const detail = card.querySelector('.detail');
  card.querySelectorAll('[data-action="toggle"]').forEach((el) => {
    el.addEventListener('click', () => {
      const opening = !detail.classList.contains('open');
      detail.classList.toggle('open');
      if (opening) drawChart(spot, spotData, 72, 'wave');
    });
  });

  // 未来时长切换
  detail.querySelectorAll('[data-seg="forecast"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActive(btn);
      const hours = +btn.dataset.hours;
      const metric = detail.querySelector('[data-seg="metric"] .active').dataset.metric;
      drawChart(spot, spotData, hours, metric);
    });
  });
  // 指标切换
  detail.querySelectorAll('[data-seg="metric"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActive(btn);
      const hours = +detail.querySelector('[data-seg="forecast"] .active').dataset.hours;
      drawChart(spot, spotData, hours, btn.dataset.metric);
    });
  });

  return card;
}

function setActive(btn) {
  btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
}

function verdictBadge(level) {
  return { green: '🟢', yellow: '🟡', red: '🔴' }[level] || '⚪';
}

// 图表实例缓存，避免重复创建
const chartInstances = {};

// 画时间轴曲线：过去(默认7天) + 未来(hours)，metric = wave|swell|wind
function drawChart(spot, spotData, forecastHours, metric) {
  const wrapId = `chart-${spot.id}`;
  const wrap = document.getElementById(wrapId);
  if (!wrap || typeof uPlot === 'undefined') return;

  const src = metric === 'wind' ? spotData.weather : spotData.marine;
  if (!src || !src.hourly) {
    wrap.innerHTML = '<div style="padding:20px;color:#94a3b8">该指标暂无数据</div>';
    return;
  }
  const hourly = src.hourly;
  const times = hourly.time;
  const nowIdx = findNowIndex(times);

  // 取值字段
  const field = {
    wave: 'wave_height',
    swell: 'swell_wave_height',
    wind: 'wind_speed_10m',
  }[metric];
  const values = pickSeries(hourly, field);

  // 时间窗口：过去 pastDaysDefault 天 ~ 未来 forecastHours 小时
  const startIdx = Math.max(0, nowIdx - TIMELINE.pastDaysDefault * 24);
  const endIdx = Math.min(times.length - 1, nowIdx + forecastHours);

  const xs = [];
  const ys = [];
  for (let i = startIdx; i <= endIdx; i++) {
    xs.push(new Date(times[i]).getTime() / 1000);
    ys.push(values ? values[i] : null);
  }

  const label = { wave: '浪高 (m)', swell: '涌浪 (m)', wind: '风速 (节)' }[metric];
  const color = metric === 'wind' ? '#f59e0b' : '#0ea5e9';

  // 销毁旧实例
  if (chartInstances[wrapId]) {
    chartInstances[wrapId].destroy();
    delete chartInstances[wrapId];
  }
  wrap.innerHTML = '';

  const nowSec = Date.now() / 1000;
  const opts = {
    width: wrap.clientWidth || 320,
    height: 200,
    scales: { x: { time: true } },
    series: [
      {},
      {
        label,
        stroke: color,
        width: 2,
        fill: color + '22',
        points: { show: false },
      },
    ],
    axes: [
      {
        stroke: '#94a3b8',
        grid: { stroke: '#e2e8f033' },
        values: (u, ticks) => ticks.map((t) => {
          const d = new Date(t * 1000);
          return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}h`;
        }),
      },
      { stroke: '#94a3b8', grid: { stroke: '#e2e8f033' } },
    ],
    // 在"现在"画竖线
    hooks: {
      draw: [
        (u) => {
          const cx = u.valToPos(nowSec, 'x', true);
          const ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = '#dc2626';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(cx, u.bbox.top);
          ctx.lineTo(cx, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        },
      ],
    },
  };

  chartInstances[wrapId] = new uPlot(opts, [xs, ys], wrap);
}

// 从可能带模式后缀的字段取一条序列（优先基础名，再取首个可用模式）
function pickSeries(hourly, base) {
  if (hourly[base]) return hourly[base];
  for (const m of WAVE_MODELS) {
    if (hourly[`${base}_${m}`]) return hourly[`${base}_${m}`];
  }
  return null;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
