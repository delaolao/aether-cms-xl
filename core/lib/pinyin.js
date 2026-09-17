/**
 * 汉字 → 拼音别名（URL slug）
 *
 * 背景：文章别名（slug）决定 URL（`/post/<slug>`）。手写拼音既慢又容易错
 * （线上实测：20 篇文章的别名全是手敲的，而且为了缩短还各自删过词），
 * 所以编辑器需要"从标题自动生成"的能力。
 *
 * 实现方式：把 `tiny-pinyin`（MIT，约 12 KB）**原样 vendor** 进
 * `core/lib/vendor/tiny-pinyin/`，而不是加 npm 依赖 —— 理由是本项目的部署方式是
 * 文件同步（`tools/sync-today-to-server.ps1`），不跑 `npm install`；
 * vendor 进仓库后，部署只需同步文件 ✓ 离线可用 ✓ 版本随仓库可追溯 ✓。
 * 升级方式：替换 `core/lib/vendor/tiny-pinyin/` 下的文件即可（package.json 里记着版本）。
 *
 * 两种生成风格（默认 word，与线上现有别名一致）：
 *   word     ：逐字拼音连写，只在**词/标点边界**加 `-`
 *               提升毅力 拒绝拖延            → tishengyili-jujuetuoyan
 *               告别后悔，适应开学            → gaobiehouhui-shiyingkaixue
 *   syllable ：每个字之间都加 `-`（更可读，但更长）
 *               提升毅力 拒绝拖延            → ti-sheng-yi-li-ju-jue-tuo-yan
 *
 * 两种都会：转小写、非字母数字折叠成单个 `-`、去掉首尾 `-`、按词边界截断到长度上限。
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const VENDOR_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "vendor", "tiny-pinyin", "dist", "index.js")

let tinyPinyin = null
function loadPinyin() {
    if (!tinyPinyin) tinyPinyin = require(VENDOR_ENTRY)
    return tinyPinyin
}

/** 长度上限：与 URL 可读性的折中（现有线上别名最长 30 字符左右） */
export const SLUG_MAX_LENGTH = 80

export const SLUG_MODES = ["word", "syllable"]

/**
 * 汉字转拼音。
 * @param {string} text
 * @param {string} separator 汉字之间插入的分隔符（word 风格传 ""）
 * @returns {string}
 */
export function toPinyin(text, separator = "-") {
    const lib = loadPinyin()
    try {
        return lib.convertToPinyin(String(text === undefined || text === null ? "" : text), separator, true)
    } catch (error) {
        console.error("[pinyin] 转换失败：", error.message)
        return ""
    }
}

/** 汉字区间（含扩展 A 与兼容区） */
const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const HAN_RE_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g

/**
 * 按「汉字段 / 非汉字段」分别转换再拼接。
 *
 * 为什么要分段：tiny-pinyin 的 `convertToPinyin(str, separator)` 会在**每个字符**之间插
 * 分隔符，包括英文数字（`Markdown` → `m-a-r-k-d-o-w-n`）。所以只对汉字段传分隔符，
 * 英文/数字段原样保留，段之间再按风格拼接。
 */
function convertRuns(text, mode) {
    const source = String(text === undefined || text === null ? "" : text)
    if (!source) return ""
    // 全是汉字（去掉汉字后没剩下别的东西）：直接转换，省一次分段
    if (source.replace(HAN_RE_G, "").trim() === "") {
        return toPinyin(source, mode === "syllable" ? "-" : "")
    }

    const parts = []
    let buffer = ""
    let bufferIsHan = null
    const flush = () => {
        if (!buffer) return
        parts.push(bufferIsHan ? toPinyin(buffer, mode === "syllable" ? "-" : "") : buffer)
        buffer = ""
    }
    for (const char of source) {
        const isHan = HAN_RE.test(char)
        if (bufferIsHan !== null && isHan !== bufferIsHan) flush()
        bufferIsHan = isHan
        buffer += char
    }
    flush()
    return parts.join(mode === "syllable" ? "-" : "")
}

/**
 * 由标题生成 slug。
 * @param {string} text 标题
 * @param {{mode?: "word"|"syllable", maxLength?: number}} [options]
 * @returns {string} 空字符串表示标题里没有可用的字母/数字/汉字
 */
export function slugFromTitle(text, options = {}) {
    const mode = SLUG_MODES.includes(options.mode) ? options.mode : "word"
    const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : SLUG_MAX_LENGTH

    const pinyin = convertRuns(text, mode)

    let slug = String(pinyin || "")
        .toLowerCase()
        // 字母、数字、连字符之外的一切（含中文标点、空格、emoji）→ 单个连字符
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "")

    if (slug.length > maxLength) {
        // 截断在词边界，避免切出半截单词（若整段没有连字符则只能硬截）
        slug = slug.slice(0, maxLength).replace(/-[^-]*$/, "").replace(/-+$/, "") || slug.slice(0, maxLength)
    }
    return slug
}

/** vendor 库是否可用（供后台页做能力提示） */
export function pinyinAvailable() {
    try {
        loadPinyin()
        return true
    } catch {
        return false
    }
}
