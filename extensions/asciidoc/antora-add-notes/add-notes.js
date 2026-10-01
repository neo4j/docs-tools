'use strict'

module.exports.register = function (registry, { file, contentCatalog }) {
  registry.preprocessor(function () {
    var self = this
    self.process(function (doc, reader) {
      // Antora's Assembler (PDF/EPUB, since Antora 3.2) reduces the page back to its
      // original source lines and errors if an include directive we injected isn't
      // there. Notes are a site-only UX feature, so skip them during assembly builds.
      if (doc.getAttribute('assembler-filetype')) return reader
      if (!doc.getAttribute('page-add-notes-tags')) return reader
      if (doc.getAttribute('page-add-notes-versions') && !doc.getAttribute('page-add-notes-versions').includes(doc.getAttribute('page-version'))) return reader
      var notesModule = doc.getAttribute('page-add-notes-module') ? doc.getAttribute('page-add-notes-module') : 'ROOT';
      var notesComponent = doc.getAttribute('page-add-notes-component') ? doc.getAttribute('page-add-notes-component') : '';
      const notesModuleComponent = notesComponent ? `${notesComponent}:${notesModule}` : notesModule;
      var lines = reader.lines
      lines.reverse()
      var found = false
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("= ")) found = true
        if (lines[i].length == 0 && found) {
            lines.splice(++i,0, '', `include::${notesModuleComponent}:partial$/notes.adoc[tags={page-add-notes-tags}]`,'')
            lines.reverse()
            return reader
        }
      }    
    })
  })
}
