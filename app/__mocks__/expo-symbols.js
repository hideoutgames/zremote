const React = require('react');
const { View } = require('react-native');

// Host-view stand-in so tests can assert name / size / tintColor / resizeMode.
exports.SymbolView = props => React.createElement(View, props);
