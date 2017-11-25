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
    es6: true,
    worker: true,
    jest: true,
    'jest/globals': true
  },
  plugins: [
    'jest',
    'import',
  ],
  extends: [
    'airbnb-base',
    'plugin:import/errors',
    'plugin:jest/recommended',
  ],
  rules: {
    'import/extensions': ['error', 'always', { js: 'never' }],
    'no-underscore-dangle': 'off',
    'object-curly-spacing': ['error', 'always', { objectsInObjects: false }],
  }
};
