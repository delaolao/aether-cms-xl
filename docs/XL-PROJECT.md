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

同步后**必须重启 node 进程**：模板与 `/assets`、`/core/admin/static` 有服务端内存缓存。

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
