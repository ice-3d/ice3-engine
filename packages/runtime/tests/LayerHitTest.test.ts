import { expect, it } from 'node-test';
import {
  ICE2DLayerRouter,
  ICELabel,
  ICEScreenLayer,
  ICEWorldLayer,
} from '../src/index';

it('routes from the topmost interactive layer', () => {
  const world = new ICEWorldLayer({ id: 'world', order: 0 });
  const hud = new ICEScreenLayer({ id: 'screen', order: 10 });
  world.addChild(new ICELabel({ id: 'world', text: 'A', anchorId: 'block' }));
  hud.addChild(
    new ICELabel({
      id: 'hud',
      text: 'B',
      screenPosition: [10, 10],
      interactive: true,
    }),
  );

  const router = new ICE2DLayerRouter(() => [world, hud]);
  expect(router.hitTest({ x: 12, y: 12 })?.label.id).toBe('hud');
});

it('passes an unhit transparent region through', () => {
  const hud = new ICEScreenLayer({
    id: 'screen',
    order: 10,
    passThrough: true,
  });
  expect(
    new ICE2DLayerRouter(() => [hud]).shouldPassThrough({ x: 100, y: 100 }),
  ).toBe(true);
});

it('blocks passthrough outside a hit even when disabled', () => {
  const hud = new ICEScreenLayer({
    id: 'screen',
    order: 10,
    passThrough: false,
  });
  expect(
    new ICE2DLayerRouter(() => [hud]).shouldPassThrough({ x: 100, y: 100 }),
  ).toBe(false);
});
