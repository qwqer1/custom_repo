/**
 * 漫画160 (mh160mh.com) comic source for Venera.
 *
 * Site runs 青天CMS (qingtiancms). Notes from reverse-engineering the site:
 *  - Chapter images live in `qTcms_S_m_murl_e`, a base64 blob whose decoded
 *    value is a `$qingtiandy$`-separated list of absolute image paths.
 *  - The host to prefix them with comes from show.20170501.js:
 *        parseInt(qTcms_S_p_id) > 542724 ? gethost() : "https://mhpic6.tgmhfc.uk"
 *    where gethost() picks at random from a 5-mirror pool.
 *  - configs.js advertises *.mangafiles.com:88 hosts. That domain is NXDOMAIN
 *    globally and is dead config; do not use it.
 *  - Images are hotlink-protected and 403 without a Referer header.
 *  - The search endpoint is behind a Cloudflare challenge; the app handles it.
 */
class Mh160 extends ComicSource {
    name = "漫画160"

    key = "mh160"

    version = "1.0.1"

    minAppVersion = "1.0.0"

    // self-update URL; must match where this file is hosted
    url = "https://raw.githubusercontent.com/qwqer1/custom_repo/main/mh160.js"

    baseUrl = "https://www.mh160mh.com"

    // gethost() pool from /template/skin1/css/d7s/js/show.20170501.js
    picHosts = [
        "https://mhpic5er.tgmhfc.uk",
        "https://mhpic789-5.tgmhfc.uk",
        "https://mhpic7fr.tgmhfc.uk",
        "https://mhpicwt.tgmhfc.uk",
        "https://mhpicwx.tgmhfc.uk",
    ]

    // used when qTcms_S_p_id <= 542724
    legacyPicHost = "https://mhpic6.tgmhfc.uk"

    // a full page of a listing is 12 items
    pageSize = 12

    get headers() {
        return {
            "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
            "Referer": `${this.baseUrl}/`,
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
    }

    async fetchDoc(url) {
        const res = await Network.get(url, this.headers)
        if (res.status !== 200) {
            throw `Invalid status code: ${res.status}`
        }
        return new HtmlDocument(res.body)
    }

    /// page 1 is the bare directory, later pages are `<n>.html`
    listUrl(param, page) {
        const part = param || "all"
        return page > 1
            ? `${this.baseUrl}/kanmanhua/${part}/${page}.html`
            : `${this.baseUrl}/kanmanhua/${part}/`
    }

    /**
     * The pager on this site is a rolling window (尾页 points at a moving
     * target) and exposes no total, so treat a short page as the end and
     * otherwise keep one page of headroom.
     */
    maxPageFor(comics, page) {
        return comics.length < this.pageSize ? Math.max(page, 1) : page + 1
    }

    parseList(doc) {
        const comics = []
        for (const box of doc.querySelectorAll(".mh-worksbox")) {
            const link = box.querySelector(".mh-nlook-w a")
            if (!link) continue
            const href = link.attributes["href"] ?? ""
            const match = /\/kanmanhua\/([^\/]+)\//.exec(href)
            if (!match) continue
            const img = box.querySelector(".mh-nlook-w img")
            comics.push(new Comic({
                id: match[1],
                title: (link.attributes["title"] ?? img?.attributes["alt"] ?? "").trim(),
                cover: img?.attributes["src"] ?? "",
                description: box.querySelector(".mh-works-decs")?.text?.trim(),
            }))
        }
        return comics
    }

    explore = [
        {
            title: "漫画160",
            type: "multiPageComicList",
            load: async (page) => {
                const comics = this.parseList(await this.fetchDoc(this.listUrl("all", page)))
                return { comics: comics, maxPage: this.maxPageFor(comics, page) }
            },
        }
    ]

    category = {
        title: "漫画160",
        parts: [
            {
                name: "分类",
                type: "fixed",
                categories: ["全部漫画", "人气排行", "日韩漫画", "内地漫画", "港台漫画"],
                categoryParams: ["all", "allhit", "zaixian_rhmh", "zaixian_dlmh", "zaixian_gtmh"],
                itemType: "category",
            }
        ],
        enableRankingPage: false,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            const comics = this.parseList(await this.fetchDoc(this.listUrl(param, page)))
            return { comics: comics, maxPage: this.maxPageFor(comics, page) }
        },
        optionList: [],
    }

