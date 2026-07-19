import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service';
import { AuthRequest } from '../types/auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let token: string | null = null;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = req.headers?.authorization;

    // Extract token from header or cookie
    if (authorization?.startsWith('Bearer ')) {
      token = authorization.split(' ')[1];
    } else if (req.cookies?.jwt) {
      token = req.cookies.jwt;
    }

    if (!token) {
      throw new UnauthorizedException('You are not logged in! Please log in.');
    }
    try {
      // verify token
      const decoded = await this.authService.verifyToken(token);
      if (!decoded) {
        throw new UnauthorizedException(
          'This token is invalid or  does not exist.',
        );
      }
      // Attach user to request
      req.user = decoded;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid token';
      throw new UnauthorizedException(message);
    }
  }
}
