module.exports = {
  extends: ['./src/ambire-common/.eslintrc.js'],
  rules: {
    'import/extensions': 'off',
    'class-methods-use-this': 'off',
    'no-nested-ternary': 'off',
    'prefer-promise-reject-errors': 'off',
    'no-underscore-dangle': 'off',
    'react/jsx-key': 'error'
  },
  env: {
    browser: true,
    node: true,
    jest: true
  },
  parserOptions: {
    project: './tsconfig.json'
  },
  globals: {
    process: 'readonly',
    chrome: 'readonly',
    injectWeb3: 'readonly',
    browser: 'readonly',
    __dirname: 'readonly',
    chromeTargetConfig: 'writable',
    firefoxTargetConfig: 'writable',
    Web3: true
  },
  overrides: [
    {
      // Account recovery: a screen imports shared/client, never the SDK doubles.
      // Only shared/client and the doubles' own folder (with its tests) may
      // import them.
      files: ['src/web/modules/social-recovery/**/*.{ts,tsx,js,jsx}'],
      excludedFiles: [
        'src/web/modules/social-recovery/shared/client/**',
        'src/web/modules/social-recovery/sdk-doubles/**'
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/sdk-doubles', '**/sdk-doubles/**'],
                message:
                  'Import the SDK through @web/modules/social-recovery/shared/client, never the doubles directly.'
              }
            ]
          }
        ]
      }
    }
  ]
}
