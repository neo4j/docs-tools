'use strict'

// @neo4j-documentation/remote-include exports its registration function
// directly (`module.exports = function () { this.includeProcessor(...) }`),
// which is what Antora's own extension loader expects, but not what
// asciidoctor-web-pdf's --extension loader does (it requires `lib.register`
// to be a function - see requireLibrary/_prepareExtensions in
// asciidoctor/lib/cli.js). This just bridges the two conventions.

const remoteInclude = require('@neo4j-documentation/remote-include')

module.exports.register = function (registry) {
  remoteInclude.call(registry)
}
