import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import * as mockApi from '../../../tests/test-mocks.ts';
import { ICEScreenLayer } from '../src/index';
import { ICE2DCanvasPainter } from '../src/layer/ICE2DCanvasPainter';

it('does not reset an unchanged Canvas backing store', () => {
  const layer = new ICEScreenLayer({ id: 'screen' });
  const context = {
    setTransform: mockApi.fn(),
    clearRect: mockApi.fn(),
    save: mockApi.fn(),
    restore: mockApi.fn(),
    fillRect: mockApi.fn(),
    fillText: mockApi.fn(),
    measureText: mockApi.fn(() => ({ width: 20 })),
    font: '',
    textBaseline: 'top',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  let width = 640;
  let height = 360;
  let widthWrites = 0;
  let heightWrites = 0;
  const canvas = {
    get width() {
      return width;
    },
    set width(value: number) {
      width = value;
      widthWrites += 1;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = value;
      heightWrites += 1;
    },
    getContext: mockApi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  const painter = new ICE2DCanvasPainter();

  painter.paint(canvas, [layer], { x: 0, y: 0, width: 640, height: 360 }, 1);
  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(360);
  expect(widthWrites).toBe(0);
  expect(heightWrites).toBe(0);
  expect(context.clearRect).toHaveBeenCalledTimes(1);
});
