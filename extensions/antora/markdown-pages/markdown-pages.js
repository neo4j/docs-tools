'use strict'

const File = require('vinyl')
const { parse: parseHTML } = require('node-html-parser')
const TurndownService = require('turndown')
const { gfm } = require('turndown-plugin-gfm')

// ---------------------------------------------------------------------------
// HTML -> Markdown conversion (pure; exported for tests)
// ---------------------------------------------------------------------------

function hasClass (node, cls) {
  const c = node.getAttribute && node.getAttribute('class')
  return !!c && new RegExp('(^|\\s)' + cls + '(\\s|$)').test(c)
}

function admonitionKind (node) {
  const m = (node.getAttribute('class') || '').match(/admonitionblock\s+([a-z]+)/i)
  return (m ? m[1] : 'note').toUpperCase()
}

function cellsOf (tr) {
  return Array.from(tr.childNodes).filter((n) => n.nodeName === 'TD' || n.nodeName === 'TH')
}

// Convert an HTML table to Markdown. Neo4j/Asciidoctor tables are commonly headerless
// and key/value-shaped (label in column 1) with colspan and multi-paragraph cells —
// none of which GFM supports — so those render as key/value blocks; the rest as GFM.
function convertTable (node, td) {
  const rows = Array.from(node.querySelectorAll('tr'))
  if (!rows.length) return ''
  const caption = node.querySelector('caption')
  const capMd = caption && caption.textContent.trim() ? `**${caption.textContent.trim()}**\n\n` : ''

  const rowCells = rows.map(cellsOf)
  const hasHead = !!node.querySelector('thead') ||
    (rowCells[0] && rowCells[0].length > 0 && rowCells[0].every((c) => c.nodeName === 'TH'))
  const toMd = (cell) => td.turndown(cell.innerHTML || '').trim()

  // Clean headerless 2-column table -> key/value blocks (config specs etc.). Every row
  // must be exactly [label, value]; the single value cell keeps its full Markdown.
  if (!hasHead && rowCells.every((r) => r.length === 2)) {
    const parts = rowCells.map((r) => {
      const label = r[0] ? r[0].textContent.trim() : ''
      const value = r[1] ? toMd(r[1]) : ''
      return value ? `**${label}**\n\n${value}` : `**${label}**`
    })
    return '\n\n' + capMd + parts.join('\n\n') + '\n\n'
  }

  // Table with a real header row -> GFM (multi-line cells joined with <br>).
  if (hasHead) {
    const toInline = (cell) => toMd(cell)
      .split('\n').map((s) => s.trim()).filter(Boolean).join(' <br> ')
      .replace(/\|/g, '\\|')
    const width = Math.max(...rowCells.map((r) => r.length))
    const pad = (cells) => { const a = cells.slice(); while (a.length < width) a.push(' '); return a }
    const mkRow = (cells) => '| ' + pad(cells).join(' | ') + ' |'
    const sep = '| ' + Array(width).fill('---').join(' | ') + ' |'
    const headTr = node.querySelector('thead tr') || rows[0]
    const headerCells = cellsOf(headTr).map(toInline)
    const bodyRows = rows.filter((r) => r !== headTr).map((r) => cellsOf(r).map(toInline))
    return '\n\n' + capMd + [mkRow(headerCells), sep, ...bodyRows.map(mkRow)].join('\n') + '\n\n'
  }

  // Complex/irregular headerless table (embedded sub-grid, colspan, ragged rows):
  // GFM/key-value can't represent it faithfully, so keep the original HTML — valid
  // Markdown, and its structure (colspan, sub-columns) stays explicit for LLMs.
  return '\n\n' + node.outerHTML + '\n\n'
}

