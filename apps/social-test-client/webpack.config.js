const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
  },
  devServer: {
    port: 4200,
    historyApiFallback: true,
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      {
        context: ['/socket.io'],
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
        // Browser traffic may arrive through a VS Code forwarded HTTPS URL.
        // The realtime gateway only needs to trust this local dev-server hop.
        headers: { origin: 'http://localhost:4200' },
      },
    ],
  },
  plugins: [
    new NxAppWebpackPlugin({
      tsConfig: './tsconfig.app.json',
      compiler: 'swc',
      main: './src/main.js',
      index: './src/index.html',
      baseHref: '/',
      assets: ['./src/favicon.ico', './src/assets'],
      styles: ['./src/styles.css'],
      outputHashing: process.env['NODE_ENV'] === 'production' ? 'all' : 'none',
      // This is a local test harness; keeping output unminified makes browser
      // debugging useful and avoids coupling it to the workspace SWC version.
      optimization: false,
    }),
  ],
};
