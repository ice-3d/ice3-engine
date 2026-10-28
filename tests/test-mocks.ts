import {
  fn,
  spyOn as createSpy,
  type MockInstance,
} from 'jest-mock';

const activeSpies = new Set<MockInstance>();

export function spyOn<T extends object, K extends keyof T>(
  object: T,
  method: K,
) {
  const spy = createSpy(object, method);
  activeSpies.add(spy);
  return spy;
}

export function restoreAllMocks(): void {
  for (const spy of activeSpies) {
    spy.mockRestore();
  }
  activeSpies.clear();
}

export { fn };
