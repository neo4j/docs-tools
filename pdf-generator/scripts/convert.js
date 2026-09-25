#!/usr/bin/env node
'use strict'

// Wraps the real asciidoctor-web-pdf binary as the assembler's build.command.
// Every path below is computed from this script's own location (__dirname) -
// never hardcoded, never dependent on where a consuming project's
// node_modules happens to hoist things - see this package's own README.

const { spawn } = require('node:child_process')
const path = require('node:path')

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
const STYLESHEET = path.join(__dirname, '../pdf-theme/print.css')
const ROLES_LABELS_POSTPROCESSOR = path.join(__dirname, '../vendor/extensions/roles-labels-postprocessor.js')
const TABLE_FOOTNOTES_POSTPROCESSOR = path.join(__dirname, '../vendor/extensions/table-footnotes-postprocessor.js')
const REMOTE_INCLUDE_ADAPTER = path.join(__dirname, '../vendor/extensions/remote-include-adapter.js')
const MACROS_ADAPTER = path.join(__dirname, '../vendor/extensions/macros-adapter.js')
const MATHJAX_ADAPTER = path.join(__dirname, '../vendor/extensions/mathjax-adapter.js')

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
  return !!resolveMathjaxSource()
}
function resolveMathjaxSource () {
  try {
    return require.resolve('@djencks/asciidoctor-mathjax')
  } catch {
    try {
      return require.resolve('@djencks/asciidoctor-mathjax', { paths: [process.cwd()] })
    } catch {
      return null
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
// roles-labels-postprocessor.js and table-footnotes-postprocessor.js port the
// essential parts of the Antora extensions of the same name (see those
// files); macros-adapter.js and remote-include-adapter.js wrap the real
// @neo4j-documentation packages - added here, __dirname-computed, for the
// same reason as the stylesheet above.
const extraArgs = [
  '-a', `stylesheet=${STYLESHEET}`,
  '--extension', ROLES_LABELS_POSTPROCESSOR,
  '--extension', TABLE_FOOTNOTES_POSTPROCESSOR,
  '--extension', REMOTE_INCLUDE_ADAPTER,
  '--extension', MACROS_ADAPTER,
]
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

readStdin().then((adoc) => {
  const child = spawn(RENDERER, finalArgs, {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...PUPPETEER_TIMEOUT_ENV, ...process.env },
  })
  child.on('error', (err) => {
    console.error(err)
    process.exit(1)
  })
  child.on('close', (status) => process.exit(status ?? 1))
  child.stdin.end(dedupeGlossary(adoc))
})
