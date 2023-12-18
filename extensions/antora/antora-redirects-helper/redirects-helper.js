const { posix: path } = require('path')
const File = require('vinyl')

module.exports.register = function ({ config }) {

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
    const { redirectFormat } = config
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
          if (newPage) {
            return
          }
    
          // logger.warn({ 'file': page.src, 'source': page.src.origin  }, 'Page in version %s removed or moved in later versions: %s (%s)', page.src.version, page.src.path, page.asciidoc.doctitle)
    
          // if we have got this far, the page has been moved or removed in the new version

          // First check if there are any page aliases that point to this page
          // If there is at least one, we don't need to do anything, that alias means there will be no 404 in the new version for this page
          const requiredAliasTarget = page.pub.url.replace(redirectFromVersion, redirectToVersion)
          const allAliases = contentCatalog.findBy({ family: 'alias' })
          const aliasesToHere = allAliases.filter(alias => alias.pub.url === requiredAliasTarget)

          // alias.pub.url is constructed from the page-alias value
          // alias.rel.pub.url is constructed from the output path of the file that contains the page-alias

          if (aliasesToHere.length > 0) {
            aliasesToHere.forEach(alias => {
              // console.log(alias.rel.pub)
              // console.log(alias.pub)
              // console.log(alias.src)
              // logger.info({ 'file': page.src, 'source': page.src.origin  }, 'Alias found for page %s (%s)', redirectFromVersion, page.src.path, page.asciidoc.doctitle)
              logger.info({ 'file': page.src, 'source': page.src.origin  }, 'Alias %s found for %s (%s) which was removed from %s to %s', alias.rel.pub.url, page.src.relative, page.asciidoc.doctitle, redirectFromVersion, redirectToVersion)
            })
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
              logger.info({ 'file': newFile.src, 'source': newFile.src.origin  }, '%s is a possible alias found for %s (%s) which was removed from %s to %s', newFile.src.relative, page.src.relative, searchTitle, redirectFromVersion, redirectToVersion)
            })
    
          } else {
            logger.info({ 'file': page.out.dirname, 'source': page.src.origin  }, 'No aliases found for %s (%s) which was removed in version %s', page.src.path, searchTitle, redirectToVersion)
          }
    
        })

      }

    })

  })
  .on('navigationBuilt',  ({  }) => {

    const { playbook, contentCatalog } = this.getVariables()

    // generate specific Neo4j nginx redirects if the playbook specifies redirect_facility: neo4j
    if (playbook.urls.redirectFacility !== 'neo4j') return

    const aliases = contentCatalog.findBy({ family: 'alias' })
    const delegate = this.getFunctions().produceRedirects
    this.replaceFunctions({
      produceRedirects(playbook, aliases) {
        const siteUrl = playbook.site.url
        return createNeoRewriteConf(aliases, extractUrlPath(siteUrl))
      }

    })

  }) 

  function createNeoRewriteConf (files, urlPath) {
    const componentList = files.map((file) => { return file.src.component })
    const uniqueComponents = Array.from(new Set(componentList));
    let rewriteFiles = []
    uniqueComponents.forEach((component) => {
      const filteredFiles = files.filter(file => file.src.component === component && file.pub.url !== '/')
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
