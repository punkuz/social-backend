import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../types/enums';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthRequest } from '../types/auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    // Get the roles required by the route handler from metadata set by the @Roles decorator
    //this is for method and class level roles, but we are only using method level roles for now
    // const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
    //   context.getHandler(),
    //   context.getClass(),
    // ]);
    const requiredRoles = this.reflector.get<Role[]>(ROLES_KEY, context.getHandler());

    // If no roles are required, allow access
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest<AuthRequest>();

    // If no user is attached to the request, deny access
    if (!user) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}
