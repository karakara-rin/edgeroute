import http from 'node:http';
import pc from 'picocolors';
import { createEdgeRouteServer } from '@edgeroute/server';
import { loadConfig } from '../utils/config-loader.js';

export interface DevOptions {
  config?: string;
  port?: string;
  host?: string;
  cwd?: string;
}

export async function devCommand(options: DevOptions): Promise<http.Server> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(options.config, cwd);
  const port = options.port ? parseInt(options.port, 10) : 3000;
  const host = options.host || '0.0.0.0';

  const { app } = await createEdgeRouteServer(config, {
    logger: { enabled: true },
  });

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const url = `http://${nodeReq.headers.host || `localhost:${port}`}${nodeReq.url}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else if (value !== undefined) {
          headers.set(key, value);
        }
      }

      const method = nodeReq.method || 'GET';
      const isBodyAllowed = method !== 'GET' && method !== 'HEAD';

      let bodyData: any = undefined;
      if (isBodyAllowed) {
        const chunks: Buffer[] = [];
        for await (const chunk of nodeReq) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        bodyData = Buffer.concat(chunks);
      }

      const webReq = new Request(url, {
        method,
        headers,
        body: bodyData,
        duplex: 'half',
      } as any);

      const webRes = await app.fetch(webReq);

      nodeRes.statusCode = webRes.status;
      webRes.headers.forEach((val, key) => {
        nodeRes.setHeader(key, val);
      });

      if (webRes.body) {
        const reader = webRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          nodeRes.write(value);
        }
        nodeRes.end();
      } else {
        nodeRes.end();
      }
    } catch (err: any) {
      if (!nodeRes.headersSent) {
        nodeRes.statusCode = 500;
        nodeRes.setHeader('Content-Type', 'application/json');
        nodeRes.end(JSON.stringify({ error: { message: err.message } }));
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.log(pc.bold(pc.cyan('\n🚀 EdgeRoute Dev Server running!')));
      console.log(pc.dim('──────────────────────────────────────────────────'));
      console.log(`  ${pc.bold('• Local:')}     ${pc.cyan(`http://localhost:${port}`)}`);
      console.log(`  ${pc.bold('• Dashboard:')} ${pc.magenta(pc.bold(`http://localhost:${port}/dashboard`))}`);
      console.log(`  ${pc.bold('• Health:')}    ${pc.cyan(`http://localhost:${port}/health`)}`);
      console.log(`  ${pc.bold('• Proxy:')}     ${pc.cyan(`http://localhost:${port}/v1/chat/completions`)}`);
      console.log(`  ${pc.bold('• Default:')}   ${pc.green(config.defaultModel)}`);
      console.log(`  ${pc.bold('• Routes:')}    ${config.routes.length} configured`);
      console.log(pc.dim('──────────────────────────────────────────────────\n'));
      resolve(server);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
