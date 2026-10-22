'use strict'

// asciidoctor-pdf's own highlight.js-based syntax highlighter (see its own
// syntax-highlighter.js - `-a source-highlighter=highlightjs` in convert.js turns it on)
// only colors a `[source,cypher]` block correctly if `hljs.getLanguage('cypher')` returns
// a real grammar; when it doesn't, that adapter's own fallback (`hljs.highlightAuto`)
// kicks in instead, which guesses the "best match" language per block from whichever
// languages stock highlight.js happens to have bundled - none of which are Cypher - and
// gives wildly inconsistent, mostly-wrong results block to block (reported directly:
// "no highlighting of any kind except 'company' and 3", immediately followed by a
// different block with full red/blue/orange/green from a lucky guess). Stock
// highlight.js has never shipped a Cypher grammar at all, so this was never going to
// self-resolve.
//
// The real HTML site has exactly this same problem and solves it the same way: it
// bundles its own highlight.js build (assets/js/vendor/highlight.js) with the
// community `highlightjs-cypher` grammar (github.com/highlightjs/highlightjs-cypher)
// registered under the name "cypher" - confirmed directly by fetching that bundle and
// finding this exact grammar's own keyword list inside it, byte for byte. Rather than
// re-deriving Cypher's grammar by hand (and inevitably drifting from what the real site
// actually renders, the same trap this theme's own hand-rolled CSS fell into before the
// real-site.css-reuse rewrite - see print.css's own top comment), vendor-languages/
// cypher.js is a verbatim copy of that same package, registered here against this
// renderer's own highlight.js instance for the same result.
//
// This can't just be *fetched* at build time the way site.css/Public Sans are (see
// convert.js's own fetchRealSiteCss/fetchGoogleFontCss) - the real bundle is a ~900KB
// minified, self-contained IIFE assigning a browser global, not a CommonJS module
// `require()` can load, and it bundles highlight.js's own engine too, which would mean
// running two separate highlight.js instances/registries in the same process rather than
// registering one more language against the single instance asciidoctor-pdf's own
// adapter already uses. A vendored copy of just the one grammar module avoids both
// problems.
//
// Must `require('highlight.js')` from somewhere inside vendor/ (not the consuming
// docset's own node_modules) to resolve the exact same singleton instance
// asciidoctor-pdf's own ServerHighlightJsAdapter calls `hljs.highlight()`/
// `hljs.getLanguage()` against - same reasoning as doc-wrapper-postprocessor.js's own
// `require('asciidoctor')` needing the vendor-local copy (see convert.js's top comment).
const hljs = require('highlight.js')
const cypher = require('../languages/cypher')

if (!hljs.getLanguage('cypher')) hljs.registerLanguage('cypher', cypher)

// cypher-shell wraps a `neo4j> `-prompted line as `meta`, then highlights everything
// after it as Cypher via subLanguage - registered by the real site alongside "cypher"
// itself (same bundle, same confirmation) for any `[source,cypher-shell]` block showing
// a REPL session rather than a bare query. Small enough to inline rather than vendor as
// its own file - copied verbatim from the real site's own bundle.
if (!hljs.getLanguage('cypher-shell')) {
  hljs.registerLanguage('cypher-shell', function () {
    return {
      contains: [{
        className: 'meta',
        begin: '^\\s{0,3}[neo4j]',
        end: '>',
        starts: { end: /[\n|;]/, subLanguage: 'cypher' },
      }],
    }
  })
}

// No Asciidoctor extension API hook needed - the registration above is this module's
// entire job, done as a side effect of being `require()`'d via `--extension` (the only
// way to run code inside asciidoctor-web-pdf's own process - see convert.js's own
// comment on why real-CSS/font fetches, which run in convert.js's own process instead,
// can't reach this far). Asciidoctor's own extension loader still expects a `register`
// function to exist on every `--extension` module, even an unused one.
module.exports.register = function () {}
