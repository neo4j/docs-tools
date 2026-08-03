const { posix: path, resolve } = require('path')
const File = require('vinyl')
const fs = require('fs')
const { title } = require('process')

// Filename used for per-component nav shards. The same name is referenced by
// the S3 aggregator (./aggregate.js) when discovering shards.
const SHARD_FILENAME = 'nav.json'

// const { buildNavigation, NavigationCatalog } = require('@antora/navigation-builder')

module.exports.register = function ({ config }) {

  const {
    logLevel = 'info',
    tabNavFile = 'nav/tabs.json',
    // All stages default to true so the canonical writer workflow ("antora preview
    // --extension nav.js") gets the full pipeline with no extra config. Actors
    // that need a subset (per-docset CI publish, central aggregator job, docs-home
    // build) opt out of the stages they don't want.
    generateNav = true,
    fetchNav = true,
    aggregateNav = true,
    consumeNav = true,
    // emitLocalManifest: when true, write a /local-manifest.json listing the
    // components and versions present in this build. Used by the UI bundle's
    // local-tabs decoration on static hosts (PR previews, etc.) that don't
    // have the express middleware to serve the manifest dynamically. Default
    // off so production publishes don't emit a misleading manifest. Can also
    // be enabled via the DOCS_EMIT_LOCAL_MANIFEST env var so a shared CI
    // workflow can flip it for PR builds without each docset's playbook
    // carrying the flag.
    emitLocalManifest = false,
    // navUrl: a URL returning an aggregated tabs.json. The fetch stage GETs it
    // and pushes the result as one merged "everything" shard. Resolution priority
    // is config > DOCS_NAV_URL env var > derived from playbook.site.url (see below).
    navUrl,
  } = config

  // Shards collected by generateNav (and, in the future, by fetchNav). aggregateNav
  // deep-merges them into a single tabs.json.
  const navShards = []

  // Holds the merged tab nav produced by aggregateNav so consumeNav can read it
  // from memory in the same Antora invocation (avoids reading from disk before
  // siteCatalog has been flushed). Falls back to disk when aggregateNav didn't
  // run in this process.
  let mergedTabNav = null

  const logger = this.getLogger('custom-nav')
    // this is a replacement of the covertDocuments function that skips the asciidoc > html conversion
    // we are only interested in the nav at this point.
    // either for speed or because we will just find a way to save the nave for a file somewhere
    // and retrieve it on the fly

    // we still need to have some sort of understanding of the asciidoc though
    // because we need to get page-attributes etc

    this.once('contextStarted', ({ playbook }) => {
      logger[logLevel]('custom-nav extension initialized (generateNav: %s, aggregateNav: %s, consumeNav: %s)', generateNav, aggregateNav, consumeNav)

      // Expose DOCS_URL to templates as the page-docs-url attribute so layouts
      // (head-meta.hbs renders a meta tag, 404.hbs uses it to construct a "view
      // on the published docs" link) can reach it. Set once on the playbook's
      // asciidoc attributes; Antora propagates to every page via the standard
      // attribute-inheritance path. Locked (trailing @ removed in Antora's
      // canonical form via direct assignment — playbook attributes always win
      // here).
      const docsUrl = process.env.DOCS_URL
      if (docsUrl && playbook && playbook.asciidoc && playbook.asciidoc.attributes) {
        playbook.asciidoc.attributes['page-docs-url'] = docsUrl
        logger[logLevel]({ docsUrl }, 'Set page-docs-url attribute from DOCS_URL env')
      }
      // Previously we replaced Antora's convertDocuments here to skip asciidoc→HTML
      // conversion when only the nav was needed. That speed shortcut conflicts with
      // any flow that also wants HTML (the writer's all-in-one preview, per-docset
      // CI publish, etc.), so it's gone. HTML rendering is now always Antora's
      // default and the nav stages run alongside it.
    })

    this.once('navigationBuilt', async ({ contentCatalog, siteCatalog, playbook }) => {

      // we need to do stuff to the nav for the thing we are building, regardless of whether we are generating
      // an aggregate nav or consuming it

      contentCatalog.getComponents().forEach(({ latest, versions }) => {
          // console.log(versions)
          // console.log(latest)

          // at this point, instead of getting all the versions
          // we only need to get the nav for the latest version of the component
          // or if the component has only one version

          versions.forEach(({ name: component, version, navigation, url, asciidoc }) => {

            if (!navigation || !navigation.length) return

            // Build a URL→page map once per component+version instead of calling
            // contentCatalog.findBy on every nav item lookup
            const pagesByUrl = new Map(
              contentCatalog.findBy({ component, version, family: 'page' })
                .filter(p => p.pub)
                .map(p => [p.pub.url, p])
            )

            for (const nav of navigation) {

              // Url-less leaf items (section headers, or link items Antora didn't
              // parse a url out of) awaiting backfill once a later sibling resolves
              // a real tab. Kept as a list, not a single slot - two such items in a
              // row (e.g. a bare link followed by a section header) would otherwise
              // have the second overwrite the first's reference before it backfills.
              let provisionalItems = []

              for (const item of nav.items) {

                // Some external-link AsciiDoc syntax (e.g. the `link:` macro) leaves
                // Antora's nav builder without a parsed .url - the href only shows up
                // baked into .content as a raw <a> tag. Promote it to a real .url/.content
                // pair so this item flows through the same "resolved link" handling as
                // every other nav link below, instead of falling into the leaf/section-header
                // path and losing its nav-link styling (indentation, hover state, etc.) in
                // the nav-tree template's raw-content fallback.
                if (!item.url && item.content) {
                  const linkMatch = /^\s*<a\s+href="([^"]+)"[^>]*>(.*)<\/a>\s*$/s.exec(item.content)
                  if (linkMatch) {
                    item.url = linkMatch[1]
                    item.urlType = 'external'
                    item.content = linkMatch[2]
                  }
                }

                if (!item.url) {
                  if (!item.items || item.items.length === 0) {
                    addTabInfoToNavItem(item, component, version, 'provisional-tab', 99999, latest.title, pagesByUrl)
                    provisionalItems.push(item)
                    continue
                  }

                  // Determine the section's tab from the first child that has one
                  for (const ci of item.items) {
                    const p = pagesByUrl.get(ci.url)
                    if (p && p.asciidoc && p.asciidoc.attributes['page-tabs']) {
                      item.pageTabs = p.asciidoc.attributes['page-tabs']
                      item.tabIndex = p.asciidoc.attributes['page-tabs-index']
                        ? parseInt(p.asciidoc.attributes['page-tabs-index'])
                        : 99999
                      item.component = component
                      item.componentTitle = latest.title
                      item.componentVersion = version
                      break
                    }
                  }

                  for (const childItem of item.items) {
                    const page = pagesByUrl.get(childItem.url)
                    if (!page || !page.asciidoc) continue

                    const childTab = page.asciidoc.attributes['page-tabs']

                    if (item.pageTabs) {
                      if (childTab && childTab !== item.pageTabs) {
                        logger.warn(
                          { file: page.src, source: page.src.origin },
                          `Navigation item "${childItem.content}" has page-tabs "${childTab}" but its section "${item.content}" is in tab "${item.pageTabs}" — overriding to match section`
                        )
                      } else if (!childTab) {
                        logger.info(
                          { file: page.src, source: page.src.origin },
                          `Navigation item "${childItem.content}" has no page-tabs — inheriting section tab "${item.pageTabs}"`
                        )
                      }
                      // All children inherit the section's tab, including those with no page-tabs attribute
                      addTabInfoToNavItem(childItem, component, version, item.pageTabs, item.tabIndex, latest.title, pagesByUrl)
                      logger.debug({file: page.src, source: page.src.origin}, `Navigation item: ${childItem.content} assigned tab "${item.pageTabs}"`)
                    } else {
                      logger[logLevel]({file: page.src, source: page.src.origin}, `Navigation item: ${childItem.content} has no section tab — unassigned`)
                    }
                  }
                  // Propagate navPromote from direct child pages up to the section item
                  if (item.items.some(ci => ci.navPromote && ci.url)) {
                    item.navPromote = true
                  }
                } else {

                  const page = pagesByUrl.get(item.url)

                  // A page-tabs value to use: prefer the specific page's own attribute,
                  // but fall back to the component-wide default (set in antora.yml/the
                  // playbook) for items whose url doesn't resolve to a page in this
                  // component at all - e.g. an external link (GraphAcademy course, etc.),
                  // which can never carry a per-page attribute since there's no page.
                  // The component-wide fallback comes straight from antora.yml, unprocessed by
                  // Asciidoctor - so a soft-set value like "drivers-apis@" still has its trailing
                  // "@" (Asciidoctor strips this marker when it resolves a page's own attributes,
                  // which is why the per-page value never needs this).
                  const pageTabs = (page && page.asciidoc && page.asciidoc.attributes['page-tabs']) ||
                    (asciidoc && asciidoc.attributes && asciidoc.attributes['page-tabs'] && asciidoc.attributes['page-tabs'].replace(/@$/, ''))
                  const pageTabsIndex = (page && page.asciidoc && page.asciidoc.attributes['page-tabs-index']) ||
                    (asciidoc && asciidoc.attributes && asciidoc.attributes['page-tabs-index'])

                  if (pageTabs) {

                    addTabInfoToNavItem(item, component, version, pageTabs, pageTabsIndex || 99999, latest.title, pagesByUrl)

                    if (provisionalItems.length) {
                      for (const pending of provisionalItems) {
                        addTabInfoToNavItem(pending, component, version, item.pageTabs, item.tabIndex || 99999, latest.title, pagesByUrl)
                      }
                      provisionalItems = []
                    }
                  }

                }

              }

            }

          })

        })

      // Fetch stage runs before generate so locally-generated shards override
      // fetched data during the aggregate merge (writer's local changes win).
      // Source URL is resolved with this priority:
      //   1. nav_url in playbook config (explicit per-playbook override)
      //   2. DOCS_NAV_URL env var (explicit per-invocation override of just the nav URL)
      //   3. DOCS_URL + /nav/tabs.json (derived from the writer's single "where docs live" var)
      //   4. <playbook.site.url>/nav/tabs.json (last-resort fallback — usually points at prod)
      const resolvedNavUrl =
        navUrl ||
        process.env.DOCS_NAV_URL ||
        (process.env.DOCS_URL
          ? process.env.DOCS_URL.replace(/\/+$/, '') + '/nav/tabs.json'
          : null) ||
        (playbook.site && playbook.site.url
          ? playbook.site.url.replace(/\/+$/, '') + '/nav/tabs.json'
          : null)

      if (fetchNav && resolvedNavUrl) {
        try {
          const res = await fetch(resolvedNavUrl)
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          navShards.push(data)
          logger[logLevel]({ url: resolvedNavUrl }, 'Fetched aggregated nav from URL')
        } catch (e) {
          logger.warn('Could not fetch nav from %s: %s', resolvedNavUrl, e.message)
        }
      }

      if (generateNav) {


        const tabNavContents = {}

        contentCatalog.getComponents().forEach(({ latest, versions }) => {
          // console.log(versions)
          logger.debug(`latest.title: ${latest.title}`)

          // after updating all the nav items we need to go through it again and add tabNav to the relevant pages
          // we do this as a second run through because we will probably have updated the page-tabs attribute for some pages
          // because they might have a tab assigned from antora.yml
          // but they are in a section of the nav so they are a child of a parent that has a different tab

          versions.forEach(({ name: component, version, navigation, url, asciidoc }) => {

            if (!navigation || !navigation.length) return

            const docsetGroup = asciidoc && asciidoc.attributes && asciidoc.attributes['page-tabs-group']

            for (const nav of navigation) {
              for (const item of nav.items) {

                logger.debug('Processing nav item: %s', item.content)

                  if (item.pageTabs) {
                    item.componentTitle = latest.title

                    // Skip non-latest versions unless this version belongs to a docset group —
                    // grouped components need all versions in the JSON so the UI can match by version.
                    if (!docsetGroup && version !== latest.version && versions.length > 1) {
                      continue
                    }

                    if (!tabNavContents[item.pageTabs]) {
                      tabNavContents[item.pageTabs] = {}
                    }

                    if (!tabNavContents[item.pageTabs][component]) {
                      tabNavContents[item.pageTabs][component] = {}
                    }

                    if (!tabNavContents[item.pageTabs][component][version]) {
                      tabNavContents[item.pageTabs][component][version] = {
                        title: latest.title,
                        tabIndex: item.tabIndex || 99999,
                        latest: version === latest.version,
                        ...(docsetGroup && { docsetGroup }),
                        items: []
                      }
                    }

                    // if the item has child items we need to find out which have the same tab and add those
                    if (item.items && item.items.length) {
                      const childItemsWithSameTab = item.items.filter( (childItem) => childItem.pageTabs === item.pageTabs )
                      // console.log(childItemsWithSameTab.length, 'child items with same tab found for', item.content)
                      item.items = childItemsWithSameTab
                    }

                    tabNavContents[item.pageTabs][component][version].items.push(item)

                  }

              }

            }

          })

        })

        // console.log(tabNavContents)

        // Per-component nav shards. Each shard mirrors tabs.json's shape but
        // contains only one component's data — i.e. a vertical slice across
        // tabs for that component. Each shard is also pushed onto navShards
        // so aggregateNav can produce the merged tabs.json without re-reading
        // from disk.
        const componentNames = new Set()
        for (const tab of Object.keys(tabNavContents)) {
          for (const component of Object.keys(tabNavContents[tab])) {
            componentNames.add(component)
          }
        }

        for (const component of componentNames) {
          const shard = {}
          for (const tab of Object.keys(tabNavContents)) {
            if (tabNavContents[tab][component]) {
              if (!shard[tab]) shard[tab] = {}
              shard[tab][component] = tabNavContents[tab][component]
            }
          }
          navShards.push(shard)
          const shardPath = `${component}/${SHARD_FILENAME}`
          siteCatalog.addFile(generateTabNavFile(shard, shardPath))
          logger.debug({ file: shardPath }, 'Component nav shard generated')
        }
        logger[logLevel]('Generated %d per-component nav shards', componentNames.size)

      }

      if (aggregateNav) {
        const merged = {}
        for (const shard of navShards) {
          deepMerge(merged, shard)
        }
        mergedTabNav = merged
        siteCatalog.addFile(generateTabNavFile(merged, tabNavFile))
        logger[logLevel]({ file: tabNavFile, shards: navShards.length }, 'Aggregated nav file written')
      }

      if (emitLocalManifest || process.env.DOCS_EMIT_LOCAL_MANIFEST) {
        // Same shape the dev-server middleware returns from a filesystem scan:
        // { components: { name: [versions] } }. Lets the UI bundle's local-tabs
        // decoration work on static hosts (PR previews, surge.sh, etc.) that
        // don't have the middleware. Path is 'local-manifest.json' at the
        // site root so it lines up with the URL the client JS fetches
        // (<sitePath>/local-manifest.json).
        const manifest = { components: {} }
        for (const { name, versions } of contentCatalog.getComponents()) {
          manifest.components[name] = versions.map((v) => v.version || '')
        }
        siteCatalog.addFile(generateTabNavFile(manifest, 'local-manifest.json'))
        logger[logLevel]({ components: Object.keys(manifest.components).length }, 'Local manifest emitted')
      }


      if (consumeNav) {

        let navFromFile
        if (mergedTabNav) {
          logger[logLevel]('Consuming tab nav from memory (aggregated this run)')
          navFromFile = mergedTabNav
        } else {
          const navFilePath = path.join((playbook.output.dir || '.'), tabNavFile)
          logger[logLevel]('Consuming tab nav file from: %s', navFilePath)
          navFromFile = JSON.parse(fs.readFileSync(navFilePath, 'utf8'))
        }

        // Sort components in each tab by tabIndex once, up front
        for (const tab of Object.keys(navFromFile)) {
          navFromFile[tab] = Object.fromEntries(
            Object.entries(navFromFile[tab]).sort(([, a], [, b]) => {
              const aIndex = Math.min(...Object.values(a).map(v => v.tabIndex || 99999))
              const bIndex = Math.min(...Object.values(b).map(v => v.tabIndex || 99999))
              return aIndex - bIndex
            })
          )
        }

        // Cache page list once — avoids rescanning the full catalog per tab
        const allPages = contentCatalog.findBy({ family: 'page' })
        const tabPageCounts = {}

        for (const tab of Object.keys(navFromFile)) {

          // Build the tabNav structure once per tab
          const tabNav = [{ items: [], root: true, order: 0 }]
          for (const [component, versions] of Object.entries(navFromFile[tab])) {
            for (const [version, versionData] of Object.entries(versions)) {
              logger.debug(` - tab "${tab}": ${component}@${version} has ${versionData.items.length} nav items`)

              const promotedItems = versionData.items.filter(item => item.navPromote)
              // Keep text-only section titles too (e.g. "* *Regular workflow*" written as a
              // flat sibling, not a parent with nested items) - they have neither a url nor
              // child items, but do have content, and the renderer already knows how to
              // render that shape as a plain section header.
              const normalItems = versionData.items.filter(item => !item.navPromote && (item.url || item.content || (item.items && item.items.length)))

              for (const item of promotedItems) {
                const sectionTitle = item.content ? stripTags(item.content).trim() : versionData.title
                tabNav[0].items.push({
                  content: sectionTitle,
                  tabIndex: item.tabIndex || versionData.tabIndex || 99999,
                  component,
                  componentVersion: version,
                  componentTitle: sectionTitle,
                  componentHeader: true,
                  latest: versionData.latest,
                  ...(versionData.docsetGroup && { docsetGroup: versionData.docsetGroup }),
                  items: item.items || [],
                })
              }

              if (normalItems.length > 0) {
                tabNav[0].items.push({
                  content: versionData.title,
                  tabIndex: versionData.tabIndex || 99999,
                  component,
                  componentVersion: version,
                  componentTitle: versionData.title,
                  componentHeader: true,
                  latest: versionData.latest,
                  ...(versionData.docsetGroup && { docsetGroup: versionData.docsetGroup }),
                  items: normalItems,
                })
              }
            }
          }

          // Serialise once per tab — all pages in the same tab share identical nav
          const tabNavString = JSON.stringify(tabNav)

          const pagesWithThisTab = allPages.filter(
            (page) => page.asciidoc && page.asciidoc.attributes['page-tabs'] === tab
          )
          tabPageCounts[tab] = pagesWithThisTab.length

          for (const page of pagesWithThisTab) {
            page.asciidoc.attributes['page-tabNav'] = tabNavString
          }
        }

        for (const [tab, count] of Object.entries(tabPageCounts)) {
          logger[logLevel]('Tab nav assigned: %s (%d pages)', tab, count)
        }

      }





      // add pageTabs to nav items
      // recurse where item has child items
      function addTabInfoToNavItem (item, component, version, tab, index=99999, title='', pagesByUrl=new Map()) {
        if (item.items && item.items.length) {
          for (const childItem of item.items) {
            addTabInfoToNavItem(childItem, component, version, tab, index, title, pagesByUrl)
          }
          // Propagate navPromote from direct child pages (with URLs) up to this section
          if (item.items.some(ci => ci.navPromote && ci.url)) {
            item.navPromote = true
          }
        }
        // console.log('adding tab to nav item:', item.content)
        item.pageTabs = tab
        item.tabIndex = index
        item.component = component
        item.componentTitle = title
        item.componentVersion = version

        const page = item.urlType === 'internal' ? pagesByUrl.get(item.url) : null
        if (page) {
          page.asciidoc.attributes['page-tabs'] = tab
          if (page.asciidoc.attributes['page-tab-overview'] !== undefined) {
            item.tabOverview = true
          }
          if (page.asciidoc.attributes['page-nav-promote'] !== undefined) {
            item.navPromote = true
          }
        }

        // console.log(` - item has tabIndex ${item.tabIndex}`)

        // if (tab === 'provisional-tab') {
          // console.log(` - ${item.content} assigned provisional tab`)
          // console.log(item)
        // }
      }

      // for each value in the tabs array
      // find all the nav items in this component and version that have that tav
      // and for every page in the contentCatalog that has that tab in page-tabs
      // add these navitmes as tabNavigationPages

    })

    // this.once('navigationBuilt', ({ }) => {

    //     // add a file.tabNavigationPages property to each file in the contentCatalog
    //     // we can add this now, before the contentCatalog object is locked
    //     // we can modify its values after the documentsConverted event
    //     const { contentCatalog } = this.getVariables()
    //     const files = contentCatalog.getFiles().filter((f) => f.src && f.src.mediaType === 'text/asciidoc')
    //     files.forEach( (file) => {
    //       console.log(Object.keys(file))
    //       if (file._contents) console.log(file._contents.toString())
    //     })
    // })

    
    // once pages are composed, let's just go through the content catalog and get the page-tabs of every page to see what we have
    // this.once('pagesComposed', ({ contentCatalog }) => {

    //   const pages = contentCatalog.getFiles().filter((f) => f.asciidoc && f.asciidoc.attributes['page-tabs'])
    //   pages.forEach( (page) => {
    //     console.log(`Page ${page.src.path} ${page.src.version}@${page.src.component} has page-tabs: ${page.asciidoc.attributes['page-tabs']}`)
    //   })

    // })


    // this.once('pagesComposed', ({ contentCatalog }) => {

    //   // let's just quickly go through the contentCatalog and output every page that has tabNavigationPages
    //   const pages = contentCatalog.getFiles().filter((f) => f.tabNavigationPages && f.tabNavigationPages.length > 0)
    //   pages.forEach( (page) => {

    //     console.log('adding nav to page')
    //     // turn the tabNavigationPages into a string that can be added as a page attribute
    //     const tabNavString = JSON.stringify(page.tabNavigationPages)
    //     page.asciidoc.attributes['additional-navigation-pages'] = tabNavString

    //     console.log(page.asciidoc.attributes)



    //     console.log(`Page ${page.src.path} has tabNavigationPages:`)
    //     page.tabNavigationPages.forEach( (navItem) => {
    //       console.log(` - ${navItem.content} (${navItem.url}) [tab: ${navItem.pageTabs}]`)
    //       if (navItem.items && navItem.items.length > 0) navItem.items.forEach( (childItem) => {
    //         console.log(`    - ${childItem.content} (${childItem.url}) [tab: ${childItem.pageTabs}]`)
    //       })
    //     })
    //   })


    // })


}

// A single-pass tag strip can be bypassed by a crafted string like
// "<scrip<script>t>", which reassembles into "<script>" after one replace.
// Loop until a pass makes no further change.
function stripTags (str) {
  let previous
  do {
    previous = str
    str = str.replace(/<[^>]+>/g, '')
  } while (str !== previous)
  return str
}

function getNavEntriesByUrl (items = [], accum = {}) {
  items.forEach((item) => {
    if (item.urlType === 'internal') accum[item.url.split('#')[0]] = item
    getNavEntriesByUrl(item.items, accum)
  })
  return accum
}

function generateTabNavFile (tabNavData, tabNavFile = 'nav/tabs.json') {
    return new File({ contents: Buffer.from(JSON.stringify(tabNavData)), out: { path: tabNavFile } })
}

// Recursive merge of two plain-object trees. Arrays and primitive values are
// replaced wholesale (not merged or concatenated). Used to combine per-component
// nav shards into a single tabs.json.
function deepMerge (target, source) {
  for (const key of Object.keys(source)) {
    const sourceVal = source[key]
    const targetVal = target[key]
    if (
      sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      deepMerge(targetVal, sourceVal)
    } else {
      target[key] = sourceVal
    }
  }
}