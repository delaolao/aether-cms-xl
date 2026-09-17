import { slugify } from "./validation-utils.js"

/** 汉字区间（含扩展 A 与兼容区）——只有含汉字的标题才需要问服务端要拼音 */
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
/** 标题停止输入多久后去生成（毫秒） */
const DEBOUNCE_MS = 350

/**
 * SlugManager —— 别名的自动生成与维护
 *
 * 规则（关键，避免把已有文章的链接改掉）：
 *   - 只有「别名为空」或「当前别名是本管理器自己写进去的」时才自动填充；
 *     用户手改过的别名、或已存在文章的别名，永不自动覆盖。
 *   - 标题含汉字 → 问服务端（拼音库在服务端 vendor，见 core/lib/pinyin.js）；
 *     纯英文/数字标题 → 本地 slugify 即可，省一次请求。
 *   - 防抖 350ms；用请求序号防「旧响应覆盖新输入」。
 */
export class SlugManager {
    constructor({ titleInput, slugInput }) {
        this.titleInput = titleInput
        this.slugInput = slugInput

        /** 缓存：标题 → 别名 */
        this.cache = new Map()
        /** 本管理器写进去过的别名（用来判断「这个值是不是我生成的」） */
        this.generated = new Set()
        /** 请求序号：只有最后一次请求的结果允许进缓存，避免乱序覆盖 */
        this.requestSeq = 0
        this.timer = null

        // Store initial title value for comparison
        if (this.titleInput) {
            this.titleInput.dataset.previousTitle = this.titleInput.value
        }
    }

    /** 标题里是否含汉字 */
    hasHan(text) {
        return HAN_RE.test(String(text || ""))
    }

    /**
     * 本地同步生成（纯 ASCII 标题用；中文标题会得到空串或中文字符，不理想）
     * @param {string} title
     * @returns {string}
     */
    generateSlug(title) {
        return slugify(title)
    }

    /**
     * 生成别名：含汉字时走服务端拼音接口（结果进缓存）。
     * @param {string} title
     * @returns {Promise<string>}
     */
    async generateSlugAsync(title) {
        const text = String(title || "").trim()
        if (!text) return ""
        if (!this.hasHan(text)) return this.generateSlug(text)
        if (this.cache.has(text)) return this.cache.get(text)

        const seq = ++this.requestSeq
        try {
            const res = await fetch(`/api/slug?text=${encodeURIComponent(text)}`, { credentials: "same-origin" })
            if (!res.ok) return ""
            const json = await res.json()
            const slug = json && json.slug ? String(json.slug) : ""
            if (seq === this.requestSeq) this.cache.set(text, slug)
            return slug
        } catch {
            return ""
        }
    }

    /** 当前别名是否「归本管理器所有」（空值或由我们生成）—— 只有这种才允许自动改写 */
    isSlugOurs(value) {
        const current = String(value || "").trim()
        return !current || this.generated.has(current)
    }

    /** 写入别名并记录 */
    applySlug(value) {
        if (!this.slugInput || !value) return
        this.slugInput.value = value
        this.generated.add(value)
    }

    /**
     * 标题变化时更新别名（防抖 + 异步拼音）。
     * 同步部分只更新头部标题与文档标题，避免阻塞输入。
     */
    updateSlug() {
        if (!this.titleInput || !this.slugInput) return

        const title = this.titleInput.value
        const currentSlug = this.slugInput.value
        const mayAutoFill = this.isSlugOurs(currentSlug)

        clearTimeout(this.timer)
        if (mayAutoFill && title.trim()) {
            this.timer = setTimeout(async () => {
                // 防抖期间用户可能手改了别名，这里再确认一次
                if (!this.isSlugOurs(this.slugInput.value)) return
                const generated = await this.generateSlugAsync(this.titleInput.value)
                if (!generated) return
                if (!this.isSlugOurs(this.slugInput.value)) return
                this.applySlug(generated)
            }, DEBOUNCE_MS)
        }

        // 更新编辑器头部标题与文档标题（保持原有行为）
        const editorHeading = document.querySelector(".editor-header > h1")
        if (editorHeading) {
            const editorHeadingParts = editorHeading.textContent.split(":")
            const editorHeadingStart = editorHeadingParts[0]

            editorHeading.textContent = `${editorHeadingStart}: ${title}`

            const pageType = editorHeadingStart.includes("Post") ? "Post" : "Page"
            document.title = `Edit ${pageType}: ${title} | Aether`
        }

        // Store current title for future comparison
        this.titleInput.dataset.previousTitle = title
    }

    /**
     * 供保存流程同步读取当前别名。
     * 若为空：命中缓存就用缓存（防抖通常已填好），否则退回本地 slugify ——
     * 保证不会因为「拼音还在路上」而提交空别名。
     * @returns {string}
     */
    getCurrentSlug() {
        if (!this.slugInput || !this.titleInput) return ""

        const title = this.titleInput.value.trim()
        let slug = this.slugInput.value.trim()

        if (!slug) {
            slug = this.cache.get(title) || this.generateSlug(title)
            if (slug) this.applySlug(slug)
        }

        return slug
    }
}
