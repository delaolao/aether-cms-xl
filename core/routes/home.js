import { prepareTemplateData, processTemplateData } from "../utils/route-utils.js"
import { resolveTemplatePath, checkCustomTemplate } from "../utils/template-utils.js"
import { HomepageStore, toPublicUrl } from "../lib/homepage-store.js"
import { collectCategoryCounts, mergeCategoryCards, visibleCategoryCards } from "../utils/category-utils.js"
import { getTagFrequency } from "../utils/tag-cloud-utils.js"
import { countStages } from "../utils/taxonomy-filter-utils.js"
import { getContentDisplayDate } from "../lib/content/utils/content-utils.js"
import { contentInstant } from "../utils/time-utils.js"

export function setupHomeRoutes(app, systems) {
    const { themeManager, contentManager, hookSystem, analyticsStore, paths } = systems

    // 首页装修配置（广告位 + 分类卡片）：实例数据，管理员在后台维护
    const homepageStore = new HomepageStore(paths?.dataDir || "content/data")

    /**
     * 组装首页需要的装修数据：只保留启用的广告位、只保留已上线的分类卡片，
     * 并把图片路径统一转成可供前台使用的 URL。
     */
    async function buildHomepageData() {
        const config = await homepageStore.load()
        const counts = await collectCategoryCounts(contentManager)

        const banners = config.banners
            .filter((banner) => banner.enabled && banner.image)
            .map((banner) => ({
                ...banner,
                image: toPublicUrl(banner.image),
                mobileImage: toPublicUrl(banner.mobileImage),
            }))

        const cards = visibleCategoryCards(mergeCategoryCards(config.categoryCards, counts)).map((card) => ({
            ...card,
            image: toPublicUrl(card.image),
            mobileImage: toPublicUrl(card.mobileImage),
        }))

        return {
            settings: config.settings,
            banners,
            hasMultipleBanners: banners.length > 1,
            categoryCards: cards,
        }
    }

    /**
     * 杂志式主题（jade）右侧边栏的数据。只有首页需要，所以一次算好传给模板；
     * 没接这段数据的主题会忽略它（模板里用 {{#if sidebar}} 兜底，不会报错）。
     *
     *   categories 分类 + 篇数（与首页装修、分类页同一套聚合口径）
     *   tags       热门标签（别名已归一，链接用 slug）
     *   stages     学段分布（按教育阶段顺序）
     *   ranking    阅读排行；没有任何阅读数据时退回「最新发布」，避免出现一排 0
     */
    async function buildSidebarData({ tagLimit = 14, stageLimit = 8, rankLimit = 5 } = {}) {
        const counts = await collectCategoryCounts(contentManager)
        const categories = counts.slice(0, 10)
        const tags = (await getTagFrequency(contentManager)).slice(0, tagLimit)

        let allPosts = []
        try {
            allPosts = await contentManager.getPosts({ status: "published", frontmatterOnly: true })
        } catch (error) {
            console.error("首页侧边栏：读取文章失败:", error.message)
        }

        const stages = countStages(allPosts).slice(0, stageLimit)
        const withViews = allPosts.map((post) => {
            const fm = post.frontmatter || {}
            const views = analyticsStore
                ? analyticsStore.viewCountFor({ id: fm.id, slug: fm.slug, path: `/notes/${fm.slug}` }) || 0
                : 0
            return {
                title: fm.title || "未命名",
                slug: fm.slug || "",
                views,
                instant: contentInstant(fm),
                date: getContentDisplayDate(fm),
            }
        })

        const hasViews = withViews.some((item) => item.views > 0)
        const sorted = withViews
            .slice()
            .sort((a, b) => (hasViews ? b.views - a.views || b.instant - a.instant : b.instant - a.instant))

        return {
            categories,
            tags,
            stages,
            ranking: {
                title: hasViews ? "阅读排行" : "最新发布",
                items: sorted.slice(0, rankLimit).map((item) => ({
                    title: item.title,
                    slug: item.slug,
                    views: hasViews ? item.views : 0,
                    date: item.date,
                })),
            },
        }
    }

    // Handle the homepage route
    app.get("/", async (req, res) => {
        try {
            // Get site settings
            const siteSettings = await contentManager.getSiteSettings()

            // Get published posts for the homepage
            const postsPerPage = siteSettings.postsPerPage || 10
            const allPosts = await contentManager.getPosts({
                status: "published",
                limit: postsPerPage,
                summaryView: true, // Default previewLength: a maximum of 300 characters.
            })

            const posts = contentManager.renameKey(allPosts, "frontmatter", "metadata")

            // Attach view counts to the post cards (analytics module)
            if (analyticsStore) {
                for (const post of posts) {
                    post.metadata.viewCount = analyticsStore.viewCountFor({
                        id: post.metadata.id,
                        slug: post.metadata.slug,
                        path: `/notes/${post.metadata.slug}`,
                    })
                }
            }

            // Prepare template data
            const templateData = await prepareTemplateData(req, themeManager, siteSettings, {
                posts,
                homeRoute: true,
                // 首页装修：广告位 + 资源分类卡片（管理员在后台维护，与文章内容无关）
                homepage: await buildHomepageData(),
                // 杂志式主题（jade）的右侧边栏：分类 / 热门标签 / 学段 / 阅读排行
                sidebar: await buildSidebarData(),
                year: new Date().getFullYear(),
            })

            // Process data through hooks
            const processedData = processTemplateData(hookSystem, templateData, "layout.html")

            // Resolve the template path with enhanced parameters
            const templatePath = await resolveTemplatePath({
                themeManager,
                contentType: "home",
                slug: "homepage", // Use "homepage" as the slug for home page
                isCustomPage: true,
            })

            // Check if the resolved template path is in a theme custom folder and extracts its slug
            const { isCustomTemplate, templateSlug } = checkCustomTemplate(templatePath)

            if (isCustomTemplate) {
                // Try to find the custom page to get its metadata
                const contentPage = await contentManager.getContentByProperty("page", "slug", templateSlug)

                if (contentPage && contentPage.frontmatter) {
                    // Attach its frontmatter to processedData as metadata
                    processedData.metadata = contentPage.frontmatter

                    // Attach contentPage's content to processedData for optional use
                    processedData.content = contentPage.content
                }
            }

            res.render(templatePath, processedData)
        } catch (err) {
            console.error("Homepage render error:", err)
            res.status(500).html("<h1>500 - Server Error</h1><p>Error rendering homepage</p>")
        }
    })
}
