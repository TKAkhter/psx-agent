const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  mode: "production",
  target: "node",
  entry: "./src/index.js",
  output: {
    filename: "index.js",
    path: __dirname + "/dist"
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()]
  }
};