/**
 * @wearegenki/db
 * @overview Vue plugin for reactive, offline capable databases.
 * @author Max Milton <max@wearegenki.com>
 *
 * Copyright 2018 We Are Genki
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

// TODO: Better logic to handle sync state in vuex OR remove this functionality

// TODO: Experiment with a SharedWorker so that there's only one worker shared
// between all tabs (minimise network performance cost of db sync etc.)
//  ↳ Could there be both a dedicated worker for queries per tab + one shared
//    worker to handle the data sync?
//    ↳ Will also need some mechanism to share changes and trigger running
//      registered queries.
//    ↳ Some things will need to be moved around, e.g. waitFor -- the magic
//      happens in the shared worker but is proxied via a dedicated worker

/* tslint:disable:no-submodule-imports no-invalid-this */

import Worker from 'workerize-loader!./worker'; // eslint-disable-line

/** @type {VueComponent} */
let _Vue;

/** @type {Function} */
let isReady;

/**
 * Vue plugin install hook
 * @param {VueComponent} Vue
 */
function install(Vue) {
  _Vue = Vue;

  /**
   * Inject plugin into Vue instances as $db
   * @this {VueComponent}
   */
  function inject() {
    const options = this.$options;
    if (options.db) {
      this.$db = options.db;
    } else if (options.parent && options.parent.$db) {
      this.$db = options.parent.$db;
    }
  }
  const usesInit = Vue.config._lifecycleHooks.indexOf('init') > -1;
  Vue.mixin(usesInit ? { init: inject } : { beforeCreate: inject });
}

class Connection {
  // TODO: Use Vuex; @property {VuexStore} [vuex] A global Vuex store.
  /**
   * Creates a database environment instance
   * @typedef {object} ConnectionProps Constructor parameters.
   * @property {string} local Name of the local database or a database endpoint URL.
   * @property {string} [remote] The remote database endpoint URL.
   * @property {(object|string)} [filter] PouchDB replication filter expression.
   * @property {object} [vuex] A global Vuex store.
   * @property {Array.<Worker.Query>} [queries]
   * @property {string} [namespace]
   * @property {boolean} [createRemote]
   * @property {boolean} [sync]
   * @property {number} [debounce]
   * @property {string} [pushCp]
   * @property {string} [pullCp]
   * @property {boolean} [status]
   * @property {boolean} [debug] Optional debugging console feedback.
   */
  constructor(/** @type {ConnectionProps} */{
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
    status = false,
    debug,
  }) {
    this.vuex = vuex;
    this.namespace = namespace;
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
      status,
      debug,
    };
    this.worker = new Worker();
    this.ready = new Promise((resolve) => { isReady = resolve; });
    this._init();
  }

  /** @private */
  _init() {
    // set up vuex store
    if (this.vuex !== undefined) {
      const vuexMod = {
        namespaced: true,
        state: {},
        mutations: {
          isOk: (state, ok) => (state.ok = ok),
          addQuery: (state, key) => _Vue.set(state, key, {}),
          removeQuery: (state, key) => _Vue.delete(state, key),
          setQueryResult: (state, { key, data }) => (state[key] = data),
        },
      };

      if (this.opts.status) vuexMod.state.ok = true;

      this.vuex.registerModule(this.namespace, vuexMod);
    }

    // handle web worker events
    this.worker.addEventListener('message', this._receive.bind(this));
    this.worker.addEventListener('error', (err) => { throw new Error(err); });

    // initialise PouchDB in web worker
    this.worker.init(this.opts);

    // expose all available methods
    Object.keys(this.worker).forEach((key) => {
      Connection.prototype[key] = this.worker[key];
    });
  }

  /**
   * Convenience wrapper methods
   */

  /**
   * Get a document from the database.
   * @param {object} docId The document _id.
   * @returns {Promise<object>} The document object.
   */
  get(docId) {
    return this.worker.local('get', docId);
  }

  /**
   * Put a document into the database (will error if _id already exists!).
   * @param {object} doc The document you want to put in the database.
   * @returns {Promise<object>}
   */
  put(doc) {
    return this.worker.local('put', doc);
  }

  /**
   * Remove a doc from the database.
   * @param {object} doc The document you want to remove from the database.
   * @returns {Promise<object>}
   */
  remove(doc) {
    return this.worker.local('remove', doc);
  }

  /**
   * Insert doc if new or update doc if it exists.
   * Based on the PouchDB upsert plugin.
   * @see https://github.com/pouchdb/upsert/blob/master/index.js
   * @param {string} _id _id of the doc to edit.
   * @param {Function} diff A function returning the changes requested.
   * @returns {Promise<object>}
   */
  async upsert(_id, diff) {
    let doc;

    try {
      doc = await this.worker.local('get', _id);
    } catch (err) {
      if (err.status !== 404) throw err;
      doc = {};
    }

    try {
      // the user might change the _rev, so save it for posterity
      const docRev = doc._rev;
      const newDoc = diff(doc);

      if (!newDoc) {
        // if the diff returns falsy, we short-circuit as an optimisation
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

  /**
   * Try to put a document in the database (only used in upsert()).
   * @private
   * @see upsert
   * @param {object} doc
   * @param {Function} diff
   */
  async _tryPut(doc, diff) {
    try {
      const res = await this.worker.local('put', doc);
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
   * Incoming WebWorker message event handler.
   * @private
   * @param {MessageEvent} event An onmessage event from the web worker.
   */
  _receive(event) {
    const { type, c, d, s, r } = event.data;

    // these are handled by workerize-loader
    if (type === 'RPC') return;

    if (c !== undefined) {
      // commit new data to vuex
      this.vuex.commit(c, d);
    } else if (s !== undefined) {
      // commit new data to vuex
      this.vuex.commit(`${this.opts.namespace}/isOk`, s);
    } else if (r !== undefined) {
      // initial replication finished
      isReady(r);
    } else {
      throw new Error(`Unknown event: ${event}`);
    }
  }
}

export default {
  install,
  Connection,
};
