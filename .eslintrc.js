// https://eslint.org/docs/user-guide/configuring

module.exports = {
  root: true,
  parser: 'babel-eslint',
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
  },
  env: {
    browser: true,
    'jest/globals': true
  },
  plugins: [
    'compat',
    'jest',
  ],
  extends: [
    'airbnb-base',
    'plugin:import/errors',
    'plugin:jest/recommended',
  ],
  // settings: {
  //   // Check if imports actually resolve
  //   'import/resolver': {
  //     webpack: {
  //       config: 'build/webpack.base.conf.js'
  //     }
  //   }
  // },
  rules: {
    // don't require .vue extension when importing
    'import/extensions': ['error', 'always', {
      js: 'never',
      // vue: 'never',
    }],
    // allow optionalDependencies
    'import/no-extraneous-dependencies': ['error', {
      optionalDependencies: ['test/unit/index.js']
    }],
    // allow debugger during development
    'no-debugger': process.env.NODE_ENV === 'production' ? 2 : 0,

    // FIXME: REMOVE BEFORE GOING LIVE
    'no-console': 'off',

    // We Are Genki
    'compat/compat': 'warn', // find out which features need a polyfill
    'no-param-reassign': ['error', { props: false }],
    'no-underscore-dangle': 'off', // needed for PouchDB
    'no-use-before-define': 'off', // FIXME: Currently broken with destructuring
    'max-len': 'off', // FIXME: Currently broken with vue template blocks
    // 'max-len': ['error', {
    //   code: 120,
    //   tabWidth: 2,
    //   ignoreComments: true,
    //   ignoreTrailingComments: true,
    //   ignoreUrls: true,
    //   ignoreStrings: true,
    //   ignoreTemplateLiterals: true,
    // }],
    'object-curly-spacing': ['error', 'always', { objectsInObjects: false }],
    'object-curly-newline': ['error', { consistent: true }],

    // edit airbnb-base to remove ForOfStatement restriction
    'no-restricted-syntax': [
      'error',
      {
        selector: 'ForInStatement',
        message: 'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
      },
      {
        selector: 'LabeledStatement',
        message: 'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
      },
      {
        selector: 'WithStatement',
        message: '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
      },
    ],
  }
};
