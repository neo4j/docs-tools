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

3. Add `lts: true` or `current: true` to a component descriptor file (_antora.yml_). The ui-bundle will display the corresponding text, `(LTS)` or `(Current)` after the component name and version in the version selector.


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
    lts:
      selector_text: '(LTS)'
```

In the default configuration, text is added in the version selector, after the component name and version, to 'Current' and 'LTS' releases.

By default, `current` is given the attribute value `unique: true`, meaning that for a given component, only one version can be considered 'Current'. An error is logged for a component if more than one version has a unique attribute defined in its _antora.yml_ file.


## Using the CLI to add the extension

Although you will usually want to add the extension to a playbook, you can add it by using the Antora CLI.
You can do this with the `--extension` option:

```
--extension <PATH TO EXTENSION>
```