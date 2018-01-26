// import _Vue, {
//   VueConstructor,
//   Component
// } from 'vue';
// import _Vuex from 'vuex';

import _Vue from 'vue';
import _Vuex from 'vuex';

declare global {
  export const VueGlobal: typeof _Vue;
  // export const VueConstructor: VueConstructor;
  // export const Component: Component;
  export const Vuex: typeof _Vuex;
}

declare module 'vue/types/vue' {
  interface Vue {
    $db: string;
  }
}

// ----------------------------------------------------------------------------------

declare module 'workerize-loader!*' {
  const WebWorker: Worker;
  export default WebWorker;
}
