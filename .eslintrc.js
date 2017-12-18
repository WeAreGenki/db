// https://eslint.org/docs/user-guide/configuring

module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2017,
    sourceType: 'module',
    ecmaFeatures: {
      experimentalObjectRestSpread: true,
    },
  },
  env: {
    browser: true,
    jest: true,
    'jest/globals': true
  },
  plugins: [
    'jest',
    'import',
  ],
  extends: [
    'airbnb-base',
    'plugin:jest/recommended',
  ],
  rules: {
    'import/extensions': ['error', 'always', { js: 'never' }],
    'no-underscore-dangle': 'off',
    'object-curly-spacing': ['error', 'always', { objectsInObjects: false }],
    'object-curly-newline': ['error', { consistent: true }],
  }
};
