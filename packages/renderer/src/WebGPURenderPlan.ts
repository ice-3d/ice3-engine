import type { ICEScene } from '@ice3/core';
import {
  collectRenderables,
  type ICEGeometryRenderable,
} from './Renderables.js';
import {
  collectInstanceBatches,
  type ICEInstanceBatch,
} from './InstanceBatch.js';
import {
  collectRenderBatches,
  type ICERenderBatchDraw,
} from './RenderBatch.js';

export type WebGPURenderPlan = Readonly<{
  scene: ICEScene;
  revision: number;
  renderables: readonly ICEGeometryRenderable[];
  instances: readonly ICEInstanceBatch[];
  batches: readonly ICERenderBatchDraw[];
  instancedMeshIds: ReadonlySet<string>;
}>;

export class WebGPURenderPlanCache {
  private scene: ICEScene | null = null;
  private current: WebGPURenderPlan | null = null;
  private readonly renderablesScratch: ICEGeometryRenderable[] = [];
  private readonly instancesScratch: ICEInstanceBatch[] = [];
  private readonly batchesScratch: ICERenderBatchDraw[] = [];

  get(scene: ICEScene): WebGPURenderPlan {
    if (
      this.current
      && this.scene === scene
      && this.current.revision === scene.revision
    ) {
      return this.current;
    }

    const renderables = collectRenderables(
      scene,
      this.renderablesScratch,
    );
    const instances = collectInstanceBatches(
      renderables,
      this.instancesScratch,
    );
    const batches = collectRenderBatches(scene, this.batchesScratch);
    const instancedMeshIds = new Set<string>();
    for (const instance of instances) {
      for (const id of instance.meshIds) instancedMeshIds.add(id);
    }
    this.scene = scene;
    this.current = Object.freeze({
      scene,
      revision: scene.revision,
      renderables: Object.freeze([...renderables]),
      instances: Object.freeze([...instances]),
      batches: Object.freeze([...batches]),
      instancedMeshIds,
    });
    return this.current;
  }

  invalidate(): void {
    this.scene = null;
    this.current = null;
    this.renderablesScratch.length = 0;
    this.instancesScratch.length = 0;
    this.batchesScratch.length = 0;
  }

  dispose(): void {
    this.invalidate();
  }
}
