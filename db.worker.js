/**
 * @wearegenki/db (web worker)
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

/* eslint-env worker */

import PouchDB from 'pouchdb-core';
import AdapterIdb from 'pouchdb-adapter-idb';
import AdapterHttp from 'pouchdb-adapter-http';
import Replication from 'pouchdb-replication';
import debounce from 'lodash/debounce';
import { rev as getRev } from 'pouchdb-utils';
import SparkMD5 from 'spark-md5';

// initialise PouchDB plugins
if (process.env.NODE_ENV === 'test') {
  // in-memory database for testing
  PouchDB.plugin(require('pouchdb-adapter-memory')); // eslint-disable-line
}
PouchDB.plugin(AdapterIdb);
PouchDB.plugin(AdapterHttp);
PouchDB.plugin(Replication);

let config;
let localDB;
let remoteDB;
let queries = new Map();
let namespace;

// outgoing message handler
function send(msg) {
  self.postMessage(JSON.stringify(msg)); // eslint-disable-line no-restricted-globals
}

async function runQuery(key, query) {
  let res;

  if (key === 'docs') {
    // simple list of doc _ids
    res = await localDB.allDocs({
      include_docs: true,
      keys: query,
    });
  } else {
    // custom query with filter and sort
    const { id, filter, sort, limit, start } = query;

    let { rows } = await localDB.allDocs({
      limit,
      include_docs: true,
      startkey: start || id,
      endkey: `${id}\ufff0`,
    });

    if (filter !== undefined) {
      // TODO: Optimise for file size
      if (filter.when === undefined) {
        rows = rows.filter(row => row.doc[filter.for] === filter.if);
      } else if (filter.when === '<=') {
        rows = rows.filter(row => row.doc[filter.for] <= filter.if);
      } else if (filter.when === '>=') {
        rows = rows.filter(row => row.doc[filter.for] >= filter.if);
      } else if (filter.when === '<') {
        rows = rows.filter(row => row.doc[filter.for] < filter.if);
      } else if (filter.when === '>') {
        rows = rows.filter(row => row.doc[filter.for] > filter.if);
      }
    }

    // clean up results so we just have an array of docs
    res = rows.map(row => row.doc);

    if (sort !== undefined) {
      res = res.sort((x, y) => x[sort].localeCompare(y[sort]));
    }
  }
  return { key, res };
}

async function handleChange(change = {}, oneShot) {
  if (queries.size) {
    const batch = [];

    if (!oneShot) {
      queries.forEach((query, key) => {
        batch.push(runQuery(key, query));
      });
    } else if (change.key === change.query) {
      // one shot doc _id query
      batch.push(runQuery('docs', [change.query]));
    } else {
      // one shot custom query
      batch.push(runQuery(change.key, change.query));
    }

    const processItem = async (input) => {
      const { key, res } = await input;

      if (res.rows) {
        // doc _id result
        res.rows.forEach(row => send({
          c: `${namespace}/setQueryResult`,
          d: { key: row.id, data: row.doc },
        }));
      } else {
        // custom query result
        send({
          c: `${namespace}/setQueryResult`,
          d: { key, data: res },
        });
      }
    };

    batch.map(processItem);
  }
}

function init(opts) {
  config = opts; // used in sync()

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
      // update main thread that initial replication is fished
      send({ r: 1, res: info });

      // keep local and remote databases in sync
      PouchDB.sync(localDB, remoteDB, {
        live: true,
        retry: true,
        filter: opts.filter,
        push: {
          checkpoint: opts.pushCp,
        },
        pull: {
          checkpoint: opts.pullCp,
        },
      });
    });
  }

  if (queries.size) {
    handleChange();
  }
}

function get(i, docId) {
  localDB.get(docId)
    .then(doc => send({ i, res: doc }))
    .catch(rej => send({ i, rej }));
}

