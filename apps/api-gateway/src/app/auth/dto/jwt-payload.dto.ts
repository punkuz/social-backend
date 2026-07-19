import { Role } from '../../types/enums';

export class JwtPayloadDto {
  username!: string;
  id!: number;
  role!: Role;
}
