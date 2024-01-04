# aliases-redirects

Use the `aliases-redirects` extension to modify the default Antora sitemap generation.

## Usage

Add the extension in a playbook

```
antora:
  extensions:
  - require: "@neo4j-antora/aliases-redirects.js"
    redirect_format: 'nginx'
    alias_log_level: 'error'
    log_found_aliases: true
```

## Options

| Name | Type | Description | Default
| ---- | ---- | ----------- | -------
| `redirect_format` | string | [Optional] The style of redirect declarations that Antora generates. If set to `neo4j`, the default Antora static meta refresh pages are not generated | `neo4j`
| `alias_log_level` | string | [Optional] The level of log messages when a page is moved or deleted in a new version, but no page-aliases are defined. | `info`
| `log_found_aliases` | boolean | [Optional] Add a message to the log when a page-alias is defined | `false`


## Using the CLI to add the extension

Although you will usually want to add the extension to a playbook, you can add it by using the Antora CLI.
You can do this with the `--extension` option:

```
--extension <PATH TO EXTENSION> --attribute aliasLogLevel='warn' --attribute logFoundAliases
```