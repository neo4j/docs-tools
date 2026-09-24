'use strict'

const path = require('node:path')
const pdfExtension = require('@antora/pdf-extension')

const DEFAULT_CONFIG_FILE = path.join(__dirname, 'antora-assembler-pdf.yml')

// Lets a docset just do `- require: '@neo4j-antora/pdf-generator'` (or
// `antora --extension @neo4j-antora/pdf-generator`) instead of also having to
// know and specify this package's own antora-assembler-pdf.yml as
// @antora/pdf-extension's own configFile - this *is* @antora/pdf-extension,
// just pre-wired with this package's assembler config as the default. A
// docset that wants to override individual assembler settings can still pass
// its own `config:` in the playbook as normal (e.g. a different
// configFile); anything it doesn't set falls back to this default.
//
// Takes a single destructured `{ config }` parameter deliberately, matching
// the exact shape @antora/pdf-extension's own register() uses - Antora's
// generator-context inspects a register function's source to decide how to
// invoke it (see @antora/site-generator/lib/generator-context.js), and a
// destructured single parameter is the path that gets `this` bound to the
// generator context and a merged `{config, ...playbookVars}` object passed
// as the one argument - confirmed directly against the installed Antora,
// including that @antora/pdf-extension's own optional second `providers`
// parameter is never actually populated by a real Antora invocation either.
module.exports.register = function ({ config = {} } = {}) {
  const resolvedConfig = Object.assign({ configFile: DEFAULT_CONFIG_FILE }, config)
  return pdfExtension.register.call(this, { config: resolvedConfig })
}
