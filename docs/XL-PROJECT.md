# xl 站点项目（aether-cms-xl）

本仓是 **https://xl.dleu.net** 的独立项目，2026-09-15 从 `delaolao/aether-cms`（下称「引擎仓」）整仓复制而来。

## 为什么拆

- xl 面向的读者与内容形态与本机其它站点不同，**模板会持续演进**，需要一个不会被引擎仓发布节奏牵连的地方
- 引擎仓继续服务另外两台实例（`:8080` root、`:8092` xq），两边发布节奏不同
- 「学段（stage）」等属于**共用引擎能力**，继续留在引擎仓维护，本仓按需回收

## 两仓关系

| | 引擎仓 `aether-cms` | 本仓 `aether-cms-xl` |
|---|---|---|
| 服务对象 | `:8080` root、`:8092` xq | `:8091` xl |
| remote | `origin` | `origin` + **`upstream` = 引擎仓** |
| 同步脚本默认实例 | root、xq | **仅 xl** |
| 主题 | `default` / `ember` | `ember`（会定制） |

> ⚠️ **不要把本仓的代码反向推给 xq / root**，也不要用引擎仓的同步脚本推 xl —— 那会覆盖掉 xl 的模板定制。

## 拆分基线（务必知道）

- 拆仓 HEAD：`0c1d4ae`
- 拆仓前实测（归一化行尾后逐字节比对 xl 线上与本仓）：`content/themes/ember/**` 17/17 一致、`assets/**` 11/11 一致、`core/admin/static/**` 86/87 一致
- 唯一的服务器侧差异 `core/admin/static/js/table/modules/tabulator.js`（Tabulator v6 卡 Loading 的修复）**已在拆仓前回收进仓库**
- 结论：本仓起点 = xl 线上实际状态，此后两边自由演进

## 内容与敏感数据不入库

`.gitignore` 已排除：

- `content/data/` —— `users.json`（口令哈希）、`sessions.json`（登录令牌）、`settings.json`、`analytics/salt.txt`
- `.env` —— `COOKIE_SECRET`
- `content/uploads/` —— 图片与附件

**内容只存在于服务器上**，靠 `tools/backup-content.ps1` 打包拉回本机留档（异地副本需要 ssh，Web 端做不了）。新机器首次部署时先建空目录：

```bash
mkdir -p content/data content/uploads
```

## 日常操作

### 只给 xl 部署

```powershell
.\tools\sync-today-to-server.ps1        # 默认实例=仅 xl（可用 -Instances 覆盖）
```

同步后是否重启，取决于**改了什么**（2026-09-15 实测）：

| 改动类型 | 是否要重启 | 原因 |
|---|---|---|
| 模板 / partial（`content/themes/**/*.html`） | **不用** | 每次请求都重新读盘；实测改完刷新即生效 |
| 静态资源（`/assets/**`、`content/themes/**/assets/**`、`core/admin/static/**`） | **不用** | 由静态文件服务直接读盘；**但浏览器可能缓存旧版**，看不到变化时先硬刷新（Ctrl+F5） |
| 服务端 JS（`core/**`、`index.js`） | **要** | Node 的 ESM 模块缓存，进程内不会重新加载 |
| `.env` | **要** | 启动时读取 |

> 早期文档里写的"模板与静态资源有服务端内存缓存、必须重启"是**错的**，多半是把浏览器缓存误判成了服务端缓存。模板改动其实只需同步 + 刷新。

```bash
tmux send-keys -t 10 C-c; sleep 2; tmux send-keys -t 10 'npm start' Enter
```

### 改模板

改 `content/themes/ember/**` → 同步 → 重启。要新建主题就放 `content/themes/<name>/`，再到后台「主题」里切换。

### 从引擎仓回收修复

```powershell
git fetch upstream
git log --oneline upstream/main ^main     # 引擎仓有哪些本仓还没有的提交
git cherry-pick <sha>                     # 逐条回收（推荐，可控）
git merge upstream/main                   # 或整段合并（冲突可能较多）
```

