const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  plugins: [
    require('postcss-import'),
    ...(isProduction ? [require('cssnano')()] : [])
  ]
};
