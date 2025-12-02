const { parse: parseHTML, valid: validHTML } = require('node-html-parser')
const semver = require('semver')
const rolesData = require('./data/roles.json')

const lowercaseProducts = rolesData.products.map((p) => p.toLowerCase())

module.exports.register = function ({ config }) {

    const {defaultLogLevel = 'info', replaceInlineLabelText = false } = config

    const logger = this.getLogger('neo4j-roles-labels')
  
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

            const logLevel = attributes['suppress-label-messages'] ? 'debug' : (attributes['roles-labels-custom-log-level'] || defaultLogLevel)

            let labelClass, inlineLabel, labelParts
            labelClass = inlineLabel = role.replace('label--', '')
            labelParts = labelClass.toLowerCase().split('-')

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

            // if it's an inline label, and the class matches a valid label
            // add the label text to the labelParts
            // so we can use it to extract version and product information
            // inline labels are output as <span class="label label--labelClass">label text</span> so we can search for SPAN elements
            if (el.tagName === 'SPAN') {
                if (rolesData.labels[labelClass]) {
                    dataLabel = labelClass
                    dataExtras = el.textContent.split(' ').reverse()
                }
            }

            // start by assuming we haven't found a valid label
            let labelFound = false
            let synonymFound = false

            // start with the full label class and reduce it by removing the last part until we find a valid label
            // any parts that we removed become part of the dataExtras array
            // the dataExtras array can then be used to derive a version number (and optionally a product name) for event labels
            while (!labelFound && labelParts.length > 0) {
                const labelCandidate = labelParts.join('-')
                

                if (rolesData.labels[labelCandidate]) {
                    dataLabel = labelCandidate
                    labelFound = true
                }

                if (rolesData.synonyms[labelCandidate]) {
                    dataLabel = rolesData.synonyms[labelCandidate]
                    labelFound = synonymFound = true
                }

                if (!labelFound) {
                    dataExtras.push(labelParts.pop())
                }
            }

            // if we haven't found a label, the label being used is not an official, valid label, defined in rolesData.labels
            if (!labelFound) {
                logger[logLevel]({ file: src, source: src.origin }, 'Label "%s" is not defined', labelClass)
                return
            }

            dataExtras = dataExtras.filter(function (t) {
                return (!(t === (rolesData.labels[dataLabel].joinText || 'in' ) || t === rolesData.labels[dataLabel].displayText))
                })

            // flag labels if roles-labels-flag is set
            if (attributes['roles-labels-flag'] && attributes['roles-labels-flag'].split(' ').includes(dataLabel)) {
                logger[logLevel]({ file: src, source: src.origin }, 'Label "%s" found', labelClass)
            }

            // the last item in a label might be a version number
            if (dataExtras.length > 0) {
                const versionCandidate = dataExtras.shift()
                dataVersion = semver.valid(semver.coerce(versionCandidate, { loose: true, includePrerelease: true })) ? versionCandidate : ''
            }

            // if anything is left it might be a product name
            while (dataExtras.length > 0) {
                dataProduct = lowercaseProducts.indexOf(dataExtras.join(' ').toLowerCase()) !== -1 ? camelCased(dataExtras.join(' ')) : ''
                if (!dataProduct) dataExtras.pop()
                else break
            }

            // put all the label details into an object
            var labelDetails = {
                src: {
                    validLabel: true,
                    inline: el.tagName === 'SPAN' ? true : false,
                    class: labelClass,
                    synonym: synonymFound ? dataLabel : '',
                    text: el.tagName === 'SPAN' ? el.textContent : '',
                },
                out: {
                    class: dataLabel,
                    id: `_${dataLabel.replace('-', '_')}`,
                    eventOrder: rolesData.labels[dataLabel].eventOrder || -1,
                    joinText: dataVersion ? rolesData.labels[dataLabel].joinText || 'in' : '',
                    text: rolesData.labels[dataLabel].displayText || '',
                    altText: rolesData.labels[dataLabel].altDisplayText || '',
                },
                data: {
                    product: dataProduct || rolesData.labels[dataLabel].product || attributes['page-product'] || '',
                    version: dataVersion || '',
                    function: rolesData.labels[dataLabel].function || '',
                    labelClass: labelClass,
                    events: {}
                },
                log: rolesData.labels[dataLabel].log || false,
                logLevel: logLevel
            }

            // if it's an inline label, check whether it should be a role instead
            // if the parent contains only labels, then the parent text will be the same as the aggregated text of the labels in the parent.
            // In this case a role should be used on the parent element
            // the exception to this rule is where the label is used in a table cell
            if (el.tagName === 'SPAN' && el.parentNode.tagName === 'P' && !el.closest("td")) {
                const parentText = el.parentNode.textContent.replace(/\n/g, ' ').trim()
                const labelsText = el.parentNode.querySelectorAll('span.label').map((s) => s.textContent.trim()).join(' ').trim()
                // the suggested fix depends on whether we are in the main section of the page below the h1, or in a subsection
                let suggestedFix = `Add [role=label--${labelDetails.src.synonym || labelDetails.src.class}] to heading or block level element`
                if (el.closest('div#preamble')) {
                    suggestedFix = `Add :page-role: ${labelDetails.src.synonym || labelDetails.src.class} to the document header`
                }
                if (parentText === labelsText) logger[logLevel]({ "suggested fix": suggestedFix, file: src, source: src.origin }, 'Inline label:%s macro used in place of role', labelClass)
            }

            // tell the user what the label: macro should look like based on the role, product, and version
            // if the label is for an event, log a message if the label does not include a version number
            if (labelDetails.src.inline && rolesData.labels[dataLabel].labelCategory === 'version') {
                if (labelDetails.data.product) {
                    inlineLabel += `-${labelDetails.data.product}`
                }

                // if there is a version on an event label, add it to the class, else log a message
                // the message dependson whether the label has a suggested alternative, eg new-versionless instead of new
                if (labelDetails.data.version) {
                    inlineLabel += `-${labelDetails.data.version}`
                }
                
                // labels that would normally include a version can sometimes be displayed without a version
                // if the label supports versionless, it doesn't need a version number
                // if the labeld does not support versionless, log a message
                if (!rolesData.labels[dataLabel].canBeVersionless && !labelDetails.data.version) {
                    labelDetails.src.validLabel = false
                    let suggestedFix = `label:${inlineLabel}-VERSION[] or label:${labelClass}\[${labelDetails.out.text} ${rolesData.labels[labelClass].joinText || 'in'} VERSION\]`
                    if (rolesData.labels[labelClass].suggestedAlternative) suggestedFix = `Use label:${rolesData.labels[labelClass].suggestedAlternative}[], or ` + suggestedFix
                    logger[labelDetails.logLevel]({ "suggested fix": suggestedFix, file: src, source: src.origin }, 'Label "%s" should include a version number', labelClass)
                }
            }

            if (rolesData.labels[dataLabel].labelCategory === 'version') {
                labelDetails.data.events[dataLabel] = dataVersion
            }

            // update label text for versioned labels
            if (rolesData.labels[dataLabel].labelCategory === 'version' || (rolesData.labels[dataLabel].joinText && dataVersion)) {
                labelDetails.out.text = [labelDetails.out.text, labelDetails.out.joinText, labelDetails.data.product, labelDetails.data.version].filter(function(t) {
                    return t;
                }).join(' ')
            }

            // if an inline label has custom text, log a message
            // we should always use the default generated text for inline labels
            if (labelDetails.src.inline && labelDetails.src.text !== '' && labelDetails.src.text !== labelDetails.out.text && !labelDetails.out.altText.map((text) => text.trim()).includes(labelDetails.src.text) && rolesData.labels[labelClass] && labelDetails.src.validLabel) {
                if (replaceInlineLabelText) {
                    logger[labelDetails.logLevel]({ file: src, source: src.origin }, 'Text "%s" on label "%s" will be updated to the default text output: "%s"', el.textContent, labelClass, labelDetails.out.text)
                } else {
                    logger[labelDetails.logLevel]({ "suggested fix": `label:${inlineLabel}[] or label:${labelClass}\[${labelDetails.out.text}\]`, file: src, source: src.origin }, 'Label text "%s" on inline label "%s" should be removed or replaced with the default text "%s"', el.textContent, labelClass, labelDetails.out.text)
                }
            }

            // log an info message if the label is deprecated
            if (rolesData.labels[dataLabel].deprecated) {
                logger[labelDetails.logLevel]({ file: src, source: src.origin }, 'Label "%s" is deprecated', labelClass)
            }

            return labelDetails
        }

        var addDataset = function (el, labelDetails) {
            for (var d in labelDetails.data.events) {
                el.setAttribute(`data-${d}`, labelDetails.data.events[d] || '')
            }
            // add the product if it is not already set
            if (labelDetails.data.product) {
                if (!el.hasAttribute('data-product')) {
                    el.setAttribute('data-product', labelDetails.data.product)
                } else {
                    el.setAttribute('data-product', el.getAttribute('data-product') + ', ' + labelDetails.data.product)
                }
            }

            // add the actual label classes as attributes
            if (labelDetails.data.labelClass) {
                if (!el.hasAttribute('data-label')) {
                    el.setAttribute('data-label', labelDetails.data.labelClass)
                } else {
                    el.setAttribute('data-label', el.getAttribute('data-label') + ' ' + labelDetails.data.labelClass)
                }
            }

        }

        files.forEach( (file) => {
            if (!file.out || !file.asciidoc) return

            if (!validHTML(file.contents.toString())) {
                logger.warn({ file: file.src, source: file.src.origin }, 'Unable to process roles: the generated HTML for the file is not valid.')
                return
            }

            const parsed = parseHTML(file.contents.toString())
            const headings = ['H2', 'H3', 'H4', 'H5', 'H6', 'CAPTION']
            const roleDivs = parsed.querySelectorAll('[class*="label--"]')
            var labelCount = 0
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
                            roleDiv.textContent = (labelDetails.src.validLabel && replaceInlineLabelText) ? labelDetails.out.text : labelDetails.src.text
                            roleDiv.classList.add(`label--${labelDetails.out.class}`)
                            // addDataset(datasetDiv.parentNode, labelDetails)
                        }

                        return
                    }

                    if (typeof labelDetails === 'undefined') {
                        return
                    }

                    // create a span element for the label
                    const labelSpan = createElement('span', `label content-label label--${labelDetails.out.class}`, labelDetails.out.text)

                    labelSpan.firstChild.data = {}

                    // detect possibly badly formed HTML if there is no datasetDiv
                    if (!datasetDiv) {
                        logger[labelDetails.logLevel]({ file: file.src, source: file.src.origin }, 'Unable to set dataset attributes for <%s> element "%s" - HTML might be malformed as a result of an error in the asciidoc source', roleDiv.tagName, roleDiv.textContent)
                    } else {
                        addDataset(datasetDiv, labelDetails)
                    }

                    labels.push(
                        {
                        html: labelSpan,
                        eventOrder: labelDetails.out.eventOrder,
                        id: `_label_${labelCount++}_${labelDetails.out.id}`,
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

                    // add id attribtue to rolediv if it doesn't already have one
                    if (!roleDiv.hasAttribute('id')) {
                        roleDiv.setAttribute('id', label.id)
                    }
                    
                }

                if (roleDiv.classList.contains('admonitionblock')) {
                    labelsLocation = roleDiv.querySelector('td.content')
                }

                

                if (roleDiv.tagName === 'H1' || headings.includes(roleDiv.firstElementChild.tagName)) {
                    labelsLocation.append(labelsDiv)
                    labelsLocation.classList.add('header-label-container')
                } else {
                    labelsLocation.prepend(labelsDiv)
                    roleDiv.classList.add('has-label')
                }
            })

            file.contents = Buffer.from(parsed.toString())
            
        })

    })

}