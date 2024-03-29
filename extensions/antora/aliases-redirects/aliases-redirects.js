const { posix: path } = require('path')
const File = require('vinyl')

module.exports.register = function ({ config }) {

  const { playbook } = this.getVariables()

  const { redirectFormat = 'neo4j', aliasLogLevel = playbook.asciidoc.attributes.aliasLogLevel || 'warn', logFoundAliases = playbook.asciidoc.attributes.logFoundAliases || false } = config

  const pluralize = (count, noun, suffix = 's', plural = '') => {
    if (count !== 1) {
      return plural !== '' ? plural : `${noun}${suffix}`
    }
    return noun
  }

  const logger = this.getLogger('aliases-redirects')
  
  this
  .on('contextStarted', () => {

    // set the redirect_facility to the value in the playbook
    if (!redirectFormat) return
    const { playbook } = this.getVariables()
    playbook.urls.redirectFacility = redirectFormat

    // can these be set automatically?
    // playbook.urls.latestVersionSegment = 'latest'
    // playbook.urls.latestVersionSegmentStrategy = 'replace'

    this.updateVariables({ playbook })
  })
  .on('documentsConverted', ({ config }) => {

    // the whole rewrite structure is very specific to neo4j
    const rewritePrefix = 'rewrite ^'
    const redirectPrefix = '/docs/'

    const { contentCatalog } = this.getVariables()

    const allAliases = contentCatalog.findBy({ family: 'alias' })

    contentCatalog.getComponents().forEach(({ name, versions }) => {

      const componentName = name
      // console.log(`Checking component: ${componentName}`)
      // console.log(versions)

      const versionsToCheck = versions.reduce((v, { version }) => {
        v.push(version)
        return v
      }, [ ]).reverse()
  

      while (versionsToCheck.length > 1) {
        const redirectFromVersion = versionsToCheck.shift()
        const redirectToVersion = versionsToCheck[0]

        // console.log(`Checking versions: ${redirectFromVersion} -> ${redirectToVersion}`)


        const allPages = contentCatalog.getPages((page) => page.out).reduce((pages, file) => {
          if ( ( file.src.version == redirectFromVersion || ( file.src.version === '' && redirectFromVersion == '~' ) ) && file.src.component == componentName && ['page'].includes(file.src.family) ) {
            pages.oldPages.push(file);
          }
          if ( ( file.src.version == redirectToVersion || ( file.src.version === '' && redirectToVersion == '~' ) ) && file.src.component == componentName && ['page'].includes(file.src.family) ) {
            pages.newPages.push(file);
          }
          return pages;
        }, { oldPages: [], newPages: [] });
    
        // logger.warn({  }, 'Found %d %s in %s', allPages.oldPages.length, pluralize(allPages.oldPages.length, 'page'), redirectFromVersion)
        // logger.warn({  }, 'Found %d %s in %s', allPages.newPages.length, pluralize(allPages.newPages.length, 'page'), redirectToVersion)
    
        const newSources = allPages.newPages.reduce((entries, page) => {
    
          if (!page.out) {
            return entries
          }
          // console.log(page.out)
          if (page.out && page.out.dirname && page.asciidoc.doctitle) {
            entries.push({url: page.pub.url, outdirname: page.out.dirname, outbasename: page.out.basename, title: page.asciidoc.doctitle, path: page.src.path, component: page.src.component, version: page.src.version})
          }
            
          return entries
        }, [ ])

        // what's missing in the new version?
        allPages.oldPages.forEach( (page) => {
    
          if (!page.out) return
    
          // File paths are the same if one of these conditions is met:
          //  - the source path is the same (ie the same .adoc file exists in both versions)
          //  - the output url is the same (ie file.adoc exists in one version and file/index.adoc exists in the other version)
          const newPage = newSources.find(({ path, url }) => path === page.src.path || url === page.pub.url.replace(redirectFromVersion, redirectToVersion) );
          
          // return if the page exists in the new version
          if (newPage) {
            return
          }

          // return if the page has a page-external attribute, indicating that it has been moved outside this component
          // TODO - add a redirect to the external page URL
          if (page.asciidoc.attributes['page-external']) {
            if (logFoundAliases) logger.info({ 'file': page.src, 'source': page.src.origin  }, 'Page %s (%s) has been moved to %s', page.src.relative, page.asciidoc.doctitle, page.asciidoc.attributes['page-external'])
            return
          }
    
          // logger.warn({ 'file': page.src, 'source': page.src.origin  }, 'Page in version %s removed or moved in later versions: %s (%s)', page.src.version, page.src.path, page.asciidoc.doctitle)
    
          // if we have got this far, the page has been moved or removed in the new version

          // First check if there are any page aliases that point to this page
          // If there is at least one, we don't need to do anything, that alias means there will be no 404 in the new version for this page
          const requiredAliasTarget = page.pub.url.replace(redirectFromVersion, redirectToVersion)
          const aliasesToHere = allAliases.filter(alias => alias.pub.url === ensureTrailingSlash(requiredAliasTarget))

          // alias.pub.url is constructed from the page-alias value
          // alias.rel.pub.url is constructed from the output path of the file that contains the page-alias

          if (aliasesToHere.length > 0) {
            if (logFoundAliases) {
              aliasesToHere.forEach(alias => {
                // console.log(alias.rel.pub)
                // console.log(alias.pub)
                // console.log(alias.src)
                // logger[aliasLogLevel]({ 'file': page.src, 'source': page.src.origin  }, 'Alias found for page %s (%s)', redirectFromVersion, page.src.path, page.asciidoc.doctitle)
                logger.info({ 'file': page.src, 'source': page.src.origin  }, 'Alias %s found for %s (%s) which was removed after %s', alias.rel.pub.url, page.src.relative, page.asciidoc.doctitle, redirectFromVersion)
              })  
            }
            return // nothing to do here if there is at least one alias to this page
          }

          // the path we need to redirect from is the old path but with the new version
          // const redirectFromPath = page.out.dirname.replace(redirectFromVersion, redirectToVersion)
    
          // get the title of the old page
          const searchTitle = page.asciidoc.doctitle
    
          // if (!((resource = contentCatalog.resolveResource(page.out.dirname, page.src, 'page')) || {}).pub) {
          //   // logger.warn({  }, 'Unable to resolve resource %s', page.out.dirname)
          // } else {
          //   // logger.warn({  }, 'Found resource %s', page.out.dirname)
          // }
    
          // If a page in the new version has the same title, we will use that as the suggested path to redirect to
          // But there should only be a single match...
          // const redirectTo = newSources.find(hasMoved);
          const redirectTo = newSources.filter(({ title }) => title === searchTitle);
          
          // if there is a page to redirect from, we should check for a page-alias on the new page
          if (redirectTo && redirectTo.length >= 1) {
            redirectTo.forEach( (target, i) => {
              const newFile = contentCatalog.getByPath({component: target.component, version: target.version, path: target.path})
              // if (i ==0) contentCatalog.registerPageAlias(page.src.relative,newFile)
              logger[aliasLogLevel]({ 'file': newFile.src, 'source': newFile.src.origin  }, '%s (%s) was removed after %s. A possible alias in %s is: %s', page.src.relative, searchTitle, redirectFromVersion, redirectToVersion, newFile.src.relative)
            })
    
          } else {
            logger[aliasLogLevel]({ 'file': page.src, 'source': page.src.origin  }, 'No aliases found for %s (%s) which was removed in version %s', page.src.path, searchTitle, redirectToVersion)
          }
    
        })

      }

    })

  })
  .on('navigationBuilt',  ({  }) => {

    const { playbook, contentCatalog } = this.getVariables()

    // generate specific Neo4j nginx redirects if the playbook specifies redirect_facility: neo4j
    if (playbook.urls.redirectFacility !== 'neo4j') return

    const delegate = this.getFunctions().produceRedirects
    this.replaceFunctions({
      produceRedirects(playbook, aliases) {

        if (!aliases.length) return []

        let siteUrl = playbook.site.url
        if (siteUrl) siteUrl = stripTrailingSlash(siteUrl, '')

        // for local builds publish a site index page
        // with a static redirect to the home page specified in the playbook
        populateStaticRedirectFiles(
          aliases.filter((it) => it.out && it.pub.url === '/'),
          siteUrl
        )
        // create a file containing redirects
        return createNeoRewriteConf(aliases, extractUrlPath(siteUrl))
      }

    })

  })

  function createNeoRewriteConf (files, urlPath) {
    const componentList = files.map((file) => { return file.src.component })
    const uniqueComponents = Array.from(new Set(componentList));
    let rewriteFiles = []
    uniqueComponents
    .filter(component => component !== 'ROOT')
    .forEach((component) => {
      const filteredFiles = files.filter(file => file.src.component === component )
      const rules = filteredFiles.map((file) => {
        delete file.out
        let fromUrl = file.pub.url
        if (fromUrl === '/') return
        fromUrl = ~fromUrl.indexOf('%20') ? `'${urlPath}${fromUrl.replace(ENCODED_SPACE_RX, ' ')}'` : stripTrailingSlash(urlPath) + ensureTrailingSlash(fromUrl)
        let toUrl = file.rel.pub.url
        toUrl = ~toUrl.indexOf('%20') ? `'${urlPath}${toUrl.replace(ENCODED_SPACE_RX, ' ')}'` : stripTrailingSlash(urlPath) + ensureTrailingSlash(toUrl)
        if (fromUrl === toUrl) return // don't redirect to the same url
        return `rewrite ^${fromUrl}? ${toUrl} permanent;`
      })
      if (rules.length) {
        logger.info({  }, 'Generating %d Neo4j %s for %s', rules.length, pluralize(rules.length, 'redirect'), component)
        rewriteFiles.push(new File({ contents: Buffer.from(rules.join('\n') + '\n'), out: { path: `.etc/nginx/redirects-${component}.conf` } }))
      } else {
        logger.info({  }, 'No Neo4j redirects for \'%s\'', component)
      }
  
    })
  
    return rewriteFiles
  }
 
}

