import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  info(): { name: string; version: string } {
    return { name: 'DinnerBears API', version: 'v1' };
  }
}
