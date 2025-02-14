const { posix: path } = require('path')
const semver = require('semver')

module.exports.register = function ({ config }) {

  const pluralize = (count, noun, suffix = 's', plural = '') => {
    if (count !== 1) {
      return plural !== '' ? plural : `${noun}${suffix}`
    }
    return noun
  }

  const SITEMAP_STEM = 'sitemap'
  const SITEMAP_PREFIX = 'sitemap-'
  const SITEMAP_EXT = '.xml'

  const logger = this.getLogger('modify-sitemaps')
  let componentVersions, mappedComponentVersions = {}
  let latestVersions = {}
  let unMappableComponents = []
  
  this
  .on('contentClassified', ({ playbook, contentCatalog }) => {

    const navFiles = contentCatalog.findBy({ family: 'nav' })

    componentVersions = navFiles.reduce((v, file) => {
      v.hasOwnProperty(file.src.component) ? null : v[file.src.component] = { latest: '', versions: [] }
      v[file.src.component].versions.indexOf(file.src.version) === -1 ? v[file.src.component].versions.push(file.src.version) : null
      return v;
    }, {});

    // derive a default component from site startPage if possible
    const defaultComponent = playbook.site.startPage ? (resolved = contentCatalog.resolvePage(playbook.site.startPage)) ? resolved.src.origin.descriptor.name : Object.keys(componentVersions)[0] : Object.keys(componentVersions)[0] ;
    logger.debug({  }, 'Default component: %s', defaultComponent)

    // check latest is not a prerelease and revert to latest actual release if it is
    for (const component of Object.keys(componentVersions)) {
      const latest = contentCatalog.getComponent(component).latest.version
      if (latest === '') {
        componentVersions[component].latest = '~'
        continue
      }
      const latestCheck = latest === ('current' || '') ? latest : semver.coerce(latest, { loose: true, includePrerelease: true })
      if (latestCheck && semver.prerelease(latestCheck)) {
        const releases = componentVersions[component].versions

        // turn releases into semver objects
        const semverList = []
        const semverObj = {}
        for (const r of releases) {
          const s = r === 'current' ? 'current' : semver.valid(semver.coerce(r, { loose: true, includePrerelease: true }))
          if (s) {
            semverList.push(s)
            semverObj[s] = r
          }
        }

        // ignore prereleases unless it's the only version
        for (s of semver.rsort(semverList)) {
          if (!semver.prerelease(s) || semverList.length === 1) {
            componentVersions[component].latest = semverObj[s]
            if (semverList.length !== 1) logger.info({  }, '%s version %s is the latest version according to semantic versioning rules', component, semverObj[s])
            break
          } else {
            logger.info({  }, '%s version %s is a prerelease', component, semverObj[s])
          }
        }

      } else {
        componentVersions[component].latest = latest
      }
    }

    const defaultSiteMapVersion = componentVersions[defaultComponent].latest

    const { sitemapVersion, data = { components: {}}, latestVersionPath = 'current' } = config

    // update file.pub.url for the latest version of every file for canonical URLs
    contentCatalog.getPages((page) => page.out).forEach( (file) => {
      const { component, version } = file.src
      if (version === componentVersions[component].latest && latestVersionPath !== '') {
        file.pub.url = file.pub.url.replace(version,latestVersionPath)
        logger.debug({ file: file.src }, 'Updating url to %s for canonical URLs', file.pub.url)
      }
    })

    if (!sitemapVersion && data.components.length == 0) {
      logger.error({  }, 'sitemap_version is required but has not been specified in the playbook. Default sitemap generation will be used')
      return
    }

    // check for each component if we can make a sitemap for the version specified
    for (const c of Object.keys(componentVersions)) {
      if (data.components[c]) logger.info({  }, '%s sitemap will be published from version %s (specified by playbook data)', c, data.components[c])
      else if (sitemapVersion) logger.info({  }, '%s sitemap will be published from version %s (specified by playbook)', c, sitemapVersion)
      else if (componentVersions[c].versions.length === 1) logger.info({  }, '%s sitemap will be published from version %s because it is the only version available', c, componentVersions[c].latest)
      else if (componentVersions[c].latest) logger.info({  }, '%s sitemap will be published from version %s (specified by semantic versioning rules)', c, componentVersions[c].latest)

      const versionToMap = data.components[c] || sitemapVersion || componentVersions[c].latest || defaultSiteMapVersion || ''
      if (versionToMap && versionToMap != '~' && !componentVersions[c].versions.includes(versionToMap)) {
        logger.warn({  }, 'Component \'%s\' does not include version \'%s\'. Available versions are \'%s\'', c, versionToMap, componentVersions[c].versions.join(', ') )
        unMappableComponents.push(c)
      }
    }

    const delegate = this.getFunctions().mapSite
    this.replaceFunctions({
      mapSite (playbook, pages) {

        const { sitemapAllVersions = true } = config

        const publishablePages = contentCatalog.getPages((page) => page.out)
        const sitemapPages = publishablePages.reduce((mappable, file) => {

          // what version of this file's component are we trying to add to the sitemap?
          let latestVersion = data.components[file.src.component] || sitemapVersion || componentVersions[file.src.component].latest || defaultSiteMapVersion || ''
          if (latestVersion === '~') latestVersion = ''
          // is this file in that version of the component?
          const latestFile = ( file.src.version == latestVersion || ( !file.src.version && !latestVersion ) )

          latestVersions[file.src.component] = ( typeof latestVersions[file.src.component] != 'undefined' && latestVersions[file.src.component] instanceof Array ) ? latestVersions[file.src.component] : []
          
          // add the file to the sitemap if it is in the latest version of the component
          // or if we are including all versions in the sitemap`
          if ( latestFile || sitemapAllVersions ) mappable.push(file);
          
          if ( latestFile) {
            mappedComponentVersions[file.src.component] = latestVersion;
          } else {
            if (!latestVersions[file.src.component].includes(file.src.version)) latestVersions[file.src.component].push(file.src.version)
          }
          return mappable;
        }, []);

        logger.info({  }, 'Adding %d %s to the %s', sitemapPages.length, pluralize(sitemapPages.length, 'page'), pluralize(mappedComponentVersions.length, 'sitemap'))
        return delegate.call(this, playbook, sitemapPages)
      }
    })
  })
  .on('siteMapped', ({  }) => {

    const { siteCatalog } = this.getVariables()
    const { sitemapVersion, data = { components: componentVersions }, moveSitemapsToComponents = true } = config

    if(!moveSitemapsToComponents) {
      logger.info({  }, 'moveSitemapsToComponents has not been specified in the playbook. Sitemaps will be published to their default locations.')
      return
    }

    if (!sitemapVersion  && data.components.length == 0) {
      logger.error({  }, 'sitemap_version is required but has not been specified in the playbook. The default Antora sitemap generation will be used.')
      return
    }

    logger.info({  }, '%d %s generated', Object.keys(mappedComponentVersions).length, pluralize(Object.keys(mappedComponentVersions).length, 'Sitemap'))
  
    const siteFiles = siteCatalog.getFiles((page) => page.out)

    const sitemapFiles = siteFiles.reduce((sitemaps, file) => {
      if (file.out.path.startsWith(SITEMAP_STEM)) sitemaps.push(file)
      return sitemaps;
    }, []);

    sitemapFiles.forEach( (file) => {
      let dirname, versionDir, path_
      
      if (file.out.path.startsWith(SITEMAP_STEM) && sitemapFiles.length == 1) {
        dirname = Object.keys(mappedComponentVersions)[0]
        versionDir = mappedComponentVersions[dirname] != '' ? mappedComponentVersions[dirname] : '' ;
        path_ = path.join(dirname, versionDir, SITEMAP_STEM+SITEMAP_EXT)
      }

      if (file.out.path.replace(SITEMAP_STEM,'') == SITEMAP_EXT && sitemapFiles.length > 1) {
        siteCatalog.addFile(file)
      }

      if (file.out.path.startsWith(SITEMAP_PREFIX)) {
        dirname = file.out.path.replace(SITEMAP_PREFIX,'').replace(SITEMAP_EXT,'')
        versionDir = mappedComponentVersions[dirname] != '' ? mappedComponentVersions[dirname] : '' ;
        path_ = path.join(dirname, versionDir, SITEMAP_STEM+SITEMAP_EXT)  
      }

      if ( typeof path_ !== 'undefined' && path_ ) {
        logger.info({ file: file.out }, '%s has been moved to %s', file.out.path, path_)
        file.out.path = path_
        siteCatalog.addFile(file)
      }

    })

    // components without sitemaps
    for (const component in latestVersions) {
      if (!Object.keys(mappedComponentVersions).includes(component)) {
        const mappableVersion = sitemapVersion || componentVersions[file.src.component].latest || defaultSiteMapVersion
        logger.warn({  }, 'Could not create sitemap for \'%s\' version \'%s\'. Available versions are \'%s\'', component, mappableVersion, componentVersions[component].versions.join(', ') )
      }
    }

    // components without sitemaps
    for (const component in data.components) {
      if (!Object.keys(latestVersions).includes(component)) {
        logger.warn({  }, 'Sitemap generation for \'%s\' version \'%s\' specified, but no files for this component were found in the site catalog', component, data.components[component] )
      }
    }

  })
}
