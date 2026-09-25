'use strict'

// @djencks/asciidoctor-mathjax's tree processor was written against the
// pre-4.x Asciidoctor.js Opal-bridge API - removed in the 4.x engine this
// vendored asciidoctor-web-pdf requires (see macros-adapter.js/
// remote-include-adapter.js for the same class of bug in other packages):
//   - `doc.$playback_attributes(...)` / `doc.$restore_attributes()` -> now
//     plain `doc.playbackAttributes(...)` / `doc.restoreAttributes()`
//     (Document instance methods, no `$`-prefixed alias kept in 4.x).
//   - `processor.$create_pass_block(...)` -> now `processor.createPassBlock(...)`.
//   - `stem.attributes.$$smap.role` - `$$smap` was Ruby Hash's internal
//     string-keyed map, exposed by Opal; 4.x attributes are a plain object,
//     so this is just `stem.attributes.role`.
//   - `Opal.hash({})` - passed as an empty attrs argument; no `Opal` global
//     exists in this engine at all (it isn't Opal-compiled), so this throws
//     a bare ReferenceError. An empty plain object is the exact equivalent.
//   - `cell.$inner_document()` - `innerDocument` is a plain getter property
//     in 4.x, not a method.
//
// These are direct property/method accesses buried inside the package's own
// module-level functions (not calls made through a `this`/callback we
// control), so a `registry.*` proxy shim like the other adapters use can't
// reach them. Instead this loads the real file's source and rewrites just
// those call sites in memory before evaluating it - not patch-package,
// since its postinstall hook isn't guaranteed to run once this package is a
// nested dependency of a docset's own install (see this package's own
// README). Verified directly against the unpatched package and the
// installed Asciidoctor.js engine.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const REPLACEMENTS = [
  [/\.\$playback_attributes\(/g, '.playbackAttributes('],
  [/\.\$restore_attributes\(/g, '.restoreAttributes('],
  [/\.\$create_pass_block\(/g, '.createPassBlock('],
  [/stem\.attributes\.\$\$smap\.role/g, 'stem.attributes.role'],
  [/Opal\.hash\(\{\}\)/g, '{}'],
  [/\.\$inner_document\(\)/g, '.innerDocument'],
]

function resolveSource (id) {
  // See scripts/convert.js's own resolveMathjaxSource comment: this file's
  // real (symlink-dereferenced) location isn't the docset's own
  // node_modules under `npm link`, so fall back to a resolve rooted at the
  // working directory (antora's cwd is always the docset being built).
  try {
    return require.resolve(id)
  } catch {
    return require.resolve(id, { paths: [process.cwd()] })
  }
}

function loadPatched (id) {
  const target = resolveSource(id)
  let src = fs.readFileSync(target, 'utf8')
  for (const [pattern, replacement] of REPLACEMENTS) src = src.replace(pattern, replacement)
  const patched = new Module(target, module)
  patched.filename = target
  patched.paths = Module._nodeModulePaths(path.dirname(target))
  patched._compile(src, target)
  return patched.exports
}

const mathjax = loadPatched('@djencks/asciidoctor-mathjax')

module.exports.register = function (registry, context) {
  mathjax.register(registry, context)
}