回收后先在本地验证（起服务、跑关键路由），再提交并部署到 xl。

### 核对「实例 ↔ 仓库」差异（部署前 / 回滚前必做）

```bash
# 1) 服务器上（xl 实例目录内）
node tools/instance-fingerprint.mjs --root . --out /tmp/xl.fingerprint.txt

# 2) 本机
scp admin@<host>:/tmp/xl.fingerprint.txt .
node tools/instance-fingerprint.mjs --root . --out xl-repo.fingerprint.txt
node tools/instance-fingerprint.mjs --compare xl.fingerprint.txt --against xl-repo.fingerprint.txt
```

- `MISSING_IN_REPO` 非空 = **服务器上有未入库的改动**（就地手改过的文件不在任何 `git status` 里），先回收再继续
- `DIFFERS` = 两边都有但内容不同
- `MISSING_IN_INSTANCE` = 仓库比实例新，或该文件从未部署到这台

注意：本地工作副本是 CRLF、服务器是 LF，**直接比 sha256 会得到「每个文件都不同」**；该工具已做行尾归一化。

排除范围：`node_modules`、`.git`、缓存与归档目录一律跳过；`content/data`（users.json 等实例数据）与 `content/uploads`（图片附件）不参与比对；**`content/themes/**` 参与比对** —— 本仓的主题定制正是最需要被发现的差异。`.env` 与工具自己的 `*.fingerprint.txt` 也排除（前者绝不入库，后者避免自我污染）。大清单按目录折叠，加 `--verbose` 展开。

## 实例资产（不入库，但要留来源）

首次全量核对（2026-09-15）发现 xl 上除本仓跟踪的两个主题外，还有 5 个从后台主题市场安装的主题，共 176 个文件。它们是**实例资产**，按 `.gitignore` 设计不入库（含二进制字体、体积大），此处记录来源以便重建：

| 主题 | 版本 | 作者 |
|---|---|---|
| `clean_blog` | 1.0.2 | LebCit |
| `editorial` | 1.0.0 | LebCit |
| `midday` | 1.1.0 | LebCit |
| `old_writer` | 1.0.1 | LebCit |
| `pure` | 1.0.3 | LebCit |

xl 当前实际使用 `ember`（本仓跟踪）。这些第三方主题若被就地改过，需要单独决定是否入库；未改动的按「市场可重装」处理。

同样不入库的还有：`content/data/tag-aliases.json`（实例配置，建议单独备份一份）、`content/uploads/**`（媒体文件）。

## 首次核对结论（2026-09-15）

- `MISSING_IN_REPO` 177 → 拆分后为 1 个 `.env`（**不该回收**，工具已修成自动排除）+ 176 个第三方主题文件（上节）
- `DIFFERS` 3 → `content/themes/default/partials/footer.html` 真差异（线上 xl / xq 多一层无 CSS 支撑的 `footer-row` 包裹，**已回收入库**）；`screenshot.avif` 伪差异（归一化实现不一致，**工具已修**）；`.gitignore` 为服务器上的旧副本（服务器不是 git 检出，无作用）
- `MISSING_IN_INSTANCE` 11 → 仓库更新尚未部署到 xl（`docs/**`、`TAG-GOVERNANCE.md`、`tools/*.ps1` 等），属正常

## 本地预览（改模板用）

```powershell
cd D:\teacherGeng\AetherCMS\aether-cms-xl
node index.js            # 端口读 .env 里的 PORT=8096
```

浏览器打开 `http://localhost:8096`。要点：

- 运行时复用引擎仓的 `node_modules`（两边 `package.json` 相同，省一次联网安装）
- `.env`、`content/data`、`content/uploads` 都不入库；预览内容与线上无关，可只拉 `posts / pages / settings.json / menu.json`
- 预览后台账号是首次启动自动创建的 `admin / admin`（仅本地）
- **改模板不用重启**：模板/partial/静态资源每次请求都重新读盘，改完刷新即可；只有 `core/**` 与 `.env` 需要重启

