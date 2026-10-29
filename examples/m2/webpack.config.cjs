const path = require('node:path');

module.exports = {
  mode: 'development',
  target: 'web',
  entry: path.resolve(__dirname, 'main.ts'),
  output: {
    path: path.resolve(__dirname, '../../dist-example-m2'),
    filename: 'main.js',
    publicPath: '/',
    clean: true,
  },
  devtool: 'source-map',
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
    static: { directory: __dirname },
    host: '127.0.0.1',
    port: 8115,
    hot: false,
    historyApiFallback: true,
    client: { logging: 'none' },
  },
  stats: 'errors-warnings',
};
