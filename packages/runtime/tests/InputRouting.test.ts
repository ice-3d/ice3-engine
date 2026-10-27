import { expect, it } from 'node-test';
import {
  ICEInputRouter,
  type ICEInputTarget,
} from '../src/index';

const createRouterForTest = (
  hitTestLayer: (point: { x: number; y: number }) => ICEInputTarget | undefined,
) => {
  const calls: ICEInputTarget[] = [];
  const router = new ICEInputRouter({
    hitTestLayer,
    pickScene: () => ({ kind: 'scene', nodeId: 'block' }),
    dispatch: (target) => calls.push(target),
  });
  return { router, calls };
};

it('keeps pointer capture after starting on a 2D control', () => {
  const { router, calls } = createRouterForTest(() => ({
    kind: 'layer',
    layerId: 'screen',
    labelId: 'hud',
  }));

  router.pointerDown({ x: 10, y: 10 }, 1);
  router.pointerMove({ x: 200, y: 200 }, 1);
  router.pointerUp({ x: 200, y: 200 }, 1);

  expect(calls).toEqual([
    { kind: 'layer', layerId: 'screen', labelId: 'hud' },
    { kind: 'layer', layerId: 'screen', labelId: 'hud' },
    { kind: 'layer', layerId: 'screen', labelId: 'hud' },
  ]);
});

it('passes empty 2D regions to 3D picking', () => {
  const { router } = createRouterForTest(() => undefined);
  expect(router.route({ x: 200, y: 200 })?.kind).toBe('scene');
});

it('releases capture after pointer cancellation', () => {
  let secondMoveUsedLayer = false;
  const router = new ICEInputRouter({
    hitTestLayer: () => (
      secondMoveUsedLayer
        ? undefined
        : { kind: 'layer', layerId: 'screen', labelId: 'hud' }
    ),
    pickScene: () => ({ kind: 'scene', nodeId: 'block' }),
  });

  router.pointerDown({ x: 10, y: 10 }, 2);
  router.pointerCancel(2);
  secondMoveUsedLayer = true;
  expect(router.pointerMove({ x: 20, y: 20 }, 2)?.kind).toBe('scene');
});
