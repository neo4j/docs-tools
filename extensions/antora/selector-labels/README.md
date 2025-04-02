# selector-labels

Use the `selector-labels` extension to add text to component versions in the version selector.


## Usage


1. Install the extension: `npm i @neo4j-antora/selector-labels`
2. Add the extension in a playbook

    ```
    antora:
      extensions:
      - require: "@neo4j-antora/selector-labels.js"
    ```

3. Add `lts: true` to a component descriptor file (_antora.yml_). The ui-bundle will display the corresponding text, `(LTS)` after the component name and version in the version selector for LTS releases, and `(Current)` for the latest release.

> Note that by default the latest release is determined using Antora's semantic [version ordering rules](https://docs.antora.org/antora/latest/how-component-versions-are-sorted/#determine-version-order). If you want to override this behaviour and manually mark a version as current you can do this by adding `current: true` to _antora.yml_ and providing your own extension config in the playbook. In the config, include `current:` and set `use_semantic: false` to prevent the latest version (as determined by Antora) from automatically being labeled as the current version.


## Config

You can define a custom list of attributes in the playbook.

If you do not define any attributes, the default values are used.
The default values are equivalent to adding the following to the playbook:

```
antora:
  extensions:
  - require: "@neo4j-antora/selector-labels.js"
    current:
      selector_text: '(Current)'
      unique: true
      use_semantic: true
    lts:
      selector_text: '(LTS)'
```

In the default configuration, text is added in the version selector, after the component name and version, to 'Current' and 'LTS' releases.

By default, `current` is given the attribute value `unique: true`, meaning that for a given component, only one version can be considered 'Current'. An error is logged for a component if more than one version has a unique attribute defined in its _antora.yml_ file. The extension uses Antora's semantic [version ordering rules](https://docs.antora.org/antora/latest/how-component-versions-are-sorted/#determine-version-order) to determine the latest version to mark as 'current'.


## Using the CLI to add the extension

Although you will usually want to add the extension to a playbook, you can add it by using the Antora CLI.
You can do this with the `--extension` option:

```
--extension <PATH TO EXTENSION>
```