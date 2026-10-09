import { computeNebula, type NebulaBuildInput } from './nebulaBuild';

// Builds SlicedNebula depth maps and particles off the main thread.
self.onmessage = (e: MessageEvent<{ id: number; input: NebulaBuildInput }>) => {
  const out = computeNebula(e.data.input);
  (self as unknown as Worker).postMessage({ id: e.data.id, out }, [out.depth.buffer, out.pos.buffer, out.col.buffer, out.size.buffer]);
};
