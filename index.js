var fs = require('fs')
var path = require('path')
var mkdirp = require('mkdirp')
var Promise = require('rsvp').Promise
var quickTemp = require('quick-temp')
var Writer = require('broccoli-writer')
var helpers = require('broccoli-kitchen-sink-helpers')
var walkSync = require('walk-sync')
var mapSeries = require('promise-map-series')


module.exports = Filter
Filter.prototype = Object.create(Writer.prototype)
Filter.prototype.constructor = Filter
function Filter (inputTree, options) {
  this.inputTree = inputTree
  options = options || {}
  if (options.extensions != null) this.extensions = options.extensions
  if (options.targetExtension != null) this.targetExtension = options.targetExtension
  // We could allow for overwriting this.getDestFilePath as well; just need an
  // option name that communicates the meaning
  // We could allow for setting the encoding to something other than utf8
}

Filter.prototype.getCacheDir = function () {
  return quickTemp.makeOrReuse(this, 'tmpCacheDir')
}

Filter.prototype.write = function (readTree, destDir) {
  var self = this

  return readTree(this.inputTree).then(function (srcDir) {
    var paths = walkSync(srcDir)

    return mapSeries(paths, function (relativePath) {
      if (relativePath.slice(-1) === '/') {
        mkdirp.sync(destDir + '/' + relativePath)
      } else {
        if (self.canProcessFile(relativePath)) {
          return self.processAndCacheFile(srcDir, destDir, relativePath)
        } else {
          helpers.copyPreserveSync(
            srcDir + '/' + relativePath, destDir + '/' + relativePath)
        }
      }
    })
  })
}

Filter.prototype.cleanup = function () {
  quickTemp.remove(this, 'tmpCacheDir')
  Writer.prototype.cleanup.call(this)
}

Filter.prototype.canProcessFile = function (relativePath) {
  return this.getDestFilePath(relativePath) != null
}

Filter.prototype.getDestFilePath = function (relativePath) {
  for (var i = 0; i < this.extensions.length; i++) {
    var ext = this.extensions[i]
    if (relativePath.slice(-ext.length - 1) === '.' + ext) {
      if (this.targetExtension != null) {
        relativePath = relativePath.slice(0, -ext.length) + this.targetExtension
      }
      return relativePath
    }
  }
  return null
}

Filter.prototype.processAndCacheFile = function (srcDir, destDir, relativePath) {
  var self = this

  this._cache = this._cache || {}
  this._cacheIndex = this._cacheIndex || 0
  var cacheEntry = this._cache[relativePath]
  if (cacheEntry != null && cacheEntry.hash === hash(cacheEntry.inputFiles)) {
    copyFromCache(cacheEntry)
  } else {
    return Promise.resolve()
      .then(function () {
        return self.processFile(srcDir, destDir, relativePath)
      })
      .catch(function (err) {
        // Augment for helpful error reporting
        err.file = relativePath
        err.treeDir = srcDir
        throw err
      })
      .then(function (cacheInfo) {
        copyToCache(cacheInfo)
      })
  }

  function hash (filePaths) {
    return filePaths.map(function (filePath) {
      return helpers.hashTree(srcDir + '/' + filePath)
    }).join(',')
  }

  function copyFromCache (cacheEntry) {
    for (var i = 0; i < cacheEntry.outputFiles.length; i++) {
      var dest = destDir + '/' + cacheEntry.outputFiles[i]
      mkdirp.sync(path.dirname(dest))
      // We may be able to link as an optimization here, because we control
      // the cache directory; we need to be 100% sure though that we don't try
      // to hardlink symlinks, as that can lead to directory hardlinks on OS X
      helpers.copyPreserveSync(
        self.getCacheDir() + '/' + cacheEntry.cacheFiles[i], dest)
    }
  }

  function copyToCache (cacheInfo) {
    var cacheEntry = {
      inputFiles: (cacheInfo || {}).inputFiles || [relativePath],
      outputFiles: (cacheInfo || {}).outputFiles || [self.getDestFilePath(relativePath)],
      cacheFiles: []
    }
    for (var i = 0; i < cacheEntry.outputFiles.length; i++) {
      var cacheFile = (self._cacheIndex++) + ''
      cacheEntry.cacheFiles.push(cacheFile)
      helpers.copyPreserveSync(
        destDir + '/' + cacheEntry.outputFiles[i],
        self.getCacheDir() + '/' + cacheFile)
    }
    cacheEntry.hash = hash(cacheEntry.inputFiles)
    self._cache[relativePath] = cacheEntry
  }
}

Filter.prototype.processFile = function (srcDir, destDir, relativePath) {
  var self = this
  this._relativePath = relativePath;
  var string = fs.readFileSync(srcDir + '/' + relativePath, { encoding: 'utf8' })
  return Promise.resolve(self.processString(string, relativePath))
    .then(function (outputString) {
      var outputPath = self.getDestFilePath(relativePath)
      fs.writeFileSync(destDir + '/' + outputPath, outputString, { encoding: 'utf8' })
    })
}
