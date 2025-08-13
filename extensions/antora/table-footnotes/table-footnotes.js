const { parse: parseHTML, valid } = require('node-html-parser')

module.exports.register = function ({ config }) {

    const {defaultLogLevel = 'info'} = config
    const logger = this.getLogger('neo4j-table-footnotes')
  
    this
    .on('pagesComposed', ({ config }) => {

        const { contentCatalog } = this.getVariables()
        const files = contentCatalog.getFiles()

        function createElement(el,className = '',text = '') {
            let output = parseHTML(`<${el}${className !== '' ? ` class="${className}"` : ''}>${text}</${el}>`)
            return output
        }

        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return
            const parsed = parseHTML(file.contents.toString())
            const footnotesDiv = parsed.getElementById('footnotes')
            const tables = parsed.querySelectorAll('table')
            if (!footnotesDiv || tables.length === 0) return

            const logLevel = file.asciidoc.attributes['suppress-table-footnote-messages'] ? 'debug' : (file.asciidoc.attributes['table-footnotes-custom-log-level'] || defaultLogLevel)
            
            tables.forEach( (table) => {
                const tableFootnotes = table.querySelectorAll('tbody a.footnote')
                if (tableFootnotes.length === 0) return

                // Get the number of columns in the table for the footnotes colspan
                const cols = table.querySelectorAll('colgroup col').length

                // create the footer
                const tFoot = createElement('tfoot')
                const footnoteRow = createElement('tr')
                tFoot.firstElementChild.appendChild(footnoteRow)
                const footnoteCell = createElement('td', 'tableblock footnote-cell')
                footnoteCell.firstElementChild.setAttribute('colspan', cols)

                // go through all the footnotes in the table
                // for each one, find the matching footnote in the footnotes div
                // the matching footnote will have an ID that matches the href of the footnote link
                tableFootnotes.forEach( (footnote) => {
                    const footnoteId = footnote.getAttribute('href').replace('#', '')
                    const matchingFootnote = footnotesDiv.querySelector(`#${footnoteId}`)
                    if (!matchingFootnote) return
                    // If we found a matching footnote, we can add it to the td
                    footnoteCell.firstElementChild.appendChild(matchingFootnote)
                })

                footnoteRow.firstElementChild.appendChild(footnoteCell)
                table.appendChild(tFoot)

                // log the change
                logger[logLevel]({ file: file.src, source: file.src.origin }, 
                    '%d footnote%s added to %s', 
                    tableFootnotes.length, tableFootnotes.length === 1 ? '' : 's', 
                    table.querySelector('caption') ? table.querySelector('caption').textContent : 'table'
                )
            })
            // remove the footnotes div if it contains no footnotes
            if (footnotesDiv.querySelectorAll('div.footnote').length === 0) {
                footnotesDiv.remove()
                logger[logLevel]({ file: file.src, source: file.src.origin }, 'All footnotes moved to table footers: footnote div removed')
            }
            file.contents = Buffer.from(parsed.toString())
        })
    })
}