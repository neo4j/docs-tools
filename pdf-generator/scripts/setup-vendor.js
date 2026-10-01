#!/usr/bin/env node
'use strict'

// Runs as this package's own `postinstall` (see package.json) - installs
// asciidoctor-pdf + the exact Asciidoctor.js it needs (4.x) into vendor/,
// fresh, in whichever environment this package itself just got installed
// into. asciidoctor-pdf needs @asciidoctor/core 4.x while Antora needs 2.x,
// and asciidoctor-pdf doesn't declare @asciidoctor/core as its own
// dependency (only a peerDep on the `asciidoctor` wrapper) - npm has no
// signal to isolate it from a docset's own shared install, and can silently
// hoist Antora's incompatible 2.x copy in instead, which crashes at import
// time. A real, separate `npm install` in vendor/'s own directory - exactly
// what the old isolated `renderer/` project this replaces did by hand -
// fixes that; running it from this package's own `postinstall` makes it
// automatic instead of a manual convention a consumer has to know about.
//
// vendor/package.json is written here, at install time, rather than shipped
// as a static file in the published package: a *shipped* nested
// package.json triggers some npm install-time reorganization that quietly
// merges vendor/'s own subfolders into this package's root and drops the
// file entirely (confirmed directly, by inspecting exactly what a real `npm
// install` of a real packed tarball produces vs. what plain `tar -x` of that
// same tarball contains - the tarball itself was correct, so this is npm's
// install step specifically, not a packaging mistake). Writing it fresh here
// avoids whatever triggers that.
//
// A published package's own devDependencies (used for local development -
// see this package's package.json) are never installed for a consumer at
// all, so this can't just be `asciidoctor`/`asciidoctor-pdf` deps declared
// there instead - nothing would ever install them for anyone but a
// contributor working on this package directly.

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const vendorDir = path.join(__dirname, '../vendor')
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

fs.writeFileSync(
  path.join(vendorDir, 'package.json'),
  JSON.stringify(
    {
      name: 'pdf-generator-vendor',
      version: '1.0.0',
      private: true,
      dependencies: {
        asciidoctor: '4.1.0',
        'asciidoctor-pdf': '1.0.2',
      },
    },
    null,
    2
  ) + '\n'
)

const result = spawnSync(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: vendorDir,
  stdio: 'inherit',
})

if (result.error || result.status !== 0) {
  console.error('@neo4j-antora/pdf-generator: failed to install its isolated asciidoctor-pdf renderer (see vendor/package.json)')
  process.exit(result.status || 1)
}
