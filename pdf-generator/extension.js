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
// A PDF contains a single version: the one being built. The playbook of a docset usually lists
// its other versions as branches of the same repository (HEAD, 5.x, 4.4, ...), and building them
// would render a PDF for each one, only to throw all but one away. A local content source is the
// repository being built, and HEAD is the branch that is checked out, so those sources are limited
// to HEAD, before any content is collected. Remote sources are left as they are.
const REMOTE_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i

function limitLocalSourcesToHead ({ playbook }) {
  const logger = this.getLogger?.('neo4j-pdf-generator')
  for (const source of playbook?.content?.sources ?? []) {
    if (REMOTE_URL.test(source.url ?? '')) continue
    const branches = [].concat(source.branches ?? [])
    if (branches.length === 1 && branches[0] === 'HEAD') continue
    source.branches = ['HEAD']
    logger?.info({ source: { url: source.url } }, 'Building HEAD only (was: %s)', branches.join(', ') || 'the playbook default')
  }
}

module.exports.register = function ({ config = {} } = {}) {
  this.once('playbookBuilt', limitLocalSourcesToHead.bind(this))
  const resolvedConfig = Object.assign({ configFile: DEFAULT_CONFIG_FILE }, config)
  return pdfExtension.register.call(this, { config: resolvedConfig })
}
