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

// TODO: Logic to handle sync state in vuex OR remove this functionality

// TODO: Use a SharedWorker so that there's only one worker shared between all
// tabs (minimise perf cost of db sync etc.)
//  ↳ Will need to make sure message ID (sequence) is unique between all tabs
//    ↳ Actually it may not be necessary, each tab will get a unique port (if
//      I understand correctly...)
//  ↳ https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker
//  ↳ Need to test if this will slow things down when multiple tabs are trying
//    to run db queries at the same time

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

class Database {
  constructor({
    Worker,
    local = 'app',
    remote,
    filter,
    vuexStore,
    queries = [],
    namespace = 'db',
    sync = true,
    debug,
  }) {
    this.vuexStore = vuexStore;
    this.namespace = namespace;
    this.worker = new Worker();
    this.opts = { local, remote, filter, queries, namespace, sync, debug };
    this._init();
  }

  _init() {
    // set up vuex store
    if (this.vuexStore !== undefined) {
      this.vuexStore.registerModule(this.namespace, {
        namespaced: true,
        // state: {
        //   syncState: 'online', // online, offline, paused, error
        // },
        mutations: {
          /* eslint-disable no-return-assign */
          // setSyncState: (state, syncState) => state.syncState = syncState,
          addQuery: (state, payload) => Vue.set(state, payload.key, {}),
          removeQuery: (state, payload) => Vue.delete(state, payload.key),
          setQueryResult: (state, payload) => state[payload.key] = payload.data,
          /* eslint-enable no-return-assign */
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
    this.worker.postMessage(JSON.stringify(this.opts));

    // handle web worker events
    this.worker.addEventListener('message', this._receive.bind(this));
    this.worker.addEventListener('error', (err) => { throw new Error(err); });
  }

  /**
   * Standard PouchDB methods
   */

  get = docId => this._send('get', docId)

  put = doc => this._send('put', doc)

  post = doc => this._send('post', doc)

  remove = doc => this._send('remove', doc)

  allDocs = docs => this._send('allDocs', docs)

  bulkDocs = (docs, opts) => this._send('bulkDocs', docs, opts)

  revsDiff = diff => this._send('revsDiff', diff)

  changes = opts => this._send('changes', opts)

  compact = () => this._send('compact')

  /**
   * Additional methods
   */

  /**
   * Wait until a doc is available in the local database
   * @param {(string|Array.<string>)} docId - The doc _id or array of _ids to wait for
   * @param {Boolean} [newOnly] - Don't check in existing docs; only react to incoming doc changes
   * @param {number} [timeout] - How long to wait before giving up in milliseconds (default = 45s)
   * @returns {Promise} - Containing the docId
   */
  waitUntil = (docId, newOnly, timeout = 45e3) => this._send('waitUntil', docId, newOnly, timeout)

  /**
   * Register a new reactive database query (keep the number of registered queries to a minimum!)
   * @param {(Object|string)} query - Query object or doc _id string to watch for changes
   * @param {string} [key] - Name of the vuex object key (for queries, otherwise doc _id)
   */
  register = (query, key) => this.worker.postMessage(JSON.stringify({ register: { query, key }}))

  /**
   * Unregister a previously registered reactive query
   * @param {(string|number)} key - The returned key generated by register()
   * @param {Boolean} [isDoc] - Specific if the query is a doc as we can't infer it like
   */
  unregister = (key, isDoc) => this.worker.postMessage(JSON.stringify({ unregister: { key, isDoc }}))

  /**
   * Generate a doc revision ID
   * @returns {Promise} - The doc revision ID string
   */
  rev = () => this._send('rev')

  /**
   * Get an MD5 hash
   * @param {string} string - The input you want hashed
   * @returns {Promise} - Resulting MD5 hash
   */
  md5 = string => this._send('md5', string)

  /**
   * Insert doc if new or update doc if it exists
   * (based on the PouchDB upsert plugin)
   * @see https://github.com/pouchdb/upsert/blob/master/index.js
   * @param {string} docId - _id of the doc to edit
   * @param {Function} diffFun - A function returning the changes requested
   */
  async upsert(docId, diffFun) {
    let doc;

    try {
      doc = await this.get(docId);
    } catch (err) {
      if (err.status !== 404) throw err;
      doc = {};
    }

    try {
      // the user might change the _rev, so save it for posterity
      const docRev = doc._rev;
      const newDoc = diffFun(doc);

      if (!newDoc) {
        // if the diffFun returns falsy, we short-circuit as an optimization
        return { updated: false, rev: docRev, id: docId };
      }

      // users aren't allowed to modify these values, so reset them here
      newDoc._id = docId;
      newDoc._rev = docRev;
      return this._tryPut(newDoc, diffFun);
    } catch (err) {
      throw err;
    }
  }

  async _tryPut(doc, diffFun) {
    try {
      const res = await this.put(doc);
      return {
        updated: true,
        rev: res.rev,
        id: doc._id,
      };
    } catch (err) {
      if (err.status !== 409) throw err;
      return this.upsert(doc._id, diffFun);
    }
  }

  // outgoing message handler
  _send(method, ...opts) {
    sequence += 1;
    const i = sequence;

    return new Promise((resolve, reject) => {
      resolves.set(i, resolve);
      rejects.set(i, reject);

      this.worker.postMessage(JSON.stringify({ [method]: { i, opts }}));
    });
  }

  // incoming message event handler
  _receive(event) {
    const data = JSON.parse(event.data);

    if (data.i !== undefined) {
      // resolve or reject promise if message contains res or rej
      if (data.res !== undefined && resolves.has(data.i)) {
        resolves.get(data.i)(data.res);
      } else if (rejects.has(data.i)) {
        rejects.get(data.i)(data.rej);
      }

      // clean up promise handlers
      resolves.delete(data.i);
      rejects.delete(data.i);
    } else if (data.commit !== undefined) {
      // commit new data to vuex
      this.vuexStore.commit(data.commit, data.data);
    } else {
      throw new Error('Unknown event:', event);
    }
  }
}

export default {
  install,
  Database,
};
