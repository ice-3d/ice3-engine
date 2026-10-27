// @node-test-environment jsdom

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

it('updates label text and remeasures without replacing the label', () => {
  const label = new ICELabel({
    id: 'selection',
    text: 'A',
    screenPosition: [10, 20],
  });
  const context = {
    measureText: (text: string) => ({ width: [...text].length * 14 }),
  } as unknown as CanvasRenderingContext2D;
  const before = label.measure(context).width;
  label.setText('A much longer equipment name');
  const after = label.measure(context);
  expect(label.text).toBe('A much longer equipment name');
  expect(after.width).toBeGreaterThan(before);
  expect(after.y).toBe(20);
});

it('keeps an updated screen position after measuring', () => {
  const label = new ICELabel({
    id: 'selection',
    text: '设备',
    screenPosition: [10, 20],
  });
  const context = {
    measureText: (text: string) => ({ width: [...text].length * 14 }),
  } as unknown as CanvasRenderingContext2D;

  label.setScreenPosition([30, 40]);
  const measured = label.measure(context);

  expect(measured.x).toBe(30);
  expect(measured.y).toBe(40);
});
