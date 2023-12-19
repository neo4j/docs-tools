# aliases-redirects

Use the `aliases-redirects` extension to modify the default Antora sitemap generation.

## Usage

Add the extension in a playbook

```
antora:
  extensions:
  - require: "@neo4j-antora/aliases-redirects.js"
    redirect_format: 'neo4j'
```

## Configuration

