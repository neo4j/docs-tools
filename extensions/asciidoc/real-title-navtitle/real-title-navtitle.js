'use strict'

// A plain Asciidoctor extension, published standalone (not nested inside
// @neo4j-antora/pdf-generator, even though that's the only thing it's actually useful
// for) specifically so a docset can have it as a permanent dependency with no real cost:
// pdf-generator's own `postinstall` sets up a full vendor/ tree (asciidoctor-pdf +
// Puppeteer, which downloads Chromium) - nesting this inside it would mean every docset
// wanting this fix would need that whole heavy install just to resolve one small
// extension file, on every plain HTML build/CI job/dev `npm install`, not just a
// PDF-specific one. A docset registers it itself, in its playbook's own
// `asciidoc.extensions` list (NOT antora.yml - @antora/content-classifier's own
// per-component asciidoc config only ever merges antora.yml's `asciidoc.attributes`
// into the site-wide config, never `asciidoc.extensions`; confirmed directly - an
// antora.yml-only registration is silently never loaded at all), the same list that
// already registers `@neo4j-documentation/macros`/`remote-include`:
//
//   asciidoc:
//     extensions:
//     - '@neo4j-antora/real-title-navtitle'
//
// Why this has to be registered that way, not something @neo4j-antora/pdf-generator can
// just always do on its own: @antora/assembler builds every merged page's own heading
// (and, from that, the PDF's own table of contents, which asciidoctor-web-pdf generates
// by scanning those headings) from the page's *nav* title - its link text in nav.adoc,
// e.g. `xref:page.adoc[Nav Text]` - not the page's own `= Real Title` document title,
// unless a page sets its own `:assembly-navtitle:` attribute to override that. Confirmed
// directly against @antora/assembler's own produce-assembly-file.js: a page listed as
// `xref:data-import/index.adoc[Import data into Neo4j]`, whose own title is
// `= Import your data into Neo4j`, rendered as "Import data into Neo4j" in both the
// merged book's in-body heading and the PDF's own table of contents, not its real title -
// reported directly: this doesn't "match up when you click the link to go to the page"
// (you expect to land on the page whose real title you read in the TOC, not a nav label
// that happens to be shown in the same place). The old Gradle/AsciidoctorJ pipeline this
// one replaces never had this problem, because it converted each page's own raw `.adoc`
// directly - never through Antora's nav-driven assembler at all.
//
// A real per-page `:assembly-navtitle:` attribute override already exists for exactly
// this (a page can opt into a *different* assembly title than both its nav text and its
// own doctitle) - this extension only backfills that attribute, from the page's own real
// title, for a page that doesn't already set it, so the *default* for every page becomes
// "assemble with your own real title", while an explicit per-page override (nav or
// in-page) still wins, same as it always has.
//
// A Treeprocessor (runs after the whole page is fully parsed), not a Preprocessor (runs
// on raw, unparsed lines) - a first attempt spliced a new `:assembly-navtitle: ...` line
// into the raw source text directly below the title line, which worked for a page with
// no include directives, but broke @asciidoctor/reducer (the extension
// @antora/assembler's own getAsciiDocConfigWithAsciidoctorReducerExtension always adds,
// to track and re-embed include'd content for the assembled book) on any page that *does*
// have one: the reducer tracks the exact original source line position of every include
// directive, and splicing an extra line in ahead of it shifts every subsequent line
// number, so the reducer goes looking for the include at the wrong position and fails
// outright ("include directive to reduce not found"). Setting the attribute via the API
// instead, once the document is already fully parsed, never touches source line
// positions at all, so it doesn't trip that failure mode.
//
// `doc.getAttribute('doctitle')`, not `doc.getDocumentTitle()` - the latter returns the
// *converted* title (backend-specific markup already applied, e.g. real HTML
// `<code>...</code>` for an HTML backend), not its own AsciiDoc source - confirmed
// directly: a page titled `= Import CSV data using \`LOAD CSV\`` produced a PDF heading
// with literal, unconverted `<code>` tags in the visible text, because the assembler
// re-parses `assembly-navtitle`'s value as AsciiDoc source (the same way it already
// handles a real nav.adoc title), not as pre-rendered HTML. `doctitle` is the document's
// own built-in attribute holding the un-converted source form, which is what
// `:assembly-navtitle:` (a real page's own override, set directly in AsciiDoc source) is
// normally given.
//
// Known limitation: a page whose title section includes another file via a
// *parent-directory-relative* path (`include::../other.adoc[]`, as opposed to a
// same-directory `include::other.adoc[]`) doesn't pick up this default - confirmed
// directly, reproducibly, by toggling only that one path style on an otherwise identical
// page: `doc.setAttribute('assembly-navtitle', ...)` below still runs and computes the
// right value, but it doesn't survive to where @antora/assembler later reads it back for
// that specific page, while an identical page using a same-directory include is
// unaffected. Not yet root-caused inside @asciidoctor/reducer/@antora/assembler's own
// internals - narrow enough (one specific include path shape) that a page hitting it can
// fall back to setting `:assembly-navtitle:` itself directly.
module.exports.register = function (registry) {
  registry.treeProcessor(function () {
    this.process(function (doc) {
      if (!doc.hasAttribute('assembler-filetype-pdf')) return
      // A page's own explicit choice (either a real per-page assembly title, or one that
      // happens to already match its nav text) always wins over this default.
      if (doc.hasAttribute('assembly-navtitle')) return
      var rawTitle = doc.getAttribute('doctitle')
      if (doc.hasHeader() && rawTitle) doc.setAttribute('assembly-navtitle', rawTitle)
    })
  })
}
