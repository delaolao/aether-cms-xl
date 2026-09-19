/**
 * 首页装修接口（后台，需登录）
 *
 *   GET /api/homepage    读取配置（广告位 + 分类卡片 + 设置）
 *   PUT /api/homepage    整体保存（后台页提交的就是整份配置）
 *
 * 分类清单不在这里：分类是从文章聚合出来的，见 `GET /api/categories`（core/api/content-api.js）。
 * 后台页会同时调这两个接口，把「配置的卡片」与「实际存在的分类」合并展示。
 *
 * 保存时会自动把旧文件备份为 `homepage.json.bak`（与菜单/别名文件的处理方式一致），
 * 所以误操作可以直接用备份覆盖回去。
 */
import { HomepageStore, normalizeHomepage, toPublicUrl } from "../lib/homepage-store.js"
import { collectCategoryCounts, mergeCategoryCards } from "../utils/category-utils.js"

/**
 * 卡片是否带有人工配置（图片 / 说明 / 已勾选上线）。
 *
 * 用来区分两种「文章里已经没有的分类」：
 *   - 有人工配置 → 保留（可能正在筹建，配好图再发文章）
 *   - 空孤儿卡片 → 保存时丢弃，否则它在装修页上永远删不掉（真实踩到过：删了测试文章，
 *     后台仍一直显示那个分类，因为分类卡片是文章聚合出来的、界面又只能「清除配置」）
 */
function cardHasConfig(card) {
    const image = String(card?.image || "").trim()
    const mobileImage = String(card?.mobileImage || "").trim()
    const description = String(card?.description || "").trim()
    const enabled = card?.enabled === true || /^(1|true|yes|on)$/i.test(String(card?.enabled ?? ""))
    return Boolean(image || mobileImage || description || enabled)
}

export function setupHomepageApi(app, systems) {
    const { authenticate, contentManager, paths } = systems
    const dataDir = paths?.dataDir || "content/data"
    const store = new HomepageStore(dataDir)

    // 读取配置：顺带把「图片路径 → 可用 URL」和分类篇数算好，
    // 后台页因此不必自己拼路径，也不会与服务端约定脱节。
    app.get("/api/homepage", authenticate, async (req, res) => {
        try {
            const config = await store.load()
            const counts = await collectCategoryCounts(contentManager)
            const cards = mergeCategoryCards(config.categoryCards, counts)

            res.json({
                success: true,
                data: {
                    ...config,
                    banners: config.banners.map((banner) => ({
                        ...banner,
                        imageUrl: toPublicUrl(banner.image),
                        mobileImageUrl: toPublicUrl(banner.mobileImage),
                    })),
                    categoryCards: cards,
                },
                categories: counts,
                file: store.filePath,
            })
        } catch (error) {
            console.error("Homepage config read error:", error)
            res.status(500).json({ success: false, error: error.message })
        }
    })

    // 整体保存：后台页提交的 categoryCards 只包含「需要落盘的字段」，
    // 这里过一遍 normalizeHomepage，服务端始终是可信数据的最后一关。
    // 另外顺手清理「空孤儿卡片」（文章里已无此分类 + 未上线 + 无图 + 无说明）。
    app.put("/api/homepage", authenticate, async (req, res) => {
        try {
            const body = req.body && typeof req.body === "object" ? req.body : {}

            // 分类篇数要在保存前算，用来判断哪些卡片是孤儿
            const counts = await collectCategoryCounts(contentManager)
            const liveCategories = new Set(counts.map((item) => item.name.toLowerCase()))
            const cards = (Array.isArray(body.categoryCards) ? body.categoryCards : []).filter((card) => {
                const name = String(card?.name || "").trim()
                if (!name) return false
                if (liveCategories.has(name.toLowerCase())) return true
                return cardHasConfig(card)
            })

            const normalized = normalizeHomepage({
                settings: body.settings,
                banners: body.banners,
                categoryCards: cards.map((card) => ({
                    name: card?.name,
                    image: card?.image,
                    mobileImage: card?.mobileImage,
                    description: card?.description,
                    enabled: card?.enabled,
                })),
            })

            const saved = await store.save(normalized)

            res.json({
                success: true,
                data: {
                    ...saved.data,
                    categoryCards: mergeCategoryCards(saved.data.categoryCards, counts),
                },
                backup: saved.backup,
            })
        } catch (error) {
            console.error("Homepage config save error:", error)
            res.status(500).json({ success: false, error: error.message })
        }
    })
}
