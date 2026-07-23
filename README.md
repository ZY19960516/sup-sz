# 🏄 深圳浆板风浪预警 PWA

为深圳桨板爱好者设计的海况预警应用，提供 7 个热门点位的实时风浪预报。基于多模式海浪预报和气象数据，按日期评估每天上午/下午的下海条件，生成一句话结论和具体原因。

## ✨ 核心功能

- **按日期评估**：查看今天/明天/后天各点位的适宜性（绿色适宜 / 黄色谨慎 / 红色不宜）
- **时段拆分**：每天分上午（6-12点）和下午（12-18点）独立评估，精准到具体时间段
- **一句话结论**：如"上午🟢适宜，下午🟡谨慎(15-18点阵风大)"
- **多维度安全评估**：
  - 浪高（多模式交叉验证，显示可信度）
  - 风速 + 阵风（阵风阈值更严格，重点防范）
  - 离岸风检测（头号杀手，会把人吹向外海）
  - 涌浪周期（长周期涌浪危险性高）
  - 雷暴预警（接入和风天气，有雷暴强制红色）
- **历史 + 预报曲线**：可查看过去 7 天和未来 24 小时的浪高/涌浪/风速走势
- **PWA 离线支持**：安装到桌面，离线可查看缓存数据

## 📍 覆盖点位

- 大梅沙/小梅沙
- 较场尾
- 大鹏湾
- 西涌
- 金沙湾
- 深圳湾

## 🔧 技术栈

