// Pure business/oracle tests. Deliberately cannot connect to the application's DB.
process.env.DATABASE_URL = 'postgresql://formula_tests@127.0.0.1:1/formula_tests'
process.env.DIRECT_URL = process.env.DATABASE_URL
const path = require('node:path')
const Module = require('node:module')
require('ts-node').register({ project: 'tsconfig.test.json' })
const original = Module._resolveFilename
Module._resolveFilename = function (request, ...args) { return original.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...args) }
require('../../src/test/learning-cycles.test')
require('../../src/test/phase3-leaderboard-oracle.test')
require('../../src/test/learning-flow-p0.test')
