var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var axios = require('axios');
var values = require('object.values');

var DATA_KEY = 'hypernova-key';
var DATA_ID = 'hypernova-id';

function reduce(obj, init, f) {
  return Object.keys(obj).reduce(function (a, b) {
    return f(a, b);
  }, init);
}

function uuid() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, function (x) {
    return (x ^ Math.random() * 16 >> x / 4).toString(16);
  } // eslint-disable-line no-mixed-operators, no-bitwise, max-len
  );
}

function encode(obj) {
  return JSON.stringify(obj).replace(/-->/g, '--&gt;');
}

function renderHTML(viewName, data) {
  var id = uuid();
  return '\n    <div data-' + DATA_KEY + '="' + String(viewName) + '" data-' + DATA_ID + '="' + String(id) + '"></div>\n    <script type="application/json" data-' + DATA_KEY + '="' + String(viewName) + '" data-' + DATA_ID + '="' + String(id) + '"><!--' + String(encode(data)) + '--></script>\n  ';
}

function fallback(error, jobs) {
  return {
    error: error,
    results: reduce(jobs, {}, function (obj, key) {
      // eslint-disable-next-line no-param-reassign
      obj[key] = {
        error: null,
        html: renderHTML(key, jobs[key].data),
        job: jobs[key]
      };
      return obj;
    })
  };
}

function toHTML(views) {
  return reduce(views, '', function (res, name) {
    return res + views[name].html;
  }, '');
}

var Renderer = function () {
  function Renderer(options) {
    _classCallCheck(this, Renderer);

    this.url = options.url;
    this.plugins = options.plugins || [];
    this.config = Object.assign({
      timeout: 1000,
      headers: {
        'Content-Type': 'application/json'
      }
    }, options.config);
  }

  _createClass(Renderer, [{
    key: 'addPlugin',
    value: function () {
      function addPlugin(plugin) {
        this.plugins.push(plugin);
      }

      return addPlugin;
    }()
  }, {
    key: 'pluginReduce',
    value: function () {
      function pluginReduce(eventName, f, initial) {
        return this.plugins.reduce(function (res, plugin) {
          if (plugin[eventName]) {
            return f(plugin[eventName], res);
          }
          return res;
        }, initial);
      }

      return pluginReduce;
    }()
  }, {
    key: 'createJobs',
    value: function () {
      function createJobs(jobs) {
        var _this = this;

        // The initial jobs hash which contains the shape of
        // { [view]: { name: String, data: ReactProps } }
        // it's outside of the main try/catch because if there are any failures
        // we want to reuse the jobs hash to go into failure mode.
        return reduce(jobs, {}, function (obj, name) {
          var data = jobs[name];

          try {
            data = _this.pluginReduce('getViewData', function (plugin, newData) {
              return plugin(name, newData);
            }, jobs[name]);
          } catch (err) {
            // let the plugins know about the error but we intentionally
            // don't fallback to failure mode (client rendering) because we can
            // probably salvage the render using the passed in data.
            _this.pluginReduce('onError', function (plugin) {
              return plugin(err);
            });
          }

          // the job shape
          // eslint-disable-next-line no-param-reassign
          obj[name] = { name: name, data: data };
          return obj;
        }, {});
      }

      return createJobs;
    }()
  }, {
    key: 'prepareRequest',
    value: function () {
      function prepareRequest(jobs) {
        var _this2 = this;

        return Promise.resolve().then(function () {
          // prepare the request by calling the plugins allowing each plugin to transform
          // the jobs hash
          var jobsHash = _this2.pluginReduce('prepareRequest', function (plugin, next) {
            return plugin(next, jobs);
          }, jobs);

          // should we actually fire off a request?
          var shouldSendRequest = _this2.pluginReduce('shouldSendRequest', function (plugin, next) {
            return next && plugin(jobsHash);
          }, true);

          return {
            shouldSendRequest: shouldSendRequest,
            jobsHash: jobsHash
          };
        });
      }

      return prepareRequest;
    }()
  }, {
    key: 'render',
    value: function () {
      function render(data) {
        var _this3 = this;

        var jobs = this.createJobs(data);

        return this.prepareRequest(jobs)
        // Query our server and retrieve the jobs data
        .then(function (item) {
          if (!item.shouldSendRequest) {
            return fallback(null, item.jobsHash);
          }

          // let everyone know we'll be firing a request
          _this3.pluginReduce('willSendRequest', function (plugin) {
            return plugin(item.jobsHash);
          });

          // fire the request and then convert the response into a shape of
          // { [string]: { error: Error?, html: string, job: Job } }
          // eslint-disable-next-line arrow-body-style
          return axios.post(_this3.url, item.jobsHash, _this3.config).then(function (res) {
            var results = res.data.results;


            Object.keys(results).forEach(function (key) {
              var body = results[key];

              body.job = item.jobsHash[key];
              body.html = body.error ? renderHTML(key, data[key]) : body.html;
            });

            return res.data;
          });
        })
        // if there is an error retrieving the result set or converting it then lets just fallback
        // to client rendering for all the jobs.
        ['catch'](function (err) {
          return fallback(err, jobs);
        })
        // Run our afterResponse plugins and send back our response.
        .then(function (res) {
          var results = res.results;


          try {
            if (res.error) _this3.pluginReduce('onError', function (plugin) {
              return plugin(res.error, results);
            });

            values(results).forEach(function (job) {
              if (job.error) {
                _this3.pluginReduce('onError', function (plugin) {
                  return plugin(job.error, job);
                });
              }
            });

            var successfulJobs = reduce(res.results, {}, function (success, key) {
              return Object.assign(success, _defineProperty({}, key, res.results[key].job));
            });

            _this3.pluginReduce('onSuccess', function (plugin) {
              return plugin(successfulJobs);
            });

            // if there are any plugins, run them
            // otherwise toHTML the response and send that
            return _this3.plugins.length ? _this3.pluginReduce('afterResponse', function (plugin, next) {
              return plugin(next, results);
            }, results) : toHTML(results);
          } catch (err) {
            _this3.pluginReduce('onError', function (plugin) {
              return plugin(err, results);
            });
            return toHTML(results);
          }
        });
      }

      return render;
    }()
  }]);

  return Renderer;
}();

module.exports = Renderer;