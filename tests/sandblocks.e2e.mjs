import assert from 'node:assert/strict'
import { test } from 'node:test'

const serviceUrl = required('SANDBLOCKS_SERVICE_PLUTO_URL')

test('Sandblocks publishes a healthy Pluto service', async () => {
  const health = await fetch(new URL('/v1/health', serviceUrl), {
    signal: AbortSignal.timeout(30_000),
  })
  assert.equal(health.status, 200)
  assert.match(health.headers.get('content-type') ?? '', /application\/json/)
  const payload = await health.json()
  assert.equal(payload.ok, true)
})

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
