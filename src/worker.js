/**
 * @wearegenki/db (web worker)
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

import PouchDB from 'pouchdb-core';
import AdapterIdb from 'pouchdb-adapter-idb';
import AdapterHttp from 'pouchdb-adapter-http';
import Replication from 'pouchdb-replication';
import debounce from 'lodash.debounce';
import { rev } from 'pouchdb-utils';
import SparkMD5 from 'spark-md5';

// initialise PouchDB plugins
if (process.env.NODE_ENV === 'test') {
  // in-memory database for testing
  PouchDB.plugin(require('pouchdb-adapter-memory')); // eslint-disable-line
}
PouchDB.plugin(AdapterIdb);
PouchDB.plugin(AdapterHttp);
PouchDB.plugin(Replication);

let config = {};
let queries = new Map();
let namespace = '';

/** @type {PouchDB.Database} */
let localDB;

/** @type {PouchDB.Database} */
let remoteDB;

/**
 * Compare two string
 * @param {string} valueOne - x
 * @param {string} valueTwo - x
 * @param {string} operator - x
 * @returns {Boolean}
 */
function compare(valueOne, valueTwo, operator) {
  switch (operator) {
    case '<=': return valueOne <= valueTwo;
    case '>=': return valueOne >= valueTwo;
    case '<': return valueOne < valueTwo;
    case '>': return valueOne > valueTwo;
    default: return valueOne === valueTwo;
  }
}

/**
 * Run a query against the local database
 * @param {string|Object} key - x
 * @param {Query} q - x
 */
async function runQuery(key, q) {
  let res;

  if (key === 'docs') {
    // simple list of doc _ids
    res = await localDB.allDocs({
      include_docs: true,
      keys: q,
    });
  } else {
    // custom query with filter and sort
    const { id, filter, sort, limit, start } = q;

    let { rows } = await localDB.allDocs({
      limit,
      include_docs: true,
      startkey: start || id,
      endkey: `${id}\ufff0`,
    });

    if (filter !== undefined) {
      rows = rows.filter(row => compare(row.doc[filter.for], filter.if, filter.when));
    }

    // clean up results so we just have an array of docs
    res = rows.map(row => row.doc);

    if (sort !== undefined) {
      res = res.sort((x, y) => x[sort].localeCompare(y[sort]));
    }
  }
  return { key, res };
}

/**
 * Process database change
 * @param {Object=} change - x
 * @param {Boolean=} oneShot - x
 */
async function handleChange(change = {}, oneShot) {
  if (queries.size) {
    /** @type {Array.<Promise>} */
    const batch = [];

    if (!oneShot) {
      queries.forEach((q, key) => {
        batch.push(runQuery(key, q));
      });
    } else if (change.key === change.q) {
      // one shot doc _id query
      batch.push(runQuery('docs', [change.q]));
    } else {
      // one shot custom query
      batch.push(runQuery(change.key, change.q));
    }

    const processItem = async (input) => {
      const { key, res } = await input;

      if (res.rows) {
        // doc _id result
        res.rows.forEach(row => postMessage({
          c: `${namespace}/setQueryResult`,
          d: { key: row.id, data: row.doc },
        }));
      }
      // custom query result
      postMessage({
        c: `${namespace}/setQueryResult`,
        d: { key, data: res },
      });
    };

    batch.map(processItem);
  }
}

export function init(opts) {
  config = opts;

  if (opts.debug !== undefined) PouchDB.debug.enable(opts.debug);

  localDB = new PouchDB(opts.local);
  remoteDB = opts.remote
    ? new PouchDB(opts.remote, { skip_setup: !opts.createRemote })
    : undefined;

  queries = new Map(opts.queries);
  namespace = opts.namespace; // eslint-disable-line prefer-destructuring

  // handle local database events
  localDB.changes({ since: 'now', live: true })
    .on('change', debounce(handleChange, opts.debounce))
    .on('error', (err) => { throw new Error(err); });

  if (opts.remote !== undefined && opts.sync) {
    // populate local database; pull docs from remote database
    PouchDB.replicate(remoteDB, localDB, { checkpoint: opts.pullCp }).on('complete', (info) => {
      // notify that initial replication is fished
      postMessage({ r: info });

      // keep local and remote databases in sync
      const syncDB = PouchDB.sync(localDB, remoteDB, {
        live: true,
        retry: true,
        filter: opts.filter,
        push: { checkpoint: opts.pushCp },
        pull: { checkpoint: opts.pullCp },
      });

      if (opts.status) {
        syncDB
          .on('change', () => postMessage({ s: true }))
          .on('active', () => postMessage({ s: true }))
          .on('denied', () => postMessage({ s: false }))
          .on('error', () => postMessage({ s: false }));
      }
    });
  }

  if (queries.size) {
    handleChange();
  }
}

