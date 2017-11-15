import multiEntry from 'rollup-plugin-multi-entry';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';
import pkg from './package.json';

export default {
  input: ['src/db.js', 'src/db.worker.js'],
  // external: ['ms'],
  output: [
    { dest: pkg.main, format: 'cjs' },
    { dest: pkg.module, format: 'es' },
  ],
  plugins: [
    multiEntry(),
    resolve(),
    commonjs(),
    babel({
      exclude: ['node_modules/**'],
      // runtimeHelpers: true,
      // externalHelpers: true,
    }),
  ],
};
