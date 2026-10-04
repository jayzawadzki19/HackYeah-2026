import { Controller, Get } from '@nestjs/common';
import type { UserSummaryDto } from '../../../contracts/api-contract';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<readonly UserSummaryDto[]> {
    return this.users.list();
  }
}
