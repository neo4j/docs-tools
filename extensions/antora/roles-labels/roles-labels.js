const { parse: parseHTML } = require('node-html-parser')
const rolesData = require('./data/roles.json')

module.exports.register = function ({ config }) {

    const {logLevel = 'warn'} = config

    const logger = this.getLogger('add-labels')
  
    this
    .on('pagesComposed', ({ config }) => {

        const { contentCatalog } = this.getVariables()

        const files = contentCatalog.getFiles()

        function createElement(el,className,text = '') {
            let output = parseHTML(`<${el} class="${className}">${text}</${el}>`)
            return output
        }

        var camelCased = function (str) {
            return str.split(/-|\./)
                .map((text) => text.substr(0, 1).toUpperCase() + text.substr(1))
                .join('')
            }

        var getLabelDetails = function (src, el, role, attributes) {

            let label, inlineLabel, labelParts
            label = inlineLabel = role.replace('label--', '')
            labelParts = label.toLowerCase().split('-')

            // if it's an inline label, add the label text to the labelParts
            if (el.tagName === 'SPAN') labelParts = labelParts.concat(el.textContent.split(' '))

            // roles can be single word ie beta - use beta as label class and text from rolesDatee.beta
            // roles can be single word + version ie new-5.20 - use new as label class and text from rolesData.new + version number
            // roles can be multiple words ie aura-db-dedicated - use aura-db-dedicated as label class and text from rolesData.aura-db-dedicated
            // roles like deprecated can appear with or without a version number - deprecated-5.20 or deprecated
            // - use deprecated as label class and text from rolesData.deprecated
            // - use deprecated as label class and text from rolesData.deprecated + version number

            // so if the role is a single word, we use the role as is - ie deprecated
            // if it is longer we test to see if it is a 'versionable' roke - ie deprecated-5.20
            // if it is a versionable role, and a version is specified, we remove the version and use the remaining text as the label class
            // if (labelParts.length > 1) {
            //   label = (rolesData[label] && rolesData[label].labelCategory !== 'version') ? label : labelParts.slice(0, -1).join('-')
            // }

            let dataLabel, dataProduct, dataVersion
            let dataExtras = []

            // what about roles like new-bolt-5.20 if we want to use a product name in the label?
            while (!dataLabel && labelParts.length > 0) {
                const labelCandidate = labelParts.join('-')
                if (rolesData.labels[labelCandidate]) {
                    dataLabel = labelCandidate
                } else {
                    dataExtras.push(labelParts.pop())
                }
            }

            // console.log('dataExtras before', dataExtras)

            dataExtras = dataExtras.filter(function (t) {
                    return (!(t === (rolesData.labels[dataLabel].joinText || 'in' ) || t === rolesData.labels[dataLabel].displayText))
                    })

            // console.log('dataExtras after', dataExtras)

            // ignore labels that are not defined in rolesData.labels
            if (!dataLabel) {
                logger[logLevel]({ file: src }, 'Label "%s" is not defined', label)
                return
            }

            // log labels if label-log-level is set and the label is configured to be logged
            if (rolesData.labels[dataLabel].log && attributes['label-log-level']) {
                logger[attributes['label-log-level']]({ file: src }, 'Label "%s" found', label)
            }

            // flag labels if roles-labels-flag is set
            if (attributes['roles-labels-flag'] && attributes['roles-labels-flag'].split(' ').includes(dataLabel)) {
                logger[logLevel]({ file: src }, 'Label "%s" found', label)
            }

            if (dataExtras.length > 0) {
                dataVersion = dataExtras.shift()
            }

            if (dataExtras.length > 0) {
                dataProduct = rolesData.products.indexOf(camelCased(dataExtras.join(' '))) !== -1 ? camelCased(dataExtras.join(' ')) : ''
            }

            var labelDetails = {
                class: dataLabel,
                role: dataLabel,
                eventOrder: rolesData.labels[dataLabel].eventOrder || -1,
                text: rolesData.labels[dataLabel].displayText || '',
                joinText: dataVersion ? rolesData.labels[dataLabel].joinText || 'in' : '',
                data: {
                    product: dataProduct || rolesData.labels[dataLabel].product || attributes['page-product'] || '',
                    version: dataVersion || '',
                    function: rolesData.labels[dataLabel].function || '',
                    events: {}
                },
                log: rolesData.labels[dataLabel].log || false
            }

            // tell the user what the label: macro should look like based on the role, product, and version
            if (el.tagName === 'SPAN') {
                if (labelDetails.data.product) {
                    inlineLabel += `--${labelDetails.data.product}`
                }
                if (labelDetails.data.version) {
                    inlineLabel += `-${labelDetails.data.version}`
                }
            }

            if (rolesData.labels[dataLabel].labelCategory === 'version') {
                labelDetails.data.events[dataLabel] = dataVersion
            }

            // update label text for versioned labels
            if ((rolesData.labels[dataLabel].labelCategory === 'version' || (rolesData.labels[dataLabel].joinText && dataVersion))) {
                labelDetails.text = [labelDetails.text, labelDetails.joinText, labelDetails.data.product, labelDetails.data.version].filter(function(t) {
                    return t;
                }).join(' ')
            }

            if (el.tagName === 'SPAN' && labelDetails.text !== el.textContent) {
                logger[logLevel]({ file: src, fix: `label:${inlineLabel}[]` }, 'Text "%s" on label "%s" will be replaced by default formatted text "%s"', el.textContent, label, labelDetails.text)
            }

            return labelDetails
        }

        var addDataset = function (el, labelDetails) {
            for (var d in labelDetails.data.events) {
                el.setAttribute(`data-${d}`, labelDetails.data.events[d] || '')
            }

            if (labelDetails.data.product) {
                el.setAttribute('data-product', labelDetails.data.product)
            }
        }

        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return

            const parsed = parseHTML(file.contents.toString())
            const headings = ['H2', 'H3', 'H4', 'H5', 'H6', 'CAPTION']
            const roleDivs = parsed.querySelectorAll('[class*="label--"]')

            roleDivs.forEach(function (roleDiv) {
                var rolesClassList = roleDiv.classList

                // ignore:
                // - discrete headers
                if (rolesClassList.contains('discrete')) return

                roles = rolesClassList.value.sort().filter(function (c) {
                    return (c.startsWith('label--'))
                })

                if (roles.length === 0) return

                const labels = []

                // decide which node to add the dataset to
                datasetDiv = (roleDiv.tagName === 'H1') ? parsed.querySelector('article.doc') : roleDiv

                roles.forEach(function (role) {
                    const labelDetails = getLabelDetails(file.src, roleDiv, role, file.asciidoc.attributes)

                    // remove the role from the parent div
                    roleDiv.classList.remove(role)

                    if (roleDiv.tagName === 'SPAN') {
                        
                        if (labelDetails) {
                            // console.log(labelDetails)
                            roleDiv.textContent = labelDetails.text
                            roleDiv.classList.add(`label--${labelDetails.class}`)
                            addDataset(datasetDiv.parentNode, labelDetails)
                        } else {
                            console.log(roleDiv.textContent)
                        }
                        return
                    }

                    if (typeof labelDetails === 'undefined') {
                        return
                    }

                    // create a span element for the label
                    const labelSpan = createElement('span', `label content-label label--${labelDetails.class}`, labelDetails.text)

                    labelSpan.firstChild.data = {}

                    // detect possibly badly formed HTML if there is no datasetDiv
                    if (!datasetDiv) {
                        logger[logLevel]({ file: file.src }, 'Unable to set dataset attributes for <%s> element "%s" - HTML might be malformed as a result of an error in the asciidoc source', roleDiv.tagName, roleDiv.textContent)
                    } else {
                        addDataset(datasetDiv, labelDetails)
                    }

                    labels.push(
                        {
                        html: labelSpan,
                        eventOrder: labelDetails.eventOrder,
                        }
                    )
                })

                // we only generate labels from defined roles
                // no need to do anything if we found only undefined roles
                if (labels.length === 0) return

                let labelsLocation = (roleDiv.firstElementChild && headings.includes(roleDiv.firstElementChild.tagName)) ? roleDiv.firstElementChild : roleDiv
                let labelsDiv = createElement('div', 'labels')

                // add the labels, in the following order:
                // 1. information labels (all non-event labels are given a negative eventOrder)
                // 2. event labels, ordered by eventOrder ascending
                for (const label of labels.sort((a, b) => a.eventOrder - b.eventOrder)) {
                    if (roleDiv.tagName === 'H1' || headings.includes(roleDiv.firstElementChild.tagName)) {
                        label.html.classList.add('header-label')
                    }
                    labelsDiv.firstChild.appendChild(label.html)

                    for (var d in label.html.dataset) {
                        roleDiv.dataset[d] = label.html.dataset[d]
                    }
                }

                if (roleDiv.classList.contains('admonitionblock')) {
                    labelsLocation = roleDiv.querySelector('td.content')
                }

                if (roleDiv.tagName === 'H1' || headings.includes(roleDiv.firstElementChild.tagName)) {
                    labelsLocation.append(labelsDiv)
                    labelsLocation.classList.add('header-label-container')
                } else {
                    labelsLocation.append(labelsDiv)
                    roleDiv.classList.add('has-label')
                }
            })

            file.contents = Buffer.from(parsed.toString())
            
        })

    })

}