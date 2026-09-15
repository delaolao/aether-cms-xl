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
    app.put("/api/homepage", authenticate, async (req, res) => {
        try {
            const body = req.body && typeof req.body === "object" ? req.body : {}
            const normalized = normalizeHomepage({
                settings: body.settings,
                banners: body.banners,
                categoryCards: (Array.isArray(body.categoryCards) ? body.categoryCards : []).map((card) => ({
                    name: card?.name,
                    image: card?.image,
                    mobileImage: card?.mobileImage,
                    description: card?.description,
                    enabled: card?.enabled,
                })),
            })

            const saved = await store.save(normalized)
            const counts = await collectCategoryCounts(contentManager)

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
