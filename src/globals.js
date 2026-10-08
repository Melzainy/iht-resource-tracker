// The prototype modules use the global `React` (JSX compiles to React.createElement and
// components read hooks from React). This module runs first and provides it.
import * as React from 'react';
window.React = React;
