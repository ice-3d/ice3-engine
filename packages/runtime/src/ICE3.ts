import {
  ICEEngineError,
  ICEEventDispatcher,
  ICEPerspectiveCamera,
  ICEScene,
  type ICEDiagnostic,
  type ICENode,
} from '@ice3/core';
import {
  WebGL2RendererBackend,
  type ICERendererBackend,
  type ICEViewport,
} from '@ice3/renderer';
import { ICE2DCanvasPainter } from './layer/ICE2DCanvasPainter';
import { ICE2DLayer } from './layer/ICE2DLayer';
import { ICE2DLayerRouter } from './layer/ICE2DLayerRouter';
import { ICEWorldLayer } from './layer/ICEWorldLayer';
import { ICEInteractionState } from './ICEInteractionState';
import { projectWorldPoint, type ICEProjectedPoint } from './ICEProjection';
import {
  BrowserRenderScheduler,
  type ICERenderScheduler,
} from './ICERenderScheduler';
import type { ICEVector3Tuple } from '@ice3/core';

export type ICE3Options = {
  readonly backend?: ICERendererBackend;
  readonly scheduler?: ICERenderScheduler;
};

export type ICEEngineDiagnostics = {
  readonly frameId: number;
  readonly fps: number;
  readonly cpuFrameTimeMs: number;
  readonly backend: Readonly<{
    backend: 'webgl2' | 'fake';
    maxTextureSize: number;
  }>;
  readonly nodeCount: number;
  readonly layerCount: number;
  readonly labelCount: number;
  readonly dpr: number;
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly viewport: Readonly<ICEViewport>;
  readonly contextLossCount: number;
  readonly labels: readonly Readonly<{
    id: string;
    layerId: string;
    rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>[];
  readonly lastDiagnostic?: Readonly<ICEDiagnostic>;
};

type EngineState = 'created' | 'initialized' | 'running' | 'stopped' | 'destroyed';

export class ICE3 extends ICEEventDispatcher {
  private readonly backend: ICERendererBackend;
  private readonly scheduler: ICERenderScheduler;
  private readonly interaction = new ICEInteractionState();
  private readonly layers: ICE2DLayer[] = [];
  private readonly layerRouter = new ICE2DLayerRouter(() => this.layers);
  private readonly layerPainter = new ICE2DCanvasPainter();
  private state: EngineState = 'created';
  private host: HTMLElement | null = null;
  private baseCanvas: HTMLCanvasElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private generatedBaseCanvas = false;
  private generatedOverlayCanvas = false;
  private scene: ICEScene | null = null;
  private camera: ICEPerspectiveCamera | null = null;
  private viewport: ICEViewport = { x: 0, y: 0, width: 1, height: 1 };
  private dpr = 1;
  private frameId = 0;
  private renderPending = false;
  private lastFrameAt = 0;
  private fps = 0;
  private cpuFrameTimeMs = 0;
  private contextLossCount = 0;
  private lastDiagnostic: ICEDiagnostic | undefined;

  constructor(options: ICE3Options = {}) {
    super();
    this.backend = options.backend ?? new WebGL2RendererBackend();
    this.scheduler = options.scheduler ?? new BrowserRenderScheduler();
  }

  init(target: string | HTMLDivElement | HTMLCanvasElement): this {
    if (this.state !== 'created') {
      throw new ICEEngineError(
        'ICE3_ALREADY_INITIALIZED',
        'ICE3 engine can only be initialized once',
      );
    }

    if (typeof target === 'string') {
      const element = document.querySelector<HTMLElement>(target);
      if (!element) {
        throw new ICEEngineError(
          'ICE3_INVALID_TARGET',
          `ICE3_INVALID_TARGET: target not found: ${target}`,
        );
      }
      this.configureTarget(element);
    } else {
      this.configureTarget(target);
    }

    const canvas = this.baseCanvas;
    if (!canvas) {
      throw new ICEEngineError('ICE3_INVALID_TARGET', 'ICE3 canvas was not created');
    }

    this.backend.initialize({
      canvas,
      onContextLost: () => {
        this.contextLossCount += 1;
        this.trigger('CONTEXT_LOST');
      },
      onContextRestored: () => {
        this.trigger('CONTEXT_RESTORED');
        this.requestRender('context-restored');
      },
    });
    this.state = 'initialized';
    this.resize();
    return this;
  }

  setScene(scene: ICEScene): this {
    this.assertActive();
    this.scene = scene;
    this.requestRender('scene-changed');
    return this;
  }

  setCamera(camera: ICEPerspectiveCamera): this {
    this.assertActive();
    this.camera = camera;
    this.requestRender('camera-changed');
    return this;
  }

  addLayer(layer: ICE2DLayer): this {
    this.assertActive();
    if (this.layers.some((item) => item.id === layer.id)) {
      throw new ICEEngineError(
        'ICE3_LAYER_ORDER_CONFLICT',
        `Duplicate ICE layer ID: ${layer.id}`,
      );
    }
    this.layers.push(layer);
    this.layers.sort((left, right) => left.order - right.order);
    this.requestRender('layer-added');
    return this;
  }

  removeLayer(layer: ICE2DLayer): this {
    const index = this.layers.indexOf(layer);
    if (index >= 0) {
      this.layers.splice(index, 1);
      this.requestRender('layer-removed');
    }
    return this;
  }

  start(): this {
    this.assertActive();
    if (this.state === 'running') {
      return this;
    }
    this.state = 'running';
    this.requestRender('started');
    return this;
  }

  stop(): this {
    this.assertActive();
    this.scheduler.cancelAll();
    this.renderPending = false;
    this.state = 'stopped';
    return this;
  }

  requestRender(_reason = 'requested'): this {
    this.assertActive();
    if (this.state !== 'running') {
      return this;
    }
    if (!this.scene || !this.camera) {
      this.recordDiagnostic(
        'ICE3_ENGINE_NOT_READY',
        'Scene and camera must be configured before rendering',
      );
      return this;
    }
    if (this.renderPending) {
      return this;
    }
    this.renderPending = true;
    this.scheduler.request(() => {
      this.renderPending = false;
      this.renderFrame();
    });
    return this;
  }

  project(position: ICEVector3Tuple): ICEProjectedPoint {
    this.assertActive();
    if (!this.camera) {
      throw new ICEEngineError('ICE3_ENGINE_NOT_READY', 'Camera is not configured');
    }
    return projectWorldPoint(this.camera, position, this.viewport);
  }

  getSelection(): readonly string[] {
    return this.interaction.getSelection();
  }

  setSelection(ids: readonly string[]): this {
    this.interaction.setSelection(ids);
    this.trigger('SELECTION_CHANGE', { selection: this.getSelection() });
    this.requestRender('selection-changed');
    return this;
  }

  getDiagnostics(): Readonly<ICEEngineDiagnostics> {
    return {
      frameId: this.frameId,
      fps: this.fps,
      cpuFrameTimeMs: this.cpuFrameTimeMs,
      backend: this.backend.capabilities,
      nodeCount: this.scene ? countNodes(this.scene) : 0,
      layerCount: this.layers.length,
      labelCount: this.layers.reduce(
        (total, layer) => total + layer.getLabels().length,
        0,
      ),
      dpr: this.dpr,
      canvas: {
        width: this.baseCanvas?.width ?? 0,
        height: this.baseCanvas?.height ?? 0,
      },
      viewport: { ...this.viewport },
      contextLossCount: this.contextLossCount,
      labels: this.layers.flatMap((layer) =>
        layer.getLabels().map((label) => ({
          id: label.id,
          layerId: layer.id,
          rect: label.getRect(),
        })),
      ),
      ...(this.lastDiagnostic ? { lastDiagnostic: this.lastDiagnostic } : {}),
    };
  }

  destroy(): void {
    if (this.state === 'destroyed') {
      return;
    }
    this.scheduler.cancelAll();
    this.renderPending = false;
    for (const layer of this.layers.splice(0)) {
      layer.dispose();
    }
    this.backend.dispose();
    if (this.generatedOverlayCanvas) {
      this.overlayCanvas?.remove();
    }
    if (this.generatedBaseCanvas) {
      this.baseCanvas?.remove();
    }
    this.overlayCanvas = null;
    this.baseCanvas = null;
    this.host = null;
    this.scene = null;
    this.camera = null;
    this.state = 'destroyed';
    this.trigger('DESTROY');
  }

  resize(): this {
    this.assertActive();
    if (!this.host || !this.baseCanvas || !this.overlayCanvas) {
      return this;
    }
    const bounds = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || this.host.clientWidth));
    const height = Math.max(1, Math.round(bounds.height || this.host.clientHeight));
    this.dpr = window.devicePixelRatio || 1;
    this.viewport = { x: 0, y: 0, width, height };
    this.backend.resize(this.viewport, this.dpr);
    this.overlayCanvas.width = Math.round(width * this.dpr);
    this.overlayCanvas.height = Math.round(height * this.dpr);
    this.overlayCanvas.style.width = `${width}px`;
    this.overlayCanvas.style.height = `${height}px`;
    this.trigger('RESIZE', { viewport: this.viewport, dpr: this.dpr });
    this.requestRender('resize');
    return this;
  }

  private configureTarget(target: HTMLElement): void {
    if (target instanceof HTMLCanvasElement) {
      this.baseCanvas = target;
      const parent = target.parentElement;
      if (!parent) {
        throw new ICEEngineError(
          'ICE3_INVALID_TARGET',
          'Canvas target must have a parent for the 2D layer',
        );
      }
      this.host = parent;
    } else {
      this.host = target;
      const canvas = document.createElement('canvas');
      canvas.dataset.layer = 'scene';
      this.baseCanvas = canvas;
      this.generatedBaseCanvas = true;
      target.appendChild(canvas);
    }

    if (getComputedStyle(this.host).position === 'static') {
      this.host.style.position = 'relative';
    }
    this.baseCanvas.style.position = 'absolute';
    this.baseCanvas.style.inset = '0';
    this.baseCanvas.style.width = '100%';
    this.baseCanvas.style.height = '100%';

    const overlay = document.createElement('canvas');
    overlay.dataset.layer = 'overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.pointerEvents = 'auto';
    this.overlayCanvas = overlay;
    this.generatedOverlayCanvas = true;
    this.host.appendChild(overlay);
  }

  private renderFrame(): void {
    if (this.state !== 'running' || !this.scene || !this.camera) {
      return;
    }
    const startedAt = performance.now();
    this.trigger('BEFORE_RENDER');
    this.frameId += 1;
    this.backend.render({
      frameId: this.frameId,
      scene: this.scene,
      camera: this.camera,
      viewport: this.viewport,
      dpr: this.dpr,
    });
    if (this.overlayCanvas && this.layers.length > 0) {
      if (this.scene) {
        for (const layer of this.layers) {
          if (layer instanceof ICEWorldLayer) {
            layer.prepare(this.scene, (anchorId) => {
              const node = this.scene?.findByID(anchorId);
              if (!node) {
                this.recordDiagnostic(
                  'ICE3_UNKNOWN_ANCHOR',
                  `Unknown ICE label anchor: ${anchorId}`,
                );
                return undefined;
              }
              return this.project(node.getWorldPosition().toArray());
            });
          }
        }
      }
      this.layerPainter.paint(
        this.overlayCanvas,
        this.layers,
        this.viewport,
        this.dpr,
      );
    }
    this.cpuFrameTimeMs = performance.now() - startedAt;
    if (this.lastFrameAt) {
      const frameMs = startedAt - this.lastFrameAt;
      this.fps = frameMs > 0 ? 1000 / frameMs : 0;
    }
    this.lastFrameAt = startedAt;
    this.trigger('AFTER_RENDER');
  }

  private assertActive(): void {
    if (this.state === 'destroyed') {
      throw new ICEEngineError('ICE3_ENGINE_DESTROYED', 'ICE3 engine is destroyed');
    }
  }

  private recordDiagnostic(code: string, message: string): void {
    this.lastDiagnostic = { severity: 'error', code, message };
    this.trigger('DIAGNOSTIC', this.lastDiagnostic);
  }
}

const countNodes = (node: ICENode): number =>
  1 + node.children.reduce((total, child) => total + countNodes(child), 0);

export { ICE2DLayerRouter };
