'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Vue = _interopDefault(require('vue'));

function _asyncToGenerator(fn) {
  return function () {
    var self = this,
        args = arguments;
    return new Promise(function (resolve, reject) {
      var gen = fn.apply(self, args);

      function step(key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }

        if (info.done) {
          resolve(value);
        } else {
          Promise.resolve(value).then(_next, _throw);
        }
      }

      function _next(value) {
        step("next", value);
      }

      function _throw(err) {
        step("throw", err);
      }

      _next();
    });
  };
}

/**
 * @wearegenki/db
 * Vue + vuex plugin for reactive PouchDB (in a web worker)
 * @author: Max Milton <max@wearegenki.com>
 *
 * Copyright 2017 We Are Genki
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// NOTE: Web worker communication sent as a JSON string for better performance
// TODO: Use a SharedWorker so that there's only one worker shared between all tabs (minimise perf cost of db sync etc.)
//  ↳ Will need to make sure message ID (sequence) is unique between all tabs
//    ↳ Actually it may not be necessary, each tab will get a unique port (if I understand correctly...)
//  ↳ https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker
// TODO: Enable support for couchbase bulkDocs API
//  ↳ REF: https://github.com/pouchdb/pouchdb/pull/6660
var sequence = 0; // use Map for better performance (in Chrome, other browsers too as they optimise Map)

var resolves = new Map();
var rejects = new Map(); // Vue plugin install hook

function install(VueInstance) {
  // inject plugin into Vue instances as $db
  function inject() {
    var options = this.$options;

    if (options.db) {
      this.$db = options.db;
    } else if (options.parent && options.parent.$db) {
      this.$db = options.parent.$db;
    }
  }

  var usesInit = VueInstance.config._lifecycleHooks.indexOf('init') > -1;
  VueInstance.mixin(usesInit ? {
    init: inject
  } : {
    beforeCreate: inject
  });
}

var Database =
/*#__PURE__*/
function () {
  function Database(_ref) {
    var _this = this;

    var Worker = _ref.Worker,
        _ref$local = _ref.local,
        local = _ref$local === void 0 ? 'PouchDB' : _ref$local,
        remote = _ref.remote,
        filter = _ref.filter,
        vuexStore = _ref.vuexStore,
        _ref$indexes = _ref.indexes,
        indexes = _ref$indexes === void 0 ? [] : _ref$indexes,
        _ref$queries = _ref.queries,
        queries = _ref$queries === void 0 ? [] : _ref$queries,
        _ref$namespace = _ref.namespace,
        namespace = _ref$namespace === void 0 ? 'db' : _ref$namespace,
        _ref$sync = _ref.sync,
        sync = _ref$sync === void 0 ? true : _ref$sync;
    Object.defineProperty(this, "get", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(docId) {
        return _this._send('get', docId);
      }
    });
    Object.defineProperty(this, "put", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(doc) {
        return _this._send('put', doc);
      }
    });
    Object.defineProperty(this, "post", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(doc) {
        return _this._send('post', doc);
      }
    });
    Object.defineProperty(this, "remove", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(doc) {
        return _this._send('remove', doc);
      }
    });
    Object.defineProperty(this, "find", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(req) {
        return _this._send('find', req);
      }
    });
    Object.defineProperty(this, "query", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(doc, opts) {
        return _this._send('query', doc, opts);
      }
    });
    Object.defineProperty(this, "allDocs", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(docs) {
        return _this._send('allDocs', docs);
      }
    });
    Object.defineProperty(this, "bulkDocs", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(docs, opts) {
        return _this._send('bulkDocs', docs, opts);
      }
    });
    Object.defineProperty(this, "bulkGet", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(opts) {
        return _this._send('bulkGet', opts);
      }
    });
    Object.defineProperty(this, "revsDiff", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(diff) {
        return _this._send('revsDiff', diff);
      }
    });
    Object.defineProperty(this, "changes", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(opts) {
        return _this._send('changes', opts);
      }
    });
    Object.defineProperty(this, "compact", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value() {
        return _this._send('compact');
      }
    });
    Object.defineProperty(this, "destroy", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value() {
        return _this._send('destroy');
      }
    });
    Object.defineProperty(this, "waitUntil", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(docId, newOnly, timeout) {
        if (timeout === void 0) {
          timeout = 45e3;
        }

        return _this._send('waitUntil', docId, newOnly, timeout);
      }
    });
    Object.defineProperty(this, "register", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(query, key) {
        return _this.worker.postMessage(JSON.stringify({
          register: {
            query,
            key
          }
        }));
      }
    });
    Object.defineProperty(this, "unregister", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(key, isDoc) {
        return _this.worker.postMessage(JSON.stringify({
          unregister: {
            key,
            isDoc
          }
        }));
      }
    });
    Object.defineProperty(this, "rev", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value() {
        return _this._send('rev');
      }
    });
    Object.defineProperty(this, "md5", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function value(string) {
        return _this._send('md5', string);
      }
    });
    this.vuexStore = vuexStore;
    this.namespace = namespace;
    this.worker = new Worker();
    this.opts = {
      local,
      remote,
      filter,
      indexes,
      queries,
      namespace,
      sync
    };

    this._init();
  }

  var _proto = Database.prototype;

  _proto._init = function _init() {
    // Set up vuex store
    if (this.vuexStore !== undefined) {
      this.vuexStore.registerModule(this.namespace, {
        namespaced: true,
        state: {
          syncState: 'online' // online, offline, paused, error

        },
        mutations: {
          /* eslint-disable no-return-assign */
          setSyncState: function setSyncState(state, syncState) {
            return state.syncState = syncState;
          },
          addQuery: function addQuery(state, payload) {
            return Vue.set(state, payload.key, {});
          },
          removeQuery: function removeQuery(state, payload) {
            return Vue.delete(state, payload.key);
          },
          setQueryResult: function setQueryResult(state, payload) {
            return state[payload.key] = payload.data;
          }
          /* eslint-enable no-return-assign */

        },
        actions: {
          // use an action to change sync state to allow for custom functionality in future
          changeSyncState(_ref2, newState) {
            var commit = _ref2.commit;
            commit('setSyncState', newState);
          }

        }
      });
    } // Send options to initialise PouchDB in dedicated web worker thread


    this.worker.postMessage(JSON.stringify(this.opts)); // Handle web worker events

    this.worker.addEventListener('message', this._receive.bind(this));
    this.worker.addEventListener('error', function (err) {
      throw new Error(err);
    });
  }; // Standard PouchDB methods


  /**
   * Insert doc if new or update doc if it exists
   * (based on the PouchDB upsert plugin)
   * @see https://github.com/pouchdb/upsert/blob/master/index.js
   * @param {string} docId - The doc to edit
   * @param {Function} diffFun -
   */
  _proto.upsert = function () {
    var _ref3 = _asyncToGenerator(
    /*#__PURE__*/
    regeneratorRuntime.mark(function _callee(docId, diffFun) {
      var doc, docRev, newDoc;
      return regeneratorRuntime.wrap(function _callee$(_context) {
        while (1) {
          switch (_context.prev = _context.next) {
            case 0:
              _context.prev = 0;
              _context.next = 3;
              return this.get(docId);

            case 3:
              doc = _context.sent;
              _context.next = 11;
              break;

            case 6:
              _context.prev = 6;
              _context.t0 = _context["catch"](0);

              if (!(_context.t0.status !== 404)) {
                _context.next = 10;
                break;
              }

              throw _context.t0;

            case 10:
              doc = {};

            case 11:
              _context.prev = 11;
              // the user might change the _rev, so save it for posterity
              docRev = doc._rev;
              newDoc = diffFun(doc);

              if (newDoc) {
                _context.next = 16;
                break;
              }

              return _context.abrupt("return", {
                updated: false,
                rev: docRev,
                id: docId
              });

            case 16:
              // users aren't allowed to modify these values, so reset them here
              newDoc._id = docId;
              newDoc._rev = docRev;
              return _context.abrupt("return", this._tryPut(newDoc, diffFun));

            case 21:
              _context.prev = 21;
              _context.t1 = _context["catch"](11);
              throw _context.t1;

            case 24:
            case "end":
              return _context.stop();
          }
        }
      }, _callee, this, [[0, 6], [11, 21]]);
    }));

    function upsert(_x, _x2) {
      return _ref3.apply(this, arguments);
    }

    return upsert;
  }();

  _proto._tryPut = function () {
    var _ref4 = _asyncToGenerator(
    /*#__PURE__*/
    regeneratorRuntime.mark(function _callee2(doc, diffFun) {
      var res;
      return regeneratorRuntime.wrap(function _callee2$(_context2) {
        while (1) {
          switch (_context2.prev = _context2.next) {
            case 0:
              _context2.prev = 0;
              _context2.next = 3;
              return this.put(doc);

            case 3:
              res = _context2.sent;
              return _context2.abrupt("return", {
                updated: true,
                rev: res.rev,
                id: doc._id
              });

            case 7:
              _context2.prev = 7;
              _context2.t0 = _context2["catch"](0);

              if (!(_context2.t0.status !== 409)) {
                _context2.next = 11;
                break;
              }

              throw _context2.t0;

            case 11:
              return _context2.abrupt("return", this.upsert(doc._id, diffFun));

            case 12:
            case "end":
              return _context2.stop();
          }
        }
      }, _callee2, this, [[0, 7]]);
    }));

    function _tryPut(_x3, _x4) {
      return _ref4.apply(this, arguments);
    }

    return _tryPut;
  }(); // Outgoing message handler


  _proto._send = function _send(method) {
    var _this2 = this;

    for (var _len = arguments.length, opts = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      opts[_key - 1] = arguments[_key];
    }

    sequence += 1;
    var i = sequence; // console.debug(i, method, opts);
    // console.time(i);

    return new Promise(function (resolve, reject) {
      resolves.set(i, resolve);
      rejects.set(i, reject);

      _this2.worker.postMessage(JSON.stringify({
        [method]: {
          i,
          opts
        }
      }));
    });
  }; // Incoming message event handler


  _proto._receive = function _receive(event) {
    var data = JSON.parse(event.data); // console.timeEnd(data.i);

    if (data.i !== undefined) {
      // resolve or reject promise if message contains res or rej
      if (data.res !== undefined && resolves.has(data.i)) {
        resolves.get(data.i)(data.res);
      } else if (rejects.has(data.i)) {
        rejects.get(data.i)(data.rej);
      } // clean up promise handlers


      resolves.delete(data.i);
      rejects.delete(data.i);
    } else if (data.commit !== undefined) {
      // commit new data to vuex
      this.vuexStore.commit(data.commit, data.data);
    } else {
      throw new Error('Unknown event:', event);
    }
  };

  return Database;
}();

var db = {
  install,
  Database
};

module.exports = db;