function extractUrlPath (url) {
  if (url) {
    if (url.charAt() === '/') return url
    const urlPath = new URL(url).pathname
    return urlPath === '/' ? '' : urlPath
  } else {
    return ''
  }
}

function ensureTrailingSlash (str) {
  return str.charAt(str.length - 1) === '/' ? str : str + '/'
}

function stripTrailingSlash (str) {
  if (str === '/') return str
  const lastIdx = str.length - 1
  return str.charAt(lastIdx) === '/' ? str.substr(0, lastIdx) : str
}

  // copy of the same function in @antora/redirect-producer
  function populateStaticRedirectFiles (files, siteUrl) {
    files.forEach((file) => (file.contents = Buffer.from(createStaticRedirectContents(file, siteUrl) + '\n')))
    return []
  }

  // copy of the same function in @antora/redirect-producer
  function createStaticRedirectContents (file, siteUrl) {
    const targetUrl = file.rel.pub.url
    let linkTag
    let to = targetUrl.charAt() === '/' ? computeRelativeUrlPath(file.pub.url, targetUrl) : undefined
    let toText = to
    if (to) {
      if (siteUrl && siteUrl.charAt() !== '/') {
        linkTag = `<link rel="canonical" href="${(toText = siteUrl + targetUrl)}">\n`
      }
    } else {
      linkTag = `<link rel="canonical" href="${(toText = to = targetUrl)}">\n`
    }
    return `<!DOCTYPE html>
  <meta charset="utf-8">
  ${linkTag || ''}<script>location="${to}"</script>
  <meta http-equiv="refresh" content="0; url=${to}">
  <meta name="robots" content="noindex">
  <title>Redirect Notice</title>
  <h1>Redirect Notice</h1>
  <p>The page you requested has been relocated to <a href="${to}">${toText}</a>.</p>`
  }

  // copy of the same function in @antora/redirect-producer
  function computeRelativeUrlPath (from, to) {
    if (to === from) return to.charAt(to.length - 1) === '/' ? './' : path.basename(to)
    return (path.relative(path.dirname(from + '.'), to) || '.') + (to.charAt(to.length - 1) === '/' ? '/' : '')
  }