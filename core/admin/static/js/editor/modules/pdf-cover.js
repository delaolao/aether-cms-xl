/**
 * PDF 封面生成（后台编辑器）
 * =====================================================================
 * 需求（2026-09-19 使用方）：资源建设者上传的多是**文字稿 PDF**，读者在列表卡片上
 * 只看到标题、点进文章只有一个下载链接，既不友好、卡片也很单调。
 *
 * 做法：在编辑器里一键把正文中**第一个 PDF 附件的第一页**渲染成封面图：
 *   1. 从正文里找出 `[file:documents/xxx.pdf|显示名]` 指令（与 core/lib/media/
 *      attachments.js 完全一致的口径：跳过代码块与行内代码）；
 *   2. 取回 PDF 字节（`fetch` → ArrayBuffer，然后用 `{ data }` 交给 pdf.js —— 这样
 *      **不依赖服务端 Range 支持**，LiteNode 的静态服务没有 206，用 URL 方式会退化成整份下载）；
 *   3. pdf.js 在**当前浏览器**里渲染第 1 页到 canvas（先铺白底，否则 JPEG 会是黑底）→ JPEG；
 *   4. 走现成的 `POST /api/media/upload` 存进内容目录的 images/；
 *   5. 写进编辑器已有的「特色图片」字段（featuredImage），于是**卡片与文章页都能用它**，
 *      并顺带把页数/文件大小记在同一个对象上（扁平键，模板一层取值即可）：
 *        featuredImage = { id, url, alt, source:"pdf", pdfFile, pdfPages, pdfSize }
 *
 * 为什么放在浏览器里做：服务端零成本（不装 poppler、不起子进程、不做缓存清理），
 * 而上传资料的普通管理者自己就能生成；前台访客完全不加载 pdf.js。
 *
 * 依赖：`core/admin/static/vendors/pdfjs/{pdf.min.mjs,pdf.worker.min.mjs}`
 * （用 `tools/fetch-pdfjs.ps1` 取件；缺失时本模块只提示、不报错，编辑照常可用）。
 */

import { uiMediaManager } from "../media-selector/modules/media-ui-manager.js"

/** pdf.js 的存放位置（跟着后台静态资源一起同步） */
const PDFJS_ROOT = "/core/admin/static/vendors/pdfjs"
/** 封面渲染宽度（像素）：卡片最大显示约 340px，1000px 兼顾清晰度与体积 */
const COVER_WIDTH = 1000
/** 超过这个大小先问一句，避免在弱网/手机上卡住 */
const BIG_FILE_BYTES = 30 * 1024 * 1024

/** Translate an admin string when the i18n layer is available, else fall back. */
function tr(key, params, fallback) {
    if (typeof window.__ === "function") {
        const value = window.__(key, params)
        if (value && value !== key) return value
    }
    if (!fallback) return key
    return String(fallback).replace(/\{(\w+)\}/g, (match, name) =>
        params && params[name] !== undefined ? String(params[name]) : match
    )
}

/** 1 234 567 → "1.2 MB"（与 core/lib/media/attachments.js 的显示口径一致） */
function formatBytes(bytes) {
    const value = Number(bytes)
    if (!Number.isFinite(value) || value <= 0) return ""
    const units = ["B", "KB", "MB", "GB"]
    let size = value
    let unit = 0
    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024
        unit++
    }
    const rounded = size >= 100 || unit === 0 ? Math.round(size) : Math.round(size * 10) / 10
    return `${rounded} ${units[unit]}`
}

/**
 * 正文里第一个 PDF 附件指令。
 * 复用 core/lib/media/attachments.js 的解析口径：先剥掉代码块与行内代码，
 * 再匹配 `[file:路径|名称]`。
 *
 * @param {string} markdown
 * @returns {{path: string, name: string, external: boolean}|null}
 */
