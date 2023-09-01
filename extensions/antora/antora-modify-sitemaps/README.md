# antora-modify-sitemaps

Use the `antora-modify-sitemaps` extension to modify the default Antora sitemap generation.

## Usage

Add the extension in a playbook

```
antora:
  extensions:
  - require: "@neo4j-antora/antora-modify-sitemaps"
    sitemap_version: '1.0'
    sitemap_loc_version: 'current'
    move_sitemaps_to_components: true
    data:
      components:
        my-component: 'my-version'
```

## Configuration

### sitemap_version

Required.

Specifies a version that will be used for the sitemap for all components in the site catalog.

You can override this value for specific components by using the `data` property.

**Note:** For versionless content, where the antora.yml file specifies `version: ~`, use `sitemap_version: '~'`.

### sitemap_loc_version

Optional.

If this is specified, updates the paths in the entries in each generated sitemap file, replacing the version with the value of  `sitemap_loc_version`.

For example, with `sitemap_loc_version: 'current'`

```
<loc>https://example.com/my-component/my-version/path/to/page/</loc>
```

is updated to:

```
<loc>https://example.com/my-component/current/path/to/page/</loc>
```

**Note:** If your content is versionless only, you do not need to specify a value for sitemap_loc_version, and any value you do specify is ignored for any versionless content.

### move_sitemaps_to_components

Optional.

If set to true, the sitemap for each component will be moved to _site/\<component>/\<sitemap_version>/sitemap.xml_

### data

Optional.

If some of your components have different versions that you want to generate a sitemap for, you can specify them with this option.

For example, if you have specified `sitemap_version: '2.0'`, but you have a component, `my-component` that is at version 1.0, you can generate a sitemap at _my-component/1.0/sitemap.xml_ with the following:

```
 data:
      components:
        my-component: '1.0'
```
