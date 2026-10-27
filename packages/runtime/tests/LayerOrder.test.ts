import { expect, it } from 'node-test';
import {
  ICE2DLayer,
  ICE2DLayerRouter,
  ICELabel,
  ICEScreenLayer,
} from '../src/index';

it('treats the later injected layer as topmost for equal order', () => {
  const first = new ICEScreenLayer({ id: 'first', order: 5 });
  const second = new ICEScreenLayer({ id: 'second', order: 5 });
  first.addChild(
    new ICELabel({ id: 'a', text: 'A', screenPosition: [10, 10], interactive: true }),
  );
  second.addChild(
    new ICELabel({ id: 'b', text: 'B', screenPosition: [10, 10], interactive: true }),
  );
  const router = new ICE2DLayerRouter(() => [first, second]);

  expect(first).toBeInstanceOf(ICE2DLayer);
  expect(router.hitTest({ x: 12, y: 12 })?.label.id).toBe('b');
});

it('removes a label and its cached bounds', () => {
  const layer = new ICEScreenLayer({ id: 'screen' });
  const label = new ICELabel({
    id: 'hud',
    text: '运行',
    screenPosition: [10, 10],
    interactive: true,
  });
  layer.addChild(label);
  expect(layer.hitTest({ x: 12, y: 12 })).toBe(label);
  layer.removeChild(label);
  expect(layer.hitTest({ x: 12, y: 12 })).toBeUndefined();
});
