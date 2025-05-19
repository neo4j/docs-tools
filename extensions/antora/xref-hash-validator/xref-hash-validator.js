const { parse: parseHTML } = require('node-html-parser')
const { posix: path, resolve } = require('path')
const url = require('url');
const http = require("http");

module.exports.register = function ({ config }) {
    
    const {logLevel = 'warn'} = config
    const logger = this.getLogger('xref-hash-validator')
  
    this
    .on('contentClassified', ({ }) => {
        const { contentCatalog } = this.getVariables()
        const files = contentCatalog.getFiles().filter((f) => f.src && f.src.mediaType === 'text/asciidoc')
        files.forEach( (file) => {
            file.xrefChecker = { 'linkTargets': [], 'internalLinks': []}
        })
    })
    .on('documentsConverted', ({ }) => {

        // after the documents have been converted, we can go back into the contentCatalog and check the xref data we added
        // for every file in the contentCatalog, check if the xrefChecker.internalLinks are valid
        // by verifying that every hash that a page links to does actually exist in the target page
        const { playbook, contentCatalog } = this.getVariables()
        const files = contentCatalog.getFiles()

        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return

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

        })
        
        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return
    
            // what is the full url of each target?
            file.xrefChecker.internalLinks.forEach((link) => {

                searchForThisURL = new URL(path.join(file.pub.url, link), playbook.site.url)

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
