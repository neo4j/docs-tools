'use strict'

// Keeps a paragraph that directly introduces an image (e.g. "Here's an
// image:") glued to it, so if the pair doesn't fit in the remaining space
// on a page, both move to the next page together instead of the intro text
// being left stranded on the page before and the image jumping ahead on
// its own.
//
// This needs to be a Postprocessor (real HTML restructuring), not just a
// print.css rule: the print theme's renderer is asciidoctor-web-pdf's own
// Vivliostyle Viewer, a JS layout/fragmentation engine, not Chromium's
// native paged-media support - and it doesn't evaluate `:has()` for
// fragmentation purposes (confirmed directly: a `:has()` rule that should
// match doesn't even apply its own unrelated declarations, like a plain
// background colour, so it isn't a fragmentation-specific gap). Wrapping
// the two nodes in a shared container and giving *that* a plain
// `break-inside: avoid-page` (see print.css's `.keep-with-image`) sidesteps
// needing `:has()` at all.
const { parse: parseHTML } = require('node-html-parser')
// Must come from the same package identity the running engine uses
// internally - see roles-labels-postprocessor.js's own comment on this.
const { Postprocessor } = require('asciidoctor')

function isStandaloneImageParagraph (el) {
  if (!el.classList.contains('paragraph')) return false
  const p = el.querySelector(':scope > p')
  if (!p) return false
  return p.text.trim() === '' && !!p.querySelector(':scope > span.image')
}

function isImageUnit (el) {
  return el.tagName === 'DIV' && (el.classList.contains('imageblock') || isStandaloneImageParagraph(el))
}

function isPlainParagraph (el) {
  return !!el && el.tagName === 'DIV' && el.classList.contains('paragraph')
}

class KeepImageWithIntroPostprocessor extends Postprocessor {
  process (_document, output) {
    if (!output.includes('class="imageblock"') && !output.includes('class="image"')) return output
    const root = parseHTML(output)
    // Collect matches before mutating - mutating while iterating a live
    // querySelectorAll result risks skipping/misordering siblings once
    // they're re-parented into a wrapper.
    const imageUnits = root.querySelectorAll('div').filter(isImageUnit)
    imageUnits.forEach((imageUnit) => {
      const intro = imageUnit.previousElementSibling
      if (!isPlainParagraph(intro)) return
      const wrapper = parseHTML('<div class="keep-with-image"></div>').firstChild
      intro.before(wrapper)
      wrapper.appendChild(intro)
      wrapper.appendChild(imageUnit)
    })
    return root.toString()
  }
}

module.exports.register = function (registry) {
  registry.postprocessor(KeepImageWithIntroPostprocessor)
}
