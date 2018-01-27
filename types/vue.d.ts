/**
 * Extends interfaces in Vue.js
 */

import Vue, { ComponentOptions } from 'vue';
import { Connection } from './index';

declare module 'vue/types/options' {
  interface ComponentOptions<V extends Vue> {
    db?: Connection;
  }
}

declare module 'vue/types/vue' {
  interface Vue {
    $db: Connection;
  }
}
