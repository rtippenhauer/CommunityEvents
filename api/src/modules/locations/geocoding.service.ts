import { Injectable, Logger } from '@nestjs/common';
import { TenantSecretsService } from '../tenant-secrets/tenant-secrets.service';

export interface Coordinates {
  lat: number;
  lng: number;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  constructor(private readonly secrets: TenantSecretsService) {}

  /**
   * The key is resolved per call rather than captured in the constructor: it is
   * per-community as of v2-7, so there is no single value to capture. A
   * community that has set its own key uses it, otherwise the deployment's
   * GEOCODING_API_KEY, otherwise geocoding is off.
   */
  async geocode(address: string): Promise<Coordinates | null> {
    const apiKey = await this.secrets.resolve('geocoding_api_key');
    if (!apiKey || apiKey === 'your_geocoding_api_key') {
      this.logger.warn('No geocoding API key for this community — skipping geocoding');
      return null;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
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
