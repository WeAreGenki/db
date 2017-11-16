/**
 * @wearegenki/db (web worker)
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

// NOTE: The `i` var is the message sequence id used to keep track of which
//  method the message originated from.

import PouchDB from 'pouchdb-core';
import AdapterIdb from 'pouchdb-adapter-idb';
import AdapterWebSql from 'pouchdb-adapter-websql';
import AdapterHttp from 'pouchdb-adapter-http';
import Replication from 'pouchdb-replication';
import Mapreduce from 'pouchdb-mapreduce';
import Find from 'pouchdb-find';
import { rev } from 'pouchdb-utils';
import SparkMD5 from 'spark-md5';

// Initialise PouchDB plugins
if (process.env.NODE_ENV === 'test') {
  // in-memory database for testing
  PouchDB.plugin(require('pouchdb-adapter-memory')); // eslint-disable-line global-require
}
PouchDB.plugin(AdapterIdb);
PouchDB.plugin(AdapterWebSql);
PouchDB.plugin(AdapterHttp);
PouchDB.plugin(Replication);
PouchDB.plugin(Mapreduce);
PouchDB.plugin(Find);

let localDB;
let remoteDB;
let queries = new Map();
let namespace;

function init(opts) {
  // Uncomment for PouchDB debugging
  // PouchDB.debug.enable('*'); // all logs
  // PouchDB.debug.enable('pouchdb:find'); // debug find() query plans and indexing

  localDB = new PouchDB(opts.local);
  remoteDB = opts.remote ? new PouchDB(opts.remote) : undefined;

  queries = new Map(opts.queries);
  namespace = opts.namespace; // eslint-disable-line prefer-destructuring

  // Handle local database events
  localDB.changes({ since: 'now', live: true })
    .on('change', change => handleChange(change))
    .on('error', (err) => { throw new Error(err); });

  if (opts.remote && opts.sync) {
    // Populate local database; replicate from remote database
    localDB.replicate.from(remoteDB).on('complete', () => {
      // Keep local and remote databases in sync
      localDB.sync(remoteDB, {
        live: true,
        retry: true,
        filter: opts.filter,
      });
    });
  }

  for (const index of opts.indexes) {
    localDB.createIndex({ index });
  }

  if (queries.size) {
    handleChange({});
  }
}

function get(i, docId) {
  localDB.get(docId)
    .then(doc => send({ i, res: doc }))
    .catch(err => send({ i, rej: err }));
}

function put(i, doc) {
  localDB.put(doc)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function post(i, doc) {
  localDB.post(doc)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function remove(i, doc) {
  localDB.remove(doc)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function find(i, req) {
  localDB.find(req)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function dbQuery(i, doc, opts) {
  localDB.query(doc, opts)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function allDocs(i, opts) {
  localDB.allDocs(opts)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function bulkDocs(i, docs, opts) {
  localDB.bulkDocs(docs, opts)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function bulkGet(i, opts) {
  localDB.bulkGet(opts)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function revsDiff(i, diff) {
  localDB.revsDiff(diff)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function changes(i, opts) {
  if (opts.live) {
    send({ i, rej: 'Can\'t use live option from web worker' });
    return;
  }

  localDB.changes(opts)
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function compact(i) {
  localDB.compact()
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function destroy(i) {
  localDB.destroy()
    .then(res => send({ i, res }))
    .catch(err => send({ i, rej: err }));
}

function runQuery(key, query) {
  return new Promise((resolve, reject) => {
    let res;

    try {
      if (key === 'docs') {
        res = localDB.allDocs({
          include_docs: true,
          keys: query,
        });
      } else {
        res = localDB.find(query);
      }
      resolve({ key, res });
    } catch (err) {
      reject(err);
    }
  });
}

async function handleChange(change, oneShot) {
  if (queries.size) {
    const batch = [];

    if (!oneShot) {
      // TODO: Optimise which queries are run based on change.id (?)
      // FIXME: Wait until initial sync is finished before running (to avoid running many times on first login)
      console.debug('CHANGE', change);

      for (const [key, query] of queries) {
        batch.push(runQuery(key, query));
      }
    } else if (change.key === change.query) {
      // one shot doc
      batch.push(runQuery('docs', [change.query]));
    } else {
      // one shot mango query
      batch.push(runQuery(change.key, change.query));
    }

    const processItem = async (item) => {
      const newItem = await item;
      const res = await newItem.res;

      if (res.docs) {
        // mango query result
        send({ commit: `${namespace}/setQueryResult`, data: { key: newItem.key, data: res.docs }});
      } else {
        // allDocs result
        for (const row of res.rows) {
          send({ commit: `${namespace}/setQueryResult`, data: { key: row.id, data: row.doc }});
        }
      }
    };

    batch.map(processItem);
  }
}

function register(query, key) {
  if (typeof query === 'string') {
    // doc query
    key = query; // eslint-disable-line no-param-reassign

    if (!queries.has('docs')) {
      queries.set('docs', [key]);
    } else {
      const keys = queries.get('docs');
      queries.set('docs', [...keys, key]);
    }
  } else {
    // mango query
    queries.set(key, query);
  }

  // register new reactive vuex object
  send({ commit: `${namespace}/addQuery`, data: { key }});

  // FIXME: REMOVE once done setting up indexes
  // console.time('regQuery');

  // run the query once to populate vuex object
  handleChange({ key, query }, true);
}

function unregister(key, isDoc) {
  if (!isDoc) {
    queries.delete(key);
  } else {
    const docs = queries.get('docs');
    queries.set('docs', docs.filter(doc => doc !== key));
  }
  send({ commit: `${namespace}/removeQuery`, data: { key }});
}

function waitUntil(i, docId, newOnly, timeout) {
  let docIds;
  if (typeof docId === 'string') {
    docIds = [docId];
  } else {
    // clone the array
    docIds = docId.slice(0);
  }

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
    const filterer = (doc) => {
      docIds = docIds.filter(id => id !== doc._id);

      if (!docIds.length) {
        send({ i, res: docId });
        listener.cancel();
      }
    };

    for (const docId2 of docIds) {
      localDB.get(docId2)
        .then(filterer)
        .catch(() => {}); // no-op; keep looking in changes feed
    }
  }

  // handle timeout
  self.setTimeout(() => { // eslint-disable-line no-restricted-globals
    send({ i, rej: `Can't find ${docId}, timeout` });
    listener.cancel();
  }, timeout);
}

function dbRev(i) {
  send({ i, res: rev() });
}

function md5(i, string) {
  send({ i, res: SparkMD5.hash(string) });
}

// Outgoing message handler
function send(msg) {
  postMessage(JSON.stringify(msg));
}

// Incoming message event handler
self.addEventListener('message', receive); // eslint-disable-line no-restricted-globals

function receive(event) { // eslint-disable-line no-undef
  const data = JSON.parse(event.data);

  if (data.get !== undefined) {
    get(data.get.i, data.get.opts[0]);
  } else if (data.put !== undefined) {
    put(data.put.i, data.put.opts[0]);
  } else if (data.register !== undefined) {
    register(data.register.query, data.register.key);
  } else if (data.unregister !== undefined) {
    unregister(data.unregister.key, data.unregister.isDoc);
  } else if (data.remove !== undefined) {
    remove(data.remove.i, data.remove.opts[0]);
  } else if (data.waitUntil !== undefined) {
    waitUntil(data.waitUntil.i, data.waitUntil.opts[0], data.waitUntil.opts[1], data.waitUntil.opts[2]);
  } else if (data.find !== undefined) {
    find(data.find.i, data.find.opts[0]);
  } else if (data.query !== undefined) {
    dbQuery(data.query.i, data.query.opts[0], data.query.opts[1]);
  } else if (data.allDocs !== undefined) {
    allDocs(data.allDocs.i, data.allDocs.opts[0]);
  } else if (data.changes !== undefined) {
    changes(data.changes.i, data.changes.opts[0]);
  } else if (data.bulkDocs !== undefined) {
    bulkDocs(data.bulkDocs.i, data.bulkDocs.opts[0], data.bulkDocs.opts[1]);
  } else if (data.local !== undefined) {
    init(data);
  } else if (data.rev !== undefined) {
    dbRev(data.rev.i);
  } else if (data.md5 !== undefined) {
    md5(data.md5.i, data.md5.opts[0]);
  } else if (data.compact !== undefined) {
    compact(data.compact.i);
  } else if (data.revsDiff !== undefined) {
    revsDiff(data.revsDiff.i, data.revsDiff.opts[0]);
  } else if (data.post !== undefined) {
    post(data.post.i, data.post.opts[0]);
  } else if (data.bulkGet !== undefined) {
    bulkGet(data.bulkGet.i, data.bulkGet.opts[0]);
  } else if (data.destroy !== undefined) {
    destroy(data.destroy.i);
  } else {
    throw new Error('Unknown event:', event);
  }
}
