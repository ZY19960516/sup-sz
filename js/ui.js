// ============================================================
// 界面渲染：点位卡片 + 点击展开详情 + 时间轴曲线图
// 依赖 uPlot（通过 CDN 在 index.html 引入，全局 uPlot）
// ============================================================
import { TIMELINE, WAVE_MODELS } from './config.js';
import { fmtWind, knotsToMs, findNowIndex } from './logic.js';

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
      <div class="card-body"><div class="reasons">${ev.summary}</div></div>`;
    return card;
  }

  const m = ev.metrics;
  const waveVal = m.peakWave != null ? m.peakWave.toFixed(1) : '--';
  const confCls = m.waveConf || 'single';
  const confLabel = { high: '✓高可信', low: '⚠分歧大', single: '单模式' }[confCls];

  const windKn = m.peakWindKn;
  const windTxt = windKn != null ? fmtWind(windKn) : '--';
  const offshoreTag = m.offshore ? '<span class="metric warn">⚠️ 离岸风</span>' : '';

  const tempTxt = m.temp != null ? `🌡️ ${m.temp.toFixed(0)}℃` : '';
  const precipVal = m.maxPrecip || 0;
  const rainTxt = precipVal > 0 ? `🌧️ ${precipVal.toFixed(1)}mm` : '☀️ 无雨';
  const rainCls = precipVal > 0 ? 'warn' : '';

  // 上午/下午时段详情
  const { morning, afternoon } = ev.periods;
  const periodHtml = (p, label) => {
    if (!p) return '';
    const badge = verdictBadge(p.level);
    const reasonsHtml = p.reasons.map((rs) => {
      const danger = /雷暴|离岸|预警|偏大|偏长|阵风/.test(rs);
      return `<div class="${danger ? 'danger' : ''}">${rs}</div>`;
    }).join('');
    return `
      <div class="period-block">
        <div class="period-label">${badge} ${label}</div>
        <div class="period-reasons">${reasonsHtml}</div>
      </div>
    `;
  };

  const updatedTxt = fmtTime(spotData.fetchedAt);

  card.innerHTML = `
    <div class="card-head" data-action="toggle">
      <span class="card-name">${spot.name}</span>
      <span class="card-verdict ${ev.level}">${verdictBadge(ev.level)}</span>
    </div>
    <div class="card-body" data-action="toggle">
      <div class="summary-text">${ev.summary}</div>
      <div class="wave-block">
        <span class="wave-main">🌊 ${waveVal}<span class="wave-unit">m</span></span>
        <span class="confidence ${confCls}">${confLabel}</span>
      </div>
      <div class="metrics-row">
        <span class="metric">💨 ${windTxt}</span>
        ${offshoreTag}
      </div>
      <div class="metrics-row">
        ${tempTxt ? `<span class="metric">${tempTxt}</span>` : ''}
        <span class="metric ${rainCls}">${rainTxt}</span>
      </div>
      <div class="periods">
        ${periodHtml(morning, '上午 6-12点')}
        ${periodHtml(afternoon, '下午 12-18点')}
      </div>
      <div class="card-foot">
        <span>更新于 ${updatedTxt}</span>
        <span class="expand-hint">点击查看曲线 ▾</span>
      </div>
    </div>
    <div class="detail" id="detail-${spot.id}">
      <div class="detail-controls">
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
    </div>
  `;

  // 交互：展开/收起 + 图表
  const detail = card.querySelector('.detail');
  card.querySelectorAll('[data-action="toggle"]').forEach((el) => {
    el.addEventListener('click', () => {
      const opening = !detail.classList.contains('open');
      detail.classList.toggle('open');
      if (opening) {
        // 等 CSS 动画完成后再画图，避免容器宽度为 0
        setTimeout(() => drawChart(spot, spotData, 24, 'wave'), 350);
      }
    });
  });

  // 指标切换（去掉了时长切换，固定 24h）
  detail.querySelectorAll('[data-seg="metric"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setActive(btn);
      drawChart(spot, spotData, 24, btn.dataset.metric);
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
  if (!wrap) {
    console.error('drawChart: 容器不存在', wrapId);
    return;
  }
  if (typeof uPlot === 'undefined') {
    console.error('drawChart: uPlot 库未加载');
    return;
  }
  // 确保容器有宽度，否则 uPlot 会报错
  if (wrap.clientWidth === 0) {
    console.warn('drawChart: 容器宽度为 0，稍后重试', wrapId);
    setTimeout(() => drawChart(spot, spotData, forecastHours, metric), 100);
    return;
  }

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
    let v = values ? values[i] : null;
    // 风速数据源是节，图表统一换算成 m/s 显示
    if (metric === 'wind' && v != null) v = +knotsToMs(v).toFixed(1);
    ys.push(v);
  }

  const label = { wave: '浪高 (m)', swell: '涌浪 (m)', wind: '风速 (m/s)' }[metric];
  const color = metric === 'wind' ? '#f59e0b' : '#0ea5e9';

  // 销毁旧实例
  if (chartInstances[wrapId]) {
    chartInstances[wrapId].destroy();
    delete chartInstances[wrapId];
  }
  wrap.innerHTML = '';

  const nowSec = Date.now() / 1000;
  const unit = metric === 'wind' ? 'm/s' : 'm';
  const opts = {
    width: wrap.clientWidth || 320,
    height: 200,
    scales: { x: { time: true } },
    // 游标：启用横向游标供 setCursor 气泡联动，但不用内置 points（该版本有 bug）
    cursor: { x: true, y: false },
    legend: { show: false }, // 用自定义气泡代替默认图例表格
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
        // 智能格式化时间轴标签
        values: (u, ticks) => ticks.map((t) => {
          const d = new Date(t * 1000);
          const hoursDiff = (t - nowSec) / 3600;
          // 未来 24h 内只显示时间(如 14:00)，超过则显示日期+时间
          if (hoursDiff >= -24 && hoursDiff <= 24) {
            return `${String(d.getHours()).padStart(2, '0')}:00`;
          }
          return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}h`;
        }),
        // 减少刻度密度，避免重叠(移动端屏幕窄)
        space: 80, // 刻度间最小像素间距
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
      setCursor: [], // 稍后添加
    },
  };

  // 触摸提示气泡：显示当前手指位置的时间 + 数值
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  wrap.style.position = 'relative';
  wrap.appendChild(tip);

  // 游标移动时更新气泡（鼠标 + 触摸都会触发）
  opts.hooks.setCursor.push(
    (u) => {
      const { idx, left } = u.cursor;
      if (idx == null || left == null || left < 0) {
        tip.style.display = 'none';
        return;
      }
      const t = u.data[0][idx];
      const v = u.data[1][idx];
      if (t == null || v == null) {
        tip.style.display = 'none';
        return;
      }
      const d = new Date(t * 1000);
      const hh = `${String(d.getHours()).padStart(2, '0')}:00`;
      const dayTxt = `${d.getMonth() + 1}/${d.getDate()}`;
      tip.innerHTML = `<b>${dayTxt} ${hh}</b><br>${label.split(' ')[0]} ${v}${unit}`;
      tip.style.display = 'block';
      // 气泡跟随手指，超右侧则翻到左边，避免出界
      const half = tip.offsetWidth / 2;
      let px = left;
      if (px + half > u.width) px = u.width - half;
      if (px - half < 0) px = half;
      tip.style.left = px + 'px';
    },
  );

  const u = new uPlot(opts, [xs, ys], wrap);
  chartInstances[wrapId] = u;

  // 让手指在图表上滑动 = 移动游标查看各时间点（uPlot 默认只认鼠标）
  // 用 requestAnimationFrame 确保 uPlot 完全初始化后再绑定
  requestAnimationFrame(() => {
    if (u.over) bindTouchCursor(u, wrap);
  });
}

// 将 touch 事件转发为 uPlot 可识别的指针位置，实现手指滑动查看数据点
function bindTouchCursor(u, wrap) {
  const over = u.over; // uPlot 的交互覆盖层
  if (!over) {
    console.warn('bindTouchCursor: u.over 不存在，跳过触摸绑定');
    return;
  }
  const handle = (e) => {
    if (!e.touches || !e.touches.length) return;
    const rect = over.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;
    // 只要手指在图表横向范围内，就更新游标到该位置
    u.setCursor({ left: Math.max(0, Math.min(x, u.width)), top: Math.max(0, Math.min(y, u.height)) });
    e.preventDefault(); // 阻止横向滑动被当成页面滚动/选中
  };
  over.addEventListener('touchstart', handle, { passive: false });
  over.addEventListener('touchmove', handle, { passive: false });
  over.addEventListener('touchend', () => u.setCursor({ left: -10, top: -10 }));
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
