import _Vue from 'vue';
import _Vuex from 'vuex';

declare global {
  export const VueComponent: typeof _Vue;
  export const VuexStore: typeof _Vuex.Store;
}