function createTurndown () {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
    emDelimiter: '_'
  })
  td.use(gfm)

  // Own the table conversion (overrides the gfm plugin, which keeps headerless tables
  // as raw HTML). Asciidoctor/Neo4j tables are usually headerless and key/value-shaped.
  td.addRule('tables', {
    filter: (node) => node.nodeName === 'TABLE',
    replacement: (_content, node) => convertTable(node, td)
  })

  // Drop heading self-link anchors (Antora adds <a class="anchor"> inside headings).
  td.addRule('stripHeadingAnchors', {
    filter: (node) => node.nodeName === 'A' && hasClass(node, 'anchor'),
    replacement: () => ''
  })

  // Fenced code block with language, discarding syntax-highlight span noise.
  td.addRule('fencedCodeBlock', {
    filter: (node) => node.nodeName === 'PRE' && !!node.querySelector && !!node.querySelector('code'),
    replacement: (_content, node) => {
      const code = node.querySelector('code')
      const lang = (code.getAttribute('data-lang') || '').trim()
      const text = code.textContent.replace(/\n+$/, '')
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`
    }
  })

  // Admonition (NOTE/TIP/IMPORTANT/WARNING/CAUTION) -> GitHub-style blockquote.
  td.addRule('admonition', {
    filter: (node) => node.nodeName === 'DIV' && hasClass(node, 'admonitionblock'),
    replacement: (_content, node) => {
      const kind = admonitionKind(node)
      const cell = node.querySelector('td.content') || node
      const inner = td.turndown(cell.innerHTML || '').trim()
      const quoted = inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n')
      return `\n\n> **${kind}**\n>\n${quoted}\n\n`
    }
  })

  return td
}

// Rewrite relative href/src to absolute so links are portable for LLMs.
function absolutize (root, baseUrl) {
  if (!baseUrl) return
  const fix = (el, attr) => {
    const val = el.getAttribute(attr)
    if (!val || /^[a-z][a-z0-9+.-]*:/i.test(val) || val.startsWith('#') || val.startsWith('//')) return
    try { el.setAttribute(attr, new URL(val, baseUrl).href) } catch (e) { /* leave as-is */ }
  }
  root.querySelectorAll('a').forEach((el) => fix(el, 'href'))
  root.querySelectorAll('img').forEach((el) => fix(el, 'src'))
}

// Convert a composed page's HTML (or a bare article fragment) to Markdown.
// Selects the `article.doc` content node when present, so page chrome is excluded.
function htmlToMarkdown (html, { baseUrl = '', title = '' } = {}) {
  const root = parseHTML(html)
  const article = root.querySelector('article.doc') || root
  absolutize(article, baseUrl)
  let md = createTurndown().turndown(article.toString()).trim()
  const firstLine = md.split('\n', 1)[0] || ''
  if (title && !/^#\s/.test(firstLine)) md = `# ${title}\n\n${md}`
  return md
}

// ---------------------------------------------------------------------------
// Output path + frontmatter helpers
// ---------------------------------------------------------------------------

// Mirror the HTML output path, swapping the extension: the .md sits right beside
// the .html (x/y/index.html -> x/y/index.md ; a/b/c.html -> a/b/c.md).
function mdOutPath (p) {
  return p.replace(/\.html$/, '.md')
}

function joinUrl (siteUrl, pubUrl) {
  if (!siteUrl || !pubUrl) return pubUrl || ''
  return siteUrl.replace(/\/+$/, '') + pubUrl
}

function frontmatter (title, url) {
  const esc = (s) => String(s == null ? '' : s).replace(/"/g, '\\"')
  const lines = ['---', `title: "${esc(title)}"`]
  if (url) lines.push(`url: "${esc(url)}"`)
  lines.push('---', '', '')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Antora extension entry point
// ---------------------------------------------------------------------------

module.exports.register = function ({ config = {} }) {
  const logger = this.getLogger('markdown-pages')
  const withFrontmatter = config.frontmatter !== false
  const absoluteLinks = config.absoluteLinks !== false

  this.on('pagesComposed', () => {
    const { contentCatalog, siteCatalog, playbook } = this.getVariables()
    const siteUrl = (playbook && playbook.site && playbook.site.url) || ''
    let n = 0

    for (const file of contentCatalog.getFiles()) {
      // Publishable pages that originated from AsciiDoc only.
      if (!file.out || !file.asciidoc) continue
      const html = file.contents.toString()
      if (!/article/i.test(html)) continue

      const title = file.asciidoc.doctitle || (file.src && file.src.stem) || ''
      const pageUrl = joinUrl(siteUrl, file.pub && file.pub.url)
      const baseUrl = absoluteLinks ? pageUrl : ''

      let md
      try {
        md = htmlToMarkdown(html, { baseUrl, title })
      } catch (err) {
        logger.warn({ file: file.out.path }, `conversion failed: ${err.message}`)
        continue
      }

      const body = (withFrontmatter ? frontmatter(title, pageUrl) : '') + md + '\n'
      siteCatalog.addFile(new File({ contents: Buffer.from(body), out: { path: mdOutPath(file.out.path) } }))
      n++
    }

    logger.info({}, `generated ${n} Markdown page(s)`)
  })
}

// Exported for unit tests.
module.exports.htmlToMarkdown = htmlToMarkdown
module.exports.mdOutPath = mdOutPath
module.exports.joinUrl = joinUrl
