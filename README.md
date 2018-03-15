<!-- markdownlint-disable first-line-h1 -->

[![Build status](https://img.shields.io/travis/WeAreGenki/db.svg)](https://travis-ci.org/WeAreGenki/db)
[![NPM version](https://img.shields.io/npm/v/@wearegenki/db.svg)](https://www.npmjs.com/package/@wearegenki/db)
[![Licence](https://img.shields.io/npm/l/@wearegenki/db.svg)](https://github.com/WeAreGenki/db/blob/master/LICENCE)

# @wearegenki/db

Vue plugin for reactive, offline capable databases — [npmjs.com/package/@wearegenki/db](https://www.npmjs.com/package/@wearegenki/db).

> NOTE: This package uses various ES6/ES7 features and needs to be transpiled to suit your browser compatibility policy. We don't handle any transpilation in the package itself, it's just the raw source code. You also need a way to load the web worker script.

## Overview

Included PouchDB plugins:

1. pouchdb-adapter-idb
1. pouchdb-adapter-http
1. pouchdb-replication

## Usage

> NOTE: These instructions assume you're using webpack.

### 1. Install plugin and dependencies

```shell
yarn add @wearegenki/db \
  && yarn add --dev workerize-loader
```

### 2. Import the plugin

> NOTE: See [configuration options below](#options).

_PRO TIP: This is also a good place to put any custom database methods too._

Create a file to import the plugin and set your configuration, e.g. `services/db.js`:

```javascript
import Vue from 'vue';
import Database from '@wearegenki/db';
import vuex from '../store'; // your vuex store

Vue.use(Database);

const db = new Database.Connection({
  vuex,
  local: 'app',
  remote: 'http://localhost:4984/your_db_name', // optional
  queries: [ // set up any reactive queries, optional
    ['docs', [
      '_local/user',
    ]],
  ],
  // debug: '*', // all logs
});

export default db;
```

### 3. Inject into the root vue instance

E.g. `main.js`:

```javascript
import Vue from 'vue';
import store from './store';
import db from './services/db';
import App from './App';

new Vue({
  el: '#app',
  store,
  db,
  render: h => h(App),
});
```

### 4. Use in vue components or JS

> NOTE: Keep in mind most of the plugin methods return a Promise so you need to use `await` or `.then()` before you can access the resulting value.

You can now use the plugin in vue components like this:

```javascript
this.$db.get('your_doc_id').then((res) => {
  console.log(res);
});
```

Or in any JS file like this:

```javascript
import db from './services/db';

db.get('your_doc_id').then((res) => {
  console.log(res);
});
```

## Options

| Option | Default | Required | Value/s | Description |
| --- | --- | :---: | --- | --- |
| `local` | `'app'` | No | `<string>` | The name for the local database. Names get appended to "\_pouch_" so the default turns in to `_pouch_app`. It's also possible to use a URL to bypass saving any data locally and only communicate with a remote database. |
| `remote` | _undefined_ | No* | `<string>` | The URL to your remote database, e.g. `https://your-site.com:5984/your_db`. *Only required if you want syncing functionality. |
| `filter` | _undefined_ | No | _A PouchDB replication filter_ | See the filtered replication section [in the PouchDB docs](https://pouchdb.com/api.html#replication). |
| `vuex` | _undefined_ | No* | `<vuex instance>` | A reference to your vuex store. *Only required when you want to use reactive queries or the status property. |
| `queries` | `[]` | No | _Valid input for Map(), see example below_ | Register reactive queries. See [queries section](#queries) below. |
| `namespace` | `'db'` | No | `<string>` | Namespace for the vuex module. Determines the path to the vuex properties and methods. |
| `createRemote` | `false` | No | `<Boolean>` | Create remote database if it doesn't already exist. Only works with CouchDB (_not_ Couchbase Sync Gateway). Default = assume remote database already exists. |
| `sync` | `true` | No | `<Boolean>` | Enables replication between the local and remote databases. The `sync()` method is useful to trigger a manual sync when this is set to `false`, see [API methods below](#custom-methods). `remote` is required for this to have any effect. |
| `debounce` | `300` | No | `<Number>` | Amount of milliseconds to debounce between executing queries when document changes are detected. This helps to limit unnecessary CPU usage when a flood of documents are syncing from the remote database, like when a user first syncs, in which case we want to delay running queries until the network traffic settles or the sync is complete. |
| `pushCp` | `'source'` | No | `'source'` \| `'target'` \| `<Boolean>` | Dictates where should checkpoints be saved. Default = only local database will save checkpoints, which results in less network traffic for better performance but at a small risk of data loss if the remote database is ever destroyed. For more information see [PouchDB docs](https://pouchdb.com/api.html#replication) and the [feature discussion on GitHub](https://github.com/pouchdb/pouchdb/issues/6308#issuecomment-282967868). |
| `pullCp` | `'target'` | No | `'source'` \| `'target'` \| `<Boolean>` | Same as `pushCp` but for docs coming from remote. Default = only local database will save checkpoints. |
| `status` | `false` | No | `<Boolean>` | Expose if the sync status is OK by adding a reactive vuex property `<namespace>/ok`. Only use this when necessary because it has a performance impact (due to its event listeners). |
| `debug` | _undefined_ | No | `'*'` \| `'pouchdb:api'` \| `pouchdb:http` | Enable PouchDB's debug mode. |

## Queries

Queries are a way to get a set of documents which match certain criteria easily. Use the `db.query()` method to do a one-time query. One-time queries are great, however, a key feature of this library is **reactive queries**, which can be set as a initial option or any time via the `db.register()` method. Please note this is different from mango queries — it's much simpler leading to much better performance.

> NOTE: To use reactive queries a vuex store is required.

### Query format

```javascript
{
  id: 'doc_id_prefix', // doc _id prefix to search
  filter: [ // optional
    'field_to_filter_by',
    '>', // comparison operator (>, <, >=, <=, or when undefined ===)
    'matching_value',
  ],
  sort: 'field_to_sort_by', // optional
  limit: 100, // optional
  start: 'doc_id_prefix', // optional, doc _id prefix to start search from (and end at `prefix`) for pagination
}
```

### Example queries

#### One-time query

`SimpleComponent.vue`:

```html
<script>
export default {
  mounted() {
    this.getFeedbackList().then((res) => {
      console.log(res);
    });
  },
  methods: {
    // simple array of "feedback" docs sorted by score
    getFeedbackList() {
      return this.$db.query({
        id: 'feedback',
        sort: 'score',
      });
    }
  },
};
</script>
```

#### Reactive query

`ReactiveComponent.vue`:

```html
<script>
import { mapState } from 'vuex';

export default {
  computed: mapState('db', [
    'topBooks', // you can use the topBooks array in your vue template
  ]),
  created() {
    this.getTopBooks();
  },
  beforeDestroy() {
    this.$db.unregister('topBooks');
  },
  methods: {
    async getTopBooks() {
      this.$db.register({
        id: 'book',
        filter: ['publishDate', '>=', '2015-03-25'],
        sort: 'title',
        limit: 10,
      }, 'topBooks');
    },
  },
};
</script>
```

## API Methods

_PRO TIP: It's recommended to call methods on the local database so to provide "offline first" support for your projects._

### Direct database access

#### `local(method, ...opts)`

Run a PouchDB method against the local database.

\#TODO: Write description and give example.

#### `remote(method, ...opts)`

Run a PouchDB method against the remote database.

\#TODO: Write description and give example.

### Convenience wrapper methods

For developer convenience the most common PouchDB methods are available directly.

#### `get(_id)`

\#TODO: Write description and give example.

#### `put(doc)`

\#TODO: Write description and give example.

#### `remove(doc)`

\#TODO: Write description and give example.

### Additional methods

Extra API methods unique to this plugin; not part of PouchDB.

#### `waitFor(_id, newOnly, timeout)`

\#TODO: Write description and give example.

#### `register(query, key)`

\#TODO: Write description and give example.

#### `unregister(key, isDoc)`

\#TODO: Write description and give example.

#### `query({ id, filter, sort, limit, start })`

\#TODO: Write description and give example.

#### `sync(retry)`

\#TODO: Write description and give example.

#### `upsert(_id, diff)`

\#TODO: Write description and give example.

#### `rev()`

\#TODO: Write description and give example.

#### `md5(string)`

\#TODO: Write description and give example.

### Useful variables

#### `ready`

A promise that resolves once the initial remote to local replication has finished. A.K.A. once the initial data has finished downloading.

## Licence

`@wearegenki/db` is an Apache-2.0 licensed open source project. See [LICENCE](https://github.com/WeAreGenki/db/blob/master/LICENCE).

-----

© 2018 [We Are Genki](https://wearegenki.com)
