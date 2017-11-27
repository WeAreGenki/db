/**
 * @wearegenki/db
 * Vue + vuex plugin for reactive PouchDB (in a web worker)
 *
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

// TODO: Logic to handle sync state in vuex OR remove this functionality

// TODO: Use a SharedWorker so that there's only one worker shared between all
// tabs (minimise network performance cost of db sync etc.)
//  ↳ Will need to make sure message ID (sequence) is unique between all tabs
//    ↳ Actually it may not be necessary, each tab will get a unique port (if
//      I understand correctly...)
//  ↳ https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker
//  ↳ Need to test if this will slow things down when multiple tabs are trying
//    to run db queries at the same time -- could we have one syncing worker and
//    multiple query workers?

// TODO: Enable support for couchbase bulkDocs API
//  ↳ REF: https://github.com/pouchdb/pouchdb/pull/6660

import Vue from 'vue'; // eslint-disable-line

let sequence = 0;
// use Map for better performance (in Chrome, other browsers too as they optimise Map)
const resolves = new Map();
const rejects = new Map();

// vue plugin install hook
function install(VueInstance) {
  // inject plugin into Vue instances as $db
  function inject() {
    const options = this.$options;
    if (options.db) {
      this.$db = options.db;
    } else if (options.parent && options.parent.$db) {
      this.$db = options.parent.$db;
    }
  }
  const usesInit = VueInstance.config._lifecycleHooks.indexOf('init') > -1;
  VueInstance.mixin(usesInit ? { init: inject } : { beforeCreate: inject });
}

// create a promise but defer resolving or rejecting it until later
function defer() {
  let res;
  let rej;

  const promise = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });

  promise.resolve = res;
  promise.reject = rej;

  return promise;
}

class Database {
  constructor({
    WW,
    local = 'app',
    remote,
    filter,
    vuex,
    queries = [],
    namespace = 'db',
    createRemote = false, // assume remote db already exists
    sync = true,
    debounce = 300, // ms
    pushCp = 'source', // less net traffic for better performance -- REF: https://git.io/vFAI6
    pullCp = 'target',
    debug,
  }) {
    this.vuex = vuex;
    this.namespace = namespace;
    this.worker = typeof WW === 'function'
      ? new WW()
      : new Worker(WW);
    this.opts = {
      local,
      remote,
      filter,
      queries,
      namespace,
      createRemote,
      sync,
      debounce,
      pullCp,
      pushCp,
      debug,
    };
    this.ready = defer(); // promise returns once initial replication is finished
    this._init();
  }

  _init() {
    // set up vuex store
    if (this.vuex !== undefined) {
      this.vuex.registerModule(this.namespace, {
        namespaced: true,
        // state: {
        //   syncState: 'online', // online, offline, paused, error
        // },
        mutations: {
          /* eslint-disable no-return-assign, no-param-reassign */
          // setSyncState: (state, syncState) => state.syncState = syncState,
          addQuery: (state, payload) => Vue.set(state, payload.key, {}),
          removeQuery: (state, payload) => Vue.delete(state, payload.key),
          setQueryResult: (state, payload) => state[payload.key] = payload.data,
          /* eslint-enable no-return-assign, no-param-reassign */
        },
        // actions: {
        //   // use an action to change sync state to allow for custom functionality in future
        //   changeSyncState({ commit }, newState) {
        //     commit('setSyncState', newState);
        //   },
        // },
      });
    }

    // send options to initialise PouchDB in dedicated web worker thread
    // this.worker.postMessage(JSON.stringify(this.opts));
    this._post('init', this.opts);

    // handle web worker events
    this.worker.addEventListener('message', this._receive.bind(this));
    this.worker.addEventListener('error', (err) => { throw new Error(err); });
  }

  /**
   * Standard PouchDB methods
   */

  get(_id) {
    return this._send('get', _id);
  }

  put(doc) {
    return this._send('put', doc);
  }

  post(doc) {
    return this._send('post', doc);
  }

  remove(doc) {
    return this._send('remove', doc);
  }

  allDocs(docs) {
    return this._send('all', docs);
  }

  bulkDocs(docs, opts) {
    return this._send('bulk', docs, opts);
  }

  revsDiff(diff) {
    return this._send('diff', diff);
  }

  changes(opts) {
    return this._send('changes', opts);
  }

  compact() {
    return this._post('compact');
  }

  /**
   * Additional methods
   */

  /**
   * Wait until a doc is available in the local database
   *
   * @param {(string|Array.<string>)} _id - The doc _id or array of _ids to wait for
   * @param {Boolean} [newOnly] - Don't check in existing docs; only react to incoming doc changes
   * @param {number} [timeout] - How long to wait before giving up in milliseconds (default = 45s)
   * @returns {Promise} - Containing the _id
   */
  waitFor(_id, newOnly, timeout = 45e3) {
    return this._send('waitFor', _id, newOnly, timeout);
  }

  /**
   * Register a new reactive database query (keep the number of registered queries to a minimum!)
   *
   * @param {(Object|string)} query - Query object or doc _id string to watch for changes
   * @param {string} [key] - Name of the vuex object key (for queries, otherwise doc _id)
   */
  register(query, key) {
    return this._post('register', { q: query, k: key });
  }

  /**
   * Unregister a previously registered reactive query
   *
   * @param {(string|number)} key - The returned key generated by register()
   * @param {Boolean} [isDoc] - Specific if the query is a doc as we can't infer it like
   */
  unregister(key, isDoc) {
    return this._post('unregister', { k: key, d: isDoc });
  }

  /**
   * Query database and filter + sort the results
   *
   * @param {string} type - x
   * @param {{field: string, value: string}} [filter] - x
   * @param {string} [sort] - x
   * @returns {Promise} - Containing the query results
   */
  query({ id, filter, sort, limit, start }) {
    return this._send('query', { k: id, f: filter, s: sort, l: limit, b: start });
  }

  /**
   * Do a manual one-time sync between the local and remote databases
   *
   * @param {Boolean} [retry] - Retry sync if there's a network failure
   * @returns {Promise} - Containing sync info once it completes
   */
  sync(retry = false) {
    return this._send('sync', retry);
  }

  /**
   * Insert doc if new or update doc if it exists (based on the PouchDB upsert plugin)
   *
   * @see https://github.com/pouchdb/upsert/blob/master/index.js
   * @param {string} _id - _id of the doc to edit
   * @param {Function} diff - A function returning the changes requested
   */
  async upsert(_id, diff) {
    let doc;

    try {
      doc = await this.get(_id);
    } catch (err) {
      if (err.status !== 404) throw err;
      doc = {};
    }

    try {
      // the user might change the _rev, so save it for posterity
      const docRev = doc._rev;
      const newDoc = diff(doc);

      if (!newDoc) {
        // if the diff returns falsy, we short-circuit as an optimization
        return { updated: false, rev: docRev, id: _id };
      }

      // users aren't allowed to modify these values, so reset them here
      newDoc._id = _id;
      newDoc._rev = docRev;
      return this._tryPut(newDoc, diff);
    } catch (err) {
      throw err;
    }
  }

  // part of upsert
  async _tryPut(doc, diff) {
    try {
      const res = await this.put(doc);
      return {
        updated: true,
        rev: res.rev,
        id: doc._id,
      };
    } catch (err) {
      if (err.status !== 409) throw err;
      return this.upsert(doc._id, diff);
    }
  }

  /**
   * Generate a doc revision ID
   *
   * @returns {Promise} - The doc revision ID string
   */
  rev() {
    return this._send('rev');
  }

  /**
   * Get an MD5 hash
   *
   * @param {string} string - The input you want hashed
   * @returns {Promise} - Resulting MD5 hash
   */
  md5(string) {
    return this._send('md5', string);
  }

  // outgoing message handler (with return value)
  // XXX: m = method, o = options
  _send(m, ...o) {
    sequence += 1;
    const i = sequence;

    return new Promise((resolve, reject) => {
      resolves.set(i, resolve);
      rejects.set(i, reject);

      this.worker.postMessage(JSON.stringify({ m, i, o }));
    });
  }

  // send one way message (no return)
  _post(m, o) {
    this.worker.postMessage(JSON.stringify({ m, o }));
  }

  // incoming message event handler
  _receive(event) {
    const { i, res, rej, c, d, r } = JSON.parse(event.data);

    if (i !== undefined) {
      // resolve or reject promise if message contains res or rej
      if (res !== undefined && resolves.has(i)) {
        resolves.get(i)(res);
      } else if (rejects.has(i)) {
        rejects.get(i)(rej);
      }

      // clean up promise handlers
      resolves.delete(i);
      rejects.delete(i);
    } else if (c !== undefined) {
      // commit new data to vuex
      this.vuex.commit(c, d);
    } else if (r !== undefined) {
      // initial replication finished
      this.ready.resolve(res);
    } else {
      throw new Error('Unknown event:', event);
    }
  }
}

if (process.env.NODE_ENV !== 'production') {
  /**
   * Execute arbitrary code in web worker for development or testing
   *
   * @param {string} code - Code to be run in eval(), will await any returned promise
   * @returns {} - No return value but does call console.log in the worker
   */
  Database.prototype.exec = function exec(code) {
    this._post('exec', code);
  };
}

export default {
  install,
  Database,
};
