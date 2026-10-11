#!/usr/bin/env node
'use strict'

// Wraps the real asciidoctor-web-pdf binary as the assembler's build.command.
// Every path below is computed from this script's own location (__dirname) -
// never hardcoded, never dependent on where a consuming project's
// node_modules happens to hoist things - see this package's own README.

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// asciidoctor-pdf needs @asciidoctor/core 4.x while Antora needs 2.x, and it
// doesn't declare @asciidoctor/core as its own dependency (only a peerDep on
// the `asciidoctor` wrapper) - npm has no signal to ever nest an isolated
// copy for it, so a normal dependency install can silently hoist Antora's
// 2.x copy in instead, which crashes at import time. `vendor/` is a real,
// pre-installed node_modules tree (asciidoctor + asciidoctor-pdf and their
// own transitive deps only) shipped as plain files with this package - not
// npm dependencies at all from a consumer's point of view - so it's immune
// to whatever else a docset's own install needs. The postprocessor/adapter
// extensions live inside vendor/ too, so their own `require('asciidoctor')`
// resolves the same isolated copy the renderer itself uses (required for
// `Postprocessor` - see roles-labels-postprocessor.js's own comment); their
// other requires (`node-html-parser`, `@neo4j-antora/roles-labels`, ...) fall
// through vendor/'s node_modules to the consumer's normal install, since
// those have no such conflict and should stay deduped normally.
const RENDERER = path.join(__dirname, '../vendor/node_modules/asciidoctor-pdf/bin/asciidoctor-web-pdf')
const PRINT_CSS = path.join(__dirname, '../pdf-theme/print.css')
const ROLES_LABELS_POSTPROCESSOR = path.join(__dirname, '../vendor/extensions/roles-labels-postprocessor.js')
const REMOTE_INCLUDE_ADAPTER = path.join(__dirname, '../vendor/extensions/remote-include-adapter.js')
const MACROS_ADAPTER = path.join(__dirname, '../vendor/extensions/macros-adapter.js')
const MATHJAX_ADAPTER = path.join(__dirname, '../vendor/extensions/mathjax-adapter.js')
const COLOPHON_POSTPROCESSOR = path.join(__dirname, '../vendor/extensions/colophon-postprocessor.js')
const ABSOLUTE_LINKS_POSTPROCESSOR = path.join(__dirname, '../vendor/extensions/absolute-links-postprocessor.js')
const DOC_WRAPPER_POSTPROCESSOR = path.join(__dirname, '../vendor/extensions/doc-wrapper-postprocessor.js')
const CYPHER_LANGUAGE_ADAPTER = path.join(__dirname, '../vendor/extensions/cypher-language-adapter.js')

// Unlike the extensions above, `@djencks/asciidoctor-mathjax` isn't a
// dependency of this package - it's an opt-in feature a docset adds itself
// (alongside registering it in its own preview.yml, for the live HTML site)
// only if it actually uses `stem`/`latexmath` blocks. Registering it here
// only when the docset's own install actually has it keeps every other
// docset's PDF build unaffected (no extra dependency, nothing to fail).
//
// A plain `require.resolve` walks up from *this file's own real location*
// (Node dereferences symlinks before resolving), which is this package's
// own install under the docset's node_modules in the normal case - fine.
// But under `npm link` (this package developed as a local checkout,
// symlinked into a docset for testing), that real location is somewhere
// else entirely, so the docset's own node_modules is never on the search
// path and this always reports unavailable even when the docset has the
// package. Falling back to a resolve rooted at the working directory
// (antora's own cwd is always the docset being built) covers that case
// too, without changing anything for a normal, non-linked install.
function mathjaxAvailable () {
  try {
    require.resolve('@djencks/asciidoctor-mathjax')
    return true
  } catch {
    try {
      require.resolve('@djencks/asciidoctor-mathjax', { paths: [process.cwd()] })
      return true
    } catch {
      return false
    }
  }
}

