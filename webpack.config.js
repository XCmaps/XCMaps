import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import Dotenv from 'dotenv-webpack';
import TerserPlugin from 'terser-webpack-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/public/assets/js/index.js',
    output: {
      path: path.resolve(__dirname, 'build'),
      filename: isProduction ? 'js/[name].[contenthash].js' : 'js/[name].js',
      publicPath: '/',
      clean: true,
      assetModuleFilename: 'assets/[hash][ext][query]'
    },
    devtool: isProduction ? 'source-map' : 'inline-source-map',
    devServer: {
      static: {
        directory: path.join(__dirname, 'build'),
        publicPath: '/',
      },
      compress: true,
      port: 3001,
      hot: true,
      historyApiFallback: true,
      open: true,
      client: {
        overlay: {
          errors: true,
          warnings: false,
        },
      },
      proxy: [
        {
          context: ['/api', '/socket.io'],
          target: 'http://localhost:3000', // Your backend server address
          secure: false, // Set to false if backend uses self-signed certs
          changeOrigin: true, // Recommended for virtual hosted sites
          ws: true // Enable WebSocket proxying
        }
      ]
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: 'babel-loader'
        },
        {
          test: /\.scss$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            {
              loader: 'sass-loader',
              options: {
                sourceMap: !isProduction,
              },
            },
          ],
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif|ico)$/,
          type: 'asset/resource',
          generator: {
            filename: 'assets/images/[name][hash][ext]',
          },
        },
        {
          test: /\.svg$/,
          type: 'asset/resource',
          generator: {
            filename: 'assets/images/[name][hash][ext]'
          }
        },
        {
          test: /\.(json)$/i,
          type: 'asset/resource',
          generator: {
            filename: 'assets/maps/[name][ext]',
          },
        },
        // Add CSS handling
        {
          test: /\.css$/,
          use: [
            isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
            {
              loader: 'css-loader',
              options: {
                url: {
                  filter: (url) => {
                    // Don't process absolute paths
                    return !url.startsWith('/');
                  }
                }
              }
            }
          ]
        }
      ],
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          parallel: true,
          terserOptions: {
            sourceMap: true,
          },
        }),
        new CssMinimizerPlugin(),
        new ImageMinimizerPlugin({
          minimizer: {
            implementation: ImageMinimizerPlugin.sharpMinify,
            options: {
              encodeOptions: {
                jpeg: { quality: 90 },
                webp: { lossless: true },
                avif: { quality: 90 },
              },
            },
          },
        }),
      ],
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
        },
      },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/public/index.html',

        filename: 'index.html',
        inject: 'body',
        minify: isProduction ? {
          removeComments: true,
          collapseWhitespace: true,
          removeRedundantAttributes: true,
          useShortDoctype: true,
          removeEmptyAttributes: true,
          keepClosingSlash: true,
          minifyJS: true,
          minifyCSS: true,
          minifyURLs: true,
        } : false,
      }),

      new MiniCssExtractPlugin({
        filename: isProduction ? 'css/[name].[contenthash].css' : 'css/[name].css',
        chunkFilename: isProduction ? 'css/[id].[contenthash].css' : 'css/[id].css',
      }),
      new Dotenv({
        systemvars: true,
      }),
      new CopyWebpackPlugin({
        patterns: [
          // Removed: Copying JS from src/components as they are now imported and bundled
          {
            from: 'src/public/assets/js/L.Control.Layers.Tree.js',
            to: 'assets/js/[name][ext]'
          },
          {
            from: 'src/public/assets/css/L.Control.Layers.Tree.css',
            to: 'assets/css/[name][ext]'
          },
          {
            from: 'src/public/assets/maps',
            to: 'assets/maps'
          },
          {
            from: 'src/public/assets/images',
            to: 'assets/images'
          }
          // SRTM folder is excluded from webpack build to avoid TIFF processing errors
          // The folder will be accessed directly from the server
        ]
      }),
    ],
    resolve: {
      extensions: ['.js', '.json'],
      modules: [
        path.resolve(__dirname, 'src/components'),
        'node_modules'
      ],
      alias: {
        '@components': path.resolve(__dirname, 'src/components'),
        '@images': path.resolve(__dirname, 'src/public/assets/images'),
        '@maps': path.resolve(__dirname, 'src/public/assets/maps'),
        'L.Control.Layers.Tree': path.resolve(__dirname, 'src/public/assets/js/L.Control.Layers.Tree.js'),
        'moment': path.resolve(__dirname, 'node_modules/moment'),
        'moment-timezone': path.resolve(__dirname, 'node_modules/moment-timezone/builds/moment-timezone-with-data.min.js')
      },
      fallback: {
        "fs": false,
        "tls": false,
        "net": false,
        "path": false,
        "zlib": false,
        "http": false,
        "https": false,
        "stream": false,
        "crypto": false,
        "os": false,
        "worker_threads": false,
        "module": false,
        "child_process": false,
        "diagnostics_channel": false,
        "buffer": false, // or require.resolve('buffer/')
        "util": false, // or require.resolve('util/')
        "assert": false, // or require.resolve('assert/')
        "tty": false, // or require.resolve('tty-browserify')
        "url": false, // or require.resolve('url/')
        "vm": false // or require.resolve('vm-browserify')
      }
    },
    performance: {
      hints: isProduction ? 'warning' : false,
      maxAssetSize: 500000,
      maxEntrypointSize: 500000,
    },
  };
};