export function local(method, ...opts) {
  return localDB[method](...opts);
}

export function remote(method, ...opts) {
  return remoteDB[method](...opts);
}

/**
 * Register a new reactive database query (keep the number of registered queries to a minimum!)
 *
 * @param {(Object|string)} q - Query object or doc _id string to watch for changes
 * @param {string} [key] - Name of the vuex object key (for queries, otherwise doc _id)
 */
export function register(q, key) {
  if (typeof q === 'string') {
    // simple doc _id query
    key = q; // eslint-disable-line no-param-reassign

    if (!queries.has('docs')) {
      queries.set('docs', [key]);
    } else {
      const keys = queries.get('docs');
      queries.set('docs', [...keys, key]);
    }
  } else {
    // custom query
    queries.set(key, q);
  }

  // register a new reactive vuex object
  postMessage({ c: `${namespace}/addQuery`, d: key });

  // run the query once to populate the vuex object
  handleChange({ key, q }, true);
}

/**
 * Unregister a previously registered reactive query
 *
 * @param {(string|number)} key - The returned key generated by register()
 * @param {Boolean} [isDoc] - Specific if the query is a doc as we can't infer it like
 */
export function unregister(key, isDoc) {
  if (!isDoc) {
    queries.delete(key);
  } else {
    const docs = queries.get('docs');
    queries.set('docs', docs.filter(doc => doc !== key));
  }
  postMessage({ c: `${namespace}/removeQuery`, d: key });
}

/**
 * Wait until a doc is available in the local database
 *
 * @param {(string|Array.<string>)} _id - The doc _id or array of _ids to wait for
 * @param {Boolean} [newOnly] - Don't check in existing docs; only react to incoming doc changes
 * @param {number} [timeout] - How long to wait before giving up in milliseconds (default = 45s)
 * @returns {string} - Containing the _id
 */
export function waitFor(docId, newOnly, timeout) {
  let docIds = typeof docId === 'string'
    ? [docId]
    : docId.slice(0); // clone array

  // listen to database changes feed
  const listener = localDB.changes({ since: 'now', live: true })
    .on('change', (change) => { // eslint-disable-line consistent-return
      docIds = docIds.filter(id => id !== change.id);

      if (!docIds.length) {
        listener.cancel();
        return docId;
      }
    })
    .on('error', (err) => {
      listener.cancel();
      return new Error(err);
    });

  // check existing docs
  if (!newOnly) {
    const filterFun = (doc) => { // eslint-disable-line consistent-return
      docIds = docIds.filter(id => id !== doc._id);

      if (!docIds.length) {
        listener.cancel();
        return docId;
      }
    };

    docIds.forEach((docId2) => {
      localDB.get(docId2)
        .then(filterFun)
        .catch(() => {}); // no-op; keep looking in changes feed
    });
  }

  // handle timeout
  setTimeout(() => { // eslint-disable-line no-restricted-globals
    listener.cancel();
    return new Error(`Can't find ${docId}, timeout`);
  }, timeout);
}

/**
 * Query database and filter + sort the results
 *
 * @param {string} id - x
 * @param {{field: string, value: string}} [filter] - x
 * @param {string} [sort] - x
 * @param {number} [limit] - x
 * @param {string} [start] - x
 * @returns {Promise} - Containing the query results
 */
export async function query({ id, filter, sort, limit, start }) {
  const { res } = await runQuery(null, { id, filter, sort, limit, start });
  return res;
}

/**
 * Do a manual one-time sync between the local and remote databases
 *
 * @param {Boolean} [retry] - Retry sync if there's a network failure
 * @returns {Promise} - Containing sync info once it completes
 */
export function sync(retry) {
  return PouchDB.sync(localDB, remoteDB, {
    retry,
    filter: config.filter,
    push: { checkpoint: config.pushCp },
    pull: { checkpoint: config.pullCp },
  })
    .on('complete', res => res)
    .on('error', rej => new Error(rej));
}

export function md5(string) {
  return SparkMD5.hash(string);
}

export { rev };
