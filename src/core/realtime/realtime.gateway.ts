import { Injectable, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { auth } from '@/core/auth/auth';
import { RealtimeService } from './realtime.service';

const FRONTEND_ORIGINS = process.env.FRONTEND_URLS?.split(',').map((o) =>
  o.trim(),
) ?? ['http://localhost:3000'];

@Injectable()
@WebSocketGateway({
  cors: { origin: FRONTEND_ORIGINS, credentials: true },
  // Keep connections alive through Render's 55s proxy idle timeout
  pingInterval: 10000,
  pingTimeout: 5000,
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  // definite assignment asserted: set by Nest after gateway init
  server!: Server;

  constructor(private readonly realtime: RealtimeService) {}

  afterInit(server: Server) {
    this.realtime.setServer(server);
    this.logger.log('WebSocket gateway initialised');
  }

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        socket.disconnect();
        return;
      }

      // useSecureCookies:true prefixes the cookie name with __Secure-
      const session = await auth.api.getSession({
        headers: new Headers({
          cookie: `__Secure-better-auth.session_token=${token}`,
        }),
      });

      if (!session?.user) {
        socket.disconnect();
        return;
      }

      socket.data.userId = session.user.id;
      await socket.join(`user:${session.user.id}`);
      this.logger.log(`Socket connected: user ${session.user.id}`);
    } catch (err) {
      this.logger.error('Socket connection error', err);
      socket.disconnect();
    }
  }
}
