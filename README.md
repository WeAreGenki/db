# @wearegenki/db

Vue and vuex plugin for reactive PouchDB databases in a web worker — https://wearegenki.com/pro-tools#FOSS

> NOTE: This package uses various ES6/ES7 features and needs to be transpiled to suit your browser compatibility policy. We don't handle any transpilation in the package itself, it's just the raw source code. You also need a way to load the web worker script.

Included PouchDB plugins:

1. pouchdb-adapter-idb
2. pouchdb-adapter-http
3. pouchdb-replication

## Usage

> NOTE: These instructions assume you're using webpack with babel.

### 1. Install

```bash
yarn add @wearegenki/db
```

Also, to load the web worker file using webpack, install:

```bash
yarn add --dev worker-loader
```

### 2. Set up your build config

Something like this in your webpack config, e.g. `webpack.base.conf.js`:

```javascript
  module: {
    rules: [
      {
        test: /\.worker\.js$/,
        loader: 'worker-loader',
        options: {
          name: utils.assetsPath('js/[name].[hash:7].js')
        }
      },
      {
        test: /\.js$/,
        loader: 'babel-loader',
        include: [
          resolve('src'),
          resolve('test'),
          resolve('node_modules/@wearegenki/db'),
        ],
      },
    ],
  }
```

### 3. Import the plugin

Create a file to import the plugin and set your configuration, e.g. `services/db.js`:

```javascript
import Vue from 'vue';
import wDB from '@wearegenki/db';
import WW from '@wearegenki/db/db.worker';
import store from '../store'; // your vuex store

Vue.use(wDB);

const db = new wDB.Database({
  WW,
  local: 'app',
  remote: 'http://localhost:4984/your_db_name',
  vuexStore: store,
  queries: [
    ['docs', [
      '_local/user',
    ]],
  ],
  // debug: '*', // all logs
});

export default db;
```

See [configuration options below](#options).

### 4. Inject into the vue root instance

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

### 5. Use in vue components or JS

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

> NOTE: Only the `WW` option is required, all other options have sane defaults.

| Option | Default | Required | Value/s | Description |
| --- | --- | :---: | --- | --- |
| `WW` | _undefined_ | Yes | _The imported db.worker.js file OR path to file_ | Works with either `worker-loader` webpack plugin or a path to the `db.worker.js` file as a string. See [install instructions above](#1-install). |
| `local` | `'app'` | No | `<string>` | The name for the local database or a URL. Names get appended to "\_pouch_" so the default turns in to `_pouch_app`. It's also possible to use a URL to bypass saving any data locally and only communicate with a remote database. |
| `remote` | _undefined_ | No* | `<string>` | The URL to your remote database, e.g. 'https://your-site.com:5984/your_db'. *Only required if you want syncing functionality. |
| `filter` | _undefined_ | No | _A PouchDB replication filter_ | See the filtered replication section [in the PouchDB docs](https://pouchdb.com/api.html#replication). |
| `vuexStore` | _undefined_ | No* | `<vuex instance>` | A reference to your vuex store. *Only required when you want to use reactive queries or want a reactive sync status property. |
| `queries` | `[]` | No | _Valid input for Map(), see example below_ | Register reactive queries. See [queries section](#queries) below. |
| `namespace` | `'db'` | No | `<string>` | Namespace for the vuex module. Determines the path to the vuex properties and methods. |
| `createRemote` | `false` | No | `<Boolean>` | Create remote database if it doesn't already exist. Only works with CouchDB (_not_ Couchbase Sync Gateway). Default = assume remote database already exists. |
| `sync` | `true` | No | `<Boolean>` | Enables replication between the local and remote databases. The `sync()` method is useful to trigger a manual sync when this is set to `false`, see [API methods below](#custom-methods). `remote` is required for this to have any effect. |
| `debounce` | `300` | No | `<Number>` | Amount of milliseconds to debounce between executing queries when document changes are detected. This helps to limit unnecessary CPU usage when a flood of documents are syncing from the remote database, like when a user first syncs, in which case we want to delay running queries until the network traffic settles or the sync is complete. |
| `pushCp` | `'source'` | No | `'source'` \| `'target'` \| `<Boolean>` | Dictates where should checkpoints be saved. Default = only local database will save checkpoints, which results in less network traffic for better performance but at a small risk of data loss if the remote database is ever destroyed. For more information see [PouchDB docs](https://pouchdb.com/api.html#replication) and the [feature discussion on GitHub](https://github.com/pouchdb/pouchdb/issues/6308#issuecomment-282967868). |
| `pullCp` | `'target'` | No | `'source'` \| `'target'` \| `<Boolean>` | Same as `pushCp` but for docs coming from remote. Default = only local database will save checkpoints. |
| `debug` | _undefined_ | No | `'*'` \| `'pouchdb:api'` \| `pouchdb:http` | Enable PouchDB's debug mode. |

## Queries

Queries are a way to get a set of documents which match certain criteria easily. Use the `db.query()` method to do a one-time query. One-time queries are great, however, a key feature of this library is **reactive queries**, which can be set as a initial option or any time via the `db.register()` method. Pleasenote -this is different from mango queries — it's much simpler and has much better performance.

> NOTE: To use reactive queries a vuex store is required.

### Query format

```javascript
{
  prefix: 'doc_id_prefix', // doc _id prefix to search
  filter: { // optional
    for: 'field_to_filter_by',
    when: '>', // optional, comparison operator (>, <, >=, <=, or when undefined ===)
    if: 'matching_value',
  },
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
        type: 'feedback',
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
  computed: {
    ...mapState('db', [
      'topBooks', // you can use the topBooks array in your vue template
    ]),
  },
  created() {
    this.getTopBooks();
  },
  beforeDestroy() {
    this.$db.unregister('topBooks');
  },
  methods: {
    async getTopBooks() {
      this.$db.register({
        type: 'book',
        filter: {
          for: 'publishDate',
          when: '>='
          if: '2015-03-25'
        },
        sort: 'title',
        limit: 10,
      }, 'topBooks');
    },
  },
};
</script>
```

## API Methods

All methods run against the local database as the intent of this library is to provide "offline first" support to your vue projects.

> NOTE: PouchDB built-in methods with low performance are purposely avoided. For functionality beyond what's here it's a better idea to write custom logic using these methods. You'll be fine with what's provided 95% of the time.

### PouchDB built-in methods

#### `get(_id)`

\#TODO

#### `put(doc)`

\#TODO

#### `post(doc)`

\#TODO

#### `remove(doc)`

\#TODO

#### `allDocs(docs)`

\#TODO

#### `bulkDocs(docs, opts)`

\#TODO

#### `revsDiff(diff)`

\#TODO

#### `changes(opts)`

\#TODO

#### `compact()`

\#TODO

### Custom methods

#### `waitFor(_id, newOnly, timeout = 45e3)`

\#TODO

#### `register(query, key)`

\#TODO

#### `unregister(key, isDoc)`

\#TODO

#### `query({ type, filter, sort, limit, start })`

\#TODO

#### `sync(retry = false)`

\#TODO

#### `upsert(_id, diff)`

\#TODO

#### `rev()`

\#TODO

#### `md5(string)`

\#TODO

### Useful variables

#### `ready`

A promise that resolves once the initial remote to local replication has finished.

-----

© 2017 [We Are Genki](https://wearegenki.com)
