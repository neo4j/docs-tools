'use strict'

// Reuses @neo4j-antora/roles-labels' own shared core (extensions/antora/
// roles-labels/lib/process-labels.js in docs-tools) so PDF labels are
// produced by the exact same logic as the real HTML site - synonym
// resolution, version/product-suffix stripping, dataset attributes, inline
// vs role handling included - rather than a hand-ported subset that can
// silently drift from it (see docs-tools/pdf/README).
//
// roles-labels itself can't be *registered* here - it hooks Antora's own
// `pagesComposed` event and operates on files in an Antora ContentCatalog,
// which never exist in this pipeline: asciidoctor-web-pdf runs a completely
// separate, isolated Asciidoctor conversion on the assembler's merged .adoc
// text, so roles-labels never gets a chance to see - let alone transform -
// this content. This is a Postprocessor instead (Asciidoctor's own extension
// point, run after conversion to HTML, before the PDF renderer sees it) that
// calls the same shared `processLabels` function roles-labels.js calls.

const { parse: parseHTML } = require('node-html-parser')
// Must come from the same package identity the running engine (loaded via
// `asciidoctor`, not `@asciidoctor/core` directly, by asciidoctor-web-pdf/
// the CLI) uses internally - requiring the class from a different copy of
// the module fails Registry's own instanceof-style check with "Invalid type
// for postprocessor extension" even though it's structurally identical.
const { Postprocessor } = require('asciidoctor')
const { processLabels } = require('@neo4j-antora/roles-labels/lib/process-labels')

// Minimal shim matching the { info(meta, msg, ...args), warn(...), debug(...) }
// shape processLabels expects from Antora's pino-based logger - this pipeline
// has no Antora logger to reuse.
function makeLogger () {
  const log = (level) => (meta, msg, ...args) => {
    const consoleMethod = level === 'debug' ? 'log' : level
    // eslint-disable-next-line no-console
    console[consoleMethod](`[roles-labels] ${msg}`.replace(/%s/g, () => args.shift()), meta)
  }
  return { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') }
}

const logger = makeLogger()

class RolesLabelsPostprocessor extends Postprocessor {
  process (document, output) {
    if (!output.includes('label--')) return output
    const root = parseHTML(output)
    processLabels(root, {
      src: { path: 'pdf-export' },
      attributes: document.getAttributes(),
      logger,
      defaultLogLevel: 'info',
      replaceInlineLabelText: false,
      // Plain Asciidoctor HTML5 output (used here) never has Antora's
      // `article.doc` wrapper - falls back to the parsed root itself, since
      // there's no better place to hang page-wide dataset attributes. On the
      // real HTML site a missing wrapper is a sign of malformed AsciiDoc, so
      // process-labels.js only falls back (instead of warning and skipping)
      // when a caller opts in with docRootFallback: true.
      docRootSelector: 'article.doc',
      docRootFallback: true,
      // @antora/assembler marks *every* merged page's heading `discrete` to
      // flatten section nesting/IDs across the book - unlike on a real
      // Antora page, that's never a signal the author marked this heading as
      // a non-section (see process-labels.js's own comment on this option),
      // so a role on it must still become a label, exactly as it would in
      // the HTML this page was built from.
      skipDiscrete: false,
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(RolesLabelsPostprocessor)
}
