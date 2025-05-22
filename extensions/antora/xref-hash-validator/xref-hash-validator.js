const { parse: parseHTML } = require('node-html-parser')
const { posix: path, resolve } = require('path')
const url = require('url');
const http = require("http");

module.exports.register = function ({ config }) {

    let linkTargets = {}
    
    const logger = this.getLogger('xref-hash-validator')

    // set a default log level for the log message when an xref is not valid
    // this an be overridden when the extension is specified in the playbook.yml file
    const {logLevel = 'warn'} = config
    
    this
    .on('contentClassified', ({ }) => {

        // add a file.xrefChecker property to each file in the contentCatalog
        // we can add this now, before the contentCatalog object is locked
        // we can modify its values after the documentsConverted event
        const { contentCatalog } = this.getVariables()
        const files = contentCatalog.getFiles().filter((f) => f.src && f.src.mediaType === 'text/asciidoc')
        files.forEach( (file) => {
            file.xrefChecker = { 'linkTargets': [], 'internalLinks': []}
        })
    })
    .on('documentsConverted', ({ }) => {

        // after the asciidoc has been converted to HTML we can parse the HTML for link targets
        // and internal links that target sections of other pages
        // for each file, we can add this information to file.xrefChecker, which is now part of the contentCatalog
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
                    (linkTargets[id] = linkTargets[id] || []).push({"out": file.pub.url, "src": file.src.path, "component": file.src.component, "version": file.src.version, "branch": file.src.origin.branch});
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

                if (!href) return []

                // if an id on this page matches this href, we can ignore it - it is essentially self-verifying
                if (file.xrefChecker.linkTargets.includes(href.replace(/^#/, ''))) return []

                if (href && !href.startsWith('http') && !href.startsWith('/docs')) {
                    return [href]
                }
                return []
            })

        })
        
        // we can go back into the contentCatalog and check the xref data we just added
        // for every file in the contentCatalog, check if the xrefChecker.internalLinks are valid
        // by verifying that for an internal link to a section, the hash does actually exist in the target page
        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return
    
            // what is the full url of each target?
            file.xrefChecker.internalLinks.forEach((link) => {

                searchForThisURL = new URL(path.join(file.pub.url, link), playbook.site.url)

                // if there's no hash the xref is already checked by Antora
                // this check shouldn't ever match anyway because we should have already filtered out links without hashes
                if (!searchForThisURL.hash) return
                
                // Find the file in the contentcatalog that has a file.pub.url value that matches the pathname of the link target
                // where the pathname is a relative path from the site root, which is also what pub.url represents
                const targetFile = contentCatalog
                .findBy({ family: 'page' })
                .filter((page) => page.pub)
                .filter((f) => {
                    return f.pub.url === searchForThisURL.pathname
                })[0]

                const hashTarget = decodeURI(searchForThisURL.hash.replace('#', ''))

                // if the anchor doesn't exist anywhere...
                if (!linkTargets[hashTarget]) {

                    if (linkTargets[hashTarget.replace(' ', '-')]) {
                        logger[logLevel]({ file: file.src, source: file.src.origin }, 'anchor %s not found in target page %s - did you mean %s?', decodeURI(searchForThisURL.hash), targetFile.src.path, hashTarget.replace(' ', '-'))
                        return
                    }
                    
                    // default generated id exists?
                    if (linkTargets[`_${hashTarget.replace('-', '_')}`]) {
                        logger[logLevel]({ file: file.src, source: file.src.origin }, 'anchor %s not found in target page %s - did you mean the default generated ID %s?', decodeURI(searchForThisURL.hash), targetFile.src.path, `_${hashTarget.replace('-', '_')}`)
                        return
                    }
                    
                    // lower case?
                    if (linkTargets[hashTarget.toLowerCase()]) {
                        logger[logLevel]({ file: file.src, source: file.src.origin }, 'anchor %s not found in target page %s - use %s', decodeURI(searchForThisURL.hash), targetFile.src.path, searchForThisURL.hash.toLowerCase())
                        return
                    }
                    
                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'anchor %s not found in target page %s', decodeURI(searchForThisURL.hash), targetFile.src.path)                        
                    return
                }

                // maybe the anchor is found in another page, possibly because the section has moved
                if (!linkTargets[hashTarget]
                    // .filter( (file) => {
                    //     return file.src.version === targetFile.src.version && file.src.component === targetFile.src.component
                    // })
                    .map( (file) => {
                        return file.out
                    })
                    .includes(targetFile.pub.url)) {

                    const possibleSources = linkTargets[hashTarget].map( (f) => {
                        return `${f.src} (branch: ${f.branch})`
                    }).join(', ')

                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'anchor %s not found in target page %s (branch: %s) - anchor found in %s', decodeURI(searchForThisURL.hash), targetFile.src.path, targetFile.src.origin.branch, possibleSources)      
                }
            })
        })
    })
}
