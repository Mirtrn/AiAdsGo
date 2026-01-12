import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { resolveAffiliateLinkWithHttp } from './url-resolver-http'

function listen(server: http.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to listen'))
        return
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

describe('resolveAffiliateLinkWithHttp', () => {
  it('resolves redirect chain via HEAD (no GET body download)', async () => {
    let getCount = 0

    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.method === 'GET') getCount++

      if (req.url === '/start' && req.method === 'HEAD') {
        res.statusCode = 302
        res.setHeader('Location', '/next')
        res.end()
        return
      }

      if (req.url === '/next' && req.method === 'HEAD') {
        res.statusCode = 301
        res.setHeader('Location', '/final?x=1')
        res.end()
        return
      }

      if (req.url.startsWith('/final') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 500
      res.end()
    })

    const { port, close } = await listen(server)
    try {
      const startUrl = `http://127.0.0.1:${port}/start`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/final`)
      expect(result.finalUrlSuffix).toBe('x=1')
      expect(result.redirectCount).toBe(2)
      expect(getCount).toBe(0)
    } finally {
      await close()
    }
  })

  it('can follow a JS/meta-style redirect without downloading full body', async () => {
    let openStreams = 0

    const server = http.createServer((req, res) => {
      if (!req.url || !req.method) {
        res.statusCode = 400
        res.end()
        return
      }

      if (req.url === '/click' && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      if (req.url === '/click' && req.method === 'GET') {
        openStreams++
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')

        const interval = setInterval(() => {
          res.write(' ')
        }, 50)

        req.on('close', () => {
          clearInterval(interval)
          openStreams--
        })

        res.write('<html><head>')
        res.write("<script>window.location.href='/final?y=2'</script>")
        // keep connection open; resolver should read a snippet then abort
        return
      }

      if (req.url.startsWith('/final') && req.method === 'HEAD') {
        res.statusCode = 200
        res.end()
        return
      }

      res.statusCode = 404
      res.end()
    })

    const { port, close } = await listen(server)
    try {
      const startUrl = `http://127.0.0.1:${port}/click`
      const result = await resolveAffiliateLinkWithHttp(startUrl, undefined, 10)

      expect(result.finalUrl).toBe(`http://127.0.0.1:${port}/final`)
      expect(result.finalUrlSuffix).toBe('y=2')
    } finally {
      await close()
    }

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(openStreams).toBe(0)
  })
})