### STE 模板引擎的三个坑（实测，2026-09-15）

| 坑 | 现象 | 规避 |
|---|---|---|
| **HTML 注释里的 mustache 会被执行** | 注释里写了未配对的循环指令 → **整页 500**（`Unterminated each loop`） | 注释里不要写 mustache；必须写就写完整配对 |
| **不支持下标访问** | `{{posts.0.title}}`、`{{posts.[0].title}}` → **500**（`Expect property name after '.'`） | 需要"第 N 项"必须由后端准备好数据，模板里挑不出来 |
| 模板改动无需重启 | 改完刷新即生效 | 见上；重启只针对 `core/**`、`.env` |

> 模板报错会让整页 500（不是空白降级），所以改模板后要立即请求一次确认，别等部署。

## 首页广告位：出图规格（2026-09-15 与使用方确定）

广告位图片**由管理员单独维护，与文章内容无关**，因此裁切问题由规格约定解决，而不是迁就内容。

| 项 | 规格 |
|---|---|
| 桌面图 | **1600 × 320（5:1）**，PNG/JPG/WebP，建议 ≤ 500KB |
| 手机图（可选） | **750 × 320（2.34:1）**；不传则用桌面图居中裁切 |
| 安全区 | 关键内容（文字、logo）放在**中间 60% 宽**内 —— 手机端只保留中央约 46% 宽 |
| 文字 | 每条广告独立选择「不叠加文字」（文字做在图里）或「叠加文字」（后台填标题/副标题） |
| 链接 | 可选，留空则整张图不可点 |
| 显示高度 | 桌面 205px（≈线上 hero 的 201px）/ 手机 150px；CSS 变量 `--banner-h`，Phase 2 做成后台可调 |

模板侧实现（`partials/home-banner.html`）：

- 可选手机图用 `<picture><source media="(max-width: 620px)" …>` —— 没配手机图时删掉 `<source>` 即可
- 纯图形态用 `.banner-slide.is-image-only`（隐藏 `.banner-caption`）
- 三种形态（叠加文字+手机图 / 叠加文字 / 纯图）在 Phase 1 占位数据里各有一张，便于对照

> 踩坑记录：Phase 1 最初用 `aspect-ratio: 16/7`，在 1048px 宽下高 459px，是线上 hero（201px）的
> 2.3 倍。改为**按高度控制**（`--banner-h: clamp(160px, 19vw, 205px)`）后才能既照搬线上比例、
> 又不至于在手机上缩成一条细线。

## 后台新增页面的注意点（2026-09-15 踩坑记录）

后台的 `core/admin/static/css/admin.css` 里有几条**全局规则**，会给新页面带来意外布局问题。
新增后台页面前，先用这三条对一遍自己的 CSS：

| 全局规则 | 副作用 | 应对 |
|---|---|---|
| `label { display: block; margin-bottom: .5rem; }` | 把 `<label>` 当布局容器用时，它自带 8px 下外边距；flex 行里 `align-items: flex-end` 对齐的是**margin box 底边**，会把旁边的按钮整体下推 8px（表现为"按钮与输入框没水平对齐"） | 容器 label 上 `margin-bottom: 0` |
| `input[type=…] { display: block; width: 100%; font-size: 1rem; line-height: 1.5; padding: .5rem .75rem; }` | 基础高度 42px；想做成紧凑布局必须自己钉 `height` + `box-sizing: border-box` | 输入框与相邻按钮**钉成同一个高度**（本页取 34px） |
| `button, .btn { cursor: pointer; }` | 按钮没有统一高度，与输入框混排时会高低不一 | 按钮用 `inline-flex` + 固定 `height` + `align-items: center` |

排查方法：把 `admin.css` 里所有 `label` / `input` / `button` 规则抓出来对一遍 ——
只看自己写的 CSS 是找不到这类冲突的。

