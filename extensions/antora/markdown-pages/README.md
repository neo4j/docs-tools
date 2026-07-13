# @neo4j-antora/markdown-pages

An Antora site-generator extension that emits a **Markdown version of every published page**
(a sibling `.md` next to each page) for LLM consumption. An LLM or fetch tool can retrieve the
Markdown for any page by appending `.md` to its URL: `/docs/x/y/` → `/docs/x/y.md`.

## How it works

Runs at the **`pagesComposed`** event (after Asciidoctor conversion *and* the `roles-labels` /
`table-footnotes` extensions), selects each page's `article.doc` content node, and converts that
HTML to Markdown with [`turndown`](https://github.com/mixmark-io/turndown) (+ the GFM plugin for
tables). Because it converts the generated HTML, all AsciiDoc features are already resolved
(includes, attributes, xrefs → real links, `label:` and other macros).

Custom conversion handling:

- **Code blocks** → fenced, with the source language, syntax-highlight spans stripped.
- **Admonitions** (NOTE/TIP/IMPORTANT/WARNING/CAUTION) → GitHub-style `> **NOTE**` blockquotes.
- **Tables** → header tables become GFM; clean headerless 2-column tables become key/value
  blocks; genuinely complex/irregular tables (colspan, embedded sub-grids — e.g. Cypher function
  "Details" tables) are kept as HTML, which is valid Markdown and unambiguous for LLMs.
- **Heading anchors** → the `<a class="anchor">` self-links are dropped.
- **Links/images** → optionally rewritten to absolute URLs (portable for LLMs).

Each file gets minimal YAML frontmatter (`title`, absolute `url`) unless disabled.

## Usage

In an Antora playbook:

```yaml
antora:
  extensions:
  - "@neo4j-antora/markdown-pages"        # or a local path: ./extensions/antora/markdown-pages
```

With options:

```yaml
antora:
  extensions:
  - require: "@neo4j-antora/markdown-pages"
    frontmatter: true        # emit YAML frontmatter (default true)
    absolute_links: true     # rewrite relative href/src to absolute (default true)
```

| Option | Default | Description |
|---|---|---|
| `frontmatter` | `true` | Prepend `title` + `url` YAML frontmatter to each `.md`. |
| `absoluteLinks` / `absolute_links` | `true` | Resolve relative links/images to absolute URLs (needs `site.url`). |

## Output

The `.md` mirrors the HTML output path with the extension swapped, so it sits right beside the
HTML: `x/y/index.html` → `x/y/index.md` (indexify); `a/b/c.html` → `a/b/c.md`. Files are added to
the site catalog, so they publish alongside the HTML.

## Not (yet) handled

Root `llms.txt` index and `llms-full.txt` concatenation; tabbed/collapsible blocks and
callout-annotated code convert best-effort. See the repo plan for the roadmap.
