/**
 * Jade theme — 渐进增强脚本。
 *
 * 只做「没有它页面也完整」的事：
 *   1. 导航当前项高亮 + 移动端菜单按钮
 *   2. 粘性头部滚动阴影
 *   3. 首页广告位轮播（无 JS 时第一张仍可见，见 style.css）
 *   4. 文章页目录（从正文 h2/h3 生成）+ 当前小节高亮
 *   5. 回到顶部按钮
 */
;(function () {
    "use strict"

    function ready(fn) {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", fn)
        } else {
            fn()
        }
    }

    /* ---------------------------------------------------------- 1. 导航 */
    function initNavigation() {
        const currentPath = window.location.pathname

        document.querySelectorAll(".site-navigation a").forEach(function (link) {
            const href = link.getAttribute("href")
            if (!href) return
            if (href === "/" && currentPath === "/") {
                link.classList.add("active")
            } else if (href !== "/" && currentPath.indexOf(href) === 0) {
                link.classList.add("active")
            }
        })

        const nav = document.querySelector(".site-navigation")
        if (!nav) return
        const toggle = document.createElement("button")
        toggle.className = "menu-toggle"
        toggle.type = "button"
        toggle.setAttribute("aria-expanded", "false")
        toggle.setAttribute("aria-label", "展开导航")
        toggle.textContent = "☰"
        nav.parentNode.insertBefore(toggle, nav)
        toggle.addEventListener("click", function () {
            const expanded = this.getAttribute("aria-expanded") === "true"
            this.setAttribute("aria-expanded", String(!expanded))
            nav.classList.toggle("toggled")
        })
    }

    /* -------------------------------------------------- 2. 粘性头部阴影 */
    function initHeaderShadow() {
        const header = document.querySelector("[data-sticky-header]")
        if (!header) return
        const sync = function () {
            header.classList.toggle("is-scrolled", window.scrollY > 6)
        }
        sync()
        window.addEventListener("scroll", sync, { passive: true })
    }

    /* ------------------------------------------------------------ 3. 轮播 */
    function initCarousel() {
        const root = document.querySelector("[data-carousel]")
        if (!root) return

        const slides = Array.prototype.slice.call(root.querySelectorAll(".banner-slide"))
        const dots = Array.prototype.slice.call(root.querySelectorAll(".banner-dot"))
        if (slides.length < 2) return

        const interval = parseInt(root.getAttribute("data-interval") || "5000", 10)
        // 后台「自动播放」开关：data-autoplay="0" 时只响应圆点/箭头
        const autoplayAllowed = root.getAttribute("data-autoplay") !== "0"
        const reduceMotion =
            window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        let index = 0
        let timer = null

        function show(next) {
            index = (next + slides.length) % slides.length
            slides.forEach(function (slide, i) {
                slide.classList.toggle("is-active", i === index)
                slide.setAttribute("aria-hidden", i === index ? "false" : "true")
            })
            dots.forEach(function (dot, i) {
                dot.classList.toggle("is-active", i === index)
            })
        }

        function stop() {
            if (timer) {
                clearInterval(timer)
                timer = null
            }
        }

        function start() {
            stop()
            if (reduceMotion || !autoplayAllowed) return
            timer = setInterval(function () {
                show(index + 1)
            }, interval)
        }

        dots.forEach(function (dot, i) {
            dot.addEventListener("click", function () {
                show(i)
                start()
            })
        })

        const prev = root.querySelector(".banner-nav.is-prev")
        const next = root.querySelector(".banner-nav.is-next")
        if (prev) prev.addEventListener("click", function () { show(index - 1); start() })
        if (next) next.addEventListener("click", function () { show(index + 1); start() })

        root.addEventListener("mouseenter", stop)
        root.addEventListener("mouseleave", start)

        show(0)
        start()
    }

    /* ------------------------------------------------------------ 4. 目录 */
    function initToc() {
        const box = document.querySelector("[data-toc]")
        const list = document.querySelector("[data-toc-list]")
        const content = document.querySelector(".post-content")
        if (!box || !list || !content) return

        const heads = Array.prototype.slice
            .call(content.querySelectorAll("h2, h3"))
            .filter(function (head) { return (head.textContent || "").trim().length > 0 })
        if (heads.length < 2) return

        const used = {}
        const links = []
        heads.forEach(function (head, i) {
            let id = head.id
            if (!id) {
                id = "sec-" + (i + 1)
                head.id = id
            }
            while (used[id]) id = id + "-x"
            used[id] = true

            const li = document.createElement("li")
            if (head.tagName === "H3") li.className = "toc-sub"
            const a = document.createElement("a")
            a.href = "#" + id
            a.textContent = head.textContent.trim()
            li.appendChild(a)
            list.appendChild(li)
            links.push({ link: a, head: head })
        })

        box.hidden = false

        // 当前小节高亮：滚动时就近取最后一个已越过顶部的标题
        let ticking = false
        const sync = function () {
            ticking = false
            const offset = 96
            let current = links[0]
            links.forEach(function (item) {
                if (item.head.getBoundingClientRect().top - offset <= 0) current = item
            })
            links.forEach(function (item) {
                item.link.classList.toggle("is-current", item === current)
            })
        }
        window.addEventListener(
            "scroll",
            function () {
                if (ticking) return
                ticking = true
                window.requestAnimationFrame(sync)
            },
            { passive: true }
        )
        sync()
    }

    /* -------------------------------------------------------- 5. 回到顶部 */
    function initToTop() {
        const btn = document.querySelector("[data-to-top]")
        if (!btn) return
        const sync = function () {
            btn.hidden = window.scrollY < 600
        }
        sync()
        window.addEventListener("scroll", sync, { passive: true })
        btn.addEventListener("click", function () {
            window.scrollTo({ top: 0, behavior: "smooth" })
        })
    }

    ready(function () {
        initNavigation()
        initHeaderShadow()
        initCarousel()
        initToc()
        initToTop()
    })
})()