另外：静态资源（`/core/admin/static/**`）的响应头是 `Cache-Control: no-cache, no-store, must-revalidate`，
改完刷新即生效，**不要**把"样式没生效"归因于浏览器缓存（我这次先误判过一次）。

## 发版部署清单（脚本不入库，但这份知识必须入库）

部署脚本 `tools/sync-today-to-server.ps1` **按设计不入库**（内含服务器地址与实例路径，见 `.gitignore`）。
代价是：脚本里的**同步清单**只存在于操作者本机 —— 换机器或重建脚本时，那份"哪些文件必须同步"的
知识就会丢。而"文件漏出清单"在本项目已经造成 **4 次**事故：

| 次数 | 文件 | 后果 |
|---|---|---|
| 1 | `core/utils/tag-cloud-utils.js` | 标签别名只在部分路由生效，看起来像"功能没生效" |
| 2 | `core/admin/static/js/table/modules/tabulator.js` | 修复只存在于服务器，仓库缺失 |
| 3 | `content/themes/default/partials/footer.html` | 服务器与仓库长期不一致 |
| 4 | 首页改版的 5 个主题文件 | **差点**：一旦后台配上广告位，`include` 找不到 partial 会 500 |

所以把规则记在这里：

1. 任何**运行时代码**（`core/**`、`content/themes/**`、`assets/**`、`tools/*.mjs`）的改动或新增，
   都必须进 `$NewFiles` 或 `$ModifiedFiles` —— **只有这两组会随普通同步部署**。
2. `$PulledFiles` **只在带 `-IncludePulled` 时**才同步。ember 主题的多数文件躺在这一组里，
   改主题模板时务必确认同一文件也在前两组，否则同步会静默漏掉。
3. 不部署的（已在 `.fingerprint-ignore` 列明）：`CHANGELOG.md`、`docs/**`、`TAG-GOVERNANCE.md`、
   `DEPLOYMENT-AI-TAGS.md`，以及本机运维脚本 `tools/*.ps1`。
4. 发版前先看清单：`.\tools\sync-today-to-server.ps1 -DryRun`；要当门禁就加 `-StrictManifest`
   （脚本用 `git log --name-only` 对比最近改动，漏文件会报出来）。
5. 同步并重启后核对：`node tools/instance-fingerprint.mjs --compare …`，目标 0/0/0。

### 首页改版（v0.17.0）需要的 21 个运行时代码文件

| 组 | 文件 |
|---|---|
| 主题 ember | `partials/home-banner.html`、`partials/category-cards.html`、`partials/header.html`、`templates/index.html`、`assets/css/style.css`、`assets/js/main.js` |
| 后台页 | `admin/views/contents/homepage.html`、`admin/static/js/homepage.js`、`admin/static/css/homepage.css`、`admin/views/layouts/index.html`、`admin/views/components/head.html`、`admin/views/components/sidebar.html`、`admin/static/js/i18n.js`、`admin/routes.js` |
| 接口与库 | `api/homepage-api.js`、`api/content-api.js`、`lib/homepage-store.js`、`utils/category-utils.js`、`lib/media/social-meta.js`、`routes/home.js`、`app.js` |

> 另：`content/data/homepage.json` 是**实例数据**（不入库），线上首次在后台点「保存」时创建；
> 已有文件时保存会先留一份 `.bak`。

## 跨仓改动的坑：复制前必须先比对（2026-09-15 实际踩到）

本仓（xl）与引擎仓的部分文件**已经分叉**（xl 有引擎仓没有的东西，例如
`GET /api/categories`、首页装修页的 i18n 键、`core/lib/homepage-store.js`、`core/lib/pinyin.js`）。

在引擎仓改好再复制过来的做法本身没错（能绕开 shell 引号破坏代码），但**复制前必须比对两仓该文件是否一致**：

