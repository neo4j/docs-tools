module.exports = function (registry) {
  registry.treeProcessor(function () {
    var self = this
    self.process(function(doc) {

      if (!doc.getAttribute('page-terms-to-mark')) return

      let terms = doc.getAttribute('page-terms-to-mark').split(',').map(function (value) {
          return value.trim();
        })

      if (!terms) return

      let markTitles = doc.getAttribute('page-terms-mark-titles')? true : false
      let devMode = doc.getAttribute('page-terms-dev-mode')
      
      let marker = doc.getAttribute('page-terms-marker') || '^&reg;^'

      let markAdded = []
      
      terms.forEach(term => {

        let re = new RegExp(`(^|\\[|\\s)${term}\\b`)

        let reMarked = new RegExp(`${term} ${marker}`)

        doc.findBy().forEach(block => {

          // if we've already marked ths, don't mark it again
          // unless testing in dev mode
          if ( markAdded.includes(term) && !devMode) return

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
        
          // return if we've already marked this term
          if (markAdded.includes(term) && !devMode) return line

          // return if this term is already marked
          if (reMarked.test(line)) {
              markAdded.push(term)
              return line
          }

          // mark the first instance of the term if we find a match
          if (re.test(line)) {
              markAdded.push(term)
              return line.replace(re, '$1' + term + marker)
          }

          // we checked but there was no match
          return line
          
        }

      })
      
    })
  })
}