function put(i, doc) {
  localDB.put(doc)
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function remove(i, doc) {
  localDB.remove(doc)
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function all(i, opts) {
  localDB.allDocs(opts)
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function bulk(i, docs, opts) {
  localDB.bulkDocs(docs, opts)
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function diff(i, ids) {
  localDB.revsDiff(ids)
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function changes(i, opts) {
  if (opts.live) {
    send({ i, rej: 'Can\'t use live option from web worker' });
    return;
  }

  localDB.changes(opts)
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function compact(i) {
  localDB.compact()
    .then(res => send({ i, res }))
    .catch(rej => send({ i, rej }));
}

function register(query, key) {
  if (typeof query === 'string') {
    // simple doc _id query
    key = query; // eslint-disable-line no-param-reassign

    if (!queries.has('docs')) {
      queries.set('docs', [key]);
    } else {
      const keys = queries.get('docs');
      queries.set('docs', [...keys, key]);
    }
  } else {
    // custom query
    queries.set(key, query);
  }

  // register a new reactive vuex object
  send({ c: `${namespace}/addQuery`, d: { key }});

  // run the query once to populate the vuex object
  handleChange({ key, query }, true);
}

function unregister(key, isDoc) {
  if (!isDoc) {
    queries.delete(key);
  } else {
    const docs = queries.get('docs');
    queries.set('docs', docs.filter(doc => doc !== key));
  }
  send({ c: `${namespace}/removeQuery`, d: { key }});
}

function waitFor(i, docId, newOnly, timeout) {
  let docIds = typeof docId === 'string'
    ? [docId]
    : docId.slice(0); // clone array

  // listen to database changes feed
  const listener = localDB.changes({ since: 'now', live: true })
    .on('change', (change) => {
      docIds = docIds.filter(id => id !== change.id);

      if (!docIds.length) {
        send({ i, res: docId });
        listener.cancel();
      }
    })
    .on('error', (err) => {
      send({ i, rej: err });
      listener.cancel();
    });

  // check existing docs
  if (!newOnly) {
    const filterFun = (doc) => {
      docIds = docIds.filter(id => id !== doc._id);

      if (!docIds.length) {
        send({ i, res: docId });
        listener.cancel();
      }
    };

    docIds.forEach((docId2) => {
      localDB.get(docId2)
        .then(filterFun)
        .catch(() => {}); // no-op; keep looking in changes feed
    });
  }

  // handle timeout
  self.setTimeout(() => { // eslint-disable-line no-restricted-globals
    send({ i, rej: `Can't find ${docId}, timeout` });
    listener.cancel();
  }, timeout);
}

async function dbQuery(i, { k, f, s, l, b }) {
  const { res } = await runQuery(null, { id: k, filter: f, sort: s, limit: l, start: b });
  send({ i, res });
}

function sync(i, retry) {
  PouchDB.sync(localDB, remoteDB, {
    retry,
    filter: config.filter,
    push: {
      checkpoint: config.pushCp,
    },
    pull: {
      checkpoint: config.pullCp,
    },
  })
    .on('complete', res => send({ i, res }))
    .on('error', rej => send({ i, rej }));
}

function rev(i) {
  send({ i, res: getRev() });
}

function md5(i, string) {
  send({ i, res: SparkMD5.hash(string) });
}

function receive(event) {
  // XXX: m = method, i = sequence number, o = options
  const { m, i, o } = JSON.parse(event.data);

  if (process.env.NODE_ENV !== 'production') {
    // execute arbitrary code for development or testing
    if (m === 'exec') {
      (async () => {
        console.log('%c[EXEC]', 'color: #fff; background: red;', await eval(o)); // eslint-disable-line
      })();
      return;
    }
  }

  switch (m) {
    case 'get': get(i, o[0]); break;
    case 'put': put(i, o[0]); break;
    case 'all': all(i, o[0]); break;
    case 'query': dbQuery(i, o[0]); break;
    case 'waitFor': waitFor(i, o[0], o[1], o[2]); break;
    case 'remove': remove(i, o[0]); break;
    case 'register': register(o.q, o.k); break;
    case 'unregister': unregister(o.k, o.d); break;
    case 'bulk': bulk(i, o[0], o[1]); break;
    case 'sync': sync(i, o[0]); break;
    case 'rev': rev(i); break;
    case 'md5': md5(i, o[0]); break;
    case 'diff': diff(i, o[0]); break;
    case 'compact': compact(i); break;
    case 'changes': changes(i, o[0]); break;
    case 'init': init(o); break;
    default: throw new Error('Unknown event:', event);
  }
}

// incoming message event handler
self.addEventListener('message', receive); // eslint-disable-line no-restricted-globals
