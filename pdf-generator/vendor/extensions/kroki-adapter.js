'use strict'

// Renders diagram blocks such as [graphviz] and [mermaid] as images from a Kroki server, the same
// way the asciidoctor-kroki extension does for the HTML site. asciidoctor-kroki itself cannot run
// here: it depends on the Opal API of Asciidoctor.js 2 and 3, and this renderer uses Asciidoctor.js
// 4 ("Opal is not defined"). Without this, every diagram is printed as its raw source.
//
// The image URL has the same format as the one asciidoctor-kroki builds:
// <kroki-server-url>/<diagram type>/svg/<source, deflated and base64url-encoded>
// kroki-server-url defaults to https://kroki.io, as it does in asciidoctor-kroki.
const zlib = require('node:zlib')

const DIAGRAM_TYPES = [
  'actdiag', 'blockdiag', 'bpmn', 'bytefield', 'c4plantuml', 'd2', 'dbml', 'ditaa', 'erd',
  'excalidraw', 'graphviz', 'mermaid', 'nomnoml', 'nwdiag', 'packetdiag', 'pikchr', 'plantuml',
  'rackdiag', 'seqdiag', 'structurizr', 'svgbob', 'symbolator', 'tikz', 'umlet', 'vega', 'vegalite',
  'wavedrom', 'wireviz',
]

function encode (source) {
  return zlib.deflateSync(Buffer.from(source, 'utf8'), { level: 9 }).toString('base64url')
}

module.exports.register = function (registry) {
  for (const type of DIAGRAM_TYPES) {
    registry.block(type, function () {
      this.onContexts('listing', 'literal')
      this.process(function (parent, reader, attrs) {
        const server = String(parent.getDocument().getAttribute('kroki-server-url', 'https://kroki.io')).replace(/\/+$/, '')
        const target = `${server}/${type}/svg/${encode(reader.getLines().join('\n'))}`
        const imageAttrs = { target, alt: attrs.alt || `${type} diagram` }
        for (const name of ['id', 'title', 'role', 'width', 'height', 'align']) {
          if (attrs[name] != null) imageAttrs[name] = attrs[name]
        }
        return this.createImageBlock(parent, imageAttrs)
      })
    })
  }
}
