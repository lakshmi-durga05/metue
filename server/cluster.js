const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
  const num = parseInt(process.env.WORKERS || '', 10) || os.cpus().length;
  for (let i = 0; i < num; i++) cluster.fork();
  cluster.on('exit', () => cluster.fork());
} else {
  require('./index');
}
