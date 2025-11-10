# aggregate-nav

Use the `aggregate-nav` extension to combine nav entries from multiple components.

## Usage

Add the extension in a playbook

```
antora:
  extensions:
  - require: "@neo4j-antora/aggregate-nav"
    log_level: info
    generate_nav: true
    consume_nav: false
```

Asciidoc pages will be grouped together in the navigation according to the value of the `page-tabs` attribute that is defined for each page.
Items are ordered in the nav by `page-tabs-index`.
