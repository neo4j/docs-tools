const { parse: parseHTML } = require('node-html-parser')
const { posix: path, resolve } = require('path')
const url = require('url');
const http = require("http");

module.exports.register = function ({ config }) {

    // holds link target objects for whole docset (all versions, all pages)
    let linkTargets = {}
    
    const logger = this.getLogger('xref-hash-validator')

    // set a default log level for the log message when an xref is not valid
    // this can be overridden when the extension is specified in the playbook.yml file
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

        // if there's no site url in the playbooks, we can't resolve links
        // but we can use any domain instead
        if (!playbook.site.url) {
            logger.info('No site URL defined in playbook %s - a dummy url will be used to validate links', playbook.file)
        }

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
                    (linkTargets[id] = linkTargets[id] || []).push({
                        "out": file.pub.url, 
                        "src": file.src.path, 
                        "component": file.src.component, 
                        "version": file.src.version, 
                        "branch": file.src.origin.branch
                    });
                    return id
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

                if (!href.startsWith('http') && !href.startsWith('/docs')) {
                    return href
                }
                return []
            })

        })
        
        // we can go back into the contentCatalog and check the xref data we just added
        // for every file in the contentCatalog, check if the xrefChecker.internalLinks are valid
        // by verifying that for an internal link to a section, the hash does actually exist in the target page
        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return
    
            // check the internal links in the file
            file.xrefChecker.internalLinks.forEach((link) => {

                // if the link starts with an inline macro, log a warning for bad asciidoc syntax
                // this can happen if eg the source is link:link:...[]
                // but mailto: is valid 
                const macroCheck = new RegExp('^(\\w+):', 'i');
                if (macroCheck.test(link) && !link.startsWith('mailto:')) {
                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'syntax error detected while validating xref target \'%s\'', link)
                    return
                }

                // what is the full url of each link?
                searchForThisURL = new URL(path.join(file.pub.url, link), (playbook.site && playbook.site.url) ? playbook.site.url : 'https://example.com')

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

                // we shouldn't generate this log message, but just in case...
                if (!targetFile) {
                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'target file %s not found for link %s', searchForThisURL.pathname, link)
                    return
                }

                const hashTarget = decodeURI(searchForThisURL.hash.replace('#', ''))

                // if the anchor (hashTarget) doesn't exist anywhere...
                // try some simple checks for common mistakes
                // if none of these checks match, log a warning and return
                if (!linkTargets[hashTarget]) {

                    if (linkTargets[hashTarget.replace(' ', '-')]) {
                        logger[logLevel]({ file: file.src, source: file.src.origin }, 'section %s not found in target page %s - did you mean %s ?', decodeURI(searchForThisURL.hash), targetFile.src.path, hashTarget.replace(' ', '-'))
                        return
                    }
                    
                    // default generated id exists?
                    if (linkTargets[`_${hashTarget.replace('-', '_')}`]) {
                        logger[logLevel]({ file: file.src, source: file.src.origin }, 'section %s not found in target page %s - did you mean the default generated ID %s ?', decodeURI(searchForThisURL.hash), targetFile.src.path, `_${hashTarget.replace('-', '_')}`)
                        return
                    }
                    
                    // lower case?
                    if (linkTargets[hashTarget.toLowerCase()]) {
                        logger[logLevel]({ file: file.src, source: file.src.origin }, 'section %s not found in target page %s - did you mean lowercase %s ?', decodeURI(searchForThisURL.hash), targetFile.src.path, searchForThisURL.hash.toLowerCase())
                        return
                    }
                    
                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'section %s not found in target page %s', decodeURI(searchForThisURL.hash), targetFile.src.path)                        
                    return
                }

                // if the anchor (hashTarget) does exist, but not in the target page...
                // maybe the anchor (hashTarget) is not found in the page the xref points to (targetFile), but it is found in another page
                // this could happen if the section has moved to a different page between versions
                if (!linkTargets[hashTarget]
                    // .filter( (file) => {
                    //     return file.src.version === targetFile.src.version && file.src.component === targetFile.src.component
                    // })
                    .map( (file) => {
                        return file.out
                    })
                    .includes(targetFile.pub.url)) {
                    
                    // the pages you could link to (possibleSources) instead are the files that do contain this anchor (hashTarget)
                    // we can log each of these
                    const possibleSources = linkTargets[hashTarget].map( (f) => {
                        return `${f.src} (branch: ${f.branch})`
                    }).join(', ')

                    logger[logLevel]({ file: file.src, source: file.src.origin }, 'section %s not found in target page %s (branch: %s) - anchor found in %s', decodeURI(searchForThisURL.hash), targetFile.src.path, targetFile.src.origin.branch, possibleSources)      
                }
            })
        })
    })
}
