/**
 * 附件（PDF / Word / PPT / 表格 / 压缩包）插入管理
 * =====================================================================
 * 为什么需要它（2026-09-19 使用方反馈）：
 *   编辑器工具栏只有「🖼️ 图片」，没有任何"上传/插入 PDF"的入口 —— 想挂一份资料，
 *   只能自己手打 `[file:documents/xxx.pdf|名称]`，而且还得先去媒体库把文件传上去。
 *   这与"资源建设者要把 PDF 提供给别人下载"的核心用法完全不匹配。
 *
 * 本模块做两件事，都挂在工具栏新增的「📎 附件」按钮上：
 *   1. **上传新文件**：选文件 → `POST /api/media/upload`（非图片一律落 documents/）
 *      → 在光标处插入 `[file:documents/<文件名>|<显示名>]`
 *   2. **从媒体库选择**：复用现成的媒体选择弹层（它本来就支持 Documents 过滤，
 *      见 partials/media-selection-modal.html 的 `#modal-media-filter`），
 *      由 `media-selector.js` 的 `openAttachmentSelector()` 打开
 *
 * 插入后若文件是 PDF，顺手问一句「要生成封面吗」—— 直接接上 pdf-cover.js（卡片封面 + 文章头图）。
 *
 * 与既有分工保持一致：图片走 media-selector，附件走这里；两者都只改"插入什么 markdown"。
 */

/** 允许上传的附件类型（与知识库实际用途一致：资料 / 课件 / 表格 / 打包） */
const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.odt,.odp,.ods,.rtf,.txt,.md,.zip,.rar,.7z,.tar,.gz"

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

/** 1 234 567 → "1.2 MB" */
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

/** 显示名：去掉扩展名（附件行已经单独显示"PDF · 2.4 MB"，名字里再带一次就显得啰嗦） */
export function displayNameFor(filename) {
    const name = String(filename || "").trim()
    if (!name) return "附件"
    const stripped = name.replace(/\.[A-Za-z0-9]{1,8}$/, "")
    return stripped || name
}

/** mediaItem.url 是 `/documents/x.pdf`；`[file:…]` 要的是相对 uploads 的路径 */
export function directivePathFor(mediaItem) {
    const url = String(mediaItem?.url || "")
    const filename = String(mediaItem?.filename || "")
    if (url) return url.replace(/^\/+/, "")
    if (filename) return `documents/${filename}`
    return ""
}

export class AttachmentsManager {
    /**
     * @param {Object} options
     * @param {HTMLTextAreaElement} [options.markdownTextarea] - 正文 textarea（编辑器里的权威内容）
     * @param {Function} [options.getTitle] - 取标题，用作上传时的 alt
     */
    constructor({ markdownTextarea, getTitle } = {}) {
        this.markdownTextarea = markdownTextarea || document.getElementById("content")
        this.getTitle = typeof getTitle === "function" ? getTitle : () => ""
        this.busy = false
        this.menu = null
        this.input = null
        this.buttons = []
    }

    /* ------------------------------------------------------------ 初始化 */

