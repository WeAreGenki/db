import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';
import pkg from './package.json';

export default [
  {
    input: 'src/db.js',
    external: ['vue'],
    output: [
      { file: pkg.main, format: 'cjs' },
      { file: pkg.module, format: 'es' },
    ],
    sourcemap: true,
    plugins: [
      babel({
        exclude: ['node_modules/**'],
        // externalHelpers: true,
        // externalHelpers: false,
        // runtimeHelpers: true,
        // runtimeHelpers: false,
      }),
    ],
  },
  {
    input: 'src/db.worker.js',
    output: [
      { file: 'dist/db.worker.cjs.js', format: 'cjs' },
      { file: 'dist/db.worker.js', format: 'es' },
    ],
    sourcemap: true,
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: true,
      }),
      commonjs({ exclude: 'src/**' }),
      babel({
        exclude: ['node_modules/**'],
        // externalHelpers: true,
        // externalHelpers: false,
        // runtimeHelpers: true,
        // runtimeHelpers: false,
      }),
    ],
  },
];
