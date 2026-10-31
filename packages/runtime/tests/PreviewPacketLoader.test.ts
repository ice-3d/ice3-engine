import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { parsePreviewGeometryPacket } from '@ice3/assets';
import { ICEPreviewPacketLoader } from '../src/asset/ICEPreviewPacketLoader';
import {
  fullPacketFixture,
  transformOnlyDeltaBytesFixture,
} from '../../assets/tests/fixtures/previewGeometry';

it('reports GLB fallback when a packet is malformed', async () => {
  const loader = new ICEPreviewPacketLoader(
    fetchReturning(new Uint8Array([1, 2, 3])),
  );

  const result = await loader.load('/preview-packets/4');

  expect(result).toEqual({
    kind: 'fallback',
    reason: 'packet-invalid',
  });
});

it('applies a matching delta before publishing a packet', async () => {
  const current = parsePreviewGeometryPacket(fullPacketFixture());
  const loader = new ICEPreviewPacketLoader(
    fetchReturning(transformOnlyDeltaBytesFixture()),
  );

  const result = await loader.load('/preview-packets/5', current);

  expect(result.kind).toBe('packet');
  if (result.kind === 'packet') {
    expect(result.packet.revision).toBe(5);
    expect(result.packet.nodes[0]?.matrix[12]).toBe(4);
  }
});

function fetchReturning(bytes: Uint8Array): typeof fetch {
  return async () => new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
  });
}
