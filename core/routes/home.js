import { prepareTemplateData, processTemplateData } from "../utils/route-utils.js"
import { resolveTemplatePath, checkCustomTemplate } from "../utils/template-utils.js"
import { HomepageStore, toPublicUrl } from "../lib/homepage-store.js"
import { collectCategoryCounts, mergeCategoryCards, visibleCategoryCards } from "../utils/category-utils.js"

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
