import { startPostgres } from '../../dist/esm/index.js';
const instance = await startPostgres(JSON.parse(process.env.PARENT_OPTIONS));
process.send({ ready: true, port: instance.port });
process.on('message', () => process.exit(0));
