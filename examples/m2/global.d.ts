import type { ICEPreparedStats } from 'ice3';

declare global {
  interface Window {
    __ice3Conformance: {
      load(id: string): Promise<void>;
      state(): {
        format: string | null;
        state: string | null;
        status: string;
        pixelRatio: number;
        names: string[];
        stats: ICEPreparedStats | null;
        contractStatus: 'active' | 'legacy' | null;
      };
      probePixels(): number;
    };
  }
}

export {};
