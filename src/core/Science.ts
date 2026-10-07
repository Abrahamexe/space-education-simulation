/**
 * Science overlays shared by the solar and galaxy views (one switch each,
 * whichever view is shown).
 */
class ScienceLayers {
  private hz = false;
  private readonly fns = new Set<() => void>();

  /** Habitable zones (Kopparapu et al. 2014) round the Sun and the galaxy's star systems. */
  get habitableZones(): boolean {
    return this.hz;
  }

  set habitableZones(v: boolean) {
    if (v === this.hz) return;
    this.hz = v;
    this.fns.forEach((fn) => fn());
  }

  onChange(fn: () => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}

export const science = new ScienceLayers();
