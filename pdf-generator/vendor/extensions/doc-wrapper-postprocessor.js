'use strict'

// The real site's own site.css (linked wholesale - see convert.js's own comment on
// why) scopes content rules two different ways, neither of which plain Asciidoctor's
// html5 backend output (used here) has on its own:
//   - `.doc ...` - Antora's own page template wraps real HTML output in
//     `<article class="doc">`, a child of <body>, not <body> itself.
//   - `body.docs ...` - a handful of rules (e.g. the page's own [abstract]/
//     {description} block, body.docs #preamble .abstract) are instead scoped off a
//     `docs` class the real <body> itself carries (alongside "article", which plain
//     Asciidoctor's own <body class="article"> already has for free).
// Asciidoctor's html5 backend has no equivalent of Antora's nested <article> at all -
// just <body class="article"><div id="header">...</div><div id="content">...all
// sections...</div><div id="footer">...</div></body> - so rather than introduce a new
// wrapper element, "doc" is added directly to the existing #content div, which scopes
// identically for any `.doc <selector>` rule.
//
// Real site.css's own content selectors are almost all scoped `.doc <thing>` (two
// classes) or deeper (`.doc table.tableblock>:not(thead) th`, `.doc h2:not(.discrete)`,
// ...) - print.css's own rules for the same elements (h2, table.tableblock, .imageblock,
// .admonitionblock, ...) are plain, single-class/element selectors, which lose that
// specificity fight regardless of which file loads second (reported directly: headings
// too small, tables with no borders/stripes, malformed admonition/code-block corners -
// each is print.css's own intended override silently losing to real site.css's richer
// selector for that same property). `#pdf-export` on <body> gives print.css's own
// selectors (written as `#pdf-export <existing selector>`) an ID in their specificity,
// which beats any number of real site.css's classes outright, rather than fixing these
// one at a time as each is found.
const { Postprocessor } = require('asciidoctor')

class DocWrapperPostprocessor extends Postprocessor {
  process (document, output) {
    return output
      .replace(/<body\b/, '<body id="pdf-export"')
      .replace(/(<body\b[^>]*\bclass=")/, '$1docs ')
      .replace(/(<div id="content"(?:\s+class="[^"]*")?)/, (match) =>
        match.includes('class="')
          ? match.replace('class="', 'class="doc ')
          : `${match} class="doc"`
      )
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(DocWrapperPostprocessor)
}
