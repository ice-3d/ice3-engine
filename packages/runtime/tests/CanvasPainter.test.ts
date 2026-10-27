import { expect, it, vi } from 'node-test';
import { ICEScreenLayer } from '../src/index';
import { ICE2DCanvasPainter } from '../src/layer/ICE2DCanvasPainter';

it('does not reset an unchanged Canvas backing store', () => {
  const layer = new ICEScreenLayer({ id: 'screen' });
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
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
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  const painter = new ICE2DCanvasPainter();

  painter.paint(canvas, [layer], { x: 0, y: 0, width: 640, height: 360 }, 1);
  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(360);
  expect(widthWrites).toBe(0);
  expect(heightWrites).toBe(0);
  expect(context.clearRect).toHaveBeenCalledTimes(1);
});
