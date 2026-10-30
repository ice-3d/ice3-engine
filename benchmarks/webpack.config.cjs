const path = require('node:path');

module.exports = {
  mode: 'production',
  target: 'web',
  entry: path.resolve(__dirname, 'web/main.ts'),
  output: {
    path: path.resolve(__dirname, '../dist-benchmark'),
    filename: 'main.js',
    publicPath: '/',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [{
      test: /\.ts$/,
      exclude: /node_modules/,
      use: {
        loader: 'esbuild-loader',
        options: { loader: 'ts', target: 'es2022' },
      },
    }],
  },
  devServer: {
    static: [
      { directory: path.resolve(__dirname, 'web') },
      {
        directory: path.resolve(__dirname, '../examples/m1/assets'),
        publicPath: '/assets',
      },
    ],
    host: '127.0.0.1',
    port: 8116,
    hot: false,
  },
  stats: 'errors-warnings',
};
