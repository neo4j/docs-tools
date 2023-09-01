const File = require('vinyl')

module.exports.register = function ({ config }) {

  const logger = this.getLogger('page-list')
  
  this
  .on('documentsConverted', ({ config }) => {

    const { contentCatalog, siteCatalog } = this.getVariables()

    let pageList = {}

    const myFiles = contentCatalog.getFiles()
    myFiles.forEach( (file) => {
      if (!file.out || !file.asciidoc) return
      pageList[file.src.path] = {
        title: file.asciidoc.doctitle,
        url: file.out.path,
      }
    })
    const pageListFile = generateChangelogFile(pageList)
    siteCatalog.addFile(pageListFile)
    logger.info({   }, 'Page list generated')
  })
}

function generateChangelogFile (pageList) {
    return new File({ contents: Buffer.from(JSON.stringify(pageList)), out: { path: './.meta/pageList' } })
}
