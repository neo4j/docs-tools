'use strict'

// Builds docsets.json, the flat per-docset listing behind the "All Neo4j documentation"
// modal in the UI bundle, from an aggregated tabs.json. Shared by the in-build stage
// (./index.js) and the post-publish S3 aggregator (./aggregate.js) so both produce the
// same file.
//
// Shape - one entry per Antora component, merged across tabs:
//   [{ name, title, group, versions: [{ version, latest, url, pdf? }] }]

// Default output path, and the default for the tabbed-nav `docsetsFile` option.
const DOCSETS_FILE = 'nav/docsets.json'

// The first item with a url, recursing into children when an item has none of its own.
function findFirstUrl (items) {
  if (!items || !items.length) return null
  for (const item of items) {
    if (item.url) return item.url
    const deeper = findFirstUrl(item.items)
    if (deeper) return deeper
  }
  return null
}

// Where the PDF for a docset version is stored, relative to the site root / publish
// prefix: <component>/<version>/_exports/neo4j-<component>-<version>.pdf. The version
// segment is omitted for an unversioned docset.
function pdfStoragePath (component, version) {
  return [component, version, '_exports', pdfFilename(component, version)].filter(Boolean).join('/')
}

// The public URL drops _exports (a server proxy rule maps it back to the stored file).
function pdfPublicUrl (component, version) {
  return '/' + [component, version, pdfFilename(component, version)].filter(Boolean).join('/')
}

function pdfFilename (component, version) {
  return `neo4j-${component}${version ? '-' + version : ''}.pdf`
}

// Latest first, then the rest newest-looking first.
function compareVersions (a, b) {
  if (a.latest !== b.latest) return a.latest ? -1 : 1
  return b.version.localeCompare(a.version, undefined, { numeric: true })
}

// tabs: the aggregated tabs.json object ({ tab: { component: { version: { title, latest, items } } } }).
// pdfExists(component, version) -> boolean: whether a PDF is present for that docset version.
// Called once per version; `pdf` is only set when it returns true.
function buildDocsets (tabs, pdfExists = () => false) {
  const components = new Map()
  for (const compMap of Object.values(tabs || {})) {
    for (const [name, versions] of Object.entries(compMap)) {
      if (!components.has(name)) components.set(name, { title: name, group: '', versions: new Map() })
      const entry = components.get(name)
      for (const [version, data] of Object.entries(versions)) {
        // A component can appear under several tabs; the first title wins, and a later
        // tab backfills a url the first one (often a provisional entry) lacked.
        if (entry.title === name && data.title) entry.title = data.title
        if (!entry.group && data.menuGroup) entry.group = data.menuGroup
        const existing = entry.versions.get(version)
        if (!existing) {
          entry.versions.set(version, { latest: !!data.latest, url: findFirstUrl(data.items) })
        } else {
          if (data.latest) existing.latest = true
          if (!existing.url) existing.url = findFirstUrl(data.items)
        }
      }
    }
  }

  return Array.from(components.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { title, group, versions }]) => ({
      name,
      title,
      // From the docset's page-docset-group attribute; empty when it doesn't set one.
      group,
      versions: Array.from(versions.entries())
        .map(([version, { latest, url }]) => ({ version, latest, url }))
        .sort(compareVersions)
        .map(({ version, latest, url }) => ({
          version,
          latest,
          url,
          ...(pdfExists(name, version) && { pdf: pdfPublicUrl(name, version) }),
        })),
    }))
}

module.exports = { DOCSETS_FILE, buildDocsets, pdfStoragePath, pdfPublicUrl }
