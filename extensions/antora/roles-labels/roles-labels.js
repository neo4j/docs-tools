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

        var getLabelDetails = function (role, attributes) {
            var label = role.replace('label--', '')
            var labelParts = label.split('-')

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
            const dataExtras = []

            // what about roles like new-bolt-5.20 if we want to use a product name in the label?
            while (!dataLabel && labelParts.length > 0) {
                const labelCandidate = labelParts.join('-')
                if (rolesData[labelCandidate]) {
                    dataLabel = labelCandidate
                } else {
                    dataExtras.push(labelParts.pop())
                }
            }

            // ignore labels that are not defined in rolesData
            if (!dataLabel) {
                return
            }

            if (dataExtras.length > 0) {
                dataVersion = dataExtras.shift()
            }

            if (dataExtras.length > 0) {
                dataProduct = camelCased(dataExtras.join(' '))
            }

            var labelDetails = {
                class: dataLabel,
                role: dataLabel,
                text: rolesData[dataLabel].displayText || '',
                joinText: dataVersion ? rolesData[dataLabel].joinText || 'in' : '',
                data: {
                    product: dataProduct || rolesData[dataLabel].product || attributes['page-product'] || '',
                    version: dataVersion || '',
                    function: rolesData[dataLabel].function || '',
                    events: {}
                },
            }

            if (rolesData[dataLabel].labelCategory === 'version') {
                labelDetails.data.events[dataLabel] = dataVersion
            }

            // update label text for versioned labels
            if ((rolesData[dataLabel].labelCategory === 'version' || (rolesData[dataLabel].joinText && dataVersion))) {
                labelDetails.text = [labelDetails.text, labelDetails.joinText, labelDetails.data.product, labelDetails.data.version].filter(function(t) {
                    return t;
                }).join(' ')
            }

            return labelDetails
        }

        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return

            const parsed = parseHTML(file.contents.toString())
            const headings = ['H2', 'H3', 'H4', 'H5', 'H6', 'CAPTION']
            const roleDivs = parsed.querySelectorAll('[class*="label--"]')

            roleDivs.forEach(function (roleDiv) {
                var rolesClassList = roleDiv.classList

                // ignore:
                // - spans because they're inline and we only care about labels on block elements DIV or TABLE
                // - discrete headers
                if (roleDiv.tagName === 'SPAN' || rolesClassList.contains('discrete')) return

                roles = rolesClassList.value.sort().filter(function (c) {
                    return (c.startsWith('label--'))
                })

                if (roles.length === 0) return

                const labels = []

                // decide which node to add the dataset to
                datasetDiv = (roleDiv.tagName === 'H1') ? parsed.querySelector('article.doc') : roleDiv

                roles.forEach(function (role) {
                    const labelDetails = getLabelDetails(role, file.asciidoc.attributes)

                    // remove the role from the parent div
                    roleDiv.classList.remove(role)

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
                                            // add dataset to parent divs
                        for (var d in labelDetails.data.events) {
                            datasetDiv.setAttribute(`data-${d}`, labelDetails.data.events[d] || '')
                        }

                        if (labelDetails.data.product) {
                            datasetDiv.setAttribute('data-product', labelDetails.data.product)
                        }

                    }

                    labels.push(labelSpan)
                })

                // we only generate labels from defined roles
                // no need to do anything if we found only undefined roles
                if (labels.length === 0) return

                let labelsLocation = (roleDiv.firstElementChild && headings.includes(roleDiv.firstElementChild.tagName)) ? roleDiv.firstElementChild : roleDiv
                let labelsDiv = createElement('div', 'labels')

                for (const label of labels) {
                    if (roleDiv.tagName === 'H1' || headings.includes(roleDiv.firstElementChild.tagName)) {
                        label.classList.add('header-label')
                    }
                    labelsDiv.firstChild.appendChild(label)

                    for (var d in label.dataset) {
                        roleDiv.dataset[d] = label.dataset[d]
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