- **纯前端 PWA**（HTML + CSS + 原生 JS），无需后端
- **数据来源**：
  - [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)：多模式海浪预报（ECMWF WAM、GWAM、Météo-France）+ 风速/阵风/风向
  - [Open-Meteo Weather API](https://open-meteo.com/en/docs)：气温/降雨/天气代码
  - [和风天气预警 API](https://dev.qweather.com/)（可选）：官方雷暴/台风预警
- **图表库**：[uPlot](https://github.com/leeoniya/uPlot)（轻量高性能）
- **Service Worker**：缓存静态资源 + API 响应，支持离线查看

## 🚀 本地运行

1. **克隆仓库**（或解压代码包）
   ```bash
   git clone <仓库地址>
   cd sup-sz
   ```

2. **启动本地服务器**（必须用 HTTP 服务器，不能直接打开 `index.html`，否则 Service Worker 和模块化 JS 无法工作）
   ```bash
   # Python 3
   python -m http.server 8080
   
   # Node.js
   npx serve -p 8080
   
   # PHP
   php -S localhost:8080
   ```

3. **打开浏览器访问** http://localhost:8080

4. **（可选）配置和风天气预警**
   - 注册 [和风天气开发者账号](https://dev.qweather.com/)
   - 获取 API Key 和专属 Host
   - 编辑 `js/config.js`，填入 `QWEATHER.key` 和 `QWEATHER.host`
   - 不填也能正常使用，只是缺少官方雷暴预警

## 📦 部署到生产

### Vercel / Netlify / GitHub Pages

```bash
# 构建（本项目无需构建步骤，直接部署静态文件）
# 部署根目录：项目根目录

# Vercel
vercel --prod

# Netlify
netlify deploy --prod --dir=.

# GitHub Pages
# 1. 推送代码到 GitHub
# 2. 仓库 Settings → Pages → Source 选 main 分支
# 3. 访问 https://<username>.github.io/<repo-name>
```

**⚠️ 安全提醒**：如果配置了和风天气 Key，部署前务必：
- 将 `js/config.js` 中的 `QWEATHER.key` 改为环境变量注入
- 或使用 Vercel/Netlify 的 Serverless Functions 做 API 代理
- 否则 Key 会暴露在前端代码中被盗刷

### 中国大陆访问优化

Vercel 默认域名（*.vercel.app）在中国大陆访问不稳定。建议：
- 绑定自定义域名（需备案）
- 或部署到中国大陆云服务商（腾讯云 COS / 阿里云 OSS 静态网站托管）

## 🎨 自定义配置

所有可调参数集中在 `js/config.js`：

### 调整安全阈值

```javascript
export const THRESHOLDS = {
  waveHeight: { greenMax: 0.5, yellowMax: 0.8 },    // 浪高 (m)
  swellPeriod: { greenMax: 8, yellowMax: 10 },      // 涌浪周期 (s)
  windSpeed: { greenMax: 12, yellowMax: 15 },       // 平均风速 (kn)
  gust: { greenMax: 10, yellowMax: 13 },            // 阵风 (kn)，比持续风严格
  offshoreWind: { greenMax: 10, yellowMax: 12 },    // 离岸风 (kn)
  offshoreAngleTolerance: 45,                       // 离岸风判定角度容差
};
```

**说明**：
- 阵风阈值比持续风速严格 2kn，因为突然阵风对桨板站立姿势威胁更大
- 离岸风是头号杀手，单独设置更严格的阈值
- 单位 `kn`（节）= 海里/小时，1kn ≈ 0.5144 m/s，UI 会自动转换显示

### 添加/修改点位

```javascript
export const SPOTS = [
  {
    id: 'example',
    name: '示例点位',
    lat: 22.xxxx,   // 纬度（必须是近岸海面坐标，陆地坐标取不到浪高）
    lon: 114.xxxx,  // 经度
    coastFacing: 180, // 海岸朝向（度，正北=0，顺时针，用于判断离岸风）
  },
  // ...
];
```

**如何确定坐标和朝向**：
1. 在 Google Maps 上找到点位，右键"这是哪里"获取经纬度
2. 确保坐标在海面上（离岸 100-500m），Open-Meteo 只对海域提供浪高数据
3. 用指南针或地图目测海岸线朝向，正北=0°，正东=90°，正南=180°，正西=270°

## 📂 项目结构

```
sup-sz/
├── index.html              # 主页面
├── css/
│   └── style.css           # 样式（移动端优先，海边强光高对比）
├── js/
│   ├── app.js              # 应用主入口（数据拉取、缓存、日期切换）
│   ├── config.js           # 配置文件（点位、阈值、API Key）
│   ├── api.js              # API 调用（Open-Meteo + 和风天气）
│   ├── logic.js            # 评估逻辑（时段拆分、多指标判级、结论生成）
│   └── ui.js               # UI 渲染（卡片、图表、交互）
├── service-worker.js       # PWA 离线支持
├── manifest.json           # PWA 配置（图标、启动模式）
└── icons/                  # PWA 图标（需自行准备 192x192 和 512x512）
```

## 🧮 评估逻辑

### 三层架构

1. **evalHour**（单小时评估）
   - 读取该小时的浪高、风速、阵风、涌浪周期、风向、降雨、雷暴
   - 每项指标独立判级（绿/黄/红），取最差等级作为该小时等级
   - 检测离岸风：实际风向与"海岸朝向 ± 180°"夹角 < 45° 即视为离岸风

2. **evalPeriod**（时段评估，上午 6-12h / 下午 12-18h）
   - 遍历时段内所有小时，收集非绿色小时的时间范围
   - 生成原因列表（如"阵风 9.1m/s（15-18点）"）
   - 提取 headline（最关键的原因，用于一句话结论）
   - 返回时段等级、原因、峰值指标、气温、降雨

3. **buildSummary**（生成一句话结论）
   - 两时段等级一致 → "🟢 全天适宜" / "🔴 全天不宜：原因"
   - 不一致 → "上午🟢适宜，下午🔴不宜(原因)"

### 多模式浪高可信度

同时请求 3 个海浪模式（ECMWF WAM、GWAM、Météo-France）：
- 三模式浪高差异 < 0.3m → 高可信 ✓
- 差异 ≥ 0.3m → 分歧大 ⚠️（仅供参考）
- 只有单模式有数据 → 单模式（无交叉验证）

## 🎯 使用建议

- **绿色适宜**：各项条件良好，新手友好
- **黄色谨慎**：部分指标接近临界值（如阵风偏大、涌浪周期偏长），建议有经验者根据自身能力判断，新手可等条件改善
- **红色不宜**：浪高过大、阵风危险、离岸风或雷暴，强烈不建议下水

**数据为数值模式预报，非实测**。出行前务必：
1. 查看图表曲线，了解趋势变化
2. 对比多个点位，选择条件最好的
3. 到现场后再次目测海况（浪高、风向、涌浪频率）
4. 查看 [深圳官方海洋预报](https://pnr.sz.gov.cn/ywzy/hyyb/index.html)
5. 结伴出行，带好救生装备

## 📜 开源协议

MIT License

## 🙏 致谢

- [Open-Meteo](https://open-meteo.com/) - 提供免费高质量的海洋和气象数据
- [和风天气](https://www.qweather.com/) - 提供中国官方预警数据
- [uPlot](https://github.com/leeoniya/uPlot) - 轻量高性能的图表库
- 深圳桨板社区的反馈与建议

---

**⚠️ 免责声明**：本应用提供的数据仅供参考，不构成专业气象建议。海上活动存在固有风险，用户应自行判断并承担一切责任。
