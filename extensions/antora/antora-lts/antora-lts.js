// Add an LTS value to the component version object in the contentCatalog
// to mark a component version as an LTS release in the source
// add lts:true to the relevant antora.yml file

module.exports.register = function ({ config }) {
  const logger = this.getLogger('antora-lts')
  this.on('navigationBuilt', ({ contentCatalog, siteCatalog, navigationCatalog }) => {
    const files = contentCatalog.findBy({ family: 'nav' })
    const ltsReleases = files.reduce((v, file) => {
      if ('origin' in file.src && file.src.origin.descriptor.lts) {
        const key = file.src.version + '@' + file.src.component
        v.indexOf(key) === -1 ? v.push(key) : null
      } 
      return v;
    }, []);
    ltsReleases.forEach((release) => {
      const [version, component] = release.split('@')
      const componentVersion = contentCatalog.getComponentVersion(component, version)
      componentVersion.lts = true
      logger.info('Marked %s@%s as LTS', component, version)
    })
  })
}
