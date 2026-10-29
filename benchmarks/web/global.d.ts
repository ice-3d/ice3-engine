import type {
  ICEBenchmarkRun,
  ICEBenchmarkRunRequest,
} from './main';

declare global {
  interface Window {
    __ice3Benchmark: {
      run(request: ICEBenchmarkRunRequest): Promise<ICEBenchmarkRun>;
    };
  }
}

export {};
