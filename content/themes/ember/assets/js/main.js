/**
 * Ember theme — minimal JS: active nav link + mobile menu toggle.
 */
document.addEventListener("DOMContentLoaded", function () {
    const currentPath = window.location.pathname

    // Highlight the current navigation item.
    document.querySelectorAll(".site-navigation a").forEach(function (link) {
        const href = link.getAttribute("href")
        if (!href) return
        if (href === "/" && currentPath === "/") {
            link.classList.add("active")
        } else if (href !== "/" && currentPath.startsWith(href)) {
            link.classList.add("active")
        }
    })

    // Mobile menu toggle.
    const nav = document.querySelector(".site-navigation")
    if (!nav) return
    const toggle = document.createElement("button")
    toggle.className = "menu-toggle"
    toggle.setAttribute("aria-expanded", "false")
    toggle.textContent = "☰"
    nav.parentNode.insertBefore(toggle, nav)
    toggle.addEventListener("click", function () {
        const expanded = this.getAttribute("aria-expanded") === "true"
        this.setAttribute("aria-expanded", !expanded)
        nav.classList.toggle("toggled")
    })
})

/**
 * 首页广告位轮播（2026-09-15）。
 * 渐进增强：HTML 里第一张默认带 .is-active，没有 JS 时也能看到内容；
 * 只有 1 张时不做任何事；系统开启"减少动态效果"时不自动播放。
 */
document.addEventListener("DOMContentLoaded", function () {
    const root = document.querySelector("[data-carousel]")
    if (!root) return

    const slides = Array.prototype.slice.call(root.querySelectorAll(".banner-slide"))
    const dots = Array.prototype.slice.call(root.querySelectorAll(".banner-dot"))
    if (slides.length < 2) return

    const interval = parseInt(root.getAttribute("data-interval") || "5000", 10)
    // 后台「自动播放」开关：data-autoplay="0" 时只响应圆点/箭头，不自动切换
    const autoplayAllowed = root.getAttribute("data-autoplay") !== "0"
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
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

    // 鼠标悬停时暂停，移开继续
    root.addEventListener("mouseenter", stop)
    root.addEventListener("mouseleave", start)

    show(0)
    start()
})