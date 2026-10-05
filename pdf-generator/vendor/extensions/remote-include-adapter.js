'use strict'

// @neo4j-documentation/remote-include exports its registration function
// directly (`module.exports = function () { this.includeProcessor(...) }`),
// which is what Antora's own extension loader expects, but not what
// asciidoctor-web-pdf's --extension loader does (it requires `lib.register`
// to be a function - see requireLibrary/_prepareExtensions in
// asciidoctor/lib/cli.js). This bridges the two conventions.
//
// It also works around a second, unrelated problem: the package's own
// includeProcessor body calls the pre-4.x Asciidoctor.js Opal-bridge API
// (`this.$option(...)`), removed in 4.x (now `this.option(...)`) - see
// macros-adapter.js for the same class of bug in a different package.
// Rather than patch the vendored file with patch-package (its postinstall
// hook isn't guaranteed to run once this package is itself a nested
// dependency of a docset's install - npm doesn't run a dependency's own
// lifecycle scripts by default), this wraps `registry.includeProcessor`
// so the callback's `this` transparently answers `$option` calls by
// forwarding to the real `option` method. Verified directly against the
// unpatched package and the installed Asciidoctor.js engine.

const remoteInclude = require('@neo4j-documentation/remote-include')

function shimOpalOptionApi (registry) {
  const original = registry.includeProcessor.bind(registry)
  registry.includeProcessor = function (fn) {
    return original(function (...args) {
      const target = this
      const self = new Proxy(target, {
        get (t, prop, receiver) {
          if (prop === '$option') return t.option.bind(t)
          return Reflect.get(t, prop, receiver)
        },
      })
      return fn.apply(self, args)
    })
  }
}

module.exports.register = function (registry) {
  shimOpalOptionApi(registry)
  remoteInclude.call(registry)
}
