'use strict'

// Express sub-app for local docs dev servers.
//
// Returns an express.Router designed to be mounted at the docs URL prefix
// (typically `/docs`). It bundles three concerns:
//
//   1. Serves static files from <buildDir>. Antora's default output layout
//      (`build/site/<component>/<version>/...`) maps cleanly through the
//      mount prefix to URLs like `/docs/<component>/<version>/...`, so
//      docsets don't need to set `output.dir: ./build/site/docs` in their
//      playbooks just to make local dev work.
//   2. Serves `/<prefix>/local-manifest.json` listing components and their
//      version subdirs present under <buildDir>. The presence of this
//      endpoint is the implicit signal to the UI bundle that it's running
//      against a local build, and powers the tab "has local content" dot.
//   3. Handles HTML requests for pages that weren't built locally —
//      distinguishing a genuine 404 (component exists locally so the
//      missing page is a broken xref) from "not part of this build" (the
//      component wasn't built locally at all). The "not in this build"
//      page links to the same path on staging.
//
// Usage:
//   const docs = require('@neo4j-antora/tabbed-nav/middleware')
//   app.use('/docs', docs({
//     buildDir: './build/site',
//     docsUrl: 'https://neo4j.com/docs',
//   }))
//
// The `tabbed-nav-serve` bin from this package does exactly this for
// docsets that don't need a custom server.js.

const fs = require('fs')
const path = require('path')
const express = require('express')

// docsUrl is a factory parameter, not request input, but a plain loop sidesteps any
// question of regex backtracking cost entirely rather than relying on /\/+$/ being safe.
function stripTrailingSlashes (str) {
  let end = str.length
  while (end > 0 && str[end - 1] === '/') end--
  return str.slice(0, end)
}

// buildDir's directory structure is fixed for the lifetime of this process - it only
// changes when a new antora build runs, and the standard dev workflow (nodemon watching
// a rebuild, whose postbuild starts a fresh server) always restarts the process when
// that happens. So there's nothing to gain by re-scanning it on every request - one
// scan, shared by both handlers below, replaces what would otherwise be repeated
// synchronous fs calls per request (the actual substance behind the "missing
// rate-limiting" findings: request volume driving real per-request I/O cost). Not
// cached on failure, so a server started before the first build still picks it up
// once a request arrives after that build completes.
let cachedListing = null

function scanBuildDir (buildDir) {
  const components = {}
  const topLevelDirs = new Set()
  for (const compEntry of fs.readdirSync(buildDir, { withFileTypes: true })) {
    if (!compEntry.isDirectory()) continue
    topLevelDirs.add(compEntry.name)
    const compPath = path.join(buildDir, compEntry.name)
    const entries = fs.readdirSync(compPath, { withFileTypes: true })
    // Versioned component → has version subdirs and no .html at root.
    // Unversioned component → has .html files directly. Record '' for
    // unversioned so it matches the empty-string version key in tabs.json.
    const hasHtmlAtRoot = entries.some((e) => e.isFile() && e.name.endsWith('.html'))
    components[compEntry.name] = hasHtmlAtRoot
      ? ['']
      : entries.filter((e) => e.isDirectory()).map((e) => e.name)
  }
  return { components, topLevelDirs }
}

function getBuildDirListing (buildDir) {
  if (cachedListing) return cachedListing
  try {
    return (cachedListing = scanBuildDir(buildDir))
  } catch (e) {
    // <buildDir> doesn't exist yet (pre-first-build) - don't cache the failure.
    return { components: {}, topLevelDirs: new Set() }
  }
}

module.exports = function ({ buildDir, docsUrl, noLocalTabs, localNavOnly } = {}) {
  const resolvedBuildDir = path.resolve(buildDir || './build/site')
  const resolvedDocsUrl = stripTrailingSlashes(docsUrl || 'https://neo4j.com/docs')
  const suppressLocalTabs = !!noLocalTabs
  const localNavOnlyFlag = !!localNavOnly

  const router = express.Router()

  router.use(express.static(resolvedBuildDir))

  router.get('/local-manifest.json', (_req, res) => {
    if (suppressLocalTabs) return res.status(404).end()
    const { components } = getBuildDirListing(resolvedBuildDir)
    res.json({ components, localNavOnly: localNavOnlyFlag })
  })

  router.use((req, res, next) => {
    const ext = path.extname(req.path).toLowerCase()
    const isHtmlRequest = !ext || ext === '.html' || req.path.endsWith('/')
    if (!isHtmlRequest) return next()

    // req.path is relative to the mount point (no /docs prefix). The first
    // path segment is the component directory.
    const componentDir = (req.path.match(/^\/([^/]+)/) || [])[1]
    const componentBuilt = componentDir && getBuildDirListing(resolvedBuildDir).topLevelDirs.has(componentDir)

    if (componentBuilt) {
      res.status(404).send(renderPage({
        title: 'Page not found',
        headingColour: '#d33',
        reqPath: req.originalUrl,
        message: 'is referenced from the nav but the local build didn\'t generate it. Usually a broken xref, a typo in <code>content-nav.adoc</code>, or a removed page that wasn\'t taken out of the nav.',
      }))
    } else {
      // docsUrl is the docs root (e.g. https://neo4j.com/docs), and req.url
      // is the path relative to the docs prefix mount (no /docs), so the two
      // concatenate cleanly without string surgery on either side.
      res.status(200).send(renderPage({
        title: 'Requested page not part of local build',
        headingColour: '#018BFF',
        reqPath: req.originalUrl,
        message: 'isn\'t part of your local build. Local builds typically include only one or a few docsets; pages from other docsets appear in the nav (which is aggregated across the site) but aren\'t generated locally.',
        docsUrl: resolvedDocsUrl ? resolvedDocsUrl + req.url : null,
      }))
    }
  })

  return router
}

function renderPage ({ title, headingColour, reqPath, message, docsUrl }) {
  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const docsLink = docsUrl
    ? `<p><a href="${escape(docsUrl)}">View on the published docs</a></p>`
    : ''
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · Neo4j Docs</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 6rem auto; padding: 0 1.5rem; line-height: 1.6; color: #333; }
  h1 { color: ${headingColour}; font-size: 1.6rem; }
  code { background: #f4f4f4; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.95em; }
  a { color: #018BFF; }
  @media (prefers-color-scheme: dark) {
    body { color: #ddd; background: #1a1a1a; }
    code { background: #2a2a2a; }
  }
</style></head>
<body>
  <h1>${title}</h1>
  <p>The page <code>${escape(reqPath)}</code> ${message}</p>
  ${docsLink}
  <p><a href="#" onclick="history.back(); return false;">Go back</a></p>
</body></html>`
}
