module.exports = {
  apps: [
    {
      name: 'metaverse-server',
      script: './server/index.js',
      instances: process.env.WEB_CONCURRENCY || 'max',
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3001
      }
    }
  ]
};
