module.exports = function (registry) {
  registry.treeProcessor(function () {
    var self = this
    self.process(function(doc) {

      if (!doc.getAttribute('page-terms-to-mark')) return


      // escape special characters in the term to mark before using
      function escapeRegExp(str) {
        let escapedStr = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
        return escapedStr
      }

      // test terms against regexp attacks
      // let terms = doc.getAttribute('page-terms-to-mark')

      let terms = "Cypher, Neo4j"
      if (!/^[\w\s-,]+?$/.test(terms)) {
        doc.getLogger().error(`mark-terms: invalid terms "${terms}"`)
        return
      }

      const safeTerms = terms.split(',').map(function (value) {
          return escapeRegExp(value.trim());
        })

      if (!safeTerms) return

      let markTitles = doc.getAttribute('page-terms-mark-titles')? true : false
      let devMode = doc.getAttribute('page-terms-dev-mode')
      
      let marker = doc.getAttribute('page-terms-marker') || '&reg;'

      // test marker
      // marker must be a string that starts with & ends with ;
      if (!/^&[\w\s-]+?;$/.test(marker)) {
        doc.getLogger().error(`mark-terms: invalid marker "${marker}"`)
        return
      }

      const safeMarker = escapeRegExp(marker)

      let markAdded = []
      
      safeTerms.forEach(safeTerm => {

        // test safeTerm
        // let's reject it if it contains anything other than word characters, spaces, numbers, or hyphens
        if (!/^[\w\s-]+$/.test(safeTerm)) {
          doc.getLogger().error(`mark-terms: invalid term "${safeTerm}"`)
          return
        }

        doc.findBy().forEach(block => {

          // if we've already marked ths, don't mark it again
          // unless testing in dev mode
          if ( markAdded.includes(safeTerm) && !devMode) return

          // lists
          if (block.getContext() === 'olist' || block.getContext() === 'ulist') {
            block.getItems().forEach(item => {
              let reggedItem = testLine(item.text)
              item.text = reggedItem
            })
            return
          }

          // ignore listing blocks (which includes source blocks) and literal blocks
          if (block.getContext() === 'listing' || block.getContext() === 'literal') return

          // heading?
          if (block.getContext() === 'section' && markTitles === true) {
            let reggedTitle = testLine(block.getName())
            block.setTitle(reggedTitle)
            return
          }

          // tables aren't blocks with lines
          // table cells can be checked for their text
          if (block.getContext() === 'table_cell') {
            let reggedText = testLine(block.text)
            block.text = reggedText
            return
          }

          // if the block contains no lines, return
          if ( !block.lines) return

          // test each line
          block.lines.forEach((line, i) => {
            let reggedLine = testLine(line)
            block.lines[i] = reggedLine
          })

        })

        // test a line of content from a block or a table cell
        function testLine(line) {

          const safelyMarkedTerm = safeTerm + safeMarker
        
          // return if we've already marked this term
          if (markAdded.includes(safeTerm) && !devMode) return line

          if (line.includes(safelyMarkedTerm)) {
            markAdded.push(safeTerm)
            return line
          }

          // mark the first instance of the term if we find a match
          if (line.includes(safeTerm)) {
            return line.replace(safeTerm, safelyMarkedTerm)          
          }

          // we checked but there was no match
          return line
          
        }

      })
      
    })
  })
}


