'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as KonvaImage, Layer } from 'react-konva';
import type { ImageryConfig } from '@garden-studio/schema';
import type { CanvasTransform } from '@/lib/canvas-transform';
import type { LocalFrame } from '@/lib/geo/local-frame';
import { TileCache } from '@/lib/geo/tile-cache';
import { parentTile, placeTile, tileKey, visibleTiles, type PlacedTile } from '@/lib/geo/tiles';
import { tileZoomFor } from '@/lib/geo/web-mercator';
import { useDevicePixelRatio } from '@/lib/materials/use-device-pixel-ratio';

/**
 * Aerial imagery under the plan, as a layer of the same stage everything else is drawn on.
 *
 * Not a map SDK underneath a transparent canvas. That would be a second camera to keep in step
 * with this one on every frame of the eased zoom, a second WebGL context with the three traps
 * `render/pixi/` records, and a renderer no test can reach — for the sake of tile fetching, which
 * is what this file does in a hundred lines. Every tile is positioned by the same `metresToPx`
 * every handle uses, so the picture sits under the corners by construction.
 *
 * **The imagery has no authority.** It is a reference the user traces over; nothing measures off
 * it, nothing stores it, and the plan is dimensionally identical with the layer deleted.
 *
 * Fetching is deferred while the viewport is easing. A wheel gesture sweeps through several zoom
 * levels and requesting tiles for each is bandwidth spent on pixels nobody sees; drawing from
 * the cache carries on every frame, so the picture never blanks. While a tile is on its way the
 * one above it is drawn scaled in its place, so a zoom-in sharpens rather than flickers.
 */

export interface ImageryStatus {
  loaded: number;
  total: number;
}

/** Module-level, like the surface pattern cache: the imagery survives a re-mount of the canvas. */
const cache = new TileCache();

export function ImageryLayer({
  transform,
  frame,
  config,
  zooming,
  onStatus,
}: {
  transform: CanvasTransform;
  frame: LocalFrame;
  config: ImageryConfig;
  /** The viewport is mid-ease: draw from cache, but do not start loads. */
  zooming: boolean;
  onStatus?: (status: ImageryStatus) => void;
}) {
  const pixelRatio = useDevicePixelRatio();
  const retina = pixelRatio > 1 && config.retinaTemplate !== null;

  // Bumped when a tile lands, which is the only reason to redraw that the props do not carry.
  const [, setLanded] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const zoom = tileZoomFor(transform.scale, frame.anchor.latitude, config);
  const tiles = useMemo(() => visibleTiles(transform, frame, zoom), [transform, frame, zoom]);

  const keyFor = (tile: PlacedTile['tile']) => `${config.provider}:${tileKey(tile)}@${retina ? 2 : 1}`;
  const urlFor = (tile: PlacedTile['tile']) =>
    (retina ? config.retinaTemplate! : config.tileTemplate)
      .replaceAll('{z}', String(tile.z))
      .replaceAll('{x}', String(tile.x))
      .replaceAll('{y}', String(tile.y));

  // Request what is missing — once the view has settled — and cancel what has scrolled away.
  useEffect(() => {
    const wanted = new Set(tiles.map((placed) => keyFor(placed.tile)));
    cache.abortExcept(wanted);
    if (zooming) return;

    for (const placed of tiles) {
      const key = keyFor(placed.tile);
      if (cache.has(key) || cache.isLoading(key) || cache.hasFailed(key)) continue;
      void cache.load(key, urlFor(placed.tile)).then((landed) => {
        if (landed && mounted.current) setLanded((n) => n + 1);
      });
    }
    // `keyFor`/`urlFor` close over config and retina, both of which are in the deps by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, zooming, config.provider, config.tileTemplate, config.retinaTemplate, retina]);

  const ready = tiles.filter((placed) => cache.has(keyFor(placed.tile)));

  useEffect(() => {
    onStatus?.({ loaded: ready.length, total: tiles.length });
  }, [onStatus, ready.length, tiles.length]);

  /*
   * Stand-ins for tiles still loading: the parent tile, drawn at its own placement so it lands
   * exactly under the four children it covers. Each parent once, and only when it is cached.
   */
  const standIns = new Map<string, PlacedTile>();
  for (const placed of tiles) {
    if (cache.has(keyFor(placed.tile))) continue;
    const parent = parentTile(placed.tile);
    if (!parent) continue;
    const parentKey = keyFor(parent);
    if (!cache.has(parentKey) || standIns.has(parentKey)) continue;
    standIns.set(parentKey, placeTile(parent, frame, transform));
  }

  return (
    <Layer listening={false}>
      {[...standIns.entries()].map(([key, placed]) => (
        <KonvaImage
          key={`parent-${key}`}
          image={cache.get(key)}
          x={placed.left}
          y={placed.top}
          width={placed.width}
          height={placed.height}
        />
      ))}
      {ready.map((placed) => (
        <KonvaImage
          key={placed.key}
          image={cache.get(keyFor(placed.tile))}
          x={placed.left}
          y={placed.top}
          width={placed.width}
          height={placed.height}
        />
      ))}
    </Layer>
  );
}
