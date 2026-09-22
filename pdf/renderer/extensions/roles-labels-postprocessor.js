'use strict'

// Ports the essential part of @neo4j-antora/roles-labels for the PDF pipeline:
// turning a block-level `[role=label--x]` into a visible label badge, the
// same way roles-labels does for the real HTML site.
//
// roles-labels itself can't be reused directly here - it hooks Antora's own
// `pagesComposed` event and operates on files in an Antora ContentCatalog,
// which never exist in this pipeline: asciidoctor-web-pdf runs a completely
// separate, isolated Asciidoctor conversion on the assembler's merged .adoc
// text, so roles-labels never gets a chance to see - let alone transform -
// this content (see docs-tools/pdf/README). This is a Postprocessor instead
// (Asciidoctor's own extension point, run after conversion to HTML, before
// the PDF renderer sees it), reusing roles-labels' own label data
// (`@neo4j-antora/roles-labels/data/roles.json`) so label names/text stay in
// sync with the real site automatically.
//
// Deliberately scoped down from the original: no inline label:x[] handling
// (@neo4j-documentation/macros, already registered, handles that directly by
// emitting the span itself), no synonym resolution, no version-number/
// product suffix stripping (e.g. label--deprecated-5.26), no dataset
// attributes. Covers the common case - one or more plain `[role=label--x]`
// roles on a block or heading - not every roles-labels feature.

const { parse: parseHTML } = require('node-html-parser')
// Must come from the same package identity the running engine (loaded via
// `asciidoctor`, not `@asciidoctor/core` directly, by asciidoctor-web-pdf/
// the CLI) uses internally - requiring the class from a different copy of
// the module fails Registry's own instanceof-style check with "Invalid type
// for postprocessor extension" even though it's structurally identical.
const { Postprocessor } = require('asciidoctor')
const rolesData = require('@neo4j-antora/roles-labels/data/roles.json')

const HEADING_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']

function labelBadgeHtml (labelClass) {
  const labelInfo = rolesData.labels[labelClass]
  if (!labelInfo) return undefined
  const text = labelInfo.displayText || labelClass
  return `<span class="label content-label label--${labelClass}">${text}</span>`
}

class RolesLabelsPostprocessor extends Postprocessor {
  process (_document, output) {
    if (!output.includes('label--')) return output
    const root = parseHTML(output)
    root.querySelectorAll('[class*="label--"]').forEach((el) => {
      if (el.tagName === 'BODY') return
      const roles = el.classList.value.filter((c) => c.startsWith('label--'))
      if (!roles.length) return
      const badges = []
      roles.forEach((role) => {
        const badge = labelBadgeHtml(role.slice('label--'.length))
        if (badge) badges.push(badge)
        el.classList.remove(role)
      })
      if (!badges.length) return
      const labelsDiv = parseHTML(`<div class="labels">${badges.join('')}</div>`)
      if (HEADING_TAGS.includes(el.tagName)) {
        el.classList.add('header-label-container')
        el.appendChild(labelsDiv)
      } else {
        el.classList.add('has-label')
        el.prepend(labelsDiv)
      }
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(RolesLabelsPostprocessor)
}
