import { Request } from 'express';
import { JwtPayloadDto } from '../auth/dto/jwt-payload.dto';

export interface AuthRequest extends Request {
  user?: JwtPayloadDto;
  cookies: { [key: string]: string };
}
