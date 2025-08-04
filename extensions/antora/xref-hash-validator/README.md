# xref-hash-validator

Validates xrefs where the target is in the same docset and includes a hash, specifying a section of a page (ex. `xref:functions/temporal/index.adoc#functions-date`).

## Usage

Add the extension in a playbook

```
antora:
  extensions:
  - require: "@neo4j-antora/xref-hash-validator"
```
