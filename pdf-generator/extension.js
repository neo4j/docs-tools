'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const yaml = require('js-yaml')
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

// A repository that holds several docsets (components), such as docs-drivers, builds one PDF for
// each, as separate runs. PDF_DOCSET_PATH is the folder of the docset to build (as written in
// start_paths) and PDF_SHARED_PATHS lists the folders it depends on (comma-separated), which are
// kept without getting a PDF of their own. Both are environment variables because the extension is
// loaded from the Antora CLI, which has no way to pass it config. When the docset path is not set
// nothing here applies, and every component is rendered as before.
//
// The local content sources are limited to those folders, so the other docsets are not loaded, and
// the assembler is limited to the component of the docset, so only its PDF is rendered.
const normalizePath = (value) => value.trim().replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')

function limitToDocset ({ playbook }, config) {
  const docsetPath = normalizePath(process.env.PDF_DOCSET_PATH ?? '')
  if (!docsetPath) return
  const logger = this.getLogger?.('neo4j-pdf-generator')
  const sharedPaths = (process.env.PDF_SHARED_PATHS ?? '').split(',').map(normalizePath).filter(Boolean)
  let componentName
  for (const source of playbook?.content?.sources ?? []) {
    // Antora camel-cases the keys of the playbook it builds (startPaths); start_paths is the
    // spelling in the file, kept as a fallback.
    const key = source.startPaths ? 'startPaths' : 'start_paths'
    if (REMOTE_URL.test(source.url ?? '') || !source[key]) continue
    const startPaths = [].concat(source[key])
    if (!startPaths.some((startPath) => normalizePath(startPath) === docsetPath)) continue
    source[key] = startPaths.filter((startPath) => {
      const normalized = normalizePath(startPath)
      return normalized === docsetPath || sharedPaths.includes(normalized)
    })
    const descriptor = path.resolve(playbook.dir ?? '.', source.url ?? '.', docsetPath, 'antora.yml')
    componentName = yaml.load(fs.readFileSync(descriptor, 'utf8'))?.name
    if (!componentName) throw new Error(`@neo4j-antora/pdf-generator: no name in ${descriptor}`)
    logger?.info({ source: { url: source.url } }, 'Building %s only (start_paths: %s)', docsetPath, source[key].join(', '))
  }
  if (!componentName) {
    throw new Error(`@neo4j-antora/pdf-generator: PDF_DOCSET_PATH "${docsetPath}" is not in the start_paths of a local content source in the playbook`)
  }
  // The assembler reads its config file when navigation is built, after this runs, so a copy of the
  // config with the component filter set can be swapped in now.
  const baseFile = path.resolve(playbook.dir ?? '.', config.configFile)
  const assemblerConfig = yaml.load(fs.readFileSync(baseFile, 'utf8')) ?? {}
  assemblerConfig.component_version_filter = { names: [componentName] }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo4j-pdf-generator-'))
  config.configFile = path.join(dir, 'antora-assembler-pdf.yml')
  fs.writeFileSync(config.configFile, yaml.dump(assemblerConfig))
}

// When the renderer fails, the assembler logs nothing, adds no PDF and Antora still exits 0, so the
// failure only shows up later, when the workflow cannot find a PDF. Registered after
// @antora/pdf-extension, this runs once the assembler has added its PDFs to the content catalog,
// and fails the build if there are none.
function requirePdf ({ contentCatalog }) {
  const pdfs = contentCatalog.findBy({ family: 'export' }).filter((file) => file.out?.path?.endsWith('.pdf'))
  // A docset build renders exactly one PDF: more would mean the limit to the docset did not apply.
  if (process.env.PDF_DOCSET_PATH?.trim() && pdfs.length > 1) {
    throw new Error(`@neo4j-antora/pdf-generator: expected one PDF for PDF_DOCSET_PATH, found ${pdfs.length}`)
  }
  if (!pdfs.length) throw new Error('@neo4j-antora/pdf-generator: no PDF was generated (see the renderer output above)')
}

module.exports.register = function ({ config = {} } = {}) {
  this.once('playbookBuilt', limitLocalSourcesToHead.bind(this))
  const resolvedConfig = Object.assign({ configFile: DEFAULT_CONFIG_FILE }, config)
  this.once('playbookBuilt', (vars) => limitToDocset.call(this, vars, resolvedConfig))
  const result = pdfExtension.register.call(this, { config: resolvedConfig })
  this.once('navigationBuilt', requirePdf)
  return result
}
