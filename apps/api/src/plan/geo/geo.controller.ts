import {
  Body,
  Controller,
  Get,
  Header,
  Ip,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  GeocodeRequestSchema,
  type GeocodeRequest,
  type GeocodeResponse,
  type ImageryConfig,
} from '@garden-studio/schema';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { GeoService } from './geo.service.js';

const geocodeBody = new ZodValidationPipe(GeocodeRequestSchema);

/**
 * Three small routes for the aerial-mapping flow. Geocoding is a POST so the address travels
 * in the body rather than in a URL that every access log keeps.
 */
@Controller()
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('imagery/config')
  imageryConfig(): ImageryConfig {
    return this.geo.imageryConfig();
  }

  /**
   * `y` may carry an `@2x` suffix for a high-density tile, matching the public template.
   * Anything else on the end is a 404, not a parse error.
   */
  @Get('imagery/tiles/:z/:x/:y')
  @Header('Cache-Control', 'public, max-age=86400')
  async tile(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y') yParam: string,
    @Ip() ip: string,
  ): Promise<StreamableFile> {
    const match = /^(\d+)(@2x)?$/.exec(yParam);
    if (!match) throw new NotFoundException('No such tile.');

    const { body, contentType } = await this.geo.tile(
      { z, x, y: Number(match[1]) },
      match[2] === '@2x',
      ip,
    );
    return new StreamableFile(body, { type: contentType, length: body.byteLength });
  }

  @Post('geocode')
  async geocode(@Body(geocodeBody) body: GeocodeRequest, @Ip() ip: string): Promise<GeocodeResponse> {
    return { results: await this.geo.geocode(body.query, ip) };
  }
}
