// https://eslint.org/docs/user-guide/configuring

module.exports = {
  root: true,
  extends: [
    '@wearegenki/eslint-config',
  ],
  parserOptions: {
    ecmaVersion: 8,
    sourceType: 'module',
  },
  env: {
    browser: true,
  },
};
