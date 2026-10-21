/*
 * This utility function is useful in combination with jest `transformIgnorePatterns` config
 * to transform specific packages (e.g.ES modules) in a projects node_modules folder.
 */
const nodeModulesToTransform = (moduleNames) => `node_modules\/(?!(${moduleNames.join('|')})\/)`;

// Array of known nested grafana package dependencies that only bundle an ESM version
const grafanaESModules = [
  '.pnpm', // Support using pnpm symlinked packages
  'd3',
  'd3-color',
  'd3-force',
  'd3-interpolate',
  'd3-scale-chromatic',
  'ol',
  'react-colorful',
  'uuid',
];

module.exports = {
  moduleNameMapper: {
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
    'react-inlinesvg': require.resolve('./mocks/react-inlinesvg.tsx'),
  },
  modulePaths: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/.config/jest-setup.js'],
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        sourceMaps: true,
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: true,
            decorators: false,
            dynamicImport: true,
          },
        },
      },
    ],
  },
  // Jest will throw `Cannot use import statement outside a module` if it tries to load an
  // ES module without it being transformed first. ./config/README.md#esm-errors-with-jest
  transformIgnorePatterns: [nodeModulesToTransform(grafanaESModules)],
};
