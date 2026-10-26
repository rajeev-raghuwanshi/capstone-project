const { app } = require('./app');
const setupContract = require('./docs-sync/contracts/setup.json');

const port = Number(process.env[setupContract.portEnvironmentVariable]) || setupContract.defaultPort;

app.listen(port, setupContract.host, () => {
  console.log(`Application listening on http://${setupContract.host}:${port}`);
});