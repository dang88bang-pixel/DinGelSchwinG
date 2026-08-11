/* ESLint-Konfiguration — DinGelSchwinG (React + TypeScript) */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2020, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // 'any' wird gezielt für Browser-Web-APIs genutzt, die nicht in lib.dom stehen
    // (DeviceOrientationEvent.requestPermission, WebUSB/WebSerial/WebBluetooth u. ä.).
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-unused-vars': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', 'android', '*.config.js', '*.config.ts'],
};
