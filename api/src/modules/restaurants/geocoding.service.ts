import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Coordinates {
  lat: number;
  lng: number;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly apiKey: string | undefined;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('GEOCODING_API_KEY');
  }

  async geocode(address: string): Promise<Coordinates | null> {
    if (!this.apiKey || this.apiKey === 'your_geocoding_api_key') {
      this.logger.warn('GEOCODING_API_KEY not configured — skipping geocoding');
      return null;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.apiKey}`;
      const res = await fetch(url);
      const data = (await res.json()) as {
        status: string;
        results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
      };

      if (data.status !== 'OK' || !data.results.length) {
        this.logger.warn(`Geocoding returned status ${data.status} for: ${address}`);
        return null;
      }

      const { lat, lng } = data.results[0].geometry.location;
      return { lat, lng };
    } catch (err) {
      this.logger.error('Geocoding request failed', err);
      return null;
    }
  }
}
