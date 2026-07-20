import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface JwtPayload {
  id: number;
  role: string;
  username: string;
}

@Injectable()
export class WsAuthService {
  constructor(private readonly jwtService: JwtService) {}

  async verifyToken(token: string): Promise<JwtPayload> {
    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

    if (!Number.isInteger(payload.id) || payload.id < 1) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return payload;
  }
}
