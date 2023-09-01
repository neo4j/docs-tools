const asciidoctor = require('@asciidoctor/core')() 

function* flatten(array, depth) {
  if(depth === undefined) {
    depth = 1;
  }
  for(const item of array) {
      if(Array.isArray(item) && depth > 0) {
        yield* flatten(item, depth - 1);
      } else {
        yield item;
      }
  }
}

function table() {
  var self = this
  self.process(function(doc) {
    var i = 1
    doc.findBy({ 'context': 'table' })
        .forEach(table => {

          var refs = []
          var footnotes = []

          const flattenedBody = [...flatten(table.rows.body, Infinity)];
          const flattenedHead = [...flatten(table.rows.head, Infinity)];

          const flattened = flattenedHead.concat(flattenedBody)
          
          flattened.forEach ( cell => {

            if (cell.text.includes('footnote:')) {

              var note = /footnote:(\S*)\[(.*)\]/
              var match = cell.text.match(note)

              // if there's a footnote
              if (match) {

                var newNote = false

                // make an id if there isn't one
                if (match[1] == '') match[1] = 'ref_' + i

                // add the ref if it's a new one
                if (!refs.includes(match[1]) ) {
                  refs[i] = match[1]
                  newNote = true
                }

                // update the cell text
                var tnotenum = refs.indexOf(match[1])
                var cellNote = "[[tnoteref" + i + "]]xref:#tnotedef" + tnotenum + "[^[" + tnotenum + "\\]^]"
                cell.text = cell.text.replace(note, cellNote)

                // add a footnote to the list if new
                if (newNote) {
                  var repl = "[[tnotedef" + i + "]]\nxref:#tnoteref" + i + "[" + i + "]. " + match[2] + "\n"
                  footnotes.push(repl)
  
                  // increment
                  i++

                }

              }
              
            }
          })
          
          // if we generated any footnotes, add the list to the table footer
          if (footnotes.length > 0) {
            const footerCol = asciidoctor.Table.Column.create(table, 0, table.attributes)
            footerCol.setAttribute('style', 'asciidoc')
            const footnotesCell = asciidoctor.Table.Cell.create(footerCol,footnotes.join('\n'))
            footnotesCell.colspan = table.getAttribute('colcount')
            table.rows.foot.push([footnotesCell])
          }
        })
  })
}

module.exports = function (registry) {
  registry.treeProcessor('table', table)
}