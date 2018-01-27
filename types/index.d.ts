// Type definitions for @wearegenki/db
// Project: @wearegenki/db
// Definitions by: Max Milton <max@wearegenki.com>

// FIXME: Is this necessary when using JSDoc comments? Is there some way to map the comments to the Vue.$db instance below?

// TODO: Vuex

import _Vue from 'vue';
// import Vuex from 'vuex';

export class Connection {
  constructor(
    local?: string,
    remote?: string,
    filter?: object | string,
    // vuex?: typeof Vuex.Store,
    vuex?: object,
    queries?: Query[],
    namespace?: string,
    createRemote?: boolean,
    sync?: boolean,
    debounce?: number,
    pushCp?: string,
    pullCp?: string,
    status?: boolean,
    debug?: boolean
  );

  get(docId: string): Promise<object>;
  put(doc: string): Promise<object>;
  remove(doc: string): Promise<object>;
  upsert(doc: string, diff: Function): Promise<object>;

  local(method: string, ...opts: any[]): Promise<object>;
  remote(method: string, ...opts: any[]): Promise<object>;

  register(q: Query | string, key?: string): void;
  unregister(key: string | number, isDoc?: Boolean): void;
  waitFor(
    docId: string | string[],
    newOnly?: Boolean,
    timeout?: number
  ): Promise<string>;
  query(queryObject: Query): Promise<object>;
  sync(retry?: Boolean): Promise<object>;
  md5(input: string): Promise<string>;
  rev(): Promise<string>;
}

export type Query = {
  id: string;
  filter?: {
    for: string;
    if: string;
    when?: string;
  };
  sort?: string;
  limit?: number;
  start?: string;
};

export function install(Vue: typeof _Vue): void;
