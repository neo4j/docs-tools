'use strict'

// Builds docsets.json, the flat per-docset listing behind the "All Neo4j documentation"
// modal in the UI bundle. Shared by the in-build stage (./index.js) and the post-publish
// S3 aggregator (./aggregate.js) so both produce the same file.
//
// Shape - one entry per Antora component, listing every version of it:
//   [{ name, title, group, versions: [{ version, latest, selectorText?, url, pdf? }] }]
// selectorText is what the page's version selector shows after the version, e.g. "(Current)"
// or "(LTS)"; it is absent for a docset that has not been built since it was added.
//
// Built from the aggregated tabs.json alone: each component's latest entry there carries
// docsetVersions (every version with its first page), and the pdf links are added here.

// Default output path, and the default for the tabbed-nav `docsetsFile` option.
const DOCSETS_FILE = 'nav/docsets.json'

// The first item with a url, recursing into children when an item has none of its own.
// External links are skipped: this is the docset's own first page.
function findFirstUrl (items) {
  if (!items || !items.length) return null
  for (const item of items) {
    if (item.url && item.urlType !== 'external') return item.url
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

// Entries ({ name, title, group, versions: [{ version, latest, url }] }) from an
// aggregated tabs.json. A component's latest entry lists all its versions in
// docsetVersions; tabs.json's own version keys (the latest, plus every version of docsets
// that set page-docset-version-group) fill in anything else, which is all there is for a component
// published before docsetVersions existed.
function entriesFromTabs (tabs) {
  const entries = new Map()
  for (const compMap of Object.values(tabs || {})) {
    for (const [name, versions] of Object.entries(compMap)) {
      if (!entries.has(name)) entries.set(name, { name, title: name, group: '', versions: [] })
      const entry = entries.get(name)
      for (const [version, data] of Object.entries(versions)) {
        if (entry.title === name && data.title) entry.title = data.title
        if (!entry.group && data.menuGroup) entry.group = data.menuGroup
        for (const v of data.docsetVersions || []) {
          if (!entry.versions.some((e) => e.version === v.version)) entry.versions.push({ ...v })
        }
        const existing = entry.versions.find((v) => v.version === version)
        if (!existing) {
          entry.versions.push({ version, latest: !!data.latest, url: findFirstUrl(data.items) })
        } else {
          if (data.latest) existing.latest = true
          if (!existing.url) existing.url = findFirstUrl(data.items)
        }
      }
    }
  }
  return Array.from(entries.values())
}

// Merges entries by component name, versions by version, and adds the pdf links.
// Later entries win over earlier ones (a version's url/latest are replaced; a group or
// title is only replaced by a non-empty one), so pass the lower-priority source first.
// pdfExists(component, version) -> boolean is called once per version; `pdf` is only set
// when it returns true.
function finalizeDocsets (entries, pdfExists = () => false) {
  const merged = new Map()
  for (const entry of entries) {
    if (!entry || !entry.name) continue
    if (!merged.has(entry.name)) {
      merged.set(entry.name, { title: entry.name, group: '', versions: new Map() })
    }
    const target = merged.get(entry.name)
    if (entry.title) target.title = entry.title
    if (entry.group) target.group = entry.group
    for (const v of entry.versions || []) {
      const version = v.version || ''
      const existing = target.versions.get(version)
      target.versions.set(version, {
        latest: !!v.latest,
        // keep a url the other source had if this one has none
        url: v.url || (existing && existing.url) || null,
        // the version selector's text for it; undefined when the docset predates the field
        selectorText: v.selectorText !== undefined ? v.selectorText : existing && existing.selectorText,
      })
    }
  }

  return Array.from(merged.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { title, group, versions }]) => ({
      name,
      title,
      // From the docset's page-docset-display-group attribute; empty when it doesn't set one.
      group,
      versions: Array.from(versions.entries())
        .map(([version, { latest, url, selectorText }]) => ({ version, latest, url, selectorText }))
        .sort(compareVersions)
        .map(({ version, latest, url, selectorText }) => ({
          version,
          latest,
          ...(selectorText !== undefined && { selectorText }),
          url,
          ...(pdfExists(name, version) && { pdf: pdfPublicUrl(name, version) }),
        })),
    }))
}

module.exports = {
  DOCSETS_FILE,
  entriesFromTabs,
  finalizeDocsets,
  findFirstUrl,
  pdfStoragePath,
  pdfPublicUrl,
}
