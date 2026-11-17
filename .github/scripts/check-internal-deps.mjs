// Fails when a package in this repository depends on another package in this repository at a
// version other than the one in the repository. A package that loads a stale pinned copy of
// another one lags behind it: for example, pdf-generator reads the label list from its own copy
// of @neo4j-antora/roles-labels, so a stale pin leaves new labels out of PDFs.
//
// Compares package.json files only. A version bumped in a pull request is not on npm until the
// merge to dev publishes it. Peer dependencies are ranges by design and are not checked.
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] ?? '.'
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies']

const files = ['pdf-generator/package.json']
for (const dir of ['extensions/antora', 'extensions/asciidoc']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    const file = path.join(dir, name, 'package.json')
    if (fs.existsSync(path.join(root, file))) files.push(file)
  }
}
const packages = files.map((file) => ({ file, ...JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) }))
const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))

let failed = false
for (const pkg of packages) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, pinned] of Object.entries(pkg[field] ?? {})) {
      const dependency = byName.get(name)
      if (!dependency) continue
      if (pinned === dependency.version) {
        console.log(`${pkg.name} -> ${name} ${pinned}: in step`)
        continue
      }
      failed = true
      console.log(
        `::error file=${pkg.file}::${pkg.name} depends on ${name} ${pinned}, but ${dependency.file} is ${dependency.version}. ` +
          `Set the dependency to ${dependency.version} and bump the version of ${pkg.name} in the same pull request.`
      )
    }
  }
}
process.exit(failed ? 1 : 0)