```powershell
# 两仓同一文件的差异（忽略行尾）
$a = [IO.File]::ReadAllText($enginePath) -replace "`r`n","`n"
$b = [IO.File]::ReadAllText($xlPath)     -replace "`r`n","`n"
$a -eq $b
```

不一致时**不要整文件覆盖**，而应把引擎仓的改动做成"补丁"应用到 xl 仓（或反过来），
否则 xl 仓独有内容会被静默抹掉。本次因此丢过 `/api/categories` 与三个 i18n 键，
好在复核 `git status`（只应出现本次有意改动的文件）时发现了。

**每次复制后固定动作**：`git status --short` 看一眼 —— 出现意料之外的文件就是被覆盖了。

## 时间与时区：约定与踩坑（2026-09-19，v0.17.3）

### 两套约定（不要混）

| 字段 | 约定 | 例子 |
|---|---|---|
| `publishDate` | **站点墙钟时间**（作者在编辑器里填的，无时区标记） | `2026-09-18T00:30` |
| `createdAt` / `updatedAt` / 访问事件 `t` | **UTC ISO** | `2026-09-18T20:30:00.000Z` |

渲染时**不能**直接 `new Date(publishDate)`（按进程时区解释，服务器换时区就整体偏移），
也**不能**用 LiteNode 的 `{{ x | dateFormat(...) }}`（**默认 `useUTC=true`**：会把墙钟时间当 UTC
再减 8 小时，于是北京时间 00:00–07:59 发布的文章显示成前一天）。统一走 `core/utils/time-utils.js`。

### 站点时区从哪来

`SITE_TIME_ZONE` 环境变量 → `content/data/settings.json` 的 `timeZone` → 默认 `Asia/Shanghai`。
后台「设置 → 常规 → 站点时区」写的就是 `settings.json`；`configureSiteTimeZoneProvider()` 读的是
`settingsService` 的**同步缓存**，所以**改完立刻生效、不用重启**（实测：改成 UTC → 「最近访问」变 01:25，
改回 Asia/Shanghai → 09:25）。

### 前台日期统一用 `metadata.displayDate`

`prepareTemplateData()` 会给 `posts[].metadata`、`metadata`、`frontmatter` 预计算 `displayDate`
（站点时区 `YYYY-MM-DD`）。模板里只写：

```html
<span class="post-date">{{ metadata.displayDate }}</span>
```

**新增主题/模板时请沿用这个字段**，不要再引入 `dateFormat`。当前 8 个模板已改：
`default/templates/{index,collection,page-content,post-content}.html`、
`ember/templates/{index,collection,page-content,post-content}.html`。

### v0.17.3 需要部署的运行时代码文件

| 组 | 文件 |
|---|---|
| 新模块 | `core/utils/time-utils.js` |
| 核心接入 | `core/app.js`、`core/utils/route-utils.js`、`core/lib/content/utils/content-utils.js` |
| 统计与维护 | `core/lib/analytics/analytics-store.js`、`core/utils/analytics-utils.js`、`core/lib/maintenance/site-doctor.js` |
| 后台页面 | `core/admin/views/contents/settings.html`、`core/admin/static/js/i18n.js` |
| 搜索 / sitemap / 管理条 | `core/routes/search.js`、`core/utils/seo-utils.js`、`core/utils/aether-bar-utils.js` |
| 主题模板 | `content/themes/default/templates/`（4 个）、`content/themes/ember/templates/`（4 个） |

> ⚠️ `content/themes/ember/templates/index.html` 是 **xl 仓独有**（首页改版过），
> **不能**从引擎仓整文件覆盖；`core/api/content-api.js`、`admin/static/js/i18n.js` 同理（见上一节）。
> 本批已确认 `core/utils/route-utils.js`、`core/admin/views/contents/settings.html`、
> `core/admin/static/js/i18n.js` 此前**不在同步清单里**，已补进 `$ModifiedFiles`。

### 本地怎么验证「与服务器时区解耦」

```powershell
# 在 xl 仓里，故意把进程时区设成 UTC，起一个临时实例（端口 8097）
$env:TZ='UTC'; $env:PORT='8097'; node index.js
```

- `http://localhost:8097/`：`publishDate: 2026-09-18T00:30` 的文章必须显示 **2026-09-18**（不是 09-17）
- 登录后 `/aether/analytics`：「最近访问」必须显示**北京时间**（比 UTC 多 8 小时）
- `/aether/maintenance`：`generatedAt` 是北京时间且带 `"timeZone":"Asia/Shanghai"`

