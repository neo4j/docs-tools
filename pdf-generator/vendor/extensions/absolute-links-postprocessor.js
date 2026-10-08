'use strict'

// Antora's own site.url is deliberately root-relative for most docsets
// (neo4j-docs-base-uri: /docs, and every per-manual *-base-uri attribute
// built from it - javadocs, cypher-manual, operations-manual, etc.), so a
// cross-manual link:{neo4j-docs-base-uri}/operations-manual/...[] macro
// resolves to an href like "/docs/operations-manual/.../securing-extensions"
// - correct inside a browser loaded from https://neo4j.com, where a path
// starting with "/" resolves against that origin. A standalone PDF has no
// such origin: opened via file://, that same href resolves to a literal,
// nonexistent local path (file:///docs/operations-manual/...), so the link
// silently does nothing when clicked - confirmed directly against a real
// build's rendered links.
//
// The old Gradle PDF pipeline hit the exact same problem and solved it by
// hardcoding its own base-uri playbook attributes to always be absolute
// (https://neo4j.com/...), for every manual, by name. That doesn't scale
// here - this pipeline has no equivalent master list of every manual's own
// base-uri attribute, and a hardcoded list would silently miss a real
// Antora cross-component xref (page-to-page, not attribute-based) that
// resolves to a root-relative href the exact same way. Rewriting every
// root-relative link after rendering, regardless of what produced it,
// handles both cases with one general fix.
const { parse: parseHTML } = require('node-html-parser')
// Must come from the same package identity the running engine uses
// internally - see roles-labels-postprocessor.js's own comment on this.
const { Postprocessor } = require('asciidoctor')

class AbsoluteLinksPostprocessor extends Postprocessor {
  process (document, output) {
    if (!output.includes('href="/')) return output
    // convert.js reads this back out of the docset's own publish.yml site.url
    // (the same canonical production URL reusable-docs-build.yml's HTML build
    // uses) and passes it on as this attribute - see its own siteOrigin()
    // comment. Falls back to the real production origin if that ever isn't
    // available, rather than leaving a root-relative, unusable link in a
    // downloaded, standalone PDF.
    const origin = document.getAttribute('absolute-link-origin') || 'https://neo4j.com'
    const root = parseHTML(output)
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href')
      // Root-relative only ("/foo") - leave protocol-relative ("//foo",
      // a different origin entirely) and everything else (full URLs,
      // same-page "#fragment"s, "mailto:", ...) untouched.
      if (href.startsWith('/') && !href.startsWith('//')) {
        a.setAttribute('href', origin + href)
      }
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(AbsoluteLinksPostprocessor)
}
