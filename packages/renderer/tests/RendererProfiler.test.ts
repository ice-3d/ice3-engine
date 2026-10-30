import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { RendererProfiler } from '../src/RendererProfiler';

it('records four non-negative stage durations when enabled', () => {
  const profiler = new RendererProfiler();
  profiler.enable(true);
  profiler.begin();
  profiler.mark('collect');
  profiler.mark('prepareAndUpload');
  profiler.mark('encode');
  profiler.mark('submit');
  const profile = profiler.end();

  expect(profile).not.toBeNull();
  for (const value of Object.values(profile!)) {
    expect(value).toBeGreaterThanOrEqual(0);
  }
});

it('performs no profile work while disabled', () => {
  const profiler = new RendererProfiler();
  profiler.begin();
  profiler.mark('collect');
  expect(profiler.end()).toBeNull();
});
