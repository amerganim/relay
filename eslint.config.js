import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const nonDeterministic = ['random', 'sin', 'cos', 'tan', 'atan', 'atan2', 'hypot', 'pow', 'exp', 'log'].map(
  (property) => ({
    object: 'Math',
    property,
    message: 'Not allowed in src/sim: results can differ between JS engines and break replay verification.',
  }),
);

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'supabase/functions/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts', 'src/relay/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', ...nonDeterministic],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'localStorage'],
      'no-restricted-imports': ['error', { patterns: ['phaser', '**/client/*'] }],
    },
  },
);
