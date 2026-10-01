'use client';

import Image from 'next/image';
import { useId } from 'react';
import { isPlantSymbol, type DesignElement } from '@garden-studio/schema';
import {
  canopiesForSymbol,
  materialAssets,
  speciesPin,
  SYMBOL_SPRITES,
} from '@/lib/materials/assets/material-assets';
import { catalogueEntry } from '@/lib/materials/assets/catalogue';
import type { AssetId } from '@/lib/materials/assets/asset-spec';

/** The catalogue uses the same local pictures as the plan, with no image-model request. */
export function CatalogueThumbnail({
  element,
  className = '',
}: {
  element: Pick<DesignElement, 'category' | 'symbol' | 'material' | 'plantId'>;
  className?: string;
}) {
  const gradientId = useId();
  let family: AssetId | undefined;
  let variant = 1;
  /* A species is shown by its own picture — the one the plan draws it with. */
  const pin = speciesPin(element.plantId);
  if (pin) {
    family = pin.family;
    variant = pin.index + 1;
  } else if (element.plantId || (element.symbol && isPlantSymbol(element.symbol))) {
    family =
      SYMBOL_SPRITES[element.symbol as keyof typeof SYMBOL_SPRITES] ??
      canopiesForSymbol(element.symbol, element.plantId)[0];
  } else if (element.symbol) {
    family = SYMBOL_SPRITES[element.symbol as keyof typeof SYMBOL_SPRITES];
  }
  const material = element.material ? materialAssets(element.material) : undefined;
  if (!family && element.category !== 'structure') family = material?.face ?? material?.texture;
  const asset = family ? (catalogueEntry(family, variant) ?? catalogueEntry(family, 1)) : null;
  if (asset)
    return (
      <Image
        unoptimized
        src={`/assets/${asset.file}`}
        width={96}
        height={96}
        alt=""
        className={`h-full w-full object-contain ${className}`}
      />
    );

  // Scalable overhead architectural previews for structures whose sizes vary on the plan.
  return (
    <svg viewBox="0 0 96 80" aria-hidden className={`h-full w-full ${className}`}>
      <defs>
        <linearGradient id={gradientId} x2="1" y2="1">
          <stop stopColor="#d2b48a" />
          <stop offset="1" stopColor="#8c6845" />
        </linearGradient>
      </defs>
      <rect x="14" y="15" width="70" height="57" rx="3" fill="#24382a" opacity=".12" />
      <rect
        x="10"
        y="10"
        width="70"
        height="57"
        rx="2"
        fill={`url(#${gradientId})`}
        stroke="#6c533d"
      />
      {element.symbol === 'shed' ? (
        <>
          <path d="M10 38H80V10H10Z" fill="#526265" />
          <path d="M10 38H80V67H10Z" fill="#354246" />
          <path d="M10 38H80" stroke="#899694" strokeWidth="2" />
          {[20, 30, 40, 50, 60, 70].map((x) => (
            <path key={x} d={`M${x} 10V67`} stroke="#91a0a0" opacity=".3" />
          ))}
        </>
      ) : element.symbol === 'gazebo' ? (
        // A hipped roof from above: four planes meeting at a finial.
        <>
          <path d="M10 10L45 38.5L80 10Z" fill="#6f5a47" />
          <path d="M80 10L45 38.5L80 67Z" fill="#5a4838" />
          <path d="M10 67L45 38.5L80 67Z" fill="#4a3b2e" />
          <path d="M10 10L45 38.5L10 67Z" fill="#7d6653" />
          <path d="M10 10L80 67M80 10L10 67" stroke="#3d3026" strokeWidth="1.5" />
          <circle cx="45" cy="38.5" r="3" fill="#2f251d" />
        </>
      ) : (
        <>
          {[16, 25, 34, 43, 52, 61, 70, 77].map((x) => (
            <path key={x} d={`M${x} 10V67`} stroke="#755535" strokeWidth="3" />
          ))}
          {[14, 72].flatMap((x) =>
            [14, 59].map((y) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="5" height="5" fill="#543e2e" />
            )),
          )}
        </>
      )}
    </svg>
  );
}
