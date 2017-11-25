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

// NOTE: The `i` var is the message sequence id used to keep track of which
//  method the message originated from.

import PouchDB from 'pouchdb-core';
import AdapterIdb from 'pouchdb-adapter-idb';
import AdapterHttp from 'pouchdb-adapter-http';
import Replication from 'pouchdb-replication';
import debounce from 'lodash/debounce';
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

let localDB;
let remoteDB;
let queries = new Map();
let namespace;

// outgoing message handler
function send(msg) {
  postMessage(JSON.stringify(msg));
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
    // type query with filter and sort
    let { rows } = await localDB.allDocs({
      include_docs: true,
      startkey: query.type,
      endkey: `${query.type}\ufff0`,
    });

    if (query.filter !== undefined) {
      rows = rows.filter(row => row.doc[query.filter.field] === query.filter.value);
    }

    // clean up results so we just have an array of docs
    res = rows.map(row => row.doc);

    if (query.sort !== undefined) {
      res = res.sort((a, b) => a[query.sort].localeCompare(b[query.sort]));
    }
  }
  return { key, res };
}

async function handleChange(change, oneShot) {
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
          commit: `${namespace}/setQueryResult`,
          data: { key: row.id, data: row.doc },
        }));
      } else {
        // custom query result
        send({
          commit: `${namespace}/setQueryResult`,
          data: { key, data: res },
        });
      }
    };

    batch.map(processItem);
  }
}

function init(opts) {
  if (opts.debug) PouchDB.debug.enable(opts.debug);

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
    // populate local database; replicate from remote database
    PouchDB.replicate(localDB, remoteDB, { checkpoint: opts.pushCp }).on('complete', () => {
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

function remove(i, doc) {
  localDB.remove(doc)
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
  send({ commit: `${namespace}/addQuery`, data: { key }});

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
  send({ commit: `${namespace}/removeQuery`, data: { key }});
}

function waitFor(i, docId, newOnly, timeout) {
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

async function dbQuery(i, { type, filter, sort }) {
  const { res } = await runQuery(null, { type, filter, sort });
  send({ i, res });
}

function dbRev(i) {
  send({ i, res: rev() });
}

function md5(i, string) {
  send({ i, res: SparkMD5.hash(string) });
}

function receive(event) {
  const data = JSON.parse(event.data);

  console.log('DATA', data, ...data);

  if (process.env.NODE_ENV !== 'production') {
    // execute arbitrary code for development or testing
    if (data.exec !== undefined) {
      (async () => {
        console.log('%c[EXEC]', 'color: #fff; background: red;', await eval(data.exec)); // eslint-disable-line
      })();
      return;
    }
  }

  if (data.get !== undefined) {
    get(data.get.i, data.get.opts[0]);
  } else if (data.allDocs !== undefined) {
    allDocs(data.allDocs.i, data.allDocs.opts[0]);
  } else if (data.register !== undefined) {
    register(data.register.query, data.register.key);
  } else if (data.unregister !== undefined) {
    unregister(data.unregister.key, data.unregister.isDoc);
  } else if (data.query !== undefined) {
    dbQuery(data.query.i, data.query.opts[0]);
  } else if (data.waitFor !== undefined) {
    waitFor(data.waitFor.i, data.waitFor.opts[0], data.waitFor.opts[1], data.waitFor.opts[2]);
  } else if (data.put !== undefined) {
    put(data.put.i, data.put.opts[0]);
  } else if (data.remove !== undefined) {
    remove(data.remove.i, data.remove.opts[0]);
  } else if (data.bulkDocs !== undefined) {
    bulkDocs(data.bulkDocs.i, data.bulkDocs.opts[0], data.bulkDocs.opts[1]);
  } else if (data.rev !== undefined) {
    dbRev(data.rev.i);
  } else if (data.md5 !== undefined) {
    md5(data.md5.i, data.md5.opts[0]);
  } else if (data.revsDiff !== undefined) {
    revsDiff(data.revsDiff.i, data.revsDiff.opts[0]);
  } else if (data.compact !== undefined) {
    compact(data.compact.i);
  } else if (data.changes !== undefined) {
    changes(data.changes.i, data.changes.opts[0]);
  } else if (data.init !== undefined) {
    init(data.init);
  } else {
    throw new Error('Unknown event:', event);
  }
}

// incoming message event handler
self.addEventListener('message', receive); // eslint-disable-line no-restricted-globals
