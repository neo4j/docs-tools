const { posix: path } = require('path')

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
  let mappableComponentVersions = {}
  let excludeVersions = {}
  
  this
  .on('contextStarted', () => {
    const { sitemapVersion, data = { components: {}}, sitemapLocVersion = sitemapVersion } = config

    if (!sitemapVersion) {
      logger.error({  }, 'sitemap_version is required but has not been specified in the playbook. Default sitemap generation will be used')
      return
    }

    const delegate = this.getFunctions().mapSite
    this.replaceFunctions({
      mapSite (playbook, pages) {
        const mappablePages = pages.reduce((mappable, file) => {
            const mappableVersion = data.components[file.src.component] ? data.components[file.src.component] : sitemapVersion
            excludeVersions[file.src.component] = ( typeof excludeVersions[file.src.component] != 'undefined' && excludeVersions[file.src.component] instanceof Array ) ? excludeVersions[file.src.component] : []
            if (file.src.version == mappableVersion || ( file.src.version === '' && mappableVersion == '~' ) ) {
            file.pub.url = file.pub.url.replace(mappableVersion,sitemapLocVersion)
            mappable.push(file);
            mappableComponentVersions[file.src.component] = mappableVersion;
          } else {
            if (!excludeVersions[file.src.component].includes(file.src.version)) excludeVersions[file.src.component].push(file.src.version)
          }
          return mappable;
        }, []);
        logger.info({  }, 'Adding %d %s to the %s for version %s', mappablePages.length, pluralize(mappablePages.length, 'page'), pluralize(mappableComponentVersions.length, 'sitemap'), sitemapVersion)
        return delegate.call(this, playbook, mappablePages)
        
      }
    })
  })
  .on('siteMapped', ({  }) => {

    const { siteCatalog } = this.getVariables()
    const { sitemapVersion, data = {components: {}}, sitemapLocVersion = sitemapVersion, moveSitemapsToComponents } = config

    if(!moveSitemapsToComponents) {
      logger.info({  }, 'moveSitemapsToComponents has not been specified in the playbook. Sitemaps will be published to their default locations.')
      return
    }

    if (!sitemapVersion) {
      logger.error({  }, 'sitemap_version is required but has not been specified in the playbook. The default Antora sitemap generation will be used.')
      return
    }

    logger.info({  }, '%s generated for version %s', pluralize(mappableComponentVersions.length, 'Sitemap'), sitemapVersion)
  
    const siteFiles = siteCatalog.getFiles((page) => page.out)

    const sitemapFiles = siteFiles.reduce((sitemaps, file) => {
      if (file.out.path.startsWith(SITEMAP_STEM)) sitemaps.push(file)
      return sitemaps;
    }, []);

    sitemapFiles.forEach( (file) => {
      let dirname, versionDir, path_
      
      if (file.out.path.startsWith(SITEMAP_STEM) && sitemapFiles.length == 1) {
        dirname = Object.keys(mappableComponentVersions)[0]
        versionDir = mappableComponentVersions[dirname] != '~' ? mappableComponentVersions[dirname] : '' ;
        path_ = path.join(dirname, versionDir, SITEMAP_STEM+SITEMAP_EXT)
      }

      if (file.out.path.replace(SITEMAP_STEM,'') == SITEMAP_EXT && sitemapFiles.length > 1) {
        logger.info({ file: file.out }, 'Paths updated in sitemap index file')
        stre = `${SITEMAP_PREFIX}(.*)${SITEMAP_EXT}`
        var re = new RegExp(stre, "g");
        file.contents = Buffer.from(file.contents.toString().replaceAll(re,`$1/${sitemapLocVersion}/${SITEMAP_STEM}${SITEMAP_EXT}`))
        siteCatalog.addFile(file)
      }

      if (file.out.path.startsWith(SITEMAP_PREFIX)) {
        dirname = file.out.path.replace(SITEMAP_PREFIX,'').replace(SITEMAP_EXT,'')
        versionDir = mappableComponentVersions[dirname] != '~' ? mappableComponentVersions[dirname] : '' ;
        path_ = path.join(dirname, versionDir, SITEMAP_STEM+SITEMAP_EXT)  
      }

      if ( typeof path_ !== 'undefined' && path_ ) {
        logger.info({ file: file.out }, '%s has been moved to %s', file.out.path, path_)
        file.out.path = path_
        siteCatalog.addFile(file)
      }

    })

    // components without sitemaps
    for (const component in excludeVersions) {
      if (!Object.keys(mappableComponentVersions).includes(component)) {
        const mappableVersion = data.components[component] ? data.components[component] : sitemapVersion 
        logger.warn({  }, 'Could not create sitemap for \'%s\' version \'%s\'. Available versions are \'%s\'', component, mappableVersion, excludeVersions[component].join(', ') )
      }
    }

    // components without sitemaps
    for (const component in data.components) {
      if (!Object.keys(excludeVersions).includes(component)) {
        logger.warn({  }, 'Sitemap generation for \'%s\' version \'%s\' specified, but no files for this component were found in the site catalog', component, data.components[component] )
      }
    }

  })
}
