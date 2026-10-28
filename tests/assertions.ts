import { expect as baseExpect } from 'expect';

function decorateAssertion(assertion: object) {
  return new Proxy(assertion, {
    get(target, property, receiver) {
      if (property === 'toThrowError') {
        return target.toThrow;
      }
      if (
        property === 'not'
        || property === 'rejects'
        || property === 'resolves'
      ) {
        return decorateAssertion(Reflect.get(target, property, receiver));
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function createExpectation(actual: unknown) {
  return decorateAssertion(baseExpect(actual));
}

function createPollProxy(
  actual: () => unknown,
  path: readonly string[] = [],
) {
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') {
        return undefined;
      }
      if (
        property === 'not'
        || property === 'rejects'
        || property === 'resolves'
      ) {
        return createPollProxy(actual, [...path, property]);
      }
      return async (...expected: unknown[]) => {
        const deadline = Date.now() + 1_000;
        let lastError: unknown;
        do {
          try {
            const assertion = createExpectation(actual()) as unknown as Record<
              string,
              (...args: unknown[]) => void
            >;
            const matchers = path.reduce<unknown>(
              (value, key) => (
                value as Record<string, unknown>
              )[key],
              assertion,
            ) as Record<
              string,
              (...args: unknown[]) => void
            >;
            matchers[property]!(...expected);
            return;
          } catch (error) {
            lastError = error;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        } while (Date.now() < deadline);
        throw lastError;
      };
    },
  });
}

function poll(actual: () => unknown) {
  return createPollProxy(actual);
}

export const expect = new Proxy(baseExpect, {
  apply(_target, _thisArg, args) {
    return createExpectation(args[0]);
  },
  get(target, property, receiver) {
    if (property === 'poll') {
      return poll;
    }
    return Reflect.get(target, property, receiver);
  },
}) as typeof baseExpect & { poll: typeof poll };
