/**
 * 首页装修配置 —— `content/data/homepage.json`
 *
 * 首页有两个「管理员单独维护、与文章内容无关」的区块：
 *   1. 广告位轮播（图片 + 可选文字，可点击跳转）
 *   2. 资源分类卡片（每个分类一张图 + 说明，数量随分类增减）
 *
 * 为什么单独一个文件而不是塞进 settings.json：它是结构化列表（有序、可增删），
 * 与 settings 的键值语义不同；也便于单独备份/回滚（保存时自动留 .bak）。
 * 与 settings.json / tag-aliases.json 一样，这个文件属于**实例数据**，不入库，
 * 由备份脚本（tools/backup-content.ps1）负责留档。
 *
 * 图片字段约定：存 `/images/xxx.png` 这种「相对 uploads 的路径」——
 * 与 theme 里的 siteLogo / siteIcon 完全一致，只是返回给前台的绝对 URL
 * 由本模块的 toPublicUrl() 统一拼 `/content/uploads`。管理员也可以直接粘贴
 * 完整 URL（http…）或已带前缀的路径，都会被识别。
 */
import { mkdir, readFile, writeFile, copyFile, rename } from "node:fs/promises"
import { join } from "node:path"

export const HOMEPAGE_FILE = "homepage.json"

// 广告位高度默认 205px：与线上 hero 横幅（1048x201px，≈5.2:1）对齐
export const DEFAULT_BANNER_HEIGHT = 205
export const BANNER_HEIGHT_MIN = 140
export const BANNER_HEIGHT_MAX = 320
export const DEFAULT_INTERVAL_MS = 5000
export const INTERVAL_MIN_MS = 2000
export const INTERVAL_MAX_MS = 30000

export const UPLOAD_URL_PREFIX = "/content/uploads"

/** 空配置：没有任何广告位与分类卡片时，首页会退回「品牌横幅 + 最新发布」。 */
export function defaultHomepage() {
    return {
        $comment: "首页装修：广告位轮播 + 资源分类卡片。改完保存即生效（前台首页直接读取）。图片建议 1600x320（5:1）。",
        updatedAt: "",
        settings: {
            autoplay: true,
            intervalMs: DEFAULT_INTERVAL_MS,
            bannerHeightPx: DEFAULT_BANNER_HEIGHT,
        },
        banners: [],
        categoryCards: [],
    }
}

function str(value, max = 600) {
    return String(value === undefined || value === null ? "" : value).trim().slice(0, max)
}

function bool(value, fallback) {
    if (typeof value === "boolean") return value
    if (value === undefined || value === null || value === "") return fallback
    return /^(1|true|yes|on)$/i.test(String(value))
}

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
}

let idSeed = 0
function nextId(prefix) {
    idSeed += 1
    return `${prefix}${Date.now().toString(36)}${idSeed.toString(36)}`
}

/**
 * 图片路径 → 前台可用的 URL。
 *   `/images/a.png`                → `/content/uploads/images/a.png`
 *   `images/a.png`                 → `/content/uploads/images/a.png`
 *   `/content/uploads/images/a.png`→ 原样
 *   `https://…`                    → 原样
 */
export function toPublicUrl(value) {
    const raw = str(value, 1000)
    if (!raw) return ""
    if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) return raw
    if (raw.startsWith(UPLOAD_URL_PREFIX)) return raw
    return `${UPLOAD_URL_PREFIX}${raw.startsWith("/") ? "" : "/"}${raw}`
}

/**
 * 把任意来源的数据规范化成可信结构（后台可能传来字符串、缺失字段、超范围数字）。
 * 保留数组顺序 —— 顺序就是前台的显示顺序。
 */
export function normalizeHomepage(raw) {
    const base = defaultHomepage()
    const source = raw && typeof raw === "object" ? raw : {}
    const settings = source.settings && typeof source.settings === "object" ? source.settings : {}

    const banners = (Array.isArray(source.banners) ? source.banners : [])
        .map((item) => {
            if (!item || typeof item !== "object") return null
            const image = str(item.image, 1000)
            const mobileImage = str(item.mobileImage, 1000)
            return {
                id: str(item.id, 64) || nextId("b"),
                image,
                mobileImage,
                title: str(item.title, 200),
                subtitle: str(item.subtitle, 300),
                url: str(item.url, 500),
                // 文字是否叠加在图上：关掉 = 文字做在图里（纯图广告）
                showText: bool(item.showText, true),
                enabled: bool(item.enabled, true),
            }
        })
        // 没图的广告位没有意义，直接丢弃（后台会有提示）
        .filter((item) => item && item.image)

    const categoryCards = (Array.isArray(source.categoryCards) ? source.categoryCards : [])
        .map((item) => {
            if (!item || typeof item !== "object") return null
            const name = str(item.name, 80)
            if (!name) return null
            return {
                name,
                image: str(item.image, 1000),
                mobileImage: str(item.mobileImage, 1000),
                description: str(item.description, 300),
                enabled: bool(item.enabled, false),
            }
        })
        .filter(Boolean)

    return {
        ...base,
        updatedAt: str(source.updatedAt, 40),
        settings: {
            autoplay: bool(settings.autoplay, base.settings.autoplay),
            intervalMs: clampInt(settings.intervalMs, INTERVAL_MIN_MS, INTERVAL_MAX_MS, DEFAULT_INTERVAL_MS),
            bannerHeightPx: clampInt(settings.bannerHeightPx, BANNER_HEIGHT_MIN, BANNER_HEIGHT_MAX, DEFAULT_BANNER_HEIGHT),
        },
        banners,
        categoryCards,
    }
}

export class HomepageStore {
    /** @param {string} dataDir - 实例的数据目录（content/data） */
    constructor(dataDir) {
        this.dataDir = dataDir
        this.filePath = join(dataDir, HOMEPAGE_FILE)
    }

    /** 读取配置；文件不存在时返回默认值（不写盘，等管理员保存时才创建）。 */
    async load() {
        try {
            const text = await readFile(this.filePath, "utf8")
            // 手工编辑过的文件可能带 UTF-8 BOM（记事本 / PowerShell Set-Content 就会加），
            // 而 JSON.parse 遇到 BOM 会直接抛错 —— 那会导致**整份配置被静默当成空配置**。
            // 这里先剥掉，实测踩到过（本机造测试数据时用 Set-Content -Encoding UTF8 正中此坑）。
            return normalizeHomepage(JSON.parse(text.replace(/^\uFEFF/, "")))
        } catch (error) {
            if (error.code !== "ENOENT") {
                console.error(`[homepage] 读取失败（将使用默认值）: ${error.message}`)
            }
            return defaultHomepage()
        }
    }

    /** 保存配置：先备份旧文件，再原子写入（tmp + rename）。 */
    async save(data) {
        const normalized = normalizeHomepage(data)
        normalized.updatedAt = new Date().toISOString()
        await mkdir(this.dataDir, { recursive: true })

        let backup = ""
        try {
            await copyFile(this.filePath, `${this.filePath}.bak`)
            backup = `${this.filePath}.bak`
        } catch {
            // 首次保存没有旧文件，正常
        }

        const tmp = `${this.filePath}.tmp-${process.pid}`
        await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
        await rename(tmp, this.filePath)

        return { data: normalized, backup }
    }
}
