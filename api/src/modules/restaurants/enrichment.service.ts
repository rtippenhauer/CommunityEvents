import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { writeFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';

export interface EnrichResult {
  description: string | null;
  phone: string | null;
  website: string | null;
  photoAdded: boolean;
  placeFound: boolean;
}

export interface EnrichDiagnosis {
  keys: {
    googlePlaces: boolean;
    anthropic: boolean;
  };
  restaurant: {
    name: string;
    address: string;
    hasDescription: boolean;
    hasPhone: boolean;
    hasWebsite: boolean;
    photoCount: number;
  };
  places: {
    query: string;
    searchStatus: string;
    placeId: string | null;
    detailsStatus: string | null;
    editorialSummary: string | null;
    phone: string | null;
    website: string | null;
    photoCount: number;
  } | null;
  claude: {
    status: 'ok' | 'skipped' | 'error';
    reason: string;
    generatedDescription: string | null;
  };
  willUpdate: string[];
  willSkip: string[];
}

interface PlaceSearchResponse {
  candidates: Array<{ place_id: string }>;
  status: string;
}

interface PlaceDetailsResponse {
  result: {
    editorial_summary?: { overview: string };
    formatted_phone_number?: string;
    website?: string;
    photos?: Array<{ photo_reference: string }>;
  };
  status: string;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly googleKey: string | undefined;
  private readonly anthropic: Anthropic | null;
  private readonly uploadPath: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(RestaurantPhotoEntity)
    private readonly photoRepo: Repository<RestaurantPhotoEntity>,
  ) {
    this.googleKey = configService.get<string>('GOOGLE_PLACES_API_KEY');
    const anthropicKey = configService.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
    this.uploadPath = configService.get<string>('UPLOAD_PATH') ?? '/app/uploads';
  }

  async enrich(restaurant: RestaurantEntity, uploaderId: number): Promise<EnrichResult> {
    const result: EnrichResult = {
      description: null,
      phone: null,
      website: null,
      photoAdded: false,
      placeFound: false,
    };

    let placeData: PlaceDetailsResponse['result'] | null = null;

    if (this.googleKey) {
      placeData = await this.fetchPlaceDetails(restaurant.name, restaurant.address);
      if (placeData) {
        result.placeFound = true;

        if (!restaurant.phone && placeData.formatted_phone_number) {
          result.phone = placeData.formatted_phone_number;
        }
        if (!restaurant.websiteUrl && placeData.website) {
          result.website = placeData.website;
        }
        if (restaurant.photos.length === 0 && placeData.photos?.length) {
          result.photoAdded = await this.downloadPlacePhoto(
            restaurant.id,
            placeData.photos[0].photo_reference,
            uploaderId,
          );
        }
      }
    }

    if (this.anthropic) {
      result.description = await this.generateDescription(
        restaurant.name,
        restaurant.address,
        restaurant.city?.name,
        placeData?.editorial_summary?.overview,
      );
    }

    return result;
  }

  async diagnose(restaurant: RestaurantEntity): Promise<EnrichDiagnosis> {
    const diagnosis: EnrichDiagnosis = {
      keys: {
        googlePlaces: !!this.googleKey,
        anthropic: !!this.anthropic,
      },
      restaurant: {
        name: restaurant.name,
        address: restaurant.address,
        hasDescription: !!restaurant.description,
        hasPhone: !!restaurant.phone,
        hasWebsite: !!restaurant.websiteUrl,
        photoCount: restaurant.photos?.length ?? 0,
      },
      places: null,
      claude: { status: 'skipped', reason: '', generatedDescription: null },
      willUpdate: [],
      willSkip: [],
    };

    // Google Places
    if (!this.googleKey) {
      diagnosis.places = null;
    } else {
      const query = `${restaurant.name} ${restaurant.address}`;
      const searchUrl =
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${this.googleKey}`;

      let searchStatus = 'ERROR';
      let placeId: string | null = null;
      let detailsStatus: string | null = null;
      let editorialSummary: string | null = null;
      let phone: string | null = null;
      let website: string | null = null;
      let photoCount = 0;

      try {
        const searchRes = await fetch(searchUrl);
        const searchData = (await searchRes.json()) as PlaceSearchResponse;
        searchStatus = searchData.status;

        if (searchData.status === 'OK' && searchData.candidates.length) {
          placeId = searchData.candidates[0].place_id;
          const fields = 'editorial_summary,formatted_phone_number,website,photos';
          const detailUrl =
            `https://maps.googleapis.com/maps/api/place/details/json` +
            `?place_id=${placeId}&fields=${fields}&key=${this.googleKey}`;

          const detailRes = await fetch(detailUrl);
          const detailData = (await detailRes.json()) as PlaceDetailsResponse;
          detailsStatus = detailData.status;

          if (detailData.status === 'OK') {
            editorialSummary = detailData.result.editorial_summary?.overview ?? null;
            phone = detailData.result.formatted_phone_number ?? null;
            website = detailData.result.website ?? null;
            photoCount = detailData.result.photos?.length ?? 0;
          }
        }
      } catch (err) {
        searchStatus = `FETCH_ERROR: ${(err as Error).message}`;
      }

      diagnosis.places = { query, searchStatus, placeId, detailsStatus, editorialSummary, phone, website, photoCount };

      if (placeId && detailsStatus === 'OK') {
        if (!restaurant.phone && phone) diagnosis.willUpdate.push(`phone → ${phone}`);
        else if (restaurant.phone) diagnosis.willSkip.push(`phone (already set: ${restaurant.phone})`);
        else diagnosis.willSkip.push('phone (not in Places result)');

        if (!restaurant.websiteUrl && website) diagnosis.willUpdate.push(`website → ${website}`);
        else if (restaurant.websiteUrl) diagnosis.willSkip.push(`website (already set)`);
        else diagnosis.willSkip.push('website (not in Places result)');

        if ((restaurant.photos?.length ?? 0) === 0 && photoCount > 0) {
          diagnosis.willUpdate.push('photo (will download first Places photo)');
        } else if ((restaurant.photos?.length ?? 0) > 0) {
          diagnosis.willSkip.push(`photo (restaurant already has ${restaurant.photos.length} photo(s))`);
        } else {
          diagnosis.willSkip.push('photo (no photos in Places result)');
        }
      }
    }

    // Claude
    if (!this.anthropic) {
      diagnosis.claude = {
        status: 'skipped',
        reason: 'ANTHROPIC_API_KEY not configured',
        generatedDescription: null,
      };
      diagnosis.willSkip.push('description (no API key)');
    } else {
      try {
        const editorial = diagnosis.places?.editorialSummary ?? undefined;
        const generated = await this.generateDescription(
          restaurant.name,
          restaurant.address,
          restaurant.city?.name,
          editorial,
        );
        diagnosis.claude = {
          status: generated ? 'ok' : 'error',
          reason: generated ? 'Successfully generated' : 'Claude returned empty response',
          generatedDescription: generated,
        };
        const action = diagnosis.restaurant.hasDescription ? 'replace existing' : 'new';
        if (generated) diagnosis.willUpdate.push(`description (Claude — ${action})`);
      } catch (err) {
        diagnosis.claude = {
          status: 'error',
          reason: (err as Error).message,
          generatedDescription: null,
        };
        diagnosis.willSkip.push(`description (Claude error: ${(err as Error).message})`);
      }
    }

    return diagnosis;
  }

  private async fetchPlaceDetails(
    name: string,
    address: string,
  ): Promise<PlaceDetailsResponse['result'] | null> {
    try {
      const query = encodeURIComponent(`${name} ${address}`);
      const searchUrl =
        `https://maps.googleapis.com/maps/api/place/findplacefromtext/json` +
        `?input=${query}&inputtype=textquery&fields=place_id&key=${this.googleKey}`;

      const searchRes = await fetch(searchUrl);
      const searchData = (await searchRes.json()) as PlaceSearchResponse;

      if (searchData.status !== 'OK' || !searchData.candidates.length) {
        this.logger.warn(`[Enrich] No Places match for: ${name}`);
        return null;
      }

      const placeId = searchData.candidates[0].place_id;
      const fields = 'editorial_summary,formatted_phone_number,website,photos';
      const detailUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${placeId}&fields=${fields}&key=${this.googleKey}`;

      const detailRes = await fetch(detailUrl);
      const detailData = (await detailRes.json()) as PlaceDetailsResponse;

      if (detailData.status !== 'OK') {
        this.logger.warn(`[Enrich] Places details status ${detailData.status} for ${name}`);
        return null;
      }

      return detailData.result;
    } catch (err) {
      this.logger.error('[Enrich] Google Places API error', err);
      return null;
    }
  }

  private async downloadPlacePhoto(
    restaurantId: number,
    photoReference: string,
    uploaderId: number,
  ): Promise<boolean> {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/photo` +
        `?maxwidth=1200&photo_reference=${photoReference}&key=${this.googleKey}`;

      const res = await fetch(url);
      if (!res.ok) return false;

      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;

      mkdirSync(this.uploadPath, { recursive: true });
      await writeFile(join(this.uploadPath, filename), buffer);

      const photo = this.photoRepo.create({
        restaurantId,
        filePath: `/api/uploads/${filename}`,
        fileName: filename,
        mimeType: 'image/jpeg',
        sortOrder: 0,
        uploadedBy: uploaderId,
      });
      await this.photoRepo.save(photo);
      return true;
    } catch (err) {
      this.logger.error('[Enrich] Photo download failed', err);
      return false;
    }
  }

  private async generateDescription(
    name: string,
    address: string,
    cityName?: string,
    editorial?: string,
  ): Promise<string | null> {
    if (!this.anthropic) return null;
    try {
      const context = editorial ? `\nGoogle says: "${editorial}"` : '';
      const message = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content:
              `Write a 2–3 sentence description for "${name}", a restaurant at ${address}` +
              `${cityName ? ` in ${cityName}` : ''}.${context}` +
              `\n\nMake it warm and inviting for a group dinner. Output only the description text.`,
          },
        ],
      });
      const block = message.content[0];
      return block.type === 'text' ? block.text.trim() : null;
    } catch (err) {
      this.logger.error('[Enrich] Claude API error', err);
      return null;
    }
  }
}
