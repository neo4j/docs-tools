'use strict';

let Validator = require('jsonschema').Validator;
let v = new Validator();

// label schema for testing
let schema = {
  "id": "/LabelsData",
  "type": "object",
  "properties": {
    "products": {"$ref": "/Product"},
    "synonyms": {"$ref": "/Synonym"},
    "labels": {"$ref": "/Label"}
  }
};

let productSchema = {
  "id": "/Product",
  "type": "array",
  "items": {"type": "string"}
};

let synonymSchema = {
  "id": "/Synonym",
  "type": "object"
};

let labelSchema = {
  "id": "/Label",
  "type": "object",
  "patternProperties": {
        "[a-z]+": {
          "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "required": true
                },
                "labelCategory": {"type": "string"},
                "function": {"type": "string"},
                "product": {"type": "string"},
                "canBeVersionless": {"type": "boolean"},
                "deprecated": {"type": "boolean"},
                "suggestedAlternative": {"type": "string"},
                "displayText": {"type": "string"},
                "altDisplayText": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    }
                },
                "joinText": {"type": "string"},
                "eventOrder": {"type": "integer"},
                "usage": {"type": "object"},
                "notes": {"type": "string"}
        },
        "additionalProperties": false
      },
    }
};

v.addSchema(productSchema, '/Product');
v.addSchema(synonymSchema, '/Synonym');
v.addSchema(labelSchema, '/Label');

// load the roles.json file
let fs = require('fs');
let path = require('path');
let rolesFilePath = path.join(__dirname, '..', 'data', 'roles.json');
let rolesData = JSON.parse(fs.readFileSync(rolesFilePath, 'utf8'));

// validate the roles data
let result = v.validate(rolesData, schema);

if (result.errors.length > 0) {
  console.error('Validation errors in roles.json:');
  result.errors.forEach(error => {
    console.error(`- ${error.stack}`);
  });
  process.exit(1);
} else {
  console.log('roles.json is valid.');
}