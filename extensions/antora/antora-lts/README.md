# antora-lts

Use the `antora-lts` extension to mark a component version as LTS.

## Usage

Add the extension in a playbook

```
antora:
  extensions:
  - require: "@neo4j-antora/antora-lts.js"
```

Add `lts: true` to a component descriptor file (antora.yml)

## Using the CLI to add the extension

Although you will usually want to add the extension to a playbook, you can add it by using the Antora CLI.
You can do this with the `--extension` option:

```
--extension <PATH TO EXTENSION>
```