'use strict'

// On the real site, `[.tabbed-example]` wraps several `[.include-with-<name>]` example
// blocks, and client-side JS (site.js) moves them into an actual clickable tab widget,
// deriving each tab's own visible button text from its `include-with-<name>` role - e.g.
// `include-with-procedure-integration-tests` becomes the tab labelled "Procedure
// integration tests". None of that JS ever runs in a static PDF, so without this
// postprocessor, every `[.include-with-X]` alternative just renders as a plain, unlabelled
// box, stacked one after another with no indication these are alternatives at all, let
// alone which is which - reported directly: multiple near-identical Java test examples
// shown back to back with nothing to tell them apart.
//
// This runs as a Postprocessor (after HTML conversion, same point roles-labels-
// postprocessor.js and absolute-links-postprocessor.js already operate at) rather than
// manipulating the Asciidoctor document tree before conversion - simpler to reuse
// node-html-parser's own CSS-selector-based DOM API than Asciidoctor's own block-title
// API, and this pipeline already depends on node-html-parser for exactly this purpose
// (see roles-labels-postprocessor.js).
//
// Label text derivation ported directly from the real site's own site.js (the exact
// function that builds each tab's clickable button text) - confirmed directly by fetching
// and reading it: replace hyphens with spaces, capitalize only the first letter (not
// title-case), with a handful of names special-cased to match a real human label
// (`csharp`/`dotnet` -> "C#", `javascript` -> "JavaScript", `macos` -> "macOS"). The real
// function also handles version-number segments (e.g. a `neo4j-5-20`-style role becoming
// "Neo4j 5.20") - not ported here, since no content in this pipeline's docsets uses that
// pattern; add it if one ever does.
const { Postprocessor } = require('asciidoctor')
const { parse: parseHTML } = require('node-html-parser')

const SPECIAL_LABELS = {
  csharp: 'C#',
  dotnet: 'C#',
  javascript: 'JavaScript',
  macos: 'macOS',
}

function deriveLabel (roleName) {
  if (roleName in SPECIAL_LABELS) return SPECIAL_LABELS[roleName]
  const spaced = roleName.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

class TabbedExamplePostprocessor extends Postprocessor {
  process (_document, output) {
    if (!output.includes('tabbed-example')) return output
    const root = parseHTML(output)
    root.querySelectorAll('.exampleblock.tabbed-example').forEach((wrapper) => {
      wrapper.querySelectorAll(':scope > .content > .exampleblock').forEach((variant) => {
        const roleClass = variant.classList.value.find((cls) => cls.startsWith('include-with-'))
        if (!roleClass) return
        const label = deriveLabel(roleClass.slice('include-with-'.length))
        const content = variant.querySelector(':scope > .content')
        ;(content || variant).insertAdjacentHTML(
          'afterbegin',
          `<div class="title tabbed-example-label">${label}</div>`
        )
      })
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(TabbedExamplePostprocessor)
}
