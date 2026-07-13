'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { htmlToMarkdown, mdOutPath, joinUrl } = require('./markdown-pages')

const ARTICLE = `<article class="doc">
<h1 class="page">My Page<a class="anchor" href="#my-page"></a></h1>
<div class="paragraph"><p>Intro with an <a href="../other/">xref</a> and <code>inline</code> code.</p></div>
<div class="admonitionblock warning"><table><tr><td class="icon"></td><td class="content"><div class="paragraph"><p>Careful.</p></div></td></tr></table></div>
<div class="listingblock"><div class="content"><pre class="highlightjs highlight"><code data-lang="cypher" class="language-cypher hljs">MATCH (n)
RETURN n</code></pre></div></div>
<table class="tableblock frame-all grid-all"><thead><tr><th class="tableblock"><p class="tableblock">A</p></th><th class="tableblock"><p class="tableblock">B</p></th></tr></thead><tbody><tr><td class="tableblock"><p class="tableblock">one</p></td><td class="tableblock"><p class="tableblock">two</p></td></tr></tbody></table>
</article>`

test('converts the page heading and strips the self-link anchor', () => {
  const md = htmlToMarkdown(ARTICLE, { title: 'My Page' })
  assert.match(md, /^# My Page$/m)
  assert.doesNotMatch(md, /\]\(#my-page\)/) // anchor link gone
})

test('renders fenced code with language, no highlight spans', () => {
  const md = htmlToMarkdown(ARTICLE, {})
  assert.match(md, /```cypher\nMATCH \(n\)\nRETURN n\n```/)
})

test('renders admonitions as GitHub-style blockquotes with the kind', () => {
  const md = htmlToMarkdown(ARTICLE, {})
  assert.match(md, /> \*\*WARNING\*\*/)
  assert.match(md, /> Careful\./)
})

test('renders tables as GFM (cell paragraphs inlined)', () => {
  const md = htmlToMarkdown(ARTICLE, {})
  assert.match(md, /\| A +\| B +\|/)
  assert.match(md, /\| one +\| two +\|/)
})

const KV_TABLE = `<article class="doc"><table class="tableblock noheader"><caption class="title">Details</caption><tbody>
<tr><td class="tableblock"><p class="tableblock"><strong>Syntax</strong></p></td><td class="tableblock" colspan="3"><p class="tableblock"><code>avg(input)</code></p></td></tr>
<tr><td class="tableblock"><p class="tableblock"><strong>Description</strong></p></td><td class="tableblock" colspan="3"><div class="content"><div class="paragraph"><p>Returns the average.</p></div><div class="paragraph"><p>Second para.</p></div></div></td></tr>
</tbody></table></article>`

test('headerless 2-column tables render as key/value blocks (no raw HTML)', () => {
  const md = htmlToMarkdown(KV_TABLE, {})
  assert.doesNotMatch(md, /<table/)
  assert.match(md, /\*\*Details\*\*/) // caption
  assert.match(md, /\*\*Syntax\*\*\n\n`avg\(input\)`/)
  assert.match(md, /\*\*Description\*\*\n\nReturns the average\.\n\nSecond para\./)
})

const COMPLEX_TABLE = `<article class="doc"><table class="tableblock"><caption class="title">Details</caption><tbody>
<tr><td><p><strong>Arguments</strong></p></td><td><p><strong>Name</strong></p></td><td><p><strong>Type</strong></p></td><td><p><strong>Description</strong></p></td></tr>
<tr><td><p><code>input</code></p></td><td colspan="3"><p>a value</p></td></tr>
</tbody></table></article>`

test('irregular headerless tables (embedded sub-grid) are kept as HTML, not mangled', () => {
  const md = htmlToMarkdown(COMPLEX_TABLE, {})
  assert.match(md, /<table/) // kept as HTML rather than flattened
  assert.match(md, /Arguments/)
})

// roles-labels nests <div class="labels"> INSIDE the labeled element.
const LABELED_HEADING = `<article class="doc"><h1 class="page header-label-container">Docs tools<div class="labels"><span class="label content-label label--aura-db-business-critical">AuraDB Business Critical</span><span class="label content-label label--enterprise-edition">Enterprise Edition</span><span class="label content-label label--community-edition">Community Edition</span></div></h1><div class="paragraph"><p>Body.</p></div></article>`
const LABELED_PARAGRAPH = `<article class="doc"><div class="paragraph has-label"><div class="labels"><span class="label content-label label--draft">Draft</span></div><p>This paragraph is marked as draft.</p></div></article>`

test('merges labels onto the heading line as inline (`label` ...) badges', () => {
  const md = htmlToMarkdown(LABELED_HEADING, { title: 'Docs tools' })
  assert.match(md, /^# Docs tools \(`AuraDB Business Critical` `Enterprise Edition` `Community Edition`\)$/m)
  assert.doesNotMatch(md, /CriticalEnterprise/) // the reported concatenation bug
})

test('renders labels on non-heading blocks (paragraph) as bare badges, no parens', () => {
  const md = htmlToMarkdown(LABELED_PARAGRAPH, {})
  assert.match(md, /`Draft`/)
  assert.doesNotMatch(md, /\(`Draft`\)/) // parentheses are heading-only
  assert.match(md, /This paragraph is marked as draft\./)
})

test('absolutizes relative links against the page base URL', () => {
  const md = htmlToMarkdown(ARTICLE, { baseUrl: 'https://neo4j.com/docs/comp/1/page/' })
  assert.match(md, /\(https:\/\/neo4j\.com\/docs\/comp\/1\/other\/\)/)
})

test('leaves relative links relative when no base URL', () => {
  const md = htmlToMarkdown(ARTICLE, {})
  assert.match(md, /\(\.\.\/other\/\)/)
})

test('mdOutPath mirrors the HTML path (.md beside .html)', () => {
  assert.strictEqual(mdOutPath('index.html'), 'index.md')
  assert.strictEqual(mdOutPath('http-api/index.html'), 'http-api/index.md')
  assert.strictEqual(mdOutPath('a/b/c.html'), 'a/b/c.md')
})

test('joinUrl concatenates site URL and root-relative page URL', () => {
  assert.strictEqual(joinUrl('https://neo4j.com/docs', '/x/y/'), 'https://neo4j.com/docs/x/y/')
  assert.strictEqual(joinUrl('https://neo4j.com/docs/', '/x/y/'), 'https://neo4j.com/docs/x/y/')
})
