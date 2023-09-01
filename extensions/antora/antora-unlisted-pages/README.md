# antora-unlisted-pages

Detects pages that are not included in your site's navigation, and adds them to a new section at the end of the navigation, or removes them from the output.


## Usage

Add as an antora extension in a playbook. For example:

```
antora:
  extensions:
  - require: "@neo4j-antora/antora-unlisted-pages"
    add_to_navigation: true
    unlisted_pages_heading: 'Additional pages'
    log_level: 'warn'

```


## Options

| Name | Type | Description | Default
| ---- | ---- | ----------- | -------
| `add_to_navigation` | boolean | If set to `true`, the unlisted pages are appended as a new section in the table of contents. If set to `false`, the unlisted pages are removed from the output | `false`
| `unlisted_pages_heading` | string | The text that is displayed for the section appended to the navigation if `add_to_navigation` is set to `true`. | `Unlisted Pages`
| `log_level` | string | The level of log output. Valid values are: `info`, `warn`, `error`. | `info`
