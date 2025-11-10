const { posix: path, resolve } = require('path')
const File = require('vinyl')
const fs = require('fs')

// const { buildNavigation, NavigationCatalog } = require('@antora/navigation-builder')

module.exports.register = function ({ config }) {

  const {
    logLevel = 'info', 
    tabNavExtraFile = '.meta/tabNavExtra.json',
    generateNav,
    consumeNav
  } = config

  const logger = this.getLogger('custom-nav')
    // this is a replacement of the covertDocuments function that skips the asciidoc > html conversion
    // we are only interested in the nav at this point.
    // either for speed or because we will just find a way to save the nave for a file somewhere
    // and retrieve it on the fly

    // we still need to have some sort of understanding of the asciidoc though
    // because we need to get page-attributes etc

    this.once('contextStarted', () => {

      logger[logLevel]('custom-nav extension initialized (generateNav: %s, consumeNav: %s)', generateNav, consumeNav)

      // if we are generating the nav we don't want to bother converting the asciidoc
      // we only need to do enough work that we can generate nav objects

      // we might want to generate the asciidoc anyway in case we can benefit from every having one big mono build
      // for now we can take the time saving though
      if (generateNav) {

        this.replaceFunctions({
          async convertDocuments (contentCatalog, siteAsciiDocConfig = {}) {
            const {
              extractAsciiDocMetadata = requireAsciiDocLoader().extractAsciiDocMetadata,
              loadAsciiDoc = requireAsciiDocLoader(),
            } = this ? this.getFunctions(false) : {}
            const mainAsciiDocConfigs = new Map()
            contentCatalog.getComponents().forEach(({ name: component, versions }) => {
              versions.forEach(({ version, asciidoc }) => {
                mainAsciiDocConfigs.set(buildCacheKey({ component, version }), asciidoc)
              })
            })
            const headerAsciiDocConfigs = new Map()
            const headerOverrides = { extensions: [], headerOnly: true }
            for (const [cacheKey, mainAsciiDocConfig] of mainAsciiDocConfigs) {
              headerAsciiDocConfigs.set(cacheKey, Object.assign({}, mainAsciiDocConfig, headerOverrides))
            }

            const pages = contentCatalog
              .getPages((page) => {
                if (page.out) {
                  if (page.mediaType === 'text/asciidoc') {
                    const asciidocConfig = headerAsciiDocConfigs.get(buildCacheKey(page.src))
                    const { attributes } = (page.asciidoc = extractAsciiDocMetadata(
                      loadAsciiDoc(page, contentCatalog, asciidocConfig || Object.assign({}, siteAsciiDocConfig, headerOverrides))
                    ))
                    Object.defineProperty(page, 'title', {
                      get () {
                        return this.asciidoc.doctitle
                      },
                    })
                    registerPageAliases(attributes['page-aliases'], page, contentCatalog)
                  }
                  return true
                }
              })
              .map((page) => page
              )
            pages.forEach((page) => delete page.src.contents)
            return pages
          }
        })

        function buildCacheKey ({ component, version }) {
          return version + '@' + component
        }

        function registerPageAliases (aliases, targetFile, contentCatalog) {
          if (!aliases) return
          aliases.split(',').forEach((spec) => (spec = spec.trim()) && contentCatalog.registerPageAlias(spec, targetFile))
        }

        function requireAsciiDocLoader () {
          return requireAsciiDocLoader.cache || (requireAsciiDocLoader.cache = require('@antora/asciidoc-loader'))
        }


      }

    })

    this.once('navigationBuilt', ({ contentCatalog, siteCatalog }) => {

      // we need to do stuff to the nav for the thing we are building, regardless of whether we are generating
      // an aggregate nav or consuming it

      contentCatalog.getComponents().forEach(({ latest, versions }) => {
          // console.log(versions)
          // console.log(latest)

          // at this point, instead of getting all the versions
          // we only need to get the nav for the latest version of the component
          // or if the component has only one version

          versions.forEach(({ name: component, version, navigation, url, asciidoc }) => {

            for (const nav of navigation) {

              let tabCandidate = {}

              // console.log('navigation looks like:')
              // console.log(nav)

              // console.log(nav.items)
              for (const item of nav.items) {
                // console.log(item)

                // here's what i need to do
                // if the item has a url then get the page with the matching url
                // addtabtonavitem for the item and the tab

                // if the item does not have a url then it's a section header
                // i need to recurse into the child items and process each of those
                if (!item.url) {
                  // console.log(`${item.content} - no url, this is a section header`)

                  // if it's just a header with no child items, we don't need to do anything unless we can derive that it is a header to a section
                  // but it's not a header with child items. It's more of a divider in the nav.
                  // but if we find items after it, and they have a tab, then we can assume this header is for that section, so we need to include it and give it the tab too
                  // so we should addtabtonavitem but with some provisional tab that we can override if we find child items with tabs
                  if (!item.items || item.items.length === 0) {
                    // console.log(` - ${item.content} has no child items as well... add a provisional tab?`)
                    addTabInfoToNavItem(item, component, version, 'provisional-tab', 99999)
                    tabCandidate = item
                    continue
                  }


                  for (const childItem of item.items) {
                    // get a page from the content catalog that has the same out.url
                    const page = findPageForNavItem(contentCatalog, component, version, childItem)

                    // if the page has page-tabs attribute get the tab value
                    // and add it to the nav item
                    if (page && page.asciidoc && page.asciidoc.attributes['page-tabs']) {
                      addTabInfoToNavItem(childItem, component, version, page.asciidoc.attributes['page-tabs'], page.asciidoc.attributes['page-tabs-index'] || 99999)
                      item.pageTabs = item.pageTabs ? item.pageTabs : page.asciidoc.attributes['page-tabs']
                      item.tabIndex = page.asciidoc.attributes['page-tabs-index'] ? parseInt(page.asciidoc.attributes['page-tabs-index']) : 99999
                    }
                    // console.log(`  ${childItem.content}`)
                  }
                } else {

                  // get a page from the content catalog that has the same out.url
                  // console.log('looking for the page!')
                  const page = findPageForNavItem(contentCatalog, component, version, item)

                  // if the page has page-tabs attribute get the tab value
                  if (page && page.asciidoc && page.asciidoc.attributes['page-tabs']) {
                    // console.log('the page has something - let us add the tab value to the nav item')
                    addTabInfoToNavItem(item, component, version, page.asciidoc.attributes['page-tabs'], page.asciidoc.attributes['page-tabs-index'] || 99999)

                    // if there's a tab candidate (ie a heading that seems on its own)
                    // give the tab candidate the same tab as this item
                    // this works when we are reading a page in the component that has the section header
                    // when we go into a page in another component, and this header is in additionalNav, the header is not getting the tab.
                    // how do we add it in that case?
                    // how about on this page, we add something to say it has a lead in heading above it that needs to be included?
                    if (tabCandidate && tabCandidate.pageTabs === 'provisional-tab') {
                      // console.log(` - also assigning provisional tab candidate "${tabCandidate.content}" the tab "${item.pageTabs}"`)
                      addTabInfoToNavItem(tabCandidate, component, version, item.pageTabs, item.tabIndex || 99999)
                      
                      // page.navHeading = tabCandidate
                      // console.log('page.navHeading is now:', page.navHeading)

                      tabCandidate = null

                    }


                  }

                }

              }

            }

          })

        })

      if (generateNav) {


        const tabNavExtra = {}

        contentCatalog.getComponents().forEach(({ latest, versions }) => {
          // console.log(versions)
          // console.log(latest)

          // after updating all the nav items we need to go through it again and add additionalNav to the relevant pages
          // we do this as a second run through because we will probably have updated the page-tabs attribute for some pages
          // because they might have a tab assigned from antora.yml
          // but they are in a section of the nav so they are a child of a parent that has a different tab

          versions.forEach(({ name: component, version, navigation, url, asciidoc }) => {

            // create an empty object for the nav json
            // we'll save it as a file later

            for (const nav of navigation) {
              for (const item of nav.items) {

                  // if this item has a pageTabs property we also need to add this item (and its children) to the additionalNav
                  // property of all the pages in contentCatalog that have this tab in their page-tabs attribute
                  // but which are not in the same component

                  if (item.pageTabs) {

                    // is this the latest version of the component?
                    // if not, we just skip it
                    if (version !== latest.version && versions.length > 1) {
                      // console.log(`\n=======\n\nNav item "${item.content}" ${item.url ? `(${item.url})` : ''} in ${version}@${component} is not in the latest version - skipping\n\n=======\n`)
                      logger[logLevel]({ component, version }, 'skipping nav item from non-latest version')
                      continue
                    }

                    tabNavExtra[item.pageTabs] ? tabNavExtra[item.pageTabs].push(item) : tabNavExtra[item.pageTabs] = [item]

                  }

              }

            }

          })



        })

        const tabNavExtraFileResult = generateTabNavExtraFile(tabNavExtra, tabNavExtraFile)
        siteCatalog.addFile(tabNavExtraFileResult)
        logger[logLevel]({   }, 'Tab nav file generated')

      }


      if (consumeNav) {

        // get the generated json file
        // parse it into an object

        const navFromFile = JSON.parse(fs.readFileSync('./tabNavExtra.json'))

        for (const tab of Object.keys(navFromFile)) {

          // loop thrugh the object
          // for each key, add that key's items to pages that have a pageTabs that matches the key

          const pagesWithThisTab = contentCatalog
            .findBy({ family: 'page' })
            .filter((page) => page.asciidoc && page.asciidoc.attributes['page-tabs'] && page.asciidoc.attributes['page-tabs'] === tab )

          for (const item of navFromFile[tab]) {

            for (const page of pagesWithThisTab) {
              // only add this nav item to the additionalNavigationPages if the page is in a different component
              if (page.src.component !== item.component) {
                page.additionalNav = page.additionalNav || [
                  {
                    items: [],
                    root: true,
                    order: 0
                  }
                ]

                // does the page have a navheading (ie a section header nav item)
                // if so, we need to ensure that is added to the additionalNav too
                // if (pageForThisItem && pageForThisItem.navHeading) {
                  // console.log(` - page ${page.src.path} has a navHeading - ensure it's in additionalNav`)
                  // page.additionalNav[0].items.push(pageForThisItem.navHeading)
                // }
              
                page.additionalNav[0].items.push({
                    content: item.content,
                    items: item.items || [],
                    url: item.url,
                    urlType: item.urlType,
                    pageTabs: item.pageTabs,
                    tabIndex: item.tabIndex
                })


              }

            }

          }
        }

      }

      // for every page that has page.additionalNav
      // turn the additionalNavigationPages into a string that can be added as a page attribute
      // maybe this should be stored as an object that the ui bundle can access?
      // could it be something in sitecatalog?
      // or written to file? (like we do with .meta/pageList)
      const pages = contentCatalog.getFiles().filter((f) => f.additionalNav && f.additionalNav.length > 0)
      for (const page of pages) {
        // console.log('after navigationBuilt:')
        // console.log(page.additionalNav)
        const additionalNavString = JSON.stringify(page.additionalNav)
        page.asciidoc.attributes['page-additionalNav'] = additionalNavString
        // console.log(`Page ${page.src.path} has additionalNav:`)
        // console.log(page.asciidoc.attributes['page-additionalNav'])
      }




      function findPageForNavItem (contentCatalog, component, version, item) {
        // console.log(`    - Finding page for nav item ${item.content} (url:${item.url})`)
        if (item.urlType === 'internal') {
          return contentCatalog.findBy({ component, version, family: 'page' }).find(p => p.pub.url === item.url)
        }
        return null
      }


      // add pageTabs to nav items
      // recurse where item has child items
      function addTabInfoToNavItem (item, component, version, tab, index=99999) {
        if (item.items && item.items.length) {
          for (const childItem of item.items) {
            addTabInfoToNavItem(childItem, component, version, tab, index)
          }
        }
        // console.log('adding tab to nav item:', item.content)
        item.pageTabs = tab
        item.tabIndex = index
        item.component = component

        // can i add or update the page-tabs attribute of the page that this nav item refers to?
        const page = findPageForNavItem(contentCatalog, component, version, item)
        if (page) {
          page.asciidoc.attributes['page-tabs'] = tab
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
      // add these navitmes as additionalNavigationPages

    })

    // this.once('navigationBuilt', ({ }) => {

    //     // add a file.additionalNavigationPages property to each file in the contentCatalog
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

    //   // let's just quickly go through the contentCatalog and output every page that has additionalNavigationPages
    //   const pages = contentCatalog.getFiles().filter((f) => f.additionalNavigationPages && f.additionalNavigationPages.length > 0)
    //   pages.forEach( (page) => {

    //     console.log('adding nav to page')
    //     // turn the additionalNavigationPages into a string that can be added as a page attribute
    //     const additionalNavString = JSON.stringify(page.additionalNavigationPages)
    //     page.asciidoc.attributes['additional-navigation-pages'] = additionalNavString

    //     console.log(page.asciidoc.attributes)



    //     console.log(`Page ${page.src.path} has additionalNavigationPages:`)
    //     page.additionalNavigationPages.forEach( (navItem) => {
    //       console.log(` - ${navItem.content} (${navItem.url}) [tab: ${navItem.pageTabs}]`)
    //       if (navItem.items && navItem.items.length > 0) navItem.items.forEach( (childItem) => {
    //         console.log(`    - ${childItem.content} (${childItem.url}) [tab: ${childItem.pageTabs}]`)
    //       })
    //     })
    //   })


    // })


}

function getNavEntriesByUrl (items = [], accum = {}) {
  items.forEach((item) => {
    if (item.urlType === 'internal') accum[item.url.split('#')[0]] = item
    getNavEntriesByUrl(item.items, accum)
  })
  return accum
}

function generateTabNavExtraFile (tabNavExtra, tabNavExtraFile = './.meta/tabNavExtra.json') {
    return new File({ contents: Buffer.from(JSON.stringify(tabNavExtra)), out: { path: tabNavExtraFile } })
}