Windows 上 Node 认 `TZ`（实测 `TZ=UTC` → `getTimezoneOffset()=0`），**不需要**改系统时区，
所以"换时区验证"随时可做。

### 编码与换行符：两个仓并不一致（用脚本/工具改代码前必看）

实测：`core/app.js`（xl 仓）= CRLF，`core/admin/static/js/i18n.js`（xl 仓）= LF，引擎仓同文件又可能相反。
用脚本做"字面替换"时，锚点里只要带 `\n`，在 CRLF 文件上就会**全部匹配失败**（本次 3 处 `NOMATCH` 就是这么来的，
且因为没有断言，差点静默漏改）。做法：读入后先 `split("\r\n").join("\n")` 归一 → 替换 → 按原约定写回，
改完再数一遍 `\r\n` 与孤立 `\n`，确认没有混用。

**BOM**：`tools/*.ps1` 是「UTF-8 **带 BOM**」的 —— Windows PowerShell 5.1 对**无 BOM** 的 `.ps1` 按 ANSI
解码，中文串会变乱码甚至整段解析失败（本次用编辑工具改了 `sync-today-to-server.ps1` 两处，BOM 被抹掉，
实测解析出 **28 处**语法错误；补回 `EF BB BF` 后 0 错误）。这两个脚本还都**不入库**，坏了没法 `git checkout` 回来。
改完请务必确认首个字节：

```powershell
$b = [System.IO.File]::ReadAllBytes($path); $b[0..2]   # 期望 239 187 191
# 少了就补：$new = [byte[]](239,187,191) + $b
```

源码文件（`.js`/`.html`/`.md`）在库里**没有** BOM，保持现状即可。

## 首页装修：分类卡片与文章的关系（2026-09-19 实际踩到）

**分类不是独立实体**，只是文章 frontmatter 里的 `category` 字段，所以「有哪些分类」永远是从**已发布文章**
聚合出来的（`core/utils/category-utils.js` 的 `collectCategoryCounts()`）。由此带来一个容易误判的现象：

1. 装修页点过一次「保存」，**页面上所有分类**（包括还没配图的）都会被写进 `content/data/homepage.json`；
2. 读取时 `mergeCategoryCards()` 按约定保留「后台配了、但文章里已经没有」的分类（支持"筹建中"），
   标记 `missing`（界面显示「文章里已无此分类」）；
3. 于是**删掉文章也不会让那一行消失**，而分类卡片原先只有「清除配置」（只清空字段，保存又写回）。

现在的行为（v0.17.4 起）：

| 操作 | 结果 |
|---|---|
| 分类卡片行点「删除」→ 保存 | 文章里**已无**该分类 → 彻底消失 |
| 同上，但该分类**还有文章** | 卡片配置被清掉，保存后以「未配置」形态回到列表（确认框会提示还有几篇） |
| 直接点「保存」（不点删除） | **空孤儿卡片**（未上线 + 无图 + 无说明 + 文章里已无此分类）自动被丢弃 |
| 孤儿卡片但配过图/说明/已上线 | **保留**，不会被误删 |

想彻底不要某个分类，正确顺序永远是**先改文章**（删文章或改 `category`），再看装修页；反过来做无效。

手工清理线上那条（改文件、不需要重启；程序保存时也会自动留 `homepage.json.bak`）：

```bash
cd /data/te_se_zi_yuan/xl/aether-cms/content/data
cp homepage.json homepage.json.bak-manual-$(date +%F)
node -e 'const fs=require("fs");const f="homepage.json";const j=JSON.parse(fs.readFileSync(f,"utf8"));const n=j.categoryCards.length;j.categoryCards=j.categoryCards.filter(c=>c.name!=="技术");fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");console.log("已移除 "+(n-j.categoryCards.length)+" 条")'
```

