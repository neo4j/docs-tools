# real-title-navtitle

`@antora/assembler` (used for PDF export, via `@neo4j-antora/pdf-generator`) builds every
merged page's own heading - and, from that, the PDF's own table of contents - from the
page's *nav* title, its link text in nav.adoc (e.g. `xref:page.adoc[Nav Text]`), not the
page's own `= Real Title` document title. Fine for a docset where the two always match,
but a docset making heavier use of custom nav link text - a shorter/clearer label for a
space-constrained web sidebar - gets a PDF where a table of contents entry's own wording
doesn't match the heading you land on when you follow it.

This extension makes every page default to assembling with its own real title instead,
while still respecting a page's own explicit `:assembly-navtitle:` attribute (Antora's own
escape hatch for a page that wants a *different* assembly title than both its nav text and
its own document title) if one is set.

Only takes effect during an `@antora/assembler` pass that's actually producing a PDF
(checks for the `assembler-filetype-pdf` attribute `@antora/assembler` seeds into every
page) - a no-op for a normal HTML build, so it's safe to leave registered permanently even
in a docset that only sometimes builds a PDF.

## Usage

Add as a dependency and register it in the playbook's own `asciidoc.extensions` list -
**not** `antora.yml`: `@antora/content-classifier`'s own per-component asciidoc config
only ever merges `antora.yml`'s own `asciidoc.attributes` into the site-wide config, never
`asciidoc.extensions` - an antora.yml-only registration is silently never loaded at all.

```yaml
asciidoc:
  extensions:
  - '@neo4j-antora/real-title-navtitle'
```