export function findFirstPdfAttachment(markdown) {
    if (!markdown || typeof markdown !== "string") return null
    const prose = markdown
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/~~~[\s\S]*?~~~/g, " ")
        .replace(/`[^`\n]*`/g, " ")

    const re = /\[file:([^\]|]+)(?:\|([^\]]*))?\]/g
    let match
    while ((match = re.exec(prose)) !== null) {
        const path = match[1].trim()
        if (!path) continue
        const clean = path.split(/[?#]/)[0]
        if (!/\.pdf$/i.test(clean)) continue
        return {
            path,
            name: (match[2] || "").trim() || clean.split("/").pop() || clean,
            external: /^https?:\/\//i.test(path),
        }
    }
    return null
}

/** 附件路径 → 前台 URL（相对 uploads，形如 documents/x.pdf） */
function attachmentUrl(path) {
    if (/^https?:\/\//i.test(path)) return path
    return `/content/uploads/${String(path).replace(/^[/\\]+/, "")}`
}

/** 封面文件名：`教学案例.pdf` → `教学案例-cover-<时间戳>.jpg` */
function coverFileName(pdfPath) {
    const base = String(pdfPath).split(/[/\\]/).pop() || "cover"
    const stem = base.replace(/\.pdf$/i, "").replace(/[^\w\u4e00-\u9fa5.-]+/g, "-").slice(0, 40) || "cover"
    return `${stem}-cover-${Date.now()}.jpg`
}

export class PdfCover {
    /**
     * @param {Object} options
     * @param {Object} options.editorState - 编辑器的 editorState（写法与特色图片一致）
     * @param {HTMLTextAreaElement} [options.markdownTextarea] - 正文 textarea（编辑器里它就是权威内容）
     * @param {Function} [options.getTitle] - 取标题，用作封面 alt
     */
    constructor({ editorState, markdownTextarea, getTitle } = {}) {
        this.editorState = editorState || window.editorState
        this.markdownTextarea = markdownTextarea || document.getElementById("content")
        this.getTitle = typeof getTitle === "function" ? getTitle : () => ""
        this.busy = false
        this.elements = {}
    }

    /** 在「特色图片」下面挂一块 UI（不改模板，跟着侧栏一起走） */
    init() {
        const anchor = document.getElementById("featured-image-preview")
        if (!anchor || document.getElementById("pdf-cover-group")) return

        const group = document.createElement("div")
        group.className = "form-group pdf-cover-group"
        group.id = "pdf-cover-group"
        group.innerHTML = `
            <label data-i18n="pdfCover_title">${tr("pdfCover_title", null, "PDF 封面")}</label>
            <p class="help-text" data-i18n="pdfCover_help">${tr(
                "pdfCover_help",
                null,
                "正文里插入 PDF 附件（[file:documents/xxx.pdf|名称]）后，可一键把第 1 页转成上面的特色图片。"
            )}</p>
            <div class="pdf-cover-actions" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
                <button type="button" class="btn btn-sm" id="pdf-cover-generate" data-i18n="pdfCover_generate">${tr(
                    "pdfCover_generate",
                    null,
                    "从 PDF 生成封面"
                )}</button>
                <span class="pdf-cover-status help-text" id="pdf-cover-status" role="status" aria-live="polite"></span>
            </div>`

        const formGroup = anchor.closest(".form-group") || anchor
        formGroup.parentNode.insertBefore(group, formGroup.nextSibling)

        this.elements.group = group
        this.elements.button = group.querySelector("#pdf-cover-generate")
        this.elements.status = group.querySelector("#pdf-cover-status")
        this.elements.button.addEventListener("click", () => this.generate())

        // 注入的节点在 I18N 首轮扫描之后才存在，这里补一次翻译（失败就算了）
        try {
            window.I18N?.apply?.(group)
        } catch {
            /* 不影响功能 */
        }
    }

    /** 状态提示（沿用后台的 .help-text 观感，仅按语气上色） */
    setStatus(message, tone) {
        const el = this.elements.status
        if (!el) return
        el.textContent = message || ""
        el.dataset.tone = tone || ""
        el.style.color = tone === "error" ? "#b5443a" : tone === "ok" ? "#0f766e" : ""
    }

    /** 当前正文 */
    currentMarkdown() {
        return this.markdownTextarea ? this.markdownTextarea.value || "" : ""
    }

    /** 主流程：找附件 → 取字节 → 渲染 → 上传 → 写入特色图片 */
    async generate() {
        if (this.busy) return
        const button = this.elements.button
        const attachment = findFirstPdfAttachment(this.currentMarkdown())

        if (!attachment) {
            this.setStatus(
                tr("pdfCover_noAttachment", null, "正文里还没有 PDF 附件（格式：[file:documents/xxx.pdf|名称]）"),
                "error"
            )
            return
        }
        if (attachment.external) {
            this.setStatus(
                tr("pdfCover_external", null, "外链 PDF 无法直接生成封面，请把文件上传到媒体库后再插入"),
                "error"
            )
            return
        }

        const existing = this.editorState?.getFeaturedImage?.()
        if (existing && existing.url) {
            const ok = window.confirm(
                tr("pdfCover_overwrite", null, "已有特色图片，确定用 PDF 第 1 页替换它吗？")
            )
            if (!ok) return
        }

        this.busy = true
        if (button) button.disabled = true
        try {
            this.setStatus(tr("pdfCover_reading", null, "正在读取 PDF…"))

            const res = await fetch(attachmentUrl(attachment.path))
            if (!res.ok) {
                throw new Error(tr("pdfCover_fetchFailed", { status: res.status }, `读取 PDF 失败（HTTP {status}）`))
            }
            const buffer = await res.arrayBuffer()
            const sizeText = formatBytes(buffer.byteLength)

            if (buffer.byteLength > BIG_FILE_BYTES) {
                const ok = window.confirm(
                    tr("pdfCover_bigFile", { size: sizeText }, `附件较大（{size}），生成封面会占用一些内存，继续吗？`)
                )
                if (!ok) return
            }

            const pdfjs = await this.loadPdfjs()
            this.setStatus(tr("pdfCover_rendering", null, "正在渲染第 1 页…"))
            const { blob, pages } = await this.renderFirstPage(pdfjs, buffer)

            this.setStatus(tr("pdfCover_uploading", null, "正在上传封面…"))
            const media = await this.uploadCover(blob, attachment)

            const payload = {
                id: media.id,
                url: media.url,
                alt: this.getTitle() || attachment.name,
                source: "pdf",
                pdfFile: attachment.path,
                pdfPages: pages,
                pdfSize: sizeText,
            }

            // 直接调 editorState：editorIntegration.setFeaturedImage() 会把对象裁成
            // { id, url, alt }，那份 pdfPages/pdfSize 就丢了（模板要靠它显示「12 页 · 2.4 MB」）。
            this.editorState?.setFeaturedImage?.(payload)
            uiMediaManager.updateFeaturedImagePreview(
                payload,
                () => window.mediaSelector?.openFeaturedImageSelector?.(),
                () => window.mediaSelector?.removeFeaturedImage?.()
            )

            this.setStatus(
                tr(
                    "pdfCover_done",
                    { pages, size: sizeText },
                    `已生成封面（{pages} 页 · {size}），记得点保存/更新`
                ),
                "ok"
            )
        } catch (error) {
            console.error("[pdf-cover] 生成失败:", error)
            this.setStatus(
                error && error.message
                    ? tr("pdfCover_failed", { message: error.message }, `生成失败：{message}`)
                    : tr("pdfCover_failedGeneric", null, "生成失败，请重试或手动设置特色图片"),
                "error"
            )
        } finally {
            this.busy = false
            if (button) button.disabled = false
        }
    }

    /** 动态加载 pdf.js：缺失时给出可执行的提示，而不是抛一堆红字 */
    async loadPdfjs() {
        try {
            const module = await import(/* @vite-ignore */ `${PDFJS_ROOT}/pdf.min.mjs`)
            const pdfjs = module.default && module.default.getDocument ? module.default : module
            if (pdfjs.GlobalWorkerOptions) {
                pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ROOT}/pdf.worker.min.mjs`
            }
            return pdfjs
        } catch (error) {
            console.error("[pdf-cover] pdf.js 未加载:", error)
            throw new Error(
                tr(
                    "pdfCover_missingLib",
                    null,
                    "pdf.js 未安装：在项目根目录运行 .\\tools\\fetch-pdfjs.ps1 后刷新本页"
                )
            )
        }
    }

    /**
     * 渲染第 1 页为 JPEG。
     * 注意：PDF 页面是透明底，先铺白底再画，否则 JPEG 会变成黑底。
     */
    async renderFirstPage(pdfjs, buffer) {
        const doc = await pdfjs.getDocument({ data: buffer }).promise
        try {
            const page = await doc.getPage(1)
            const base = page.getViewport({ scale: 1 })
            const scale = Math.min(2, COVER_WIDTH / base.width)
            const viewport = page.getViewport({ scale })

            const canvas = document.createElement("canvas")
            canvas.width = Math.max(1, Math.ceil(viewport.width))
            canvas.height = Math.max(1, Math.ceil(viewport.height))
            const context = canvas.getContext("2d", { alpha: false })
            context.fillStyle = "#ffffff"
            context.fillRect(0, 0, canvas.width, canvas.height)

            await page.render({ canvasContext: context, viewport }).promise
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(
                    (result) => (result ? resolve(result) : reject(new Error("canvas.toBlob 失败"))),
                    "image/jpeg",
                    0.85
                )
            })
            page.cleanup()
            return { blob, pages: doc.numPages }
        } finally {
            doc.destroy()
        }
    }

    /** 上传封面图（走现成的媒体上传接口：#file + alt） */
    async uploadCover(blob, attachment) {
        const formData = new FormData()
        formData.append("file", new File([blob], coverFileName(attachment.path), { type: "image/jpeg" }))
        formData.append("alt", this.getTitle() || attachment.name)

        const res = await fetch("/api/media/upload", { method: "POST", body: formData })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload || !payload.success || !payload.data) {
            const detail = (payload && payload.error) || `HTTP ${res.status}`
            throw new Error(tr("pdfCover_uploadFailed", { detail }, `上传失败：{detail}`))
        }
        return payload.data
    }
}

export default PdfCover
