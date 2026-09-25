'use strict'

// Inserts a one-time copyright/trademark colophon page, right after the
// cover/title page and before the table of contents, as an alternative to
// running @neo4j-antora/mark-terms in this pipeline (see this package's own
// README, "Known limitations" - mark-terms marks a term's *first use per
// page*, a notion this pipeline's single merged document has no equivalent
// of). One boilerplate statement covering the whole PDF sidesteps that
// entirely.
//
// This has to insert into already-rendered HTML rather than as real
// AsciiDoc content (e.g. a discrete heading placed in the document
// preamble with `toc-placement: preamble` to push the auto-generated TOC
// below it) - that would only work if the merged document's own preamble
// were otherwise empty, but a docset's own first page very often has real
// intro text before its own first heading, which would then also count as
// "preamble" and get pulled in front of the TOC alongside this notice.
// Inserting directly before whatever HTML element the TOC actually
// produced sidesteps that risk entirely - it doesn't depend on any
// document content structure, just the cover/TOC/content divs the PDF
// converter itself always emits in that fixed order (see
// asciidoctor-pdf's own document-converter.js).
//
// The year is the docset's own `copyright` attribute (already maintained
// by every docs-* repo's playbook, specifically for this purpose - see its
// own comment in preview.yml/publish.yml: "update the copyright value with
// the first commit in a new year"), not a fresh computation to keep in
// sync with it.
const { parse: parseHTML } = require('node-html-parser')
// Must come from the same package identity the running engine uses
// internally - see roles-labels-postprocessor.js's own comment on this.
const { Postprocessor } = require('asciidoctor')

const TRADEMARK_NOTICE =
  'Neo4j®, Neo Technology®, Cypher®, Neo4j® Bloom™, Neo4j® AuraDB℠, and ' +
  'Neo4j® AuraDS℠ are registered trademarks or trademarks of Neo4j, Inc. in the United States ' +
  'and other countries.'
const OTHER_MARKS_NOTICE =
  'All other trademarks, service marks, registered trademarks, or registered service marks mentioned ' +
  'in this document are the property of their respective owners.'

class ColophonPostprocessor extends Postprocessor {
  process (document, output) {
    if (!output.includes('id="content"')) return output
    const root = parseHTML(output)
    // Insert before the TOC if there is one (the normal case - every
    // docset's PDF build enables it), else fall back to right before the
    // main content div.
    const anchor = root.getElementById('toc') || root.getElementById('content')
    if (!anchor) return output
    const year = document.getAttribute('copyright') || new Date().getFullYear().toString()
    const colophon = parseHTML(
      `<div id="colophon">
<h1>Copyright &amp; Trademarks</h1>
<p>&#169; ${year} Neo4j, Inc. All rights reserved.</p>
<p>${TRADEMARK_NOTICE}</p>
<p>${OTHER_MARKS_NOTICE}</p>
</div>`
    ).firstChild
    anchor.before(colophon)
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(ColophonPostprocessor)
}
