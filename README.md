# 跑路了吗？（机场跑路预警与状态追踪看板）

基于 GitHub 开源社区 [limbopro/Paolujichang](https://github.com/limbopro/Paolujichang) 数据的实时跑路预警看板。采用 **Astro 5 纯静态生成 (SSG) + Pagefind 中文全文检索** 架构，零运行时 API 依赖，秒级全量检索，可无缝免费部署于 **Cloudflare Pages**。

---

## 🌟 核心特性

- ⚡ **零额外前端依赖的 Astro 纯静态架构**：全站预构建静态 HTML，极低资源开销与毫秒级加载。
- 🔍 **Pagefind 中文全文检索**：专为静态站设计的客户端全文索引，支持机场名称、官网域名、故障特征及社区评论全文精准直达。
- 📄 **单条预警详情页 (`/issue/[id]/`)**：每条预警独立静态页面，支持外链直达、社交群聊精准分享，并配备结构化检索标签。
- 📊 **动态 KPI 态势大盘**：当前预警、近 7 天活跃反馈、累计收录线索与同步时间一目了然。
- 🎛️ **多维实时过滤与排序**：支持预警/观察中/已恢复/历史归档风险等级筛选，近 7/30 天时间范围过滤，最新动态/讨论热度/发布时间排序。
- 🌙 **深色看板美学**：全站现代暗色设计，自带不同风险等级的呼吸徽章与视觉警示。
- ☁️ **Cloudflare Pages 边缘缓存优化**：预置 `_headers`，静态构建与 Pagefind 索引自动增量更新。

---

## 📁 项目目录结构

```text
paolu-dashboard/
├── package.json
├── astro.config.mjs             # Astro 静态输出配置
├── public/
│   └── _headers                 # Cloudflare Pages 边缘缓存与安全策略
├── scripts/
│   └── sync.mjs                 # GitHub Issues 数据抓取与预处理脚本
└── src/
    ├── data/
    │   └── issues.json          # 预警与反馈结构化数据集
    ├── layouts/
    │   └── Layout.astro         # 公共导航、深色主题与免责声明页脚
    └── pages/
        ├── index.astro          # 看板主页（KPI + Pagefind 检索 + 预警卡片流）
        └── issue/
            └── [id].astro       # 独立预警详情页（供全文检索精准命中与分享）
```

---

## 🚀 本地开发与快速上手

### 1. 安装依赖

```bash
npm install
```

### 2. 同步社区最新数据

```bash
# 可选：配置 GITHUB_TOKEN 以获得更高 API 配额（未配置时默认使用匿名模式）
GITHUB_TOKEN=your_pat_token npm run sync
```

### 3. 构建静态站点与全文索引

```bash
npm run build
```

该命令将先后执行：
1. `astro build`：静态编译生成首页与所有预警详情页至 `dist/`
2. `pagefind --site dist`：对全站详情页生成中文索引与前端检索资源

### 4. 本地静态预览

```bash
npm run preview
```

访问终端输出的地址（通常为 `http://localhost:4321`）即可体验 Pagefind 搜索与全部交互功能。

---

## 🌐 Cloudflare Pages 部署流程

### 方案 A：直接关联 GitHub 仓库（最推荐）

1. 将本项目推送到你的 GitHub 仓库（Public 或 Private 均可）。
2. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Workers 和 Pages** → **创建** → **Pages** → **连接到 Git**。
3. 选择你的项目仓库，构建参数配置如下：

| 配置项 | 填写值 | 说明 |
| :--- | :--- | :--- |
| **Framework preset** | `Astro` | 自动识别静态框架 |
| **Build command** | `npm run build` | 构建 Astro 静态站并生成 Pagefind 索引 |
| **Build output directory** | `dist` | 最终部署产物目录 |

4. **环境变量（Environment variables）**（可选但推荐）：
   - `NODE_VERSION` = `20`
   - `GITHUB_TOKEN` = 你的个人访问令牌（PAT），用于规避构建期 API 速率限制。

### 方案 B：GitHub Actions 自动每日同步与部署

仓库已包含 `.github/workflows/daily-refresh.yml` 工作流：
- **定时任务**：每日 02:00 UTC（北京时间 10:00）自动拉取原仓库最新 Issue。
- **自动提交**：若发现新数据，自动向仓库 `main` 分支提交 `src/data/issues.json`，触发 Cloudflare Pages 增量构建。
- 若需要直接通过 GitHub Actions 发布到 Pages，请在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：
  - `CLOUDFLARE_API_TOKEN`：具备 Pages 部署权限的 Cloudflare API Token
  - `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare 账户 ID

---

## ⚖️ 免责声明

本看板展示的数据均自动抓取自开源社区仓库 [limbopro/Paolujichang](https://github.com/limbopro/Paolujichang)，仅作网络服务可用性信息聚合展示与风险提示，不构成任何商业评价、定性结论或消费建议。各节点运营方如需申诉、更正状态或补充恢复说明，请直接前往原 GitHub Issue 留言沟通。