const PAGE_BOUNDARY_RX = /(?=^:page-docname: .*$)/m
const GLOSSARY_MARKER_RX = /^\[discrete\.glossary#.*\]$/m

// Some docsets (e.g. docs-http-api) repeat a glossary include on several
// source pages, meant to be excluded from PDF via ifndef::backend-pdf[],
// which doesn't evaluate correctly under this pipeline (see this package's
// own README - the assembler resolves that attribute against its own
// internal re-parse context, not the real, final PDF conversion). This is a
// no-op for any docset with no `[discrete.glossary#...]` marker in its
// merged source.
function dedupeGlossary (adoc) {
  const [preamble, ...pages] = adoc.split(PAGE_BOUNDARY_RX)
  let glossaryChunk
  const strippedPages = pages.map((page) => {
    const match = GLOSSARY_MARKER_RX.exec(page)
    if (!match) return page
    if (!glossaryChunk) {
      // Drop the "discrete" style so the glossary becomes a normal chapter
      // section: included in the TOC and picked up by the print theme's
      // `.sect1 { break-before: page }` rule like every other chapter.
      glossaryChunk = page
        .slice(match.index)
        .trimEnd()
        .replace(/^\[discrete\.glossary/, '[glossary')
    }
    // Keep a blank line before whatever follows (the next page's own
    // `:page-docname:` metadata block, mid-document) - an undelimited
    // single-paragraph admonition like [NOTE] only ends at a blank line, so
    // trimming it away merges the next page's raw attribute lines straight
    // into that paragraph's text instead of stopping it.
    return page.slice(0, match.index).trimEnd() + '\n\n'
  })
  let result = preamble + strippedPages.join('')
  if (glossaryChunk) result = result.trimEnd() + '\n\n' + glossaryChunk + '\n'
  return result
}

// Every PDF this pipeline produces gets the same closing License page appended -
// not a per-docset opt-in, the same way the old Gradle pipeline's build.gradle
// unconditionally appended its own copy of this page to every book's pdfNav.
// Vendored here (rather than read from a consuming docset's own content, the
// way a couple of repos still happen to carry a copy of this exact page at
// modules/ROOT/pages/license.adoc left over from that old pipeline, unused by
// their nav and therefore invisible to this one) so every docset gets it
// identically regardless of what that docset's own content tree does or
// doesn't contain. `[discrete]` keeps it out of the book's own table of
// contents, same as a real book's colophon page; the heading is still a
// level-1 (`==`) heading, matching every other chapter this pipeline merges
// in, so it inherits the same typography - only the page-break-before (since a
// discrete heading, unlike a real chapter, isn't wrapped in its own `.sect1`)
// needs a dedicated rule in print.css.
const LICENSE_PAGE = fs.readFileSync(path.join(__dirname, '../pages/license.adoc'), 'utf8')

// Fetched fresh at build time rather than vendored, so it can never drift from what
// the live site actually looks like (see the print theme's own top comment for why
// this pipeline reuses it at all) - the tradeoff is a new network dependency at build
// time, consistent with this pipeline's existing ones (npm installs, the HTML build's
// own UI bundle fetch). Same base DOCS_PUBLISH_URL as absolute-links-postprocessor.js's
// own rewrite prefix (see linkPrefix() below), so this always matches whichever
// environment's real site this PDF is standing in for - dev sandbox vs prod have
// completely different site.css content (different nav, different feature flags), not
// just a different URL for the "same" file.
async function fetchRealSiteCss () {
  const base = (process.env.DOCS_PUBLISH_URL || 'https://neo4j.com/docs').replace(/\/$/, '')
  const url = `${base}/assets/css/site.css`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

// The real site's own body copy and headings are all set in Public Sans (see real
// site.css's own font-family rules) - but, unlike Roboto Mono (vendored as local font
// files - see print.css's own @font-face rules) or every other font real site.css
// references (Roboto Mono, FontAwesome, Syne Neo - all declared via their own @font-face
// with real font file URLs), Public Sans is never declared in site.css at all. The real
// HTML page loads it from a separate <link> Antora's own template adds to <head>
// (fonts.googleapis.com/css2?family=Public+Sans...), which this pipeline has no
// equivalent of - nothing here ever fetches that second stylesheet, so Public Sans was
// never actually available to any PDF this pipeline has built with real site.css, and
// every reference to it silently fell through to its own fallback stack (Helvetica/
// Arial), rendered at real site.css's own `font-weight:300` body default - reported
// directly as "we seem to have lost the main font" / "text is just thin" (a generic
// sans-serif has no true light weight to fall back to the way Public Sans does, so the
// renderer fakes a thinner line weight instead).
async function fetchGoogleFontCss () {
  const url = 'https://fonts.googleapis.com/css2?family=Public+Sans:wght@300;400;500;600;700&display=swap'
  const res = await fetch(url, {
    headers: {
      // Google's font CSS endpoint serves different @font-face formats depending on
      // the requesting User-Agent (old EOT/TTF for legacy browsers, WOFF2 otherwise) -
      // the default fetch() UA here reads as neither to Google, and gets served a
      // very old format Chromium (what this renderer actually uses) has no use for. A
      // plain desktop Chrome UA string is enough to get the modern WOFF2 response.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

// Written into print.css's own directory, not a generic temp dir - print.css's own
// font/logo `url(...)` references are relative to wherever the stylesheet file itself
// ends up (see its own top comment), so moving the combined file elsewhere would break
// them. Real site.css's own url()s are already absolute (served from a CDN), so they're
// unaffected either way. Named per-process so two concurrent builds sharing this same
// install (unusual, but not impossible) can't clobber each other's file mid-write.
async function buildStylesheet () {
  const ownCss = fs.readFileSync(PRINT_CSS, 'utf8')
  let realCss
  try {
    realCss = await fetchRealSiteCss()
  } catch (err) {
    // A docset's own content is still perfectly buildable without the real site's
    // styling - degrade to this package's own (much thinner) print-only rules rather
    // than failing the whole PDF over a transient network blip, the same tradeoff
    // in-document `link:` targets failing to resolve would get in a live HTML build.
    console.error(`::warning::Could not fetch the real site.css (${err.message}) - falling back to this package's own print-only styles, which cover far less (no admonition/label/table/example colors, etc.)`)
    realCss = ''
  }
  let fontCss = ''
  try {
    fontCss = await fetchGoogleFontCss()
  } catch (err) {
    // Same degrade-gracefully tradeoff as site.css above - Public Sans not loading
    // falls back to real site.css's own fallback stack (Helvetica/Arial), not a broken
    // build.
    console.error(`::warning::Could not fetch the Public Sans font CSS (${err.message}) - falling back to real site.css's own fallback font stack`)
  }
  const combined = realCss
    ? `/* ---- Public Sans (fetched at build time - see fetchGoogleFontCss's own comment) ---- */\n${fontCss}\n\n/* ---- real site.css (fetched at build time) ---- */\n${realCss}\n\n/* ---- print.css (paged-media overrides) ---- */\n${ownCss}`
    : ownCss
  const outPath = path.join(path.dirname(PRINT_CSS), `.combined-stylesheet.${process.pid}.css`)
  fs.writeFileSync(outPath, combined)
  return outPath
}

function readStdin () {
  const chunks = []
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

// asciidoctor-web-pdf only reads these from the environment (no -a attribute or
// CLI flag equivalent - see lib/browser.js) and defaults to 30s, which a large
// docset can easily exceed. Give it more headroom here rather than relying on
// whoever runs the build to remember to export these.
const PUPPETEER_TIMEOUT_ENV = {
  PUPPETEER_NAVIGATION_TIMEOUT: '180000',
  PUPPETEER_RENDERING_TIMEOUT: '180000',
}

// antora-assembler-pdf.yml deliberately does NOT set a `stylesheet` attribute
// itself - it's added here instead, __dirname-computed, so the path is always
// correct wherever this package happens to be installed. CSS url()s resolve
// relative to the stylesheet's own location, but Asciidoctor's `stylesheet`
// attribute resolves relative to docdir/cwd - a different base entirely - so
// this can't just be a relative value in the playbook/assembler config.
const args = process.argv.slice(2)
const stdinMarkerIdx = args.lastIndexOf('-')
// reusable-docs-pdf-build.yml sets DOCS_PUBLISH_URL as this job's own env - the
// exact same value reusable-docs-build.yml's own HTML build resolves (dev
// sandbox vs prod) - which reaches this child process for free (plain env var
// inheritance), rather than needing to round-trip it through Antora's own CLI
// args: Antora's top-level command has no generic attribute-override flag the
// way plain asciidoctor does, so there's no "-a" to read it back out of here.
//
// A root-relative href (from neo4j-docs-base-uri - see
// absolute-links-postprocessor.js's own comment) always starts with the literal
// "/docs" - true site-root-relative on production, where DOCS_PUBLISH_URL's own
// path is just "/docs", but not on a sandbox/dev deployment, whose
// DOCS_PUBLISH_URL has a longer path that merely *ends* in that same "/docs"
// segment (e.g. ".../sandbox/restructure/docs"). Stripping that one trailing
// segment before prepending gives the prefix that's correct in both cases - the
// href's own "/docs" fills back in whichever one was removed:
//   prod:    https://neo4j.com/docs                           -> https://neo4j.com
//   sandbox: https://development.neo4j.dev/docs/sandbox/restructure/docs
//            -> https://development.neo4j.dev/docs/sandbox/restructure
function linkPrefix () {
  if (!process.env.DOCS_PUBLISH_URL) return null
  try {
    const url = new URL(process.env.DOCS_PUBLISH_URL)
    return url.origin + url.pathname.replace(/\/docs\/?$/, '')
  } catch {
    return null
  }
}
// roles-labels-postprocessor.js, colophon-postprocessor.js and
// doc-wrapper-postprocessor.js port/add behavior of their own (see those
// files); macros-adapter.js and remote-include-adapter.js wrap the real
// @neo4j-documentation packages - added here, __dirname-computed, for the
// same reason as the stylesheet above. (table-footnotes has no equivalent
// here: CSS `float: footnote` - see the print theme's own comment - already
// places a footnote on whatever page its table lands on, natively, so
// there's nothing for a postprocessor to move.)
Promise.all([buildStylesheet(), readStdin()]).then(([stylesheet, adoc]) => {
  const extraArgs = [
    '-a', `stylesheet=${stylesheet}`,
    // Without this, asciidoctor-web-pdf never actually colors a code block -
    // Antora's own template still adds class="language-x hljs" to every <code>
    // regardless, since that's also the hook the real HTML site's client-side
    // highlight.js looks for, but nothing in a static PDF ever runs that script.
    // asciidoctor-web-pdf bundles its own server-side highlight.js adapter
    // (registered under this exact name - see its own syntax-highlighter.js)
    // that runs highlight.js in Node during conversion instead, embedding real
    // colored spans directly in the HTML before Vivliostyle ever sees it - this
    // pipeline has never turned it on, so no PDF it has ever produced has had
    // real syntax highlighting, confirmed directly: plain monochrome code in
    // every rebuild tried, with or without this package's own recent changes.
    // Token *colors* (the `.hljs-*` rules) come from the real site.css in the
    // combined stylesheet above, not this adapter's own bundled default theme.
    '-a', 'source-highlighter=highlightjs',
    // Must load before any document content is actually highlighted (asciidoctor-web-pdf
    // loads every `--extension` up front, before conversion starts, so position in this
    // list doesn't matter beyond that) - see cypher-language-adapter.js's own comment.
    '--extension', CYPHER_LANGUAGE_ADAPTER,
    '--extension', ROLES_LABELS_POSTPROCESSOR,
    '--extension', REMOTE_INCLUDE_ADAPTER,
    '--extension', MACROS_ADAPTER,
    '--extension', COLOPHON_POSTPROCESSOR,
    '--extension', ABSOLUTE_LINKS_POSTPROCESSOR,
    '--extension', DOC_WRAPPER_POSTPROCESSOR,
  ]
  const prefix = linkPrefix()
  if (prefix) extraArgs.push('-a', `absolute-link-prefix=${prefix}`)
  if (mathjaxAvailable()) extraArgs.push('--extension', MATHJAX_ADAPTER)
  // Reading from stdin (this is piped the merged .adoc, not a real file - see
  // below), asciidoctor-web-pdf invents a fictive input path rooted at
  // `--base-dir`/`-B` if given, else its own cwd (lib/cli.js's
  // _convertFromStdin), and writes its temporary intermediate HTML file next
  // to THAT path (lib/converter.js's getTemporaryHtmlFile), not next to the
  // real docdir the assembler passes via `-a docdir=...`. Without `-B`, that
  // temp HTML ends up sitting in whatever directory this script itself was
  // invoked from (the docset's own root, since that's antora's cwd) - one or
  // more levels away from `-a docdir`/`-a imagesoutdir`. Every image target,
  // resolved correctly as relative to the real docdir (e.g. `../_images/
  // foo.png`), then resolves relative to the WRONG directory when the
  // browser loads that temp HTML via file://, so every image in the PDF is
  // silently broken. Passing the same docdir here as `-B` puts the temp HTML
  // file where the image paths actually expect it to be.
  const docdirIdx = args.findIndex((arg) => arg.startsWith('docdir='))
  if (docdirIdx > 0 && args[docdirIdx - 1] === '-a') {
    extraArgs.push('-B', args[docdirIdx].slice('docdir='.length))
  }
  const finalArgs =
    stdinMarkerIdx === -1
      ? [...args, ...extraArgs]
      : [...args.slice(0, stdinMarkerIdx), ...extraArgs, ...args.slice(stdinMarkerIdx)]

  const child = spawn(RENDERER, finalArgs, {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...PUPPETEER_TIMEOUT_ENV, ...process.env },
  })
  child.on('error', (err) => {
    console.error(err)
    process.exit(1)
  })
  child.on('close', (status) => {
    fs.rmSync(stylesheet, { force: true })
    process.exit(status ?? 1)
  })
  child.stdin.end(dedupeGlossary(adoc).trimEnd() + '\n\n' + LICENSE_PAGE)
})
