import { createProvider } from './provider.mjs';
const server = createProvider();
server.listen(Number(process.env.PORT || 8081), '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));