'use strict'

// Ports @neo4j-antora/table-footnotes for the PDF pipeline: moving a table's
// own footnotes out of Asciidoctor's single document-wide #footnotes div and
// into a <tfoot> row on that specific table, instead of leaving them
// dumped at the very end of the whole document, disconnected from the table
// they came from.
//
// Same reason this can't just reuse table-footnotes.js directly as roles-
// labels-postprocessor.js: it hooks Antora's own `pagesComposed` event and
// operates on files in an Antora ContentCatalog, neither of which exist in
// this pipeline (see docs-tools/pdf/README) - asciidoctor-web-pdf runs a
// separate, isolated Asciidoctor conversion on the assembler's merged .adoc
// text that table-footnotes never gets a chance to see. This is a
// Postprocessor instead (Asciidoctor's own extension point, run after
// conversion to HTML), with the same DOM manipulation ported over near
// verbatim - it's pure HTML restructuring, no Antora-specific data needed.

const { parse: parseHTML } = require('node-html-parser')
// Must come from the same package identity the running engine uses
// internally, not a separately-resolved copy - see roles-labels-
// postprocessor.js for why requiring the class from the wrong copy of the
// module fails Registry's own type check.
const { Postprocessor } = require('asciidoctor')

function createElement (el, className = '') {
  return parseHTML(`<${el}${className ? ` class="${className}"` : ''}></${el}>`)
}

class TableFootnotesPostprocessor extends Postprocessor {
  process (_document, output) {
    if (!output.includes('id="footnotes"')) return output
    const root = parseHTML(output)
    const footnotesDiv = root.getElementById('footnotes')
    const tables = root.querySelectorAll('table')
    if (!footnotesDiv || tables.length === 0) return output

    tables.forEach((table) => {
      const tableFootnotes = table.querySelectorAll('tbody a.footnote')
      if (tableFootnotes.length === 0) return

      const cols = table.querySelectorAll('colgroup col').length
      const tFoot = createElement('tfoot')
      const footnoteRow = createElement('tr')
      tFoot.firstElementChild.appendChild(footnoteRow)
      const footnoteCell = createElement('td', 'tableblock footnote-cell')
      footnoteCell.firstElementChild.setAttribute('colspan', cols)

      // For each footnote reference in this table, find the matching
      // footnote definition (by id, from its href) in the document-wide
      // footnotes div, and move it into this table's own footer.
      tableFootnotes.forEach((footnote) => {
        const footnoteId = footnote.getAttribute('href').replace('#', '')
        const matchingFootnote = footnotesDiv.querySelector(`#${footnoteId}`)
        if (!matchingFootnote) return
        footnoteCell.firstElementChild.appendChild(matchingFootnote)
      })

      footnoteRow.firstElementChild.appendChild(footnoteCell)
      table.appendChild(tFoot)
    })

    // Remove the document-wide footnotes div if every footnote in it ended
    // up moved into a table footer.
    if (footnotesDiv.querySelectorAll('div.footnote').length === 0) {
      footnotesDiv.remove()
    }
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(TableFootnotesPostprocessor)
}