    init() {
        // 工具栏有两个实例：正文编辑器 + 全屏编辑器，都要挂上
        this.buttons = Array.prototype.slice.call(document.querySelectorAll('[data-command="attach"]'))
        this.buttons.forEach((button) => {
            button.addEventListener("click", (event) => {
                event.preventDefault()
                this.toggleMenu(button)
            })
        })

        // 隐藏的文件选择框（accept 之外仍让用户能选"所有文件"，由后端判类型）
        this.input = document.createElement("input")
        this.input.type = "file"
        this.input.accept = ACCEPT
        this.input.multiple = true
        this.input.style.display = "none"
        this.input.addEventListener("change", () => {
            const files = Array.prototype.slice.call(this.input.files || [])
            this.input.value = ""
            if (files.length) this.uploadFiles(files)
        })
        document.body.appendChild(this.input)

        document.addEventListener("click", (event) => {
            if (this.menu && !this.menu.contains(event.target) && !event.target.closest('[data-command="attach"]')) {
                this.closeMenu()
            }
        })
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") this.closeMenu()
        })
    }

    /* ------------------------------------------------------------ 小菜单 */

    toggleMenu(anchor) {
        if (this.menu) {
            this.closeMenu()
            return
        }

        const menu = document.createElement("div")
        menu.className = "attach-menu"
        menu.style.cssText = [
            "position:absolute",
            "z-index:9999",
            "min-width:264px",
            "background:#fff",
            "border:1px solid #d8e0e6",
            "border-radius:8px",
            "box-shadow:0 12px 28px rgba(11,61,56,.16)",
            "padding:6px",
        ].join(";")
        menu.innerHTML = `
            <button type="button" class="btn btn-sm" data-attach-action="upload"
                style="display:block;width:100%;text-align:left;margin:0 0 4px">
                📤 ${tr("attach_upload", null, "上传新文件（PDF / Word / PPT / 表格 / 压缩包）")}
            </button>
            <button type="button" class="btn btn-sm btn-outline" data-attach-action="library"
                style="display:block;width:100%;text-align:left">
                🗂 ${tr("attach_library", null, "从媒体库选择已有文档")}
            </button>
            <p class="help-text" style="margin:6px 4px 2px">
                ${tr("attach_hint", null, "插入后正文里会写成 [file:…] 附件块，前台显示下载按钮；PDF 可一键生成封面。")}
            </p>
            <p class="help-text attach-status" style="margin:2px 4px 2px"></p>`

        const rect = anchor.getBoundingClientRect()
        menu.style.left = `${Math.max(8, rect.left + window.scrollX)}px`
        menu.style.top = `${rect.bottom + window.scrollY + 6}px`
        document.body.appendChild(menu)
        this.menu = menu

        menu.querySelector('[data-attach-action="upload"]').addEventListener("click", () => {
            this.closeMenu()
            this.input.click()
        })
        menu.querySelector('[data-attach-action="library"]').addEventListener("click", () => {
            this.closeMenu()
            this.chooseFromLibrary()
        })
    }

    closeMenu() {
        if (this.menu) {
            this.menu.remove()
            this.menu = null
        }
    }

    setMenuStatus(message, tone) {
        const el = this.menu && this.menu.querySelector(".attach-status")
        if (!el) return
        el.textContent = message || ""
        el.style.color = tone === "error" ? "#b5443a" : tone === "ok" ? "#0f766e" : ""
    }

    /* -------------------------------------------------------- 插入到正文 */

    /** 在光标处插入 `[file:路径|显示名]`，并通知编辑器"内容变了" */
    insertDirective(mediaItem, originalName) {
        const path = directivePathFor(mediaItem)
        if (!path || !this.markdownTextarea) return null

        // ⚠️ 服务端会把文件名规范化：`教学案例示例.pdf` → `-ba36722ef7cda039.pdf`
        // （见 file-manager 的 sanitize），所以**显示名一定要用原始名/title**，
        // 否则附件行会显示成一串哈希。
        const readable =
            originalName || mediaItem.title || mediaItem.originalFilename || mediaItem.filename || path
        const name = displayNameFor(readable)
        const directive = `[file:${path}|${name}]`
        const textarea = this.markdownTextarea
        const start = textarea.selectionStart === undefined ? textarea.value.length : textarea.selectionStart
        const end = textarea.selectionEnd === undefined ? start : textarea.selectionEnd

        textarea.value = textarea.value.substring(0, start) + directive + textarea.value.substring(end)
        textarea.selectionStart = textarea.selectionEnd = start + directive.length
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
        textarea.focus()
        return { directive, path, name, isPdf: /\.pdf$/i.test(path) }
    }

    /* ------------------------------------------------------------ 上传 */

    async uploadFiles(files) {
        if (this.busy) return
        this.busy = true
        let inserted = 0
        let firstPdf = false
        const failures = []

        for (const file of files) {
            try {
                if (this.menu) this.setMenuStatus(tr("attach_uploading", { name: file.name }, `正在上传 {name}…`))
                const media = await this.uploadOne(file)
                const result = this.insertDirective(media, file.name)
                if (result) {
                    inserted++
                    if (result.isPdf && !firstPdf) firstPdf = true
                }
            } catch (error) {
                console.error("[attachments] 上传失败:", error)
                failures.push(`${file.name}：${error.message}`)
            }
        }

        this.busy = false

        if (failures.length) {
            window.alert(tr("attach_failed", { detail: failures.join("\n") }, `上传失败：\n{detail}`))
        }
        if (inserted) {
            this.offerCover(firstPdf, inserted)
        }
    }

    /** POST /api/media/upload（字段名 file；非图片一律落 documents/） */
    async uploadOne(file) {
        const formData = new FormData()
        formData.append("file", file, file.name)
        const title = this.getTitle()
        if (title) formData.append("alt", title)

        const res = await fetch("/api/media/upload", { method: "POST", body: formData })
        const payload = await res.json().catch(() => null)
        if (!res.ok || !payload || !payload.success || !payload.data) {
            throw new Error((payload && payload.error) || `HTTP ${res.status}`)
        }
        return payload.data
    }

    /* -------------------------------------------------- 从媒体库选已有文档 */

    chooseFromLibrary() {
        if (window.mediaSelector && typeof window.mediaSelector.openAttachmentSelector === "function") {
            window.mediaSelector.openAttachmentSelector()
            return
        }
        window.alert(tr("attach_noLibrary", null, "媒体选择器不可用，请刷新页面后重试"))
    }

    /** 供 media-selector 的 openAttachmentSelector() 回调：插入已有文档 */
    insertExisting(mediaItem) {
        // 媒体库里 filename 是规范化后的名字，title/originalFilename 才是人看得懂的
        const result = this.insertDirective(mediaItem, mediaItem.title || mediaItem.originalFilename || "")
        if (result) this.offerCover(result.isPdf, 1)
    }

    /* -------------------------------------------------- 顺手续上 PDF 封面 */

    offerCover(isPdf, count) {
        const status = tr("attach_inserted", { count }, `已插入 {count} 个附件`)
        if (!isPdf) {
            if (this.menu) this.setMenuStatus(status, "ok")
            return
        }
        if (window.pdfCover && typeof window.pdfCover.generate === "function") {
            const ok = window.confirm(tr("attach_offerCover", null, "已插入 PDF 附件。现在就把它生成封面吗？"))
            if (ok) {
                window.pdfCover.generate()
                return
            }
        }
        if (this.menu) this.setMenuStatus(status, "ok")
    }
}

export default AttachmentsManager
