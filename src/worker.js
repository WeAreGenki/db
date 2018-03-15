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
 * Compare two strings with an operator
 * @private
 * @param {string} valueOne
 * @param {string} valueTwo
 * @param {string} [operator]
 * @returns {boolean}
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
 * Query filter options.
 * @typedef {Array} FilterOptions
 * @property {string} field The name of the doc field to compare.
 * @property {string} [operator] Comparison operator; <=, >=, <, >. Anything else defaults to ===.
 * @property {string} value The value to compare against.
 */

/**
 * Database query definition object.
 * @typedef {object} Query
 * @property {string} id
 * @property {FilterOptions} [filter]
 * @property {string} [sort]
 * @property {number} [limit]
 * @property {string} [start]
 */

/**
 * Run a query against the local database.
 * @private
 * @param {(string|object)} key
 * @param {Query} q Query to run.
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
      rows = rows.filter(row =>
        // filter[0] = compare field
        // filter[1] = compare operator
        // filter[2] = compare value
        compare(row.doc[filter[0]], filter[2], filter[1]));
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
 * Process database change.
 * @private
 * @param {object} [change]
 * @param {boolean} [oneShot]
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

    /** @param {Object} input */
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

/** @private @param {object} opts */
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
    PouchDB.replicate(remoteDB, localDB, { checkpoint: opts.pullCp }).then((info) => {
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
        // TODO: Decide whether to keep this functionality; is this even useful?
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

// FIXME: localDB typedef
/**
 * Run a PouchDB method against the local database.
 * @param {string} method The PouchDB method to call.
 * @param {Array.<any>} opts Options to pass to the method call.
 */
export function local(method, ...opts) {
  return localDB[method](...opts);
}

// FIXME: remoteDB typedef
/**
 * Run a PouchDB method against the remote database.
 * @param {string} method The PouchDB method to call.
 * @param {Array.<any>} opts Options to pass to the method call.
 */
export function remote(method, ...opts) {
  return remoteDB[method](...opts);
}

/**
 * Register a new reactive database query (keep the number of registered queries to a minimum!)
 *
 * @param {(Query|string)} q - Query object or doc _id string to watch for changes
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
 * Unregister a previously registered reactive query.
 * @param {(string|number)} key - The returned key generated by register().
 * @param {boolean} [isDoc] - Specific if the query is a doc as we can't infer it like.
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
 * Wait until a doc is available in the local database.
 * @param {(string|Array.<string>)} docId - The doc _id or array of _ids to wait for.
 * @param {boolean} [newOnly] - Don't check in existing docs; only react to incoming doc changes.
 * @param {number} [timeout] - How long to wait before giving up in milliseconds (default = 45s).
 * @returns {Promise<string>} - Containing the _id.
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
        .catch(() => { /* no op */ }); // keep looking in changes feed
    });
  }

  // handle timeout
  setTimeout(() => { // eslint-disable-line no-restricted-globals
    listener.cancel();
    return new Error(`Can't find ${docId}, timeout`);
  }, timeout);
}

/**
 * Query database and filter and sort the results.
 * @param {Query} $0 Query parameters.
 * @returns {Promise<object>} - Containing the query results.
 */
export async function query({ id, filter, sort, limit, start }) {
  const { res } = await runQuery(null, { id, filter, sort, limit, start });
  return res;
}

/**
 * Do a manual one-time sync between the local and remote databases.
 * @param {boolean} [retry] - Retry sync if there's a network failure
 * @returns {Promise<object>} - Containing sync info once it completes
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

/**
 * Get the MD5 hash a text string.
 * @param {string} input String to hash.
 * @returns {string} The MD5 hash to the input string.
 */
export function md5(input) {
  return SparkMD5.hash(input);
}

/**
 * Generate a random PouchDB document revision ID.
 * @returns {string} A document revision ID.
 */
export { rev };
