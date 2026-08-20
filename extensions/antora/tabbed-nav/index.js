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
    // generateNav/aggregateNav/consumeNav default to true so the canonical writer
    // workflow ("antora preview --extension nav.js") gets the full local-content
    // pipeline with no extra config. Actors that need a subset (central aggregator
    // job, docs-home build) opt out of the stages they don't want.
    generateNav = true,
    // fetchNav defaults to false, unlike the other stages: reaching out to a remote
    // tabs.json is the one thing that should never happen just because a docset
    // referenced this extension - it has to be requested. That request can be this
    // flag, a truthy DOCS_FETCH_NAV env var, or simply pointing at an explicit nav
    // source (navUrl config, DOCS_NAV_URL/DOCS_URL env) - see the resolution logic
    // below, near where resolvedNavUrl/shouldFetchNav are computed.
    fetchNav = false,
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

            // Docset-wide equivalent of page-nav-promote: set once in antora.yml (or the
            // playbook, to apply to everything it builds) so every top-level thing in
            // content-nav.adoc - section or flat standalone page - becomes its own
            // promoted top-level block, instead of hand-tagging page-nav-promote on
            // every section's landing page individually.
            const promoteAll = componentWideAttr('page-tabs-promote-all', asciidoc, playbook.asciidoc) !== undefined

            // A full-line comment inside a content-nav.adoc (e.g. "// * xref:..[]")
            // makes AsciiDoc split what the writer sees as one continuous list into
            // two independent "navigation" blocks - severing the "top-level section
            // + its flat sibling xrefs" relationship groupFlatNavSections depends
            // on: a bold heading in one block never sees the xrefs that end up in
            // the next, so they're never nested under it and never inherit its tab.
            //
            // Separately, when a component's antora.yml lists multiple nav: files
            // (one per module), each file's blocks land in this same navigation
            // array too. Those genuinely are separate top-level lists and must NOT
            // be concatenated together before grouping - doing so lets
            // groupFlatNavSections's currentHeader leak from one file into the
            // next, silently absorbing another module's whole section as a child
            // of the previous module's last section (stripping it of its own
            // top-level status, and with it any promotion) whenever that module's
            // first top-level item isn't itself a bare "* *Heading*" bullet.
            //
            // build-navigation.js's buildNavigation gives every nav file's first
            // list an integer .order (that file's index in antora.yml's nav:
            // list); a comment-induced extra list from the *same* file gets a
            // fractional order instead. Flooring .order recovers which file a
            // block came from, so blocks are merged only within a file (undoing
            // the comment split) and grouped per file (preserving module
            // boundaries) before the per-file results are concatenated in file
            // order.
            const fileGroups = new Map()
            for (const nav of navigation) {
              const fileIndex = Math.floor(nav.order)
              if (!fileGroups.has(fileIndex)) fileGroups.set(fileIndex, [])
              fileGroups.get(fileIndex).push(...nav.items)
            }
            navigation[0].items = [].concat(
              ...Array.from(fileGroups.keys())
                .sort((a, b) => a - b)
                .map((fileIndex) => groupFlatNavSections(fileGroups.get(fileIndex)))
            )
            for (let i = 1; i < navigation.length; i++) navigation[i].items = []

            for (const nav of navigation) {

              // Url-less leaf items (section headers, or link items Antora didn't
              // parse a url out of) awaiting backfill once a later sibling resolves
              // a real tab. Kept as a list, not a single slot - two such items in a
              // row (e.g. a bare link followed by a section header) would otherwise
              // have the second overwrite the first's reference before it backfills.
              let provisionalItems = []

              for (const item of nav.items) {

                if (!item.url) {
                  if (!item.items || item.items.length === 0) {
                    addTabInfoToNavItem(item, component, version, 'provisional-tab', 99999, latest.title, pagesByUrl)
                    provisionalItems.push(item)
                    continue
                  }

                  // Determine the section's tab from the first child that has one -
                  // either its own page attribute, or (for a child with no page at
                  // all, e.g. an external GraphAcademy/API-docs link) the same
                  // component-wide fallback used for flat resolved links below.
                  for (const ci of item.items) {
                    const p = pagesByUrl.get(ci.url)
                    const ciPageTabsRaw = componentWideAttr('page-tabs', asciidoc, playbook.asciidoc)
                    const ciPageTabs = (p && p.asciidoc && p.asciidoc.attributes['page-tabs']) ||
                      (ciPageTabsRaw && ciPageTabsRaw.replace(/@$/, ''))
                    if (ciPageTabs) {
                      item.pageTabs = ciPageTabs
                      item.tabIndex = (p && p.asciidoc && p.asciidoc.attributes['page-tabs-index'])
                        ? parseInt(p.asciidoc.attributes['page-tabs-index'])
                        : componentWideAttr('page-tabs-index', asciidoc, playbook.asciidoc) || 99999
                      item.component = component
                      item.componentTitle = latest.title
                      item.componentVersion = version
                      break
                    }
                  }

                  for (const childItem of item.items) {
                    const page = pagesByUrl.get(childItem.url)
                    const childTab = page && page.asciidoc && page.asciidoc.attributes['page-tabs']

                    if (item.pageTabs) {
                      if (page && childTab && childTab !== item.pageTabs) {
                        // Expected, not a problem: a page can have its own page-tabs for
                        // when it's viewed standalone, but the enclosing section's tab
                        // always wins once nested under it - same info-level treatment as
                        // every other routine nav-assignment message in this file.
                        logger[logLevel](
                          { file: page.src, source: page.src.origin },
                          `Navigation item "${childItem.content}" has page-tabs "${childTab}" but its section "${item.content}" is in tab "${item.pageTabs}" — overriding to match section`
                        )
                      } else if (page && !childTab) {
                        logger.info(
                          { file: page.src, source: page.src.origin },
                          `Navigation item "${childItem.content}" has no page-tabs — inheriting section tab "${item.pageTabs}"`
                        )
                      }
                      // All children inherit the section's tab, including those with no page
                      // (external links) or no page-tabs attribute of their own.
                      addTabInfoToNavItem(childItem, component, version, item.pageTabs, item.tabIndex, latest.title, pagesByUrl)
                    } else {
                      // Unlike the two cases above, this one isn't benign: the section got
                      // no tab at all, so every child under it - this one included - never
                      // lands in any tab and is invisible in the aggregated nav. Antora's own
                      // messages point writers at { file, source } rather than just a nav
                      // label, so do the same here - fall back to component/version for a
                      // child with no resolvable page (an external link, or a nested
                      // sub-section heading with no url of its own).
                      logger.warn(
                        page ? { file: page.src, source: page.src.origin } : { component, version },
                        `Navigation item "${stripTags(childItem.content)}" is nested under section "${stripTags(item.content)}", which has no page-tabs — it will not appear in any tab's aggregated navigation. Set page-tabs on the section's own first child, or on this page directly, to fix.`
                      )
                    }
                  }
                  // Propagate navPromote from direct child pages up to the section item -
                  // or force it regardless, when the whole docset opted into promoting
                  // every top-level thing (see promoteAll above). A bare "* Heading"
                  // section has no url/page of its own to carry an opt-out, so - same as
                  // the tab-inference loop above already does for pageTabs - treat the
                  // section's first child as its representative page: an explicit
                  // `:page-nav-promote: false` there opts the whole section out of
                  // promoteAll, the same as it would for a linked landing page.
                  const firstChildPage = pagesByUrl.get(item.items[0] && item.items[0].url)
                  if ((promoteAll && !isPageNavPromoteExplicitlyDisabled(firstChildPage)) ||
                      item.items.some(ci => ci.navPromote && ci.url)) {
                    item.navPromote = true
                  }
                } else {

                  const page = pagesByUrl.get(item.url)

                  // A page-tabs value to use: prefer the specific page's own attribute,
                  // but fall back to the component-wide default (antora.yml, or the
                  // playbook to apply it to everything the playbook builds - antora.yml
                  // wins when both are set, same as Antora's own attribute precedence)
                  // for items whose url doesn't resolve to a page in this component at
                  // all - e.g. an external link (GraphAcademy course, etc.), which can
                  // never carry a per-page attribute since there's no page. The
                  // component-wide fallback comes straight from antora.yml/the playbook,
                  // unprocessed by Asciidoctor - so a soft-set value like "drivers-apis@"
                  // still has its trailing "@" (Asciidoctor strips this marker when it
                  // resolves a page's own attributes, which is why the per-page value
                  // never needs this).
                  const pageTabsRaw = componentWideAttr('page-tabs', asciidoc, playbook.asciidoc)
                  let pageTabs = (page && page.asciidoc && page.asciidoc.attributes['page-tabs']) ||
                    (pageTabsRaw && pageTabsRaw.replace(/@$/, ''))
                  let pageTabsIndex = (page && page.asciidoc && page.asciidoc.attributes['page-tabs-index']) ||
                    componentWideAttr('page-tabs-index', asciidoc, playbook.asciidoc)

                  // A section written as a linked landing page (`* xref:installation/index.adoc[]`
                  // with nested `** xref:...` children) commonly leaves the landing page itself
                  // without its own page-tabs - it's just a nesting container, the tab lives on
                  // its descendants (or arrives here via promoteAll without a page-tabs default at
                  // all). Unlike the bare-heading section case above, which already walks its
                  // children hunting for a resolvable tab, this branch had no such fallback - so
                  // the whole section, landing page and every descendant, silently vanished from
                  // the aggregated nav. Search descendants the same way before giving up.
                  if (!pageTabs && item.items && item.items.length) {
                    const inherited = findDescendantPageTabs(item.items, pagesByUrl)
                    if (inherited) {
                      pageTabs = inherited.pageTabs
                      pageTabsIndex = pageTabsIndex || inherited.pageTabsIndex
                    }
                  }

                  if (pageTabs) {

                    addTabInfoToNavItem(item, component, version, pageTabs, pageTabsIndex || 99999, latest.title, pagesByUrl)

                    // promoteAll applies to every top-level linked item here, section or
                    // not: a linked page with its own children (`* xref:security.adoc[Security]`
                    // followed by nested `** xref:...`) is still a "section" for this
                    // purpose, and a flat standalone page (no children at all, e.g. a bare
                    // "* xref:virtual-graph.adoc[]" sibling) gets force-promoted too - it's
                    // pushed through as its own plain top-level item further downstream
                    // (see the promotedItems loop in consumeNav), not wrapped as a
                    // componentHeader block. addTabInfoToNavItem already propagates
                    // navPromote up from a promoted child; this forces it regardless -
                    // unless the item's own landing page opts out with an explicit
                    // `:page-nav-promote: false`, letting one section sit out a
                    // docset-wide page-tabs-promote-all without disabling it for everyone else.
                    if (promoteAll && !isPageNavPromoteExplicitlyDisabled(page)) {
                      item.navPromote = true
                    }

                    if (provisionalItems.length) {
                      for (const pending of provisionalItems) {
                        addTabInfoToNavItem(pending, component, version, item.pageTabs, item.tabIndex || 99999, latest.title, pagesByUrl)
                      }
                      provisionalItems = []
                    }
                  } else {
                    // Previously silent: a top-level linked item with no page-tabs
                    // anywhere in its resolution chain (own attribute, antora.yml,
                    // playbook) never lands in any tab and is invisible in the
                    // aggregated nav - same "isn't benign" case as the section-child
                    // one above, just for a flat top-level page instead of a nested one.
                    logger.warn(
                      page ? { file: page.src, source: page.src.origin } : { component, version },
                      `Navigation item "${stripTags(item.content)}" has no page-tabs (checked the page's own attribute, antora.yml, and the playbook) — it will not appear in any tab's aggregated navigation. Set page-tabs on the page, in antora.yml, or in the playbook to fix.`
                    )
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
      const explicitNavUrl =
        navUrl ||
        process.env.DOCS_NAV_URL ||
        (process.env.DOCS_URL
          ? process.env.DOCS_URL.replace(/\/+$/, '') + '/nav/tabs.json'
          : null)

      const resolvedNavUrl =
        explicitNavUrl ||
        (playbook.site && playbook.site.url
          ? playbook.site.url.replace(/\/+$/, '') + '/nav/tabs.json'
          : null)

      // Fetching is on when explicitly requested (fetchNav config, truthy
      // DOCS_FETCH_NAV) or implied by an explicit nav source (navUrl config,
      // DOCS_NAV_URL/DOCS_URL env) - setting one of those to point at a nav file is
      // itself the opt-in, no extra flag needed. Falling back to playbook.site.url
      // alone never implies fetching (that's the "silently hits prod" case this gate
      // exists to prevent). DOCS_FETCH_NAV can still be set to 'false'/'0' to force
      // fetching off even when an explicit nav source is present.
      const fetchNavEnv = process.env.DOCS_FETCH_NAV
      const fetchNavExplicitlyDisabled = fetchNavEnv === 'false' || fetchNavEnv === '0'
      const shouldFetchNav = !fetchNavExplicitlyDisabled && (fetchNav || fetchNavEnv || !!explicitNavUrl)

      if (shouldFetchNav && resolvedNavUrl) {
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

            const docsetGroup = componentWideAttr('page-tabs-group', asciidoc, playbook.asciidoc)

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

              // A promoted item with no children (a flat standalone page, e.g. a bare
              // "* xref:virtual-graph.adoc[]" sibling) has nothing to wrap into a docset
              // block - it's pushed through as-is below, already carrying url/content/
              // pageTabs etc. from addTabInfoToNavItem. Only promoted sections (real
              // parent items with children) become their own componentHeader block.
              const promotedSectionCount = promotedItems.filter(item => item.items && item.items.length).length

              // How many top-level blocks this component+version contributes to this tab -
              // normally 1, but page-tabs-promote-all (or several individually
              // promoted sections) can split one docset into several sibling blocks that
              // all share this component+version. soleBlock lets the UI tell "the one
              // block for this docset" apart from "one of several" - see its use in
              // nav-tree.hbs/09-nav-fetch.js, which only auto-expand a block on a
              // component+version match when it's the only one.
              const soleBlock = (promotedSectionCount + (normalItems.length > 0 ? 1 : 0)) === 1

              for (const item of promotedItems) {
                if (!(item.items && item.items.length)) {
                  // Unlike every other branch here, this item is pushed through
                  // unwrapped - so it also needs docsetGroup attached directly, or it
                  // never enters the docsetGroup version-selection logic downstream
                  // (client nav-fetch and the SSR nav-aggregate helper both skip an
                  // item with no docsetGroup entirely) and every version's copy of a
                  // flat promoted page (e.g. a promoteAll'd component index or
                  // introduction page with no children) shows up simultaneously.
                  if (versionData.docsetGroup) item.docsetGroup = versionData.docsetGroup
                  tabNav[0].items.push(item)
                  continue
                }
                const sectionTitle = item.content ? stripTags(item.content).trim() : versionData.title
                // A promoted item that is also its own linked page (e.g. a landing page
                // like clauses/index.adoc with nested siblings, as opposed to a bare
                // "* *Heading*" bullet with no url of its own) would otherwise vanish
                // once wrapped into a section block below - only .content survives as
                // the section title, and the page's own url is dropped. Keep it as the
                // section's own first child instead, exactly matching what the source
                // would produce if it had been written with an explicit bare heading:
                // "* *Clauses*\n** xref:clauses/index.adoc[]\n** xref:clause-composition.adoc[]".
                const sectionItems = item.url
                  ? [{
                      content: item.content,
                      url: item.url,
                      urlType: item.urlType,
                      pageTabs: item.pageTabs,
                      tabIndex: item.tabIndex,
                      component: item.component,
                      componentTitle: item.componentTitle,
                      componentVersion: item.componentVersion,
                    }, ...item.items]
                  : item.items
                tabNav[0].items.push({
                  content: sectionTitle,
                  tabIndex: item.tabIndex || versionData.tabIndex || 99999,
                  component,
                  componentVersion: version,
                  componentTitle: sectionTitle,
                  componentHeader: true,
                  soleBlock,
                  latest: versionData.latest,
                  ...(versionData.docsetGroup && { docsetGroup: versionData.docsetGroup }),
                  items: sectionItems,
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
                  soleBlock,
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





      // Depth-first search for the first descendant whose own page carries a page-tabs
      // attribute. Used to give a linked section-landing item (one with its own url and
      // children) the tab of whichever descendant declares one, mirroring the fallback
      // the bare-heading section case already has.
      function findDescendantPageTabs (items, pagesByUrl) {
        for (const child of items) {
          const childPage = pagesByUrl.get(child.url)
          const childPageTabs = childPage && childPage.asciidoc && childPage.asciidoc.attributes['page-tabs']
          if (childPageTabs) {
            return { pageTabs: childPageTabs, pageTabsIndex: childPage.asciidoc.attributes['page-tabs-index'] }
          }
          if (child.items && child.items.length) {
            const found = findDescendantPageTabs(child.items, pagesByUrl)
            if (found) return found
          }
        }
        return null
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
          // Presence alone used to opt a page in, which meant `:page-nav-promote: false` -
          // written to opt a page OUT of a docset-wide page-tabs-promote-all - was
          // misread as "set, so opt in", the opposite of what it says. An explicit
          // "false" no longer counts as opting in (isPageNavPromoteExplicitlyDisabled
          // is what actually enforces the opt-out, in the promoteAll check below).
          if (page.asciidoc.attributes['page-nav-promote'] !== undefined &&
              !isPageNavPromoteExplicitlyDisabled(page)) {
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

// A page's own `:page-nav-promote: false` overrides a docset-wide page-tabs-promote-all
// for that one page, letting a single section sit out of promotion without disabling it
// for the whole docset. Asciidoctor has no unset-to-false idiom that survives as a
// distinguishable value (`:!page-nav-promote:` just deletes the attribute, identical to
// never having set it) - "false" has to be checked for as a literal string value instead.
function isPageNavPromoteExplicitlyDisabled (page) {
  return !!(page && page.asciidoc && page.asciidoc.attributes['page-nav-promote'] === 'false')
}

// Component-wide attribute defaults can be set in antora.yml (scoped to that one
// component+version, e.g. so a driver manual's docs stay valid checked out and built
// standalone) or in the playbook (applies to everything that playbook builds, useful
// for a shared CI workflow that doesn't want to touch every docset's antora.yml).
// antora.yml wins when both are set, matching Antora's own attribute precedence
// (more specific source wins). Returns the raw value, unprocessed by Asciidoctor - a
// soft-set value like "drivers-apis@" still has its trailing "@"; callers that need
// the resolved form strip it themselves.
function componentWideAttr (name, componentAsciidoc, playbookAsciidoc) {
  if (componentAsciidoc && componentAsciidoc.attributes && componentAsciidoc.attributes[name] !== undefined) {
    return componentAsciidoc.attributes[name]
  }
  if (playbookAsciidoc && playbookAsciidoc.attributes && playbookAsciidoc.attributes[name] !== undefined) {
    return playbookAsciidoc.attributes[name]
  }
  return undefined
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

// Docs sources commonly write a section title as a flat, unlinked sibling bullet
// (`* *Section heading*`) followed by flat sibling xrefs, rather than nesting them
// (`** xref:...[]`) under it. Rebuild that flat run into a real parent/children
// tree - a title item with an .items array - so it renders, and gets its tab
// resolved, exactly as if the source had nested them. Mutates items in place and
// returns the new top-level array.
// `* *Heading*` renders to `<strong>Heading</strong>` - fine for the old plain-text
// rendering, but once promoted to a real section toggle below it gets its own
// heading treatment and the inline bold is no longer wanted.
function unwrapBold (content) {
  const m = /^<(strong|b)>([\s\S]*)<\/\1>$/.exec(content.trim())
  return m ? m[2] : content
}

function isBoldContent (content) {
  return /^<(strong|b)>[\s\S]*<\/\1>$/.test((content || '').trim())
}

function groupFlatNavSections (items) {
  const grouped = []
  let currentHeader = null
  for (const item of items) {
    // Some external-link AsciiDoc syntax (e.g. the `link:` macro) leaves Antora's
    // nav builder without a parsed .url - the href only shows up baked into
    // .content as a raw <a> tag. Promote it to a real .url/.content pair so it's
    // treated as a resolved link below, not mistaken for a section heading.
    if (!item.url && item.content) {
      const linkMatch = /^\s*<a\s+href="([^"]+)"[^>]*>(.*)<\/a>\s*$/s.exec(item.content)
      if (linkMatch) {
        item.url = linkMatch[1]
        item.urlType = 'external'
        item.content = linkMatch[2]
      }
    }

    // Only a bold, linkless, childless bullet (`* *Heading*`) opens - or replaces
    // - a section. A flat sibling link (no `**` children of its own) is absorbed
    // as a child of whatever section is currently open, without ending it - so a
    // run of flat sibling links all end up nested one level deeper, until the
    // next bold heading appears (the classic "* *Heading*" + flat xrefs pattern).
    //
    // An item the source already nested with `**` of its own (a landing page with
    // real children, e.g. `* xref:kubernetes/index.adoc[]` followed by its own
    // `** xref:...`) is a complete section in its own right - it's the thing the
    // open heading was titling, not another flat member of it. Fold its own
    // url/items straight into the heading (keeping only the heading's title, and
    // any flat links already absorbed ahead of it) rather than nesting it as an
    // extra wrapper level, and end the heading there - otherwise a later,
    // unrelated already-nested item (e.g. `* xref:configuration/index.adoc[]`
    // right after) would keep being swallowed into the same heading instead of
    // starting its own promoted section.
    if (!item.url && (!item.items || !item.items.length) && isBoldContent(item.content)) {
      item.content = unwrapBold(item.content)
      item.items = item.items || []
      grouped.push(item)
      currentHeader = item
    } else if (currentHeader) {
      if (item.items && item.items.length) {
        currentHeader.url = item.url
        currentHeader.urlType = item.urlType
        currentHeader.items = currentHeader.items.concat(item.items)
        currentHeader = null
      } else {
        currentHeader.items.push(item)
      }
    } else {
      grouped.push(item)
    }
  }
  return grouped
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
    // source is parsed JSON from a fetched URL or S3 shard - Object.keys() includes a
    // literal "__proto__" key if the JSON had one, and target[key] = val for that key
    // really does set the prototype. Skip it (and the other dangerous keys) rather than
    // trust the data source never gets tampered with.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
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