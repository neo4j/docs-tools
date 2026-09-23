'use strict'

// @neo4j-documentation/macros' `label:x[]` inline macro reads
// `attr.$positional` (pre-4.x Asciidoctor.js's Opal-bridge attribute
// wrapper) to get the macro's positional text argument - removed in
// Asciidoctor.js 4.x, which instead hands a plain object with 1-indexed
// string keys (e.g. `{"1": "Custom text"}`). Without a fix, `attr.$positional`
// is just `undefined`, so any custom inline label text (e.g.
// `label:new[Custom text]`) is silently dropped in favour of the default
// display text - it doesn't throw, so this is easy to miss.
//
// Rather than patch the vendored file with patch-package (its postinstall
// hook isn't guaranteed to run once this package is itself a nested
// dependency of a docset's install - npm doesn't run a dependency's own
// lifecycle scripts by default), this wraps `registry.inlineMacro` so any
// attrs object handed to a macro's `process` callback gets `$positional`
// backfilled from those numeric keys, matching the shape macros.js expects.
//
// Must intercept via a Proxy rather than binding/replacing `self.process`
// directly - the installed Asciidoctor.js engine here is a compiled/WASM
// binding, and a `.bind()`'d reference to its native `process` method
// silently never invokes the callback it's given, even though calling it
// unbound (`target.process(fn)`) works correctly. Verified directly against
// the unpatched package and the installed engine.
const macros = require('@neo4j-documentation/macros')

function backfillPositionalAttrs (attrs) {
  if (!attrs || attrs.$positional) return
  const positional = []
  let i = 1
  while (attrs[String(i)] !== undefined) {
    positional.push(attrs[String(i)])
    i++
  }
  if (positional.length) attrs.$positional = positional
}

function shimOpalPositionalAttrs (registry) {
  const original = registry.inlineMacro.bind(registry)
  registry.inlineMacro = function (name, fn) {
    return original(name, function (...outerArgs) {
      const target = this
      const selfProxy = new Proxy(target, {
        get (t, prop, receiver) {
          if (prop === 'process') {
            return function (processFn) {
              return t.process(function (parent, macroTarget, attrs) {
                backfillPositionalAttrs(attrs)
                return processFn(parent, macroTarget, attrs)
              })
            }
          }
          return Reflect.get(t, prop, receiver)
        },
      })
      return fn.apply(selfProxy, outerArgs)
    })
  }
}

module.exports.register = function (registry, context) {
  shimOpalPositionalAttrs(registry)
  macros.register(registry, context)
}
