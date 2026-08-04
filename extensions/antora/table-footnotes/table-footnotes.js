const { parse: parseHTML, valid: validHTML } = require('node-html-parser')

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

            if (!validHTML(file.contents.toString())) {
                logger.warn({ file: file.src, source: file.src.origin }, 'Unable to process footnotes: the generated HTML for the file is not valid.')
                return
            }

            const parsed = parseHTML(file.contents.toString())
            // AsciiDoc-styled table cells are rendered as nested documents, so a single
            // page can contain several "footnotes" divs: one at the page level plus one
            // inside each such cell that defines a footnote. Collect them all.
            const footnotesDivs = parsed.querySelectorAll('[id="footnotes"]')
            const tables = parsed.querySelectorAll('table')
            if (footnotesDivs.length === 0 || tables.length === 0) return

            const logLevel = file.asciidoc.attributes['suppress-table-footnote-messages'] ? 'debug' : (file.asciidoc.attributes['table-footnotes-custom-log-level'] || defaultLogLevel)
            
            tables.forEach( (table) => {
                const tableFootnotes = table.querySelectorAll('a.footnote')
                if (tableFootnotes.length === 0) return

                const admonTable = table.parentNode.classList.contains('admonitionblock')

                // Get the number of columns in the table for the footnotes colspan
                const cols = admonTable
                    ? '2'
                    : table.querySelectorAll('colgroup col').length

                // create the footer
                const existingTFoot = table.querySelector('tfoot')
                const tFoot = existingTFoot || createElement('tfoot')
                const footnoteRow = createElement('tr')
                if (!existingTFoot) tFoot.firstElementChild.appendChild(footnoteRow)
                else tFoot.appendChild(footnoteRow)
                const footnoteCell = createElement('td', 'tableblock footnote-cell')
                footnoteCell.firstElementChild.setAttribute('colspan', cols)

                if (admonTable) {
                    const contentClasses = table.querySelector('td.content').classList.value
                    contentClasses.forEach(cls => footnoteCell.firstElementChild.classList.add(cls))
                }

                // go through all the footnotes in the table
                // for each one, find the matching footnote in the footnotes div
                // the matching footnote will have an ID that matches the href of the footnote link
                tableFootnotes.forEach( (footnote) => {
                    const footnoteId = footnote.getAttribute('href').replace('#', '')
                    // The matching definition may live in any of the page's footnotes divs
                    // (page-level or inside another cell), so search the whole document.
                    const matchingFootnote = parsed.querySelector(`#${footnoteId}`)
                    if (!matchingFootnote) return
                    // If we found a matching footnote, we can add it to the td
                    footnoteCell.firstElementChild.appendChild(matchingFootnote)
                })

                footnoteRow.firstElementChild.appendChild(footnoteCell)
                if (!existingTFoot) table.appendChild(tFoot)

                // log the change
                logger[logLevel]({ file: file.src, source: file.src.origin }, 
                    '%d footnote%s added to %s', 
                    tableFootnotes.length, tableFootnotes.length === 1 ? '' : 's', 
                    table.querySelector('caption') ? table.querySelector('caption').textContent : 'table'
                )
            })
            // remove any footnotes div that no longer contains footnotes
            footnotesDivs.forEach( (footnotesDiv) => {
                if (footnotesDiv.querySelectorAll('div.footnote').length === 0) {
                    footnotesDiv.remove()
                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'All footnotes moved to table footers: footnote div removed')
                }
            })
            file.contents = Buffer.from(parsed.toString())
        })
    })
}