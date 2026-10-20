"use client";

import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { colorizeTileImage } from "@/lib/radarPalettes";

const DPC_TILE_CACHE_URL = "https://s3-prod-dpc-radar-webp-cache.s3.eu-south-1.amazonaws.com";
const TILE_SIZE = 256;
const NATIVE_ZOOM = 7;

const pad = (value) => String(value).padStart(2, "0");

function tileTimePath(timestamp) {
  const date = timestamp ? new Date(timestamp) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  const minute = Math.floor(date.getUTCMinutes() / 5) * 5;
  return (
    date.getUTCFullYear() +
    "/" + pad(date.getUTCMonth() + 1) +
    "/" + pad(date.getUTCDate()) +
    "/" + pad(date.getUTCHours()) + pad(minute)
  );
}

function tileUrl(product, timePath, coords) {
  const tileProduct = product.tileProduct || product.apiType || product.id;
  const file = tileProduct.toLowerCase();
  return `${DPC_TILE_CACHE_URL}/${tileProduct}/${timePath}/${coords.z}/${coords.x}/${coords.y}/${file}.webp`;
}

// Layer Leaflet che scarica le tile WebP DPC e le ricolora con la palette ufficiale.
export default function RadarOverlayLayer({ product, timestamp, opacity = 0.92 }) {
  const map = useMap();
  const timePath = tileTimePath(timestamp);
  const productId = product?.id || null;
  const tileProduct = product?.tileProduct || product?.apiType || productId;

  useEffect(() => {
    if (!map || !productId || !tileProduct || !timePath) return undefined;

    const RadarTileLayer = L.GridLayer.extend({
      createTile(coords, done) {
        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          try {
            ctx.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
            colorizeTileImage(ctx, productId);
            done(null, canvas);
          } catch (error) {
            done(error, canvas);
          }
        };
        image.onerror = () => done(new Error("tile radar non disponibile"), canvas);
        image.src = tileUrl(product, timePath, coords);
        return canvas;
      }
    });

    const layer = new RadarTileLayer({
      tileSize: TILE_SIZE,
      minNativeZoom: NATIVE_ZOOM,
      maxNativeZoom: NATIVE_ZOOM,
      opacity,
      className: "dpc-radar-tile dpc-radar-" + String(productId).toLowerCase(),
      pane: "overlayPane"
    });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, productId, tileProduct, timePath, opacity, product]);

  return null;
}
