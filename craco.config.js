const CracoAntDesignPlugin = require("craco-antd");
const webpack = require("webpack");
const path = require("path")

module.exports = {
  plugins: [
    {
      plugin: CracoAntDesignPlugin,
      options: {
      }
    }
  ],
  webpack: {
    plugins: [
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1
      })
    ],
    configure: {
      output: {
        filename: '[name].js',
      },
      optimization: {

        runtimeChunk: false,

        splitChunks: {
          cacheGroups: {
            default: false
          }
        }
      }
    }
  }
};
