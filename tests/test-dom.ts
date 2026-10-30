export function createHost(): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperties(host, {
    clientWidth: { configurable: true, value: 640 },
    clientHeight: { configurable: true, value: 360 },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 640,
        bottom: 360,
        width: 640,
        height: 360,
        toJSON: () => ({}),
      }),
    },
  });
  document.body.appendChild(host);
  return host;
}
