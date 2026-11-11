import { createDatabase } from '../src/db/client.js';
import { buildApp } from '../src/app.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

let appInstance: any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!appInstance) {
    if(!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
      res.status(500).json({ error: 'Missing environment variables' });
      return;
    }
    const connection = createDatabase(process.env.DATABASE_URL);
    appInstance = await buildApp(connection.db, process.env.JWT_SECRET, false);
    await appInstance.ready();
  }
  
  appInstance.server.emit('request', req, res);
}
