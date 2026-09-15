/**
 * 后台「首页装修」页 —— 广告位轮播 + 资源分类卡片
 *
 * 设计取向：
 *   - 纯原生 JS，不引框架；页面骨架在 homepage.html，列表由这里渲染
 *   - 图片一律走「媒体库」：可上传新图，也可从已有图片里点选（避免重复上传）
 *   - 保存是**整份提交**（PUT /api/homepage），服务端再用 normalizeHomepage 兜底校验
 *   - 排序用「上移 / 下移」按钮（数组顺序即前台显示顺序）；不引拖拽库，少一处依赖
 *
 * 与后台其它页一致：接口都带 Cookie 登录态（fetch 默认 same-origin）。
 */
(function () {
    "use strict"

    const state = {
        loaded: false,
        saving: false,
        file: "",
        settings: { autoplay: true, intervalMs: 5000, bannerHeightPx: 205 },
        banners: [],
        categoryCards: [],
        picker: { open: false, target: null },
    }

    const el = (id) => document.getElementById(id)
    const escapeHtml = (value) =>
        String(value === undefined || value === null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")

    /** 图片路径 → 预览用的 URL（与服务端 toPublicUrl 同一规则）。 */
    function previewUrl(value) {
        const raw = String(value || "").trim()
        if (!raw) return ""
        if (/^https?:\/\//i.test(raw) || raw.startsWith("//") || raw.startsWith("/content/uploads")) return raw
        return `/content/uploads${raw.startsWith("/") ? "" : "/"}${raw}`
    }

    async function api(path, options) {
        const response = await fetch(path, Object.assign({ credentials: "same-origin" }, options || {}))
        if (response.status === 401) {
            window.location.href = "/aether/login"
            throw new Error("未登录")
        }
        const payload = await response.json().catch(() => ({}))
        if (!response.ok || payload.success === false) {
            throw new Error(payload.error || `HTTP ${response.status}`)
        }
        return payload
    }

    function setStatus(text, kind) {
        const node = el("homepageStatus")
        if (!node) return
        node.textContent = text || ""
        node.className = `homepage-status${kind ? ` is-${kind}` : ""}`
    }

    // ---------------------------------------------------------------------
    // 渲染：广告位
    // ---------------------------------------------------------------------
    function bannerCard(banner, index, total) {
        const preview = previewUrl(banner.image)
        return `
        <div class="hp-item" data-index="${index}">
            <div class="hp-thumb">
                ${preview ? `<img src="${escapeHtml(preview)}" alt="" />` : `<span class="hp-thumb-empty">未选图</span>`}
            </div>
            <div class="hp-fields">
                <div class="hp-row">
                    <label class="hp-field">
                        <span>桌面图（1600×320）</span>
                        <input type="text" data-field="image" value="${escapeHtml(banner.image)}" placeholder="/images/xxx.jpg" />
                    </label>
                    <button type="button" class="btn-secondary hp-pick" data-field="image">选择 / 上传</button>
                </div>
                <div class="hp-row">
                    <label class="hp-field">
                        <span>手机图（可选，750×320）</span>
                        <input type="text" data-field="mobileImage" value="${escapeHtml(banner.mobileImage || "")}" placeholder="留空则手机端用桌面图裁切" />
                    </label>
                    <button type="button" class="btn-secondary hp-pick" data-field="mobileImage">选择 / 上传</button>
                </div>
                <div class="hp-row">
                    <label class="hp-field">
                        <span>标题</span>
                        <input type="text" data-field="title" value="${escapeHtml(banner.title)}" placeholder="可留空" />
                    </label>
                    <label class="hp-field">
                        <span>副标题</span>
                        <input type="text" data-field="subtitle" value="${escapeHtml(banner.subtitle)}" placeholder="可留空" />
                    </label>
                </div>
                <div class="hp-row">
                    <label class="hp-field hp-field-wide">
                        <span>点击跳转链接（可选）</span>
                        <input type="text" data-field="url" value="${escapeHtml(banner.url)}" placeholder="留空则整张图不可点" />
                    </label>
                </div>
                <div class="hp-row hp-row-flags">
                    <label class="hp-flag"><input type="checkbox" data-field="showText" ${banner.showText ? "checked" : ""} /> 叠加文字（文字做在图里就关掉）</label>
                    <label class="hp-flag"><input type="checkbox" data-field="enabled" ${banner.enabled ? "checked" : ""} /> 启用</label>
                    <span class="hp-item-actions">
                        <button type="button" class="btn-secondary hp-move" data-dir="-1" ${index === 0 ? "disabled" : ""}>上移</button>
                        <button type="button" class="btn-secondary hp-move" data-dir="1" ${index === total - 1 ? "disabled" : ""}>下移</button>
                        <button type="button" class="btn-secondary hp-danger hp-remove">删除</button>
                    </span>
                </div>
            </div>
        </div>`
    }

    function renderBanners() {
        const box = el("bannerList")
        if (!box) return
        if (!state.banners.length) {
            box.innerHTML = `<p class="hint">还没有广告位。前台首页会退回「品牌横幅 + 最新发布」的默认样式。</p>`
            return
        }
        box.innerHTML = state.banners.map((banner, index) => bannerCard(banner, index, state.banners.length)).join("")
    }

    // ---------------------------------------------------------------------
    // 渲染：分类卡片
    // ---------------------------------------------------------------------
    function categoryCard(card, index, total) {
        const preview = previewUrl(card.image)
        const countText = card.missing ? "文章里已无此分类" : `${card.count} 篇`
        return `
        <div class="hp-item ${card.enabled ? "" : "is-off"}" data-index="${index}">
            <div class="hp-thumb">
                ${preview ? `<img src="${escapeHtml(preview)}" alt="" />` : `<span class="hp-thumb-empty">未配图</span>`}
            </div>
            <div class="hp-fields">
                <div class="hp-row">
                    <label class="hp-field">
                        <span>分类（自动来自文章）</span>
                        <input type="text" value="${escapeHtml(card.name)}" readonly />
                    </label>
                    <span class="hp-count ${card.enabled ? "" : "is-muted"}">${escapeHtml(countText)}</span>
                </div>
                <div class="hp-row">
                    <label class="hp-field">
                        <span>卡片图片（建议 16:9）</span>
                        <input type="text" data-field="image" value="${escapeHtml(card.image)}" placeholder="/images/xxx.jpg" />
                    </label>
                    <button type="button" class="btn-secondary hp-pick" data-field="image">选择 / 上传</button>
                </div>
                <div class="hp-row">
                    <label class="hp-field hp-field-wide">
                        <span>一句话说明（可选）</span>
                        <input type="text" data-field="description" value="${escapeHtml(card.description)}" placeholder="留空则只显示分类名与篇数" />
                    </label>
                </div>
                <div class="hp-row hp-row-flags">
                    <label class="hp-flag"><input type="checkbox" data-field="enabled" ${card.enabled ? "checked" : ""} /> 上线到首页</label>
                    <span class="hp-item-actions">
                        <button type="button" class="btn-secondary hp-move" data-dir="-1" ${index === 0 ? "disabled" : ""}>上移</button>
                        <button type="button" class="btn-secondary hp-move" data-dir="1" ${index === total - 1 ? "disabled" : ""}>下移</button>
                        ${card.configured ? `<button type="button" class="btn-secondary hp-reset">清除配置</button>` : ""}
                    </span>
                </div>
            </div>
        </div>`
    }

    function renderCategories() {
        const box = el("categoryList")
        if (!box) return
        box.innerHTML = state.categoryCards.map((card, index) => categoryCard(card, index, state.categoryCards.length)).join("")
        const online = state.categoryCards.filter((card) => card.enabled).length
        const unconfigured = state.categoryCards.filter((card) => !card.image).length
        const summary = el("categorySummary")
        if (summary) {
            summary.textContent = `共 ${state.categoryCards.length} 个分类，已上线 ${online} 个${unconfigured ? `，${unconfigured} 个还没配图` : ""}。`
        }
    }

    function renderSettings() {
        if (el("setAutoplay")) el("setAutoplay").checked = state.settings.autoplay !== false
        if (el("setInterval")) el("setInterval").value = Math.round((state.settings.intervalMs || 5000) / 1000)
        if (el("setHeight")) el("setHeight").value = state.settings.bannerHeightPx || 205
    }

    function renderAll() {
        renderBanners()
        renderCategories()
        renderSettings()
    }

    // ---------------------------------------------------------------------
    // 媒体选择面板
    // ---------------------------------------------------------------------
    async function openPicker(target) {
        state.picker.target = target
        const panel = el("hpPicker")
        if (!panel) return
        panel.hidden = false
        el("hpPickerTitle").textContent = target.field === "mobileImage" ? "选择手机图（750×320）" : "选择图片"
        await refreshPickerGrid()
    }

    function closePicker() {
        const panel = el("hpPicker")
        if (panel) panel.hidden = true
        state.picker.target = null
    }

    async function refreshPickerGrid() {
        const grid = el("hpPickerGrid")
        if (!grid) return
        grid.innerHTML = `<p class="hint">加载中…</p>`
        try {
            const payload = await api("/api/media")
            const images = (payload.data || []).filter((item) => item.type === "image")
            if (!images.length) {
                grid.innerHTML = `<p class="hint">媒体库还没有图片，用上面的「上传新图片」。</p>`
                return
            }
            grid.innerHTML = images
                .map(
                    (item) => `
                <button type="button" class="hp-pick-item" data-url="${escapeHtml(item.url)}" title="${escapeHtml(item.filename)}">
                    <img src="/content/uploads${escapeHtml(item.url)}" alt="" loading="lazy" />
                    <span>${escapeHtml(item.filename)}</span>
                </button>`
                )
                .join("")
        } catch (error) {
            grid.innerHTML = `<p class="hint">读取媒体库失败：${escapeHtml(error.message)}</p>`
        }
    }

    function applyPicked(url) {
        const target = state.picker.target
        if (!target) return
        const list = target.kind === "banner" ? state.banners : state.categoryCards
        if (list[target.index]) list[target.index][target.field] = url
        closePicker()
        renderAll()
        setStatus("已选图，别忘了点「保存」", "warn")
    }

    async function uploadInto(file) {
        const target = state.picker.target
        if (!target || !file) return
        const form = new FormData()
        form.append("file", file)
        el("hpPickerHint").textContent = "上传中…"
        try {
            const payload = await api("/api/media/upload", { method: "POST", body: form })
            const url = payload.data?.url || ""
            el("hpPickerHint").textContent = `已上传：${payload.data?.filename || url}`
            if (url) applyPicked(url)
        } catch (error) {
            el("hpPickerHint").textContent = `上传失败：${error.message}`
        }
    }

    // ---------------------------------------------------------------------
    // 事件绑定
    // ---------------------------------------------------------------------
    function listOf(node) {
        const item = node.closest(".hp-item")
        if (!item) return null
        const index = parseInt(item.getAttribute("data-index"), 10)
        const kind = node.closest("#categoryList") ? "category" : "banner"
        return { kind, index, item, list: kind === "category" ? state.categoryCards : state.banners }
    }

    function bindListEvents(containerId) {
        const container = el(containerId)
        if (!container) return

        container.addEventListener("input", (event) => {
            const input = event.target.closest("[data-field]")
            if (!input) return
            const found = listOf(input)
            if (!found) return
            const field = input.getAttribute("data-field")
            found.list[found.index][field] = input.type === "checkbox" ? input.checked : input.value
            if (input.type === "checkbox") renderAll()
        })

        container.addEventListener("change", (event) => {
            const input = event.target.closest("[data-field]")
            if (!input || input.type !== "checkbox") return
            const found = listOf(input)
            if (!found) return
            found.list[found.index][input.getAttribute("data-field")] = input.checked
            renderAll()
        })

        container.addEventListener("click", (event) => {
            const pick = event.target.closest(".hp-pick")
            if (pick) {
                const found = listOf(pick)
                if (found) openPicker({ kind: found.kind, index: found.index, field: pick.getAttribute("data-field") })
                return
            }

            const move = event.target.closest(".hp-move")
            if (move) {
                const found = listOf(move)
                if (!found) return
                const to = found.index + parseInt(move.getAttribute("data-dir"), 10)
                if (to < 0 || to >= found.list.length) return
                const [item] = found.list.splice(found.index, 1)
                found.list.splice(to, 0, item)
                renderAll()
                setStatus("顺序已调整，别忘了点「保存」", "warn")
                return
            }

            const remove = event.target.closest(".hp-remove")
            if (remove) {
                const found = listOf(remove)
                if (!found) return
                if (!window.confirm("确定删除这条广告位？")) return
                found.list.splice(found.index, 1)
                renderAll()
                setStatus("已删除，别忘了点「保存」", "warn")
                return
            }

            const reset = event.target.closest(".hp-reset")
            if (reset) {
                const found = listOf(reset)
                if (!found) return
                const card = found.list[found.index]
                card.image = ""
                card.description = ""
                card.enabled = false
                card.configured = false
                renderAll()
                setStatus("已清除该分类的配置（保存后生效）", "warn")
            }
        })
    }

    function bindSettings() {
        if (el("setAutoplay")) {
            el("setAutoplay").addEventListener("change", (event) => {
                state.settings.autoplay = event.target.checked
            })
        }
        if (el("setInterval")) {
            el("setInterval").addEventListener("change", (event) => {
                const seconds = Math.min(30, Math.max(2, parseInt(event.target.value, 10) || 5))
                state.settings.intervalMs = seconds * 1000
                event.target.value = seconds
            })
        }
        if (el("setHeight")) {
            el("setHeight").addEventListener("change", (event) => {
                const px = Math.min(320, Math.max(140, parseInt(event.target.value, 10) || 205))
                state.settings.bannerHeightPx = px
                event.target.value = px
            })
        }
    }

    function bindPicker() {
        if (el("hpPickerClose")) el("hpPickerClose").addEventListener("click", closePicker)
        if (el("hpPickerUpload")) {
            el("hpPickerUpload").addEventListener("change", (event) => {
                const file = event.target.files && event.target.files[0]
                event.target.value = ""
                if (file) uploadInto(file)
            })
        }
        if (el("hpPickerGrid")) {
            el("hpPickerGrid").addEventListener("click", (event) => {
                const item = event.target.closest(".hp-pick-item")
                if (item) applyPicked(item.getAttribute("data-url"))
            })
        }
    }

    function bindActions() {
        if (el("bannerAdd")) {
            el("bannerAdd").addEventListener("click", () => {
                state.banners.push({
                    id: "",
                    image: "",
                    mobileImage: "",
                    title: "",
                    subtitle: "",
                    url: "",
                    showText: true,
                    enabled: true,
                })
                renderAll()
                setStatus("已新增一条（请选图后保存）", "warn")
            })
        }
        if (el("homepageSave")) {
            el("homepageSave").addEventListener("click", async () => {
                if (state.saving) return
                state.saving = true
                setStatus("保存中…")
                try {
                    const payload = await api("/api/homepage", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            settings: state.settings,
                            banners: state.banners,
                            categoryCards: state.categoryCards,
                        }),
                    })
                    // 服务端是可信来源：保存后用它返回的数据重绘（含生成的 id 与分类篇数）
                    state.settings = payload.data.settings
                    state.banners = payload.data.banners
                    state.categoryCards = payload.data.categoryCards
                    renderAll()
                    setStatus("已保存 ✓ 前台首页已生效", "ok")
                } catch (error) {
                    setStatus(`保存失败：${error.message}`, "error")
                } finally {
                    state.saving = false
                }
            })
        }
    }

    async function load() {
        setStatus("读取配置中…")
        try {
            const payload = await api("/api/homepage")
            state.settings = payload.data.settings
            state.banners = payload.data.banners
            state.categoryCards = payload.data.categoryCards
            state.file = payload.file || ""
            if (el("homepageFile")) el("homepageFile").textContent = state.file
            state.loaded = true
            renderAll()
            setStatus("已读取", "")
        } catch (error) {
            setStatus(`读取失败：${error.message}`, "error")
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (!el("homepageSave")) return
        bindListEvents("bannerList")
        bindListEvents("categoryList")
        bindSettings()
        bindPicker()
        bindActions()
        if (window.I18N) window.I18N.init()
        load()
    })
})()
