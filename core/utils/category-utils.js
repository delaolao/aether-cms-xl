/**
 * 分类聚合 —— 首页「资源分类」卡片与后台分类清单都靠它。
 *
 * 为什么需要：分类不是独立实体，只是文章 frontmatter 里的一个字段
 * （`category: 心理微课`）。所以「有哪些分类、各多少篇」只能从文章聚合出来。
 * 之前没有这个能力（`/api/categories` 是 404），首页分类卡片与后台配图都无从下手。
 */
import { postCategoryOf } from "./taxonomy-filter-utils.js"

/**
 * 聚合已发布文章的分类分布。
 * 排序：篇数倒序 → 名称（与标签云/学段的口径一致，便于人工核对）。
 *
 * @param {Object} contentManager
 * @param {{status?: string, includeEmpty?: boolean}} [options]
 * @returns {Promise<Array<{name: string, count: number}>>}
 */
export async function collectCategoryCounts(contentManager, options = {}) {
    const status = options.status || "published"
    const posts = await contentManager.getPosts({ status, frontmatterOnly: true }).catch(() => [])

    const map = new Map()
    for (const post of posts) {
        const name = postCategoryOf(post)
        if (!name) continue
        const key = name.toLowerCase()
        const entry = map.get(key) || { name, count: 0 }
        entry.count += 1
        map.set(key, entry)
    }

    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hans-CN"))
}

/**
 * 把「后台配置的分类卡片」与「文章里实际存在的分类」合并成前台/后台都能用的清单。
 *
 * 规则（2026-09-15 与使用方确定）：
 *   - 顺序 = 后台数组顺序（就是前台显示顺序）
 *   - 文章里有、后台还没配的分类：追加到末尾，enabled=false（**默认不上首页**）
 *   - 后台配了、但文章里已经没有的分类：仍保留（可能正在筹建），count=0 并标记 missing。
 *     例外：「空孤儿卡片」（未上线 + 无图 + 无说明）会在**保存时**被丢弃
 *     —— 否则删掉文章后，这一行在装修页上永远删不掉（界面只有「清除配置」，保存又会写回）。
 *     实测踩过：测试分类「技术」的文章删掉后，装修页仍一直显示它。见 api/homepage-api.js
 *
 * @param {Array<{name: string, image?: string, description?: string, enabled?: boolean}>} configured
 * @param {Array<{name: string, count: number}>} counts
 * @returns {Array<{name: string, image: string, description: string, enabled: boolean, count: number, configured: boolean, missing: boolean}>}
 */
export function mergeCategoryCards(configured = [], counts = []) {
    const countOf = new Map(counts.map((item) => [item.name.toLowerCase(), item.count]))
    const seen = new Set()
    const result = []

    for (const card of Array.isArray(configured) ? configured : []) {
        const name = String(card?.name || "").trim()
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const count = countOf.get(key)
        result.push({
            name,
            image: String(card?.image || ""),
            mobileImage: String(card?.mobileImage || ""),
            description: String(card?.description || ""),
            enabled: card?.enabled === true,
            count: count || 0,
            configured: true,
            missing: count === undefined,
        })
    }

    for (const item of counts) {
        const key = item.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push({
            name: item.name,
            image: "",
            mobileImage: "",
            description: "",
            enabled: false, // 新分类默认不上首页，配好图再勾选上线
            count: item.count,
            configured: false,
            missing: false,
        })
    }

    return result
}

/** 前台只渲染「已上线」的卡片；没有图的卡片用纯文字形态兜底。 */
export function visibleCategoryCards(cards = []) {
    return cards
        .filter((card) => card && card.enabled)
        .map((card) => ({ ...card }))
}
