// ============================================================
// 深圳浆板风浪预警 PWA — 配置文件
// 所有可调参数集中在这里：点位、阈值、和风天气 key
// ============================================================

// ---------- 和风天气配置（可选，缺失则自动降级为单源） ----------
export const QWEATHER = {
  // 你的专属 API Host（新版和风必须用这个域名）
  host: 'n72tur22nm.re.qweatherapi.com',
  // API Key：在这里填入你的和风 key。
  // ⚠️ 安全提醒：若日后要公开部署（如 GitHub Pages），不要把带 key 的文件推到公开仓库，
  //    否则 key 会暴露被盗刷。本地自用直接填即可。
  key: '', // <-- 在此填入你的和风 API Key
};

// ---------- 点位清单 ----------
// 坐标使用各点位【近岸海面】经纬度，确保 Open-Meteo Marine 能返回浪高数据
// （陆地坐标取不到浪）。coastFacing = 海岸朝向（度，正北=0，用于判断离岸风）。
export const SPOTS = [
  {
    id: 'meisha',
    name: '大梅沙/小梅沙',
    lat: 22.5850,
    lon: 114.3200,
    coastFacing: 160,
  },
  {
    id: 'jiaochangwei',
    name: '较场尾',
    lat: 22.5980,
    lon: 114.5320,
    coastFacing: 160, // 大鹏所城南侧，朝向东南偏南
  },
  {
    id: 'dapengwan',
    name: '大鹏湾',
    lat: 22.5450,
    lon: 114.4800,
    coastFacing: 180, // 湾内朝南
  },
  {
    id: 'xichong',
    name: '西涌',
    lat: 22.4790,
    lon: 114.5350,
    coastFacing: 170, // 朝南偏东，直面外海
  },
  {
    id: 'jinshawan',
    name: '金沙湾',
    lat: 22.5920,
    lon: 114.5060,
    coastFacing: 150,
  },
  {
    id: 'shenzhenwan',
    name: '深圳湾',
    lat: 22.4780,
    lon: 113.9450,
    coastFacing: 225, // 湾内朝西南，内湾浪小
  },
];

// ---------- 安全阈值（红黄绿分界）----------
// 单位：浪高 m，周期 s，风速 节(kn)
// 判断规则：任一指标命中红 -> 红；无红但有黄 -> 黄；全绿 -> 绿；有雷暴预警强制红。
export const THRESHOLDS = {
  // 总有效浪高
  waveHeight: { greenMax: 0.5, yellowMax: 0.8 },
  // 涌浪周期（越长的涌浪越危险）——红线由 10s 抬高到 11s，适当放松
  swellPeriod: { greenMax: 8, yellowMax: 11 },
  // 涌浪高度联合判定：涌高 < ignore 视为远洋残涌尾巴，水面平缓无危害，
  // 无论周期多长都不判危险；长周期(超 yellowMax)要判红，涌高须达到 redMin，
  // 否则降为黄。避免"周期长但涌很小"被过度判红。
  swellHeight: { ignore: 0.3, redMin: 0.6 },
  // 平均风速（风力主要作为"谨慎"提醒，红色线抬高，不轻易主导整体判红）
  windSpeed: { greenMax: 14, yellowMax: 22 },
  // 离岸风（把人吹向外海，头号杀手，保持严格——这是真正的致命因素）
  offshoreWind: { greenMax: 10, yellowMax: 14 },
  // 阵风绝对值上限（阵风比持续风更影响站立，但仍以黄色提醒为主，红色留给极端大风）
  gust: { greenMax: 15, yellowMax: 24 },
  // 离岸风判定：实际风向与"离岸方向"夹角小于此值即视为离岸风
  offshoreAngleTolerance: 45,
};

// ---------- Open-Meteo 多模式（用于交叉验证浪高可信度）----------
// 同时取多个海浪模式，数值接近=高可信，分歧大=仅供参考
// 注意：ewam 是欧洲区域模式，不覆盖南海（对深圳坐标返回空），
//       已换成覆盖全球/南海的 ecmwf_wam025，实测三模式对深圳均有数据。
export const WAVE_MODELS = ['ecmwf_wam025', 'gwam', 'meteofrance_wave'];
// 多模式浪高差异超过此值(m)判定为"分歧大"
export const MODEL_DIVERGENCE_THRESHOLD = 0.3;

// ---------- 时间轴 ----------
export const TIMELINE = {
  pastDaysDefault: 7,   // 默认回溯天数
  pastDaysMax: 92,      // 最多回溯（约 3 个月）
  forecastOptions: [24, 48, 72], // 未来预报可选小时数
};

// ---------- 官方海洋预报跳转链接（不抓取，仅跳转）----------
export const OFFICIAL_FORECAST_URL = 'https://pnr.sz.gov.cn/ywzy/hyyb/index.html';
