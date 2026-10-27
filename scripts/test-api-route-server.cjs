// Local integration harness: real route handlers + real disposable PostgreSQL.
// Used when a separate Next build would interfere with an active browser suite.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const target = process.env.TEST_DATABASE_URL
if (!target) throw new Error('Explicit TEST_DATABASE_URL required')
const url = new URL(target)
if (url.hostname !== '127.0.0.1' || url.port !== '55439' || !['/bbe_test_learning_flow','/bbe_test_leaderboard'].includes(url.pathname)) throw new Error('Only the isolated Chapter fix test cluster is allowed')
process.env.DATABASE_URL = target; process.env.DIRECT_URL = target
process.env.JWT_ACCESS_SECRET = 'chapter-fix-local-test-only-signing-key'
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const { NextRequest } = require('next/server')
const routes = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.name === 'route.ts') {
      const parts = path.relative('src/app',path.dirname(file)).split(path.sep)
      routes.push({ file:path.resolve(file), parts })
    }
  }
}
walk('src/app/api')
const port = url.pathname === '/bbe_test_learning_flow' ? 3112 : 3111
const server = http.createServer(async (req,res) => {
  try {
    const address = new URL(req.url, `http://127.0.0.1:${port}`)
    if(address.pathname==='/'){res.end('local route integration harness');return}
    const parts=address.pathname.split('/').filter(Boolean)
    const route=routes.find(r=>r.parts.length===parts.length&&r.parts.every((p,i)=>p.startsWith('[')||p===parts[i]))
    if(!route){res.statusCode=404;res.end();return}
    const params=Object.fromEntries(route.parts.flatMap((p,i)=>p.startsWith('[')?[[p.slice(1,-1),parts[i]]]:[]))
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(','):value)
    const request=new NextRequest(address,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})})
    const handler=require(route.file)[req.method]
    if(!handler){res.statusCode=405;res.end();return}
    const response=await handler(request,{params})
    res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(Buffer.from(await response.arrayBuffer()))
  }catch(error){console.error(error);res.statusCode=500;res.end(JSON.stringify({error:{code:'TestHarnessFailure'}}))}
})
server.listen(port,'127.0.0.1',()=>console.log(`Local route integration harness ready on ${port}`))
