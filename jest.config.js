module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|react-native-worklets|react-native-svg)/)',
  ],
  setupFiles: ['./jest.setup.js'],
};
