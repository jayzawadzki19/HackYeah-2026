import { Controller, Get, Param } from '@nestjs/common';
import type { BriefingDto, EnergyMapDto, WeekDto } from '../../../contracts/api-contract';
import { UsersService } from '../users/users.service';
import { requireUserKey } from '../users/user-key';
import { ForecastService } from './forecast.service';

@Controller('users')
export class ForecastController {
  constructor(
    private readonly users: UsersService,
    private readonly forecasts: ForecastService,
  ) {}

  @Get(':key/briefing')
  async briefing(@Param('key') key: string): Promise<BriefingDto> {
    return this.forecasts.briefing(await this.user(key));
  }

  @Get(':key/week')
  async week(@Param('key') key: string): Promise<WeekDto> {
    return this.forecasts.week(await this.user(key));
  }

  @Get(':key/energy-map')
  async energyMap(@Param('key') key: string): Promise<EnergyMapDto> {
    return this.forecasts.energyMap(await this.user(key));
  }

  private async user(key: string) {
    const userKey = requireUserKey(key);
    await this.users.profile(userKey);
    return userKey;
  }
}
