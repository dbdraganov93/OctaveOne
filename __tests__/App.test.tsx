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