⚠️ `homepage.json` 属于**实例数据**（不入库）。手工编辑时别用「记事本 / `Set-Content -Encoding UTF8`」——
它们会加 UTF-8 BOM，而 `JSON.parse` 遇到 BOM 直接抛错，整份配置会被**静默当成空配置**
（现象：装修页上广告位与分类卡片全没了）。v0.17.4 已在读取时剥掉 BOM 兜底，但仍建议用 Node 写：

```bash
node -e 'const fs=require("fs");const f="homepage.json";const j=JSON.parse(fs.readFileSync(f,"utf8"));/* 这里改 j */ fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
```

## 前端主题：契约与新增主题的流程（2026-09-19 新增 jade 时整理）

主题目录：`content/themes/<name>/`，结构固定为

```
theme.json                 标题/描述/版本/作者/tags/features/screenshot/colors（后台主题列表读它）
templates/{layout,index,collection,post-content,page-content,404}.html
partials/{head,header,main,footer,home-banner,category-cards,sidebar,related-posts,wiki-links}.html
assets/css/{style.css,katex.min.css}      ← katex.min.css 必须自带（数学公式渲染依赖它）
assets/js/main.js
screenshot.svg
```

**必须遵守的 core 契约**（不遵守就整页 500 或功能静默失效）：

| 契约 | 说明 |
|---|---|
| `partials/main.html` 的分发标志 | `homeRoute` / `fileType === "post"` / `fileType === "page"` / `taxonomyRoute` / `notFoundRoute`。列表类路由（搜索/标签云/图谱/学段/视频）靠 `resolveTemplatePath()` 回到 `layout.html` 再由这里分发，标志名**不可改名** |
| 列表页保留 `class="post-grid"` | `core/app.js` 的 `injectWorkbench()` 是按这个字符串找位置插入标签筛选工作台的；没有它，工作台会被塞到 `</main>` 前甚至丢失 |
| 广告位保留 `data-carousel` / `data-interval` / `data-autoplay` / 内联 `--banner-h` | 前者驱动轮播脚本，`--banner-h` 来自后台「首页装修」的高度设置（140–320px） |
| 13 个 `--aether-*` 变量 | `/assets/aether-extras.css`（core 自动注入）用它渲染标签工作台、媒体徽章、图谱控件、wiki 链接。新主题的 `:root` 必须全部重新赋值，否则会出现"默认蓝" |
| **注释里不能写 mustache** | STE 会解析 HTML 注释：未闭合的 `{{#if}}` 会让整页 500（`Unterminated conditional statement`）。jade 的 `partials/sidebar.html` 已踩过一次 |
| 不用索引取值 | STE 不支持 `{{posts.0.title}}`；要分条就 `{{#each}}` |

**切换主题**：后台「设置 → 主题」写入 `settings.json` 的 `activeTheme` —— 模板/样式/脚本每次请求重新读取，
**不需要重启**；只有改了 `core/**` 才要重启。

**新增主题要同步的文件**：整目录都要进 `$NewFiles`（同步脚本不认通配符）。jade 是第十五批，共 20 个文件。
另外 jade 的首页侧边栏依赖 `core/routes/home.js` 的 `buildSidebarData()`（提供 `sidebar.*`），
这段数据缺失时模板会整块跳过 —— 所以老主题（ember/default）不需要改也能继续用。

**改主题时的自查清单**（本次实测有效）：

1. 注释内 mustache 扫描 + 每个文件 `#if`/`/if`、`#each`/`/each` 配平；
2. 新主题的 class 是否都在自己的 CSS 或 `aether-extras.css` 里有样式（否则布局会"塌"得莫名其妙）；
3. 每个路由都点一遍：`/`、`/post/<slug>`、`/category/<名>`、`/stage/<学段>`、`/tag-cloud`、
   `/search?q=`、`/notes/graph`、`/videos`、`/sitemap.html`、一个不存在的路径（应 404）；