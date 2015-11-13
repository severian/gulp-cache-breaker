var replace = require('gulp-replace-async');
var path = require('path');
var fs = require('fs');
var checksum = require('checksum');
var Promise = require('promise');

// Match {{cache-break:path/to/resource}}
var reCacheBreak = /{{cache-break:(.+?)}}/g;

// Match {{cdn-path:path/to/resource}}
var reCdnPath = /{{cdn-path:(.+?)}}/g;

var readFile = Promise.denodeify(fs.readFile);
var stat = Promise.denodeify(fs.stat);

function mkPath(resource, cs) {
  var dirname = path.dirname(resource);
  var extname = path.extname(resource);
  var basename = path.basename(resource, extname);

  return path.join(dirname, basename + '.' + cs.substring(0, 10) + extname);
}

function CacheBreaker() {
  this.checksumCache = {};
}

CacheBreaker.prototype.cacheBreakPath = function(base, resource) {
  base = base || process.cwd();;

  var joinedPath = path.join(base, resource);
  var fullPath = path.resolve(joinedPath);

  return stat(fullPath).then(function(s) {
    var mtime = s.mtime.getTime();
    if (fullPath in this.checksumCache && mtime === this.checksumCache[fullPath].mtime) {
      var cs = this.checksumCache[fullPath].checksum;
      return mkPath(resource, fullPath);
    } else {
      return readFile(fullPath).then(function(file) {
        var cs = checksum(file);
        this.checksumCache[fullPath] = { checksum: cs, mtime: mtime };
        return mkPath(resource, fullPath);
      }.bind(this));
    }
  }.bind(this));

};

CacheBreaker.prototype.cdnUri = function(base, resource, host) {
  if (host) {
    return this.cacheBreakpath(base, resource).then(function(path) {
      return 'https://' + host + path;
    });
  } else {
    return this.cacheBreakPath(base, resource);
  }
};

CacheBreaker.prototype.gulpCbPath = function(base) {
  return replace(reCacheBreak, function(match, callback) {
    this.cacheBreakPath(base, match[1]).then(function(path) {
      callback(null, path);
    });
  }.bind(this));
};

CacheBreaker.prototype.gulpCdnUri = function(base, host) {
  return replace(reCdnPath, function(match, callback) {
    this.cdnUri(base, match[1], host).then(function(path) {
      callback(null, path);
    });
  }.bind(this));
};

CacheBreaker.prototype.symlinkCbPaths = function() {
  Object.keys(this.checksumCache).forEach(function(fullPath) {
    var cbPath = mkPath(fullPath, this.checksumCache[fullPath].checksum);
    try {
      fs.symlinkSync(path.basename(fullPath), cbPath);
    } catch (e) {
      if (e.code !== 'EEXIST') {
        throw e;
      }
    }
  }.bind(this));
};

module.exports = CacheBreaker;

