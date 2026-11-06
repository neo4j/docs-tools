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
// Beyond labelling each alternative in place, this also inserts a short numbered list of
// internal links at the top of the group (where the HTML tab-switcher buttons would have
// been), one per alternative, each jumping down to that alternative's own section - the
// label alone says "you are now reading the X alternative", but doesn't tell a reader
// browsing linearly, before reaching the group, that several alternatives of the same
// thing are coming up and what they are; the list makes that grouping explicit and
// navigable, the way the real tab strip does on the live site.
//
// This runs as a Postprocessor (after HTML conversion, same point roles-labels-
// postprocessor.js and absolute-links-postprocessor.js already operate at) rather than
// manipulating the Asciidoctor document tree before conversion - simpler to reuse
// node-html-parser's own CSS-selector-based DOM API than Asciidoctor's own block-title
// API, and this pipeline already depends on node-html-parser for exactly this purpose
// (see roles-labels-postprocessor.js). It also runs once against the *whole*, already-
// merged book (the assembler hands this renderer one combined document, not one page at a
// time), so anchor IDs are minted from a counter kept for the lifetime of a single
// process() call, not derived from role names alone - two different pages using the same
// role name (e.g. both having an `include-with-java` alternative) would otherwise collide.
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

function escapeHtml (text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

class TabbedExamplePostprocessor extends Postprocessor {
  process (_document, output) {
    if (!output.includes('tabbed-example')) return output
    const root = parseHTML(output)
    let groupCounter = 0
    root.querySelectorAll('.exampleblock.tabbed-example').forEach((wrapper) => {
      groupCounter++
      const listItems = []
      let variantCounter = 0
      wrapper.querySelectorAll(':scope > .content > .exampleblock').forEach((variant) => {
        const roleClass = variant.classList.value.find((cls) => cls.startsWith('include-with-'))
        if (!roleClass) return
        variantCounter++
        const label = deriveLabel(roleClass.slice('include-with-'.length))
        const anchorId = `tabbed-example-${groupCounter}-${variantCounter}`
        variant.setAttribute('id', anchorId)
        const content = variant.querySelector(':scope > .content')
        ;(content || variant).insertAdjacentHTML(
          'afterbegin',
          `<div class="title tabbed-example-label">${escapeHtml(label)}</div>`
        )
        listItems.push(`<li><a href="#${anchorId}">${escapeHtml(label)}</a></li>`)
      })
      if (listItems.length > 1) {
        wrapper.insertAdjacentHTML('afterbegin', `<ol class="tabbed-example-list">${listItems.join('')}</ol>`)
      }
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(TabbedExamplePostprocessor)
}
