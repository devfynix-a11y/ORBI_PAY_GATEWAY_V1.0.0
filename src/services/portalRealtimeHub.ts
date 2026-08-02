import type http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { logger } from '../logger.js';
import { portalAccessStore } from './portalAccessStore.js';

type PortalRealtimeClient = {
  socket: WebSocket;
  email: string;
  role: string;
  serviceCodes: Set<string>;
};

const parseToken = (url: string | undefined) => {
  try {
    const parsed = new URL(url || '/', 'http://localhost');
    return parsed.searchParams.get('token') || '';
  } catch {
    return '';
  }
};

const canReceiveMessage = (client: PortalRealtimeClient, delivery: any) => {
  if (client.role === 'operator' || client.role === 'admin') return true;
  const recipient = String(delivery?.recipientIdentityRef || '').toLowerCase();
  const sentBy = String(delivery?.safeMetadata?.sentBy || '').toLowerCase();
  const serviceCode = String(delivery?.serviceCode || '');
  return recipient === client.email.toLowerCase()
    || sentBy === client.email.toLowerCase()
    || Boolean(serviceCode && client.serviceCodes.has(serviceCode));
};

export class PortalRealtimeHub {
  private server?: WebSocketServer;
  private clients = new Set<PortalRealtimeClient>();

  attach(httpServer: http.Server) {
    if (this.server) return;
    this.server = new WebSocketServer({ noServer: true });
    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname !== '/v1/portal/realtime') return;
      this.server?.handleUpgrade(req, socket, head, (ws) => {
        const token = parseToken(req.url);
        const authReq = {
          headers: { authorization: token ? `Bearer ${token}` : '' },
        } as any;
        const session = portalAccessStore.requireSession(authReq, 'developer');
        if (!session.ok) {
          ws.close(1008, 'Portal session required');
          return;
        }
        const client: PortalRealtimeClient = {
          socket: ws,
          email: session.claims.email,
          role: session.claims.role,
          serviceCodes: new Set(session.claims.serviceCodes || []),
        };
        this.clients.add(client);
        ws.send(JSON.stringify({
          type: 'portal.realtime.ready',
          payload: {
            email: client.email,
            role: client.role,
            ts: new Date().toISOString(),
          },
        }));
        ws.on('close', () => this.clients.delete(client));
        ws.on('error', (error) => logger.warn('portal_realtime_socket_error', { error: error.message }));
      });
    });
  }

  broadcastMessageDelivery(delivery: any) {
    const message = JSON.stringify({
      type: 'portal.message.created',
      payload: delivery,
    });
    for (const client of this.clients) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      if (!canReceiveMessage(client, delivery)) continue;
      client.socket.send(message);
    }
  }

  broadcastMessageRead(payload: { threadId?: string; deliveryIds: string[]; readBy: string; readAt: string }) {
    const message = JSON.stringify({
      type: 'portal.message.read',
      payload,
    });
    for (const client of this.clients) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      client.socket.send(message);
    }
  }
}

export const portalRealtimeHub = new PortalRealtimeHub();
