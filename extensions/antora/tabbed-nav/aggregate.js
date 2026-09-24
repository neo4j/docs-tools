#!/usr/bin/env node
'use strict'

// S3 aggregator: lists every <component>/nav.json under a prefix, deep-merges
// them, and writes the result back to S3 as tabs.json. This is the post-publish
// task that runs in CI alongside the existing versions.json and sitemap_index
// updaters.
//
// Usage (also installable as the `tabbed-nav-aggregate` bin from this package):
//   AWS_PROFILE=docs-dev \
//   AWS_BUCKET=development-neo4j-docs-origin \
//   DOCS_PREFIX=docs/sandbox/restructure/docs/ \
//   node extensions/antora/tabbed-nav/aggregate.js
//
// The output key for tabs.json is derived as DOCS_PREFIX + 'nav/tabs.json'.
// Credentials are picked up from the AWS_PROFILE env var via the standard
// SDK credential chain. Region defaults to us-east-1; override via AWS_REGION.

let S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand
try {
  ({ S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3'))
} catch (e) {
  console.error('Missing dependency: @aws-sdk/client-s3. Run `npm install --save @aws-sdk/client-s3`.')
  process.exit(1)
}

// Per-component nav shard filename. Must match the one emitted by the
// generate stage in ./index.js.
const SHARD_FILENAME = 'nav.json'

const BUCKET = process.env.AWS_BUCKET
const PREFIX = process.env.DOCS_PREFIX
const REGION = process.env.AWS_REGION || 'us-east-1'

if (!BUCKET || !PREFIX) {
  console.error('Required env vars: AWS_BUCKET, DOCS_PREFIX')
  process.exit(1)
}

const TABS_KEY = PREFIX.replace(/\/+$/, '') + '/nav/tabs.json'

const s3 = new S3Client({ region: REGION })

async function listShardKeys () {
  const keys = []
  let ContinuationToken
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: PREFIX,
      ContinuationToken,
    }))
    for (const obj of res.Contents || []) {
      if (obj.Key.endsWith('/' + SHARD_FILENAME) && obj.Key !== TABS_KEY) {
        keys.push(obj.Key)
      }
    }
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (ContinuationToken)
  return keys
}

async function getJson (Key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }))
  const body = await res.Body.transformToString()
  return JSON.parse(body)
}

async function putJson (Key, data) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }))
}

function deepMerge (target, source) {
  for (const key of Object.keys(source)) {
    // source is parsed JSON from a fetched S3 shard - Object.keys() includes a literal
    // "__proto__" key if the JSON had one, and target[key] = val for that key really does
    // set the prototype. Skip it (and the other dangerous keys) rather than trust the
    // bucket contents never get tampered with.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const sourceVal = source[key]
    const targetVal = target[key]
    if (
      sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      deepMerge(targetVal, sourceVal)
    } else {
      target[key] = sourceVal
    }
  }
}

;(async () => {
  console.log(`Listing shards in s3://${BUCKET}/${PREFIX}`)
  const keys = await listShardKeys()
  console.log(`Found ${keys.length} shards`)
  if (!keys.length) {
    console.error('No shards found; aborting.')
    process.exit(1)
  }

  const merged = {}
  let fetched = 0
  for (const key of keys) {
    try {
      const shard = await getJson(key)
      deepMerge(merged, shard)
      fetched++
    } catch (e) {
      console.warn(`  skipping ${key}: ${e.message}`)
    }
  }
  console.log(`Merged ${fetched}/${keys.length} shards`)

  console.log(`Writing merged tabs.json to s3://${BUCKET}/${TABS_KEY}`)
  await putJson(TABS_KEY, merged)
  console.log('Done')
})().catch((err) => {
  console.error('Aggregator failed:', err)
  process.exit(1)
})
