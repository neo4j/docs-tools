const { parse: parseHTML } = require('node-html-parser')
const { posix: path, resolve } = require('path')
const url = require('url');

module.exports.register = function ({ config }) {

    const {logLevel = 'warn'} = config

    const logger = this.getLogger('xref-hash-validator')
  
    this
    .on('contentClassified', ({ config }) => {

        const { playbook, contentCatalog } = this.getVariables()
        
        // replace the existing convertDocument function
        // we copy the existing code, but add some data to the contentCatalog for xref checking
        // this has to be done before or during document conversion because after the documentsConverted event the contentCatalog cannot be updated
        this.replaceFunctions({
            convertDocument (file, contentCatalog = undefined, asciidocConfig = {}) {

                // This part is copied from Antora and should be checked for updates when Antora is updated
                const {
                extractAsciiDocMetadata = requireAsciiDocLoader().extractAsciiDocMetadata,
                loadAsciiDoc = requireAsciiDocLoader(),
                } = this ? this.getFunctions(false) : {}
                const doc = loadAsciiDoc(file, contentCatalog, asciidocConfig)
                
                if (!file.asciidoc) {
                file.asciidoc = extractAsciiDocMetadata(doc)
                if (asciidocConfig.keepSource || 'page-partial' in file.asciidoc.attributes) file.src.contents = file.contents
                }

                file.contents = Buffer.from(doc.convert())
                file.mediaType = 'text/html'

                // The rest of the code in this function is specific to this extension
                file.xrefChecker = { 'linkTargets': [], 'internalLinks': []}

                // parse the HTML - note that the HTML includes the content of the page only - excluding the document header
                // so we can't verify any links in the toolbar, nav, footer etc at this point
                const elements = parseHTML(file.contents.toString()).getElementsByTagName('*')

                // any element in the HTML that has an id attribute is a valid link target
                file.xrefChecker.linkTargets = elements.flatMap((e) => {
                    const id = e.getAttribute('id')
                    if (id) {
                        return [id]
                    }
                    return []
                })
                
                // any anchor element in the HTML that has an href attribute can originate from an xref in the source file for this HTML page
                const anchors = parseHTML(file.contents.toString()).querySelectorAll('a')
                file.xrefChecker.internalLinks = anchors.flatMap((a) => {
                    // ignore unresolved links that Antora has already logged
                    if (a.classList.contains('unresolved')) return []

                    const href = a.getAttribute('href')

                    // if an id on this page matches this href, we can ignore it - it is essentially self-verifying
                    if (file.xrefChecker.linkTargets.includes(href.replace(/^#/, ''))) return []

                    if (href && !href.startsWith('http') && !href.startsWith('/docs')) {
                        return [href]
                    }
                    return []
                })
                return file
            }
        })
    })
    .on('documentsConverted', ({ config }) => {

        // after the documents have been converted, we can go back into the contentCatalog and check the xref data we added
        // for every file in the contentCatalog, check if the xrefChecker.internalLinks are valid
        // by verifying that every hash that a page links to does actually exist in the target page
        const { contentCatalog } = this.getVariables()
        const files = contentCatalog.getFiles()
        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return
    
            // what is the full url of each target?
            file.xrefChecker.internalLinks.forEach((link) => {
                const searchForThisURL = url.parse(path.join(file.pub.url, link))

                // if there's no hash the xref is already checked by Antora
                if (!searchForThisURL.hash) return
                
                // Find the file in the contentcatalog that has file.pub,url matching the pathname of the link target
                const targetFile = contentCatalog
                .findBy({ family: 'page' })
                .filter((page) => page.pub)
                .filter((f) => {
                    return f.pub.url === searchForThisURL.pathname
                })[0]

                // check the file's xrefChecker.linkTargets to see if the hash is valid
                if (!targetFile.xrefChecker.linkTargets.includes(searchForThisURL.hash.replace('#', ''))) {
                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'anchor %s not found in target page %s', searchForThisURL.hash, targetFile.src.path)
                }
            })
        })
    })
}
