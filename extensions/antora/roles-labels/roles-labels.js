const { parse: parseHTML, valid: validHTML } = require('node-html-parser')
const { processLabels } = require('./lib/process-labels')

module.exports.register = function ({ config }) {

    const {defaultLogLevel = 'info', replaceInlineLabelText = false } = config

    const logger = this.getLogger('neo4j-roles-labels')

    this
    .on('pagesComposed', ({ config }) => {

        const { contentCatalog } = this.getVariables()

        const files = contentCatalog.getFiles()

        files.forEach( (file) => {
            // file.asciidoc is also truthy for a non-HTML export file produced by
            // @antora/assembler (e.g. a PDF export via @antora/pdf-extension) -
            // carried over from its pre-conversion assembly stage. Without this
            // check, this mistakes that file's binary buffer for HTML and
            // corrupts it: validHTML() below isn't a reliable enough guard on its
            // own, since e.g. a PDF commonly embeds real XML/XMP metadata that
            // looks enough like HTML to pass. A real HTML page always has
            // file.mediaType === 'text/html' (set by @antora/document-converter).
            if (!file.out || !file.asciidoc || file.mediaType !== 'text/html') return

            if (!validHTML(file.contents.toString())) {
                logger.warn({ file: file.src, source: file.src.origin }, 'Unable to process roles: the generated HTML for the file is not valid.')
                return
            }

            const parsed = parseHTML(file.contents.toString())

            processLabels(parsed, {
                src: file.src,
                attributes: file.asciidoc.attributes,
                logger,
                defaultLogLevel,
                replaceInlineLabelText,
                docRootSelector: 'article.doc',
            })

            file.contents = Buffer.from(parsed.toString())

        })

    })

}