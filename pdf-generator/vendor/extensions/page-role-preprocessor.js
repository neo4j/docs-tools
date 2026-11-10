'use strict'

// Carries a page's `:page-role:` (e.g. `:page-role: not-on-mvcc` in the document header)
// across to the PDF, where it becomes the label next to the page title, as on the real site.
//
// On the real site the page layout puts the page role on the page's <h1>, and
// @neo4j-antora/roles-labels turns an <h1> role into the label beside the title. The PDF
// pipeline never goes through that layout: @antora/assembler merges every page into one
// document, and plain Asciidoctor converts it. In that merged source a page's attributes
// are written as attribute entries in the block just before its title, with the page's own
// `:page-role:` first and `:page-url:` last, then the title preceded by an anchor line:
//
//   :page-role: not-on-mvcc
//   :page-docname: mvcc
//   ...
//   :page-url: /docs-tools/dev/mvcc/
//   [#mvcc]
//   == MVCC Label
//
// and the role is cleared again with `:!page-role:` after the page. An attribute entry never
// reaches the converted HTML, so nothing downstream can see it. This preprocessor reads the
// merged lines, finds the anchor line that follows `:page-url:` while a `:page-role:` is
// set, and adds the label roles to it (`[#mvcc]` becomes `[#mvcc.label--not-on-mvcc]`). The
// roles-labels postprocessor then turns that role on the title into the label, exactly as it
// does for a role written on a heading by hand.
//
// A page-role value that is not a label (for example a styling role) is left alone: only
// names roles-labels knows are added, resolved the same way processLabels resolves them
// (`label--x` as is, a label name as `label--<name>`, a synonym as is).
//
// Rewrites `reader._lines`, the reader's own storage of the remaining lines. It is stored
// reversed (next line last), and the public `lines` getter only returns a copy, so the lines
// cannot be changed through the public API, which also has no synchronous way to replace
// them (readLines() is async and a preprocessor must return the reader synchronously).
// Verified against Asciidoctor.js 4.1.

const { Preprocessor } = require('asciidoctor')
const rolesData = require('@neo4j-antora/roles-labels/data/roles.json')

const PAGE_ROLE = /^:page-role:\s*(.*?)\s*$/
const PAGE_ROLE_UNSET = /^:(?:!page-role|page-role!):\s*$/
const PAGE_URL = /^:page-url:/
const ANCHOR = /^\[#([^\].,\s]+)\]$/

// The role processLabels will turn into a label, or undefined if this value is not a label.
function labelRole (value) {
  if (value.startsWith('label--')) return value
  if (rolesData.labels[value]) return `label--${value}`
  if (rolesData.synonyms[value]) return value
}

function addPageRoles (lines) {
  let roles = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const set = PAGE_ROLE.exec(line)
    if (set) {
      roles = set[1].split(/\s+/).map(labelRole).filter(Boolean)
    } else if (PAGE_ROLE_UNSET.test(line)) {
      roles = []
    } else if (roles.length && PAGE_URL.test(line)) {
      const anchor = ANCHOR.exec(lines[i + 1] || '')
      if (anchor) lines[i + 1] = `[#${anchor[1]}${roles.map((role) => `.${role}`).join('')}]`
    }
  }
  return lines
}

class PageRolePreprocessor extends Preprocessor {
  process (document, reader) {
    const lines = reader.getLines()
    if (!lines.some((line) => PAGE_ROLE.test(line))) return reader
    const rewritten = addPageRoles(lines.slice())
    reader._lines.splice(0, reader._lines.length, ...rewritten.slice().reverse())
    return reader
  }
}

module.exports.addPageRoles = addPageRoles

module.exports.register = function (registry) {
  registry.preprocessor(PageRolePreprocessor)
}
