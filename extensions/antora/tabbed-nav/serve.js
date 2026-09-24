#!/usr/bin/env node
'use strict'

// tabbed-nav-serve: turnkey docs dev server.
//
// Replaces a docset's hand-rolled server.js. Wires up:
//   - express.static of <buildDir>, mounted at the docs URL prefix
//   - /local-manifest.json endpoint for the UI bundle's local-tabs feature
//   - friendly fallback pages for nav links into docsets not built locally
//   - root → /docs/ redirect
//
// Usage:
//   tabbed-nav-serve [--build-dir <path>] [--port <num>] [--docs-url <url>]
//                    [--docs-prefix <path>] [--no-local-tabs] [--local-nav-only]
//
// Defaults:
//   --build-dir       ./build/site
//   --port            8000          (or PORT env var)
//   --docs-url        https://neo4j.com/docs (or DOCS_URL env var)
//   --docs-prefix     /docs
//   --no-local-tabs   off — pass to suppress the UI bundle's local-tabs
//                     decoration (the dots on tabs that contain locally-built
//                     content + the href rewrite to the first local page).
//                     Causes the middleware to 404 /local-manifest.json so
//                     the client JS bails silently.
//   --local-nav-only  off — pass to filter the left-side nav to only show
//                     content from locally-built docsets. Cross-docset items
//                     in the fetched tabs.json are dropped client-side. Helps
//                     declutter previews when you only care about your own
//                     docset.
//
// Add to a docset's package.json:
//   "scripts": { "serve": "tabbed-nav-serve" }

const express = require('express')
const docsApp = require('./middleware')

const args = parseArgs(process.argv.slice(2))
const buildDir = args['build-dir'] || './build/site'
const port = parseInt(args.port || process.env.PORT || '8000', 10)
const docsUrl = args['docs-url'] || process.env.DOCS_URL || 'https://neo4j.com/docs'
const docsPrefix = (args['docs-prefix'] || '/docs').replace(/\/+$/, '') || '/docs'
const noLocalTabs = !!args['no-local-tabs']
const localNavOnly = !!args['local-nav-only']

const app = express()
app.use(docsPrefix, docsApp({ buildDir, docsUrl, noLocalTabs, localNavOnly }))
app.get('/', (_req, res) => res.redirect(docsPrefix + '/'))

app.listen(port, () => {
  console.log(`📘 http://localhost:${port}${docsPrefix}/`)
})

function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next != null && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}
