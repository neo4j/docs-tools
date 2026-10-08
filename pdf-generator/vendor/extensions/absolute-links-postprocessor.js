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

// The production origin every PDF should link back to, however it was
// built or wherever its own build happens to be published (dev, staging, a
// PR preview, ...) - a PDF is a standalone, offline-readable artifact with
// an effectively permanent lifetime once downloaded, so its links should
// point at the one real, durable destination rather than wherever this
// particular build happened to run.
const PRODUCTION_ORIGIN = 'https://neo4j.com'

class AbsoluteLinksPostprocessor extends Postprocessor {
  process (document, output) {
    if (!output.includes('href="/')) return output
    const root = parseHTML(output)
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href')
      // Root-relative only ("/foo") - leave protocol-relative ("//foo",
      // a different origin entirely) and everything else (full URLs,
      // same-page "#fragment"s, "mailto:", ...) untouched.
      if (href.startsWith('/') && !href.startsWith('//')) {
        a.setAttribute('href', PRODUCTION_ORIGIN + href)
      }
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(AbsoluteLinksPostprocessor)
}