    search = {
        load: async (keyword, options, page) => {
            // This endpoint answers 403 with `cf-mitigated: challenge`. Venera's
            // CloudflareInterceptor detects that header, opens a webview for the
            // user to pass the challenge, then reuses cf_clearance and the
            // webview's UA on later requests. Do NOT catch the 403 here: doing so
            // hides the challenge from the app and the webview never opens.
            const doc = await this.fetchDoc(
                `${this.baseUrl}/statics/searchelxt1e1.aspx?key=${encodeURIComponent(keyword)}`)
            // The paging parameter for this endpoint could not be observed from
            // behind the challenge, so report a single page rather than
            // re-serving page 1 every time the user scrolls.
            return { comics: this.parseList(doc), maxPage: 1 }
        },
        optionList: [],
    }

    comic = {
        loadInfo: async (id) => {
            const doc = await this.fetchDoc(`${this.baseUrl}/kanmanhua/${id}/`)

            // The cover is the first image served out of the thumbnail bucket;
            // its alt/title carries the clean series name.
            let cover = ""
            let title = ""
            for (const img of doc.querySelectorAll("img")) {
                const src = img.attributes["src"] ?? ""
                if (src.includes("mh160xiaotuku")) {
                    cover = src
                    title = (img.attributes["alt"] ?? img.attributes["title"] ?? "").trim()
                    break
                }
            }
            if (!title) {
                title = doc.querySelector(".works-name")?.text?.trim() ?? id
            }

            let author = ""
            let status = ""
            for (const p of doc.querySelectorAll("p.works-info-tc")) {
                const text = p.text ?? ""
                author = author || (/作者[:：]?\s*([^\s]+)/.exec(text)?.[1] ?? "")
                status = status || (/状态[:：]?\s*([^\s]+)/.exec(text)?.[1] ?? "")
            }

            // Map, not a plain object: chapter ids are numeric strings and an
            // object would silently re-sort them into numeric order.
            const chapters = new Map()
            for (const a of doc.querySelectorAll("#mh-chapter-list-ol-0 li a")) {
                const href = a.attributes["href"] ?? ""
                const match = /\/kanmanhua\/[^\/]+\/(\d+)\.html/.exec(href)
                if (!match) continue
                const name = (a.querySelector("p")?.text ?? a.text ?? "").trim()
                if (!chapters.has(match[1])) {
                    chapters.set(match[1], name || match[1])
                }
            }

            const tags = {}
            if (author) tags["作者"] = [author]
            if (status) tags["状态"] = [status]

            return new ComicDetails({
                title: title,
                cover: cover,
                description: doc.querySelector("#workint")?.text?.trim(),
                tags: tags,
                chapters: chapters,
                url: `${this.baseUrl}/kanmanhua/${id}/`,
            })
        },

        loadEp: async (comicId, epId) => {
            const res = await Network.get(`${this.baseUrl}/kanmanhua/${comicId}/${epId}.html`, this.headers)
            if (res.status !== 200) {
                throw `Invalid status code: ${res.status}`
            }
            const html = res.body

            const payload = /qTcms_S_m_murl_e="([^"]*)"/.exec(html)?.[1]
            if (!payload) {
                throw "Failed to locate image payload (qTcms_S_m_murl_e)"
            }
            const decoded = Convert.decodeUtf8(Convert.decodeBase64(payload))

            const pid = parseInt(/qTcms_S_p_id="(\d+)"/.exec(html)?.[1] ?? "0")
            const host = pid > 542724
                ? this.picHosts[Math.floor(Math.random() * this.picHosts.length)]
                : this.legacyPicHost

            const images = decoded
                .split("$qingtiandy$")
                .map(path => path.trim())
                .filter(path => path.length > 0)
                .map(path => path.startsWith("http") ? path : host + path)

            if (images.length === 0) {
                throw "No images found in chapter"
            }
            return { images: images }
        },

        // The image CDN 403s without a referer back to the site.
        onImageLoad: (url, comicId, epId) => {
            return {
                headers: {
                    "User-Agent": this.headers["User-Agent"],
                    "Referer": `${this.baseUrl}/`,
                }
            }
        },

        onThumbnailLoad: (url) => {
            return {
                headers: {
                    "User-Agent": this.headers["User-Agent"],
                    "Referer": `${this.baseUrl}/`,
                }
            }
        },

        enableTagsTranslate: false,
    }
}
