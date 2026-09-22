#!/usr/bin/env node
'use strict'

// Wraps the real asciidoctor-web-pdf binary as the assembler's build.command,
// shared by every docset via reusable-pdf-build.yml (docs-tools checked out
// into each repo's build). Every path below is computed from this script's
// own location (__dirname), never hardcoded and never dependent on where in
// a repo's checkout docs-tools lands - see docs-tools/pdf/README.

const { spawn } = require('node:child_process')
const path = require('node:path')

const RENDERER = path.join(__dirname, '../renderer/node_modules/.bin/asciidoctor-web-pdf')
const STYLESHEET = path.join(__dirname, '../pdf-theme/print.css')

const PAGE_BOUNDARY_RX = /(?=^:page-docname: .*$)/m
const GLOSSARY_MARKER_RX = /^\[discrete\.glossary#.*\]$/m

// Some docsets (e.g. docs-http-api) repeat a glossary include on several
// source pages, meant to be excluded from PDF via ifndef::backend-pdf[],
// which doesn't evaluate correctly under this pipeline (see docs-tools/pdf/
// README - the assembler resolves that attribute against its own internal
// re-parse context, not the real, final PDF conversion). This is a no-op for
// any docset with no `[discrete.glossary#...]` marker in its merged source.
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
// correct wherever docs-tools happens to be checked out. CSS url()s resolve
// relative to the stylesheet's own location, but Asciidoctor's `stylesheet`
// attribute resolves relative to docdir/cwd - a different base entirely - so
// this can't just be a relative value in the playbook/assembler config.
const args = process.argv.slice(2)
const stdinMarkerIdx = args.lastIndexOf('-')
const extraArgs = ['-a', `stylesheet=${STYLESHEET}`]
const finalArgs =
  stdinMarkerIdx === -1
    ? [...args, ...extraArgs]
    : [...args.slice(0, stdinMarkerIdx), ...extraArgs, ...args.slice(stdinMarkerIdx)]

readStdin().then((adoc) => {
  const child = spawn(RENDERER, finalArgs, {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...PUPPETEER_TIMEOUT_ENV, ...process.env },
    // asciidoctor-web-pdf's --extension resolves bare package names against
    // cwd/node_modules before its own install location (see requireLibrary in
    // asciidoctor/lib/cli.js). Without this, it inherits the assembler's cwd
    // (the calling docset's own repo root) and picks up whatever unpatched
    // @neo4j-documentation/macros that repo installed for Antora's own HTML
    // build, instead of the patched copy in renderer/node_modules here.
    cwd: path.join(__dirname, '../renderer'),
  })
  child.on('error', (err) => {
    console.error(err)
    process.exit(1)
  })
  child.on('close', (status) => process.exit(status ?? 1))
  child.stdin.end(dedupeGlossary(adoc))
})
