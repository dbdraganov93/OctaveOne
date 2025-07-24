/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock(
  'react-native-audio-record',
  () => ({
    init: jest.fn(),
    on: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  }),
  {virtual: true},
);

jest.mock(
  'react-native-svg',
  () => {
    const React = require('react');
    const {View} = require('react-native');
    const Svg = props => React.createElement(View, props, props.children);
    const Polyline = props => React.createElement(View, props, props.children);
    return {__esModule: true, Svg, Polyline, default: Svg};
  },
  {virtual: true},
);

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const {View} = require('react-native');
  return React.forwardRef((props, ref) => React.createElement(View, {...props, ref}, props.children));
});


jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});


jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const {View} = require('react-native');
  return React.forwardRef((props, ref) =>
    React.createElement(View, {...props, ref}, props.children),
  );
});

jest.mock(
  'fft.js',
  () =>
    function Mock(size) {
      this.size = size;
      this.createComplexArray = () => new Array(size * 2).fill(0);
      this.realTransform = () => {};
      this.completeSpectrum = () => {};
    },
  {virtual: true},
);

import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
