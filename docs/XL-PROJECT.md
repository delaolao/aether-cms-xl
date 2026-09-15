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