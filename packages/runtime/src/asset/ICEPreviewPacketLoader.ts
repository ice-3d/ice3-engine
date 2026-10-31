import {
  applyPreviewGeometryDelta,
  parsePreviewGeometryPacket,
  type ICEPreviewGeometryPacket,
} from '@ice3/assets';
import type {
  ICEGeometryBufferUpdate,
  ICEIndexedGeometry,
  ICEScene,
} from '@ice3/core';
import {
  buildPreviewPacketScene,
  type ICEBuiltPreviewPacket,
} from './ICEAssetSceneBuilder.js';

export type ICEPreviewPacketFallbackReason =
  | 'packet-unavailable'
  | 'packet-invalid'
  | 'packet-revision-mismatch';

export type ICEPreviewPacketLoadResult =
  | {
      readonly kind: 'packet';
      readonly packet: ICEPreviewGeometryPacket;
    }
  | {
      readonly kind: 'fallback';
      readonly reason: ICEPreviewPacketFallbackReason;
    };

export interface ICEPreviewPacketLoaderOptions {
  readonly fetch?: typeof fetch;
  readonly pinGeometry?: (
    geometry: ICEIndexedGeometry,
    update?: ICEGeometryBufferUpdate,
  ) => void;
}

export class ICEPreviewPacketLoader {
  private readonly fetcher: typeof fetch;
  private readonly pinGeometry: ICEPreviewPacketLoaderOptions['pinGeometry'];
  private geometries: ReadonlyMap<string, ICEIndexedGeometry> = new Map();
  private publishedScene: ICEScene | null = null;

  constructor(options: ICEPreviewPacketLoaderOptions | typeof fetch = {}) {
    const normalized = typeof options === 'function'
      ? { fetch: options }
      : options;
    this.fetcher = normalized.fetch ?? globalThis.fetch.bind(globalThis);
    this.pinGeometry = normalized.pinGeometry;
  }

  get scene(): ICEScene | null {
    return this.publishedScene;
  }

  get currentGeometries(): ReadonlyMap<string, ICEIndexedGeometry> {
    return this.geometries;
  }

  async load(
    url: string,
    current?: ICEPreviewGeometryPacket,
  ): Promise<ICEPreviewPacketLoadResult> {
    let bytes: Uint8Array;
    try {
      const response = await this.fetcher(url, {
        headers: {
          accept: 'application/vnd.ice3.preview-geometry; version=1',
        },
      });
      if (!response.ok) {
        return { kind: 'fallback', reason: 'packet-unavailable' };
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      return { kind: 'fallback', reason: 'packet-unavailable' };
    }

    let incoming: ICEPreviewGeometryPacket;
    try {
      incoming = parsePreviewGeometryPacket(bytes);
    } catch {
      return { kind: 'fallback', reason: 'packet-invalid' };
    }
    let packet = incoming;
    if (incoming.parentRevision !== null) {
      if (!current || incoming.parentRevision !== current.revision) {
        return { kind: 'fallback', reason: 'packet-revision-mismatch' };
      }
      packet = applyPreviewGeometryDelta(current, incoming);
    }

    let built: ICEBuiltPreviewPacket;
    try {
      built = buildPreviewPacketScene(packet, this.geometries);
      if (this.pinGeometry) {
        for (const [geometryId, update] of built.geometryUpdates) {
          const geometry = built.geometries.get(geometryId);
          if (!geometry) {
            throw new Error('ICE3_PREVIEW_PACKET_INVALID: geometry is missing');
          }
          this.pinGeometry(geometry, update);
        }
      }
    } catch {
      return { kind: 'fallback', reason: 'packet-invalid' };
    }

    this.geometries = built.geometries;
    this.publishedScene = built.scene;
    return { kind: 'packet', packet };
  }
}
