// Add an LTS value to the component version object in the contentCatalog
// to mark a component version as an LTS release in the source
// add lts:true to the relevant antora.yml file

module.exports.register = function ({ config }) {
  const logger = this.getLogger('selector-labels')
  this.on('navigationBuilt', ({ contentCatalog }) => {

    const defaultConfig = [
      [ 'current', { selectorText: '(Current)', unique: true } ],
      [ 'lts', { selectorText: '(LTS)' } ]
    ]

    const data = Object.entries(config).length > 0 ? Object.entries(config) : defaultConfig
    const files = contentCatalog.findBy({ family: 'nav' })

    var selectorLabels = []
    data.forEach(([attr, properties]) => {

      const componentVersions = files.reduce((v, file) => {
        if ('origin' in file.src && file.src.origin.descriptor[attr]) {
          const key = file.src.version + '@' + file.src.component
          v.indexOf(key) === -1 ? v.push(key) : null
        } 
        return v;
      }, []);

      selectorLabels.push({
        name: attr,
        properties: properties,
        componentVersions: componentVersions
      })


    })

    selectorLabels.forEach((label) => {
      label.componentVersions.forEach((entry) => {
        const [version, component] = entry.split('@')
        const componentVersion = contentCatalog.getComponentVersion(component, version)
        componentVersion.selectorText = (componentVersion.selectorText || '').concat(' ' + label.properties.selectorText).trim()
        componentVersion[label.name] = true
        label.componentsMarked = (label.componentsMarked || {})
        label.componentsMarked[component] = (label.componentsMarked[component] || []).concat([version])
        logger.info('Marked %s@%s as %s', version, component, label.properties.selectorText)
      })

    })

    // Check for components with multiple attrs where attr is marked as unique in config
    selectorLabels.filter(label => label.properties.unique).forEach((label) => {
      Object.keys(label.componentsMarked).forEach((component) => {
        if (label.componentsMarked[component].length > 1) {
          logger.error('Component %s has multiple %s versions: %s', component, label.name, label.componentsMarked[component].join(', '))
        }
      })
    })

  })
}
