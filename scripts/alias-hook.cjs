const Module = require('module')
const path = require('path')
const original = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    request = path.join(process.cwd(), 'src', request.slice(2))
  }
  return original.call(this, request, parent, isMain, options)
}
