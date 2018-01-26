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

import Worker from 'workerize-loader!./worker'; // eslint-disable-line

/** @type {VueGlobal.component} */
let _Vue;

/** @type {Function} */
let isReady;

/**
 * Vue plugin install hook
 * @param {VueGlobal.component} Vue
 */
function install(Vue) {
  _Vue = Vue;

  // * @this {VueConstructor}
  /**
   * Inject plugin into Vue instances as $db
   * @this {VueGlobal.component}
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

class Database {
  /**
   * Creates a database environment instance
   * @param {Object} 0$
   * @param {string} 0$.remote
   * @param {string} 0$.filter
   * @param {Vuex.Store} 0$.vuex
   * @param {Boolean} 0$.debug
   */
  constructor({
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
    this.ready = new Promise((resolve) => {
      isReady = resolve;
    });
    this._init();
  }

  _init() {
    // set up vuex store
    if (this.vuex !== undefined) {
      const vuexMod = {
        namespaced: true,
        state: {},
        mutations: {
          /* eslint-disable no-return-assign, no-param-reassign */
          isOk: (state, ok) => (state.ok = ok),
          addQuery: (state, key) => _Vue.set(state, key, {}),
          removeQuery: (state, key) => _Vue.delete(state, key),
          setQueryResult: (state, { key, data }) => (state[key] = data),
          /* eslint-enable no-return-assign, no-param-reassign */
        },
      };

      if (this.opts.status) vuexMod.state.ok = true;

      this.vuex.registerModule(this.namespace, vuexMod);
    }

    // handle web worker events
    this.worker.addEventListener('message', this._receive.bind(this));
    this.worker.addEventListener('error', (err) => {
      throw new Error(err);
    });

    // initialise PouchDB in web worker
    this.worker.init(this.opts);

    // expose all available methods
    Object.keys(this.worker).forEach((key) => {
      Database.prototype[key] = this.worker[key];
    });
  }

  /**
   * Convenience wrapper methods
   */

  get(docId) {
    return this.worker.local('get', docId);
  }

  put(doc) {
    return this.worker.local('put', doc);
  }

  remove(doc) {
    return this.worker.local('remove', doc);
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

  // part of upsert
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

  // incoming message event handler
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
  Database,